import type {
  AcceptedClaim,
  FusedOutput,
  FuseFn,
  RunReport,
  StageBuilders,
  StageInput,
} from "./engine";
import {
  checkClaimReferences,
  checkRoleClaims,
  DEFAULT_HARNESS_HINT,
  type DiversityCounts,
  diversityCounts,
  HARNESS_OPTION,
  type PatternDefinition,
  type PatternOptions,
  ROSTER_OPTION,
  resolveRoster,
} from "./pattern";
import { canonicalize } from "./tier1";

export const JURY_MIN_WORKERS = 2;
export const JURY_DEFAULT_WORKERS = 3;

/**
 * Parse a comma-separated vocabulary into canonical members. Empty
 * members are dropped; members compare by canonical form so casing and
 * spacing do not split a bounded vote. Returns an error string when
 * fewer than two distinct members survive.
 */
export function parseVocabulary(raw: string): { error: string } | { members: string[] } {
  const members: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const member = part.trim();
    if (member.length === 0) {
      continue;
    }
    const key = canonicalize(member);
    if (!seen.has(key)) {
      seen.add(key);
      members.push(member);
    }
  }
  if (members.length < 2) {
    return { error: "--vocabulary must name at least two distinct answers" };
  }
  return { members };
}

export function juryWorkerPrompt(task: string, vocabulary?: readonly string[]): string {
  const vocabBlock =
    vocabulary === undefined
      ? []
      : [
          "",
          `VOCABULARY (answer with exactly one of these, verbatim, as the full claim text): ${vocabulary.join(", ")}`,
        ];
  return [
    "You are one sealed juror in an independent jury.",
    "You cannot see other jurors. Do not discuss, hedge, or ask which answer is popular.",
    "Answer the task on your own evidence and judgment.",
    "",
    `TASK: ${task}`,
    ...vocabBlock,
    "",
    "Reply with EXACTLY ONE JSON object and nothing else, with these fields:",
    '- claim_id: "C1"',
    '- kind: "answer"',
    "- claim: your answer, one self-contained sentence",
    '- status: "observed" | "documented" | "inferred" | "unknown"',
    "- confidence: number in [0,1]",
    "- falsifier: what result would change this answer",
    '- requested_action (optional): "accept" | "test" | "revise" | "escalate" | "abstain"',
    "",
    "Do NOT include a provenance field. It is tool-stamped; a claim that sets it is rejected.",
  ].join("\n");
}

/**
 * Blind merge brief. Answers are listed with their anonymized record ids
 * (worker-scoped C refs, e.g. w1:C1); cluster dependencies cite those
 * ids, which is the schema-legal cross-worker reference form.
 */
export function juryMergePrompt(listing: readonly { canonical: string; id: string }[]): string {
  return [
    "You are the merge judge in a sealed jury.",
    "You see only anonymized canonical answers: no worker ids beyond the opaque record",
    "ids below, no harness or model names, no confidences. Judge meaning only.",
    "",
    "ANSWERS (record id - answer text, one per line):",
    ...listing.map((entry) => `${entry.id} - ${entry.canonical}`),
    "",
    "Cluster answers that mean the same thing despite different wording. Reply with one",
    "JSON object per cluster and nothing else, with these fields:",
    '- claim_id: "C1", "C2", ... (your own cluster ids, one per cluster)',
    '- kind: "answer"',
    "- claim: the cluster label (the clearest member wording, verbatim)",
    '- status: "inferred", confidence [0,1] (your confidence the members mean the same thing),',
    "- falsifier: what distinction would split this cluster",
    '- dependencies: the record ids of the member answers (e.g. ["w1:C1", "w3:C1"])',
    "",
    "Every answer belongs in exactly one cluster. An answer that means nothing like any",
    "other is a cluster of one. Do NOT include a provenance field.",
  ].join("\n");
}

export interface JuryMember {
  readonly claimId: string;
  readonly confidence: number;
  readonly falsifier: string;
  readonly requestedAction: string | null;
  readonly workerId: string;
}

export interface JuryCluster {
  readonly label: string;
  readonly members: readonly string[];
}

/**
 * Build clusters from merge-stage claims. Each merge claim links member
 * canonicals by their record ids in dependencies; the label is the claim
 * text. Returns null when no usable merge claim exists, in which case
 * fusion falls back to the unmerged tally.
 */
export function juryClustersFromMerge(
  mergeClaims: readonly Record<string, unknown>[],
  listing: readonly { canonical: string; id: string }[],
): { clusters: JuryCluster[] } | null {
  if (mergeClaims.length === 0 || listing.length === 0) {
    return null;
  }
  const canonicalOf = new Map(listing.map((entry) => [entry.id, entry.canonical]));
  const clusters: JuryCluster[] = [];
  const covered = new Set<string>();
  for (const raw of mergeClaims) {
    if (raw["kind"] !== "answer") {
      continue;
    }
    const deps = raw["dependencies"];
    if (!Array.isArray(deps)) {
      continue;
    }
    const members: string[] = [];
    for (const dep of deps) {
      const id = String(dep);
      const canonical = canonicalOf.get(id);
      if (canonical === undefined || covered.has(id)) {
        continue;
      }
      covered.add(id);
      members.push(canonical);
    }
    if (members.length === 0) {
      continue;
    }
    clusters.push({ label: String(raw["claim"] ?? members[0]), members });
  }
  for (const entry of listing) {
    if (!covered.has(entry.id)) {
      clusters.push({ label: entry.canonical, members: [entry.canonical] });
    }
  }
  return clusters.length === 0 ? null : { clusters };
}

export interface JuryGroup {
  readonly canonical: string;
  readonly members: readonly JuryMember[];
  readonly votes: number;
}

export interface JuryTallyGroup {
  readonly canonical: string;
  readonly members: readonly JuryMember[];
  readonly votes: number;
}

export interface JuryDecision extends FusedOutput {
  readonly decision: Record<string, unknown> & {
    readonly decision: string | null;
    readonly diversity: DiversityCounts;
    readonly independence: {
      readonly acceptedAnswers: number;
      readonly duplicateRate: number;
      readonly groups: number;
    };
    readonly mergeClusters?: readonly { label: string; members: readonly string[] }[];
    readonly mergeFallback?: string;
    readonly minorityReport: readonly JuryTallyGroup[];
    readonly pattern: "jury";
    readonly rejectedOptions: readonly { claimId: string; reason: string }[];
    readonly residualRisks: readonly { claimId: string; confidence: number; falsifier: string }[];
    /** True when another group matched the winner's votes and definition order broke the tie. */
    readonly tie: boolean;
  };
}

function isAnswerClaim(claim: Record<string, unknown>): boolean {
  return claim["kind"] === "answer";
}

function memberOf(claim: Record<string, unknown>, workerId: string): JuryMember {
  return {
    claimId: String(claim["claim_id"] ?? "unknown"),
    confidence: Number(claim["confidence"] ?? 0),
    falsifier: String(claim["falsifier"] ?? ""),
    requestedAction:
      typeof claim["requested_action"] === "string" ? claim["requested_action"] : null,
    workerId,
  };
}

/**
 * Mechanical jury fusion. Pattern strictness first (kind=answer only,
 * plus vocabulary membership when the run declares one), then canonical
 * grouping, then cluster application when a merge stage ran, then
 * plurality with first-seen tiebreak. The accepted array arrives in
 * definition order, so submission order cannot change tie-breaking.
 * A minority claim becomes a residual risk when its own confidence is
 * >= 0.6 or its own requested_action is escalate/revise. Returns a
 * null decision when no answer survives. A merge that yields nothing
 * usable falls back to the unmerged tally with the failure named.
 */
export function juryFuse(
  accepted: readonly AcceptedClaim[],
  vocabulary?: readonly string[],
): JuryDecision {
  const vocabKeys = vocabulary === undefined ? null : new Set(vocabulary.map(canonicalize));
  const rejectedOptions: { claimId: string; reason: string }[] = [];
  const answers: { claim: Record<string, unknown>; workerId: string }[] = [];
  const mergeClaims: Record<string, unknown>[] = [];
  for (const entry of accepted) {
    if (entry.stage === "verify") {
      mergeClaims.push(entry.claim);
      continue;
    }
    if (!isAnswerClaim(entry.claim)) {
      rejectedOptions.push({
        claimId: String(entry.claim["claim_id"] ?? "unknown"),
        reason: `jury requires kind=answer, got ${String(entry.claim["kind"] ?? "none")}`,
      });
      continue;
    }
    if (vocabKeys !== null && !vocabKeys.has(canonicalize(String(entry.claim["claim"] ?? "")))) {
      rejectedOptions.push({
        claimId: String(entry.claim["claim_id"] ?? "unknown"),
        reason: `jury vocabulary violation: answer must be one of ${(vocabulary ?? []).join(", ")}`,
      });
      continue;
    }
    answers.push({ claim: entry.claim, workerId: entry.workerId });
  }

  const groups = new Map<string, JuryMember[]>();
  const order: string[] = [];
  const representative = new Map<string, string>();
  for (const entry of answers) {
    const canonical = canonicalize(String(entry.claim["claim"] ?? ""));
    const member = memberOf(entry.claim, entry.workerId);
    const existing = groups.get(canonical);
    if (existing === undefined) {
      groups.set(canonical, [member]);
      order.push(canonical);
      representative.set(canonical, String(entry.claim["claim_id"] ?? ""));
    } else {
      groups.set(canonical, [...existing, member]);
    }
  }
  const listing = order.map((canonical) => ({
    canonical,
    id: representative.get(canonical) ?? "",
  }));

  const juryGroups: JuryGroup[] = order.map((canonical) => ({
    canonical,
    members: groups.get(canonical) ?? [],
    votes: (groups.get(canonical) ?? []).length,
  }));

  const merged = juryClustersFromMerge(mergeClaims, listing);
  const tallyGroups: JuryTallyGroup[] =
    merged === null
      ? juryGroups.map((g) => ({ canonical: g.canonical, members: [...g.members], votes: g.votes }))
      : merged.clusters.map((c) => {
          const members = c.members.flatMap((m) => groups.get(m) ?? []);
          return { canonical: c.label, members, votes: members.length };
        });

  let winner: JuryTallyGroup | null = null;
  for (const group of tallyGroups) {
    if (winner === null || group.votes > winner.votes) {
      winner = group;
    }
  }
  const topVotes = winner?.votes ?? 0;
  const tie = winner !== null && tallyGroups.filter((g) => g.votes === topVotes).length > 1;

  const minority = tallyGroups.filter((group) => group !== winner);
  const residualRisks = minority.flatMap((group) =>
    group.members
      .filter(
        (m) =>
          m.confidence >= 0.6 || m.requestedAction === "escalate" || m.requestedAction === "revise",
      )
      .map((m) => ({ claimId: m.claimId, confidence: m.confidence, falsifier: m.falsifier })),
  );

  const duplicateRate = answers.length === 0 ? 0 : 1 - juryGroups.length / answers.length;
  const diversity = diversityCounts(accepted.map((a) => a.claim));

  return {
    decision: {
      decision: winner?.canonical ?? null,
      diversity,
      ...(vocabulary === undefined ? {} : { vocabulary: [...vocabulary] }),
      ...(merged === null && mergeClaims.length > 0
        ? { mergeFallback: "merge produced no usable clusters; unmerged tally stands" }
        : {}),
      ...(merged !== null
        ? { mergeClusters: merged.clusters.map((c) => ({ label: c.label, members: c.members })) }
        : {}),
      independence: {
        acceptedAnswers: answers.length,
        duplicateRate,
        groups: juryGroups.length,
      },
      minorityReport: minority,
      pattern: "jury",
      rejectedOptions,
      residualRisks,
      tie,
    },
    fusion: {
      duplicateRate,
      groups: tallyGroups.map((g) => ({ canonical: g.canonical, votes: g.votes })),
      merged: merged !== null,
      method: "plurality",
      tie,
      unmergedGroups: juryGroups.map((g) => ({ canonical: g.canonical, votes: g.votes })),
      winner: winner?.canonical ?? null,
    },
  };
}

function positiveInt(value: string, min: number, name: string): number | string {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) {
    return `--${name} must be an integer >= ${min}`;
  }
  return n;
}

export const juryDefinition: PatternDefinition = {
  build(options: PatternOptions) {
    const task = String(options["task"] ?? "");
    if (task.trim().length === 0) {
      return { error: "--task must be non-empty" };
    }
    const workers = positiveInt(
      String(options["workers"] ?? JURY_DEFAULT_WORKERS),
      JURY_MIN_WORKERS,
      "workers",
    );
    if (typeof workers === "string") {
      return { error: workers };
    }
    const timeout = Number(options["timeout"] ?? 180);
    if (!(timeout > 0)) {
      return { error: "--timeout must be positive seconds" };
    }
    const rostered = resolveRoster(options, workers);
    if ("error" in rostered) {
      return { error: rostered.error };
    }
    const roster = rostered.roster;
    const rawVocabulary = options["vocabulary"];
    let vocabulary: string[] | undefined;
    if (rawVocabulary !== undefined) {
      const parsed = parseVocabulary(String(rawVocabulary));
      if ("error" in parsed) {
        return { error: parsed.error };
      }
      vocabulary = parsed.members;
    }
    const merge = options["merge"] === true || options["merge"] === "true";
    const mergeHarness =
      options["merge-harness"] === undefined ? undefined : String(options["merge-harness"]);
    if (mergeHarness !== undefined && !merge) {
      return { error: "--merge-harness requires --merge" };
    }
    const fuse: FuseFn = (accepted: readonly AcceptedClaim[]) =>
      vocabulary === undefined ? juryFuse(accepted) : juryFuse(accepted, vocabulary);
    const stages: StageBuilders | undefined = merge
      ? {
          verify: (input: StageInput) => {
            const seen = new Set<string>();
            const listing: { canonical: string; id: string }[] = [];
            for (const claim of input.anonymizedClaims) {
              const canonical = canonicalize(String(claim["claim"] ?? ""));
              if (!seen.has(canonical)) {
                seen.add(canonical);
                listing.push({ canonical, id: String(claim["claim_id"] ?? "") });
              }
            }
            const slot = roster[0] ?? { harness: DEFAULT_HARNESS_HINT };
            return [
              {
                harness: mergeHarness ?? slot.harness,
                ...(mergeHarness !== undefined
                  ? {}
                  : slot.model !== undefined
                    ? { model: slot.model }
                    : {}),
                prompt: juryMergePrompt(listing),
                timeoutSec: timeout,
                workerId: "w-merge",
              },
            ];
          },
        }
      : undefined;
    return {
      fuse,
      ...(stages !== undefined ? { stages } : {}),
      validateSubmission(job, claims, accepted) {
        const errors = checkRoleClaims(claims, {
          kinds: ["answer"],
          count: {
            min: 1,
            max:
              job.stage === "generate"
                ? 1
                : accepted.filter((entry) => entry.stage === "generate").length,
          },
          actions: { required: false },
        });
        if (job.stage === "verify") {
          const representatives = new Map<string, string>();
          for (const entry of accepted.filter((entry) => entry.stage === "generate")) {
            const canonical = canonicalize(String(entry.claim.claim));
            if (!representatives.has(canonical))
              representatives.set(canonical, String(entry.claim.claim_id));
          }
          errors.push(
            ...checkClaimReferences(claims, new Set(representatives.values()), {
              uniqueTargets: true,
              coverAll: true,
            }),
          );
        }
        if (job.stage === "generate" && vocabulary !== undefined) {
          const allowed = new Set(vocabulary.map(canonicalize));
          for (const claim of claims) {
            if (!allowed.has(canonicalize(String(claim.claim)))) {
              errors.push(`${String(claim.claim_id)}: answer must be in the declared vocabulary`);
            }
          }
        }
        return errors;
      },
      stoppingRule: "every worker submits one answer claim or the caller reports its failure",
      task,
      workers: Array.from({ length: workers }, (_, index) => {
        const slot = roster[index] ?? { harness: DEFAULT_HARNESS_HINT };
        return {
          harness: slot.harness,
          ...(slot.model !== undefined ? { model: slot.model } : {}),
          prompt: juryWorkerPrompt(task, vocabulary),
          timeoutSec: timeout,
          workerId: `w${index + 1}`,
        };
      }),
    };
  },
  command: "jury",
  description:
    "Sealed Jury pattern run: N sealed workers answer the task as claims; equivalent answers " +
    "are normalized; plurality fusion decides mechanically. Starts a caller-managed run and " +
    "returns its first wave of jobs. Exit codes follow the shared command contract.",
  options: [
    {
      default: String(JURY_DEFAULT_WORKERS),
      description: "number of sealed workers",
      name: "workers",
    },
    HARNESS_OPTION,
    { description: "model hint passed to every worker", name: "model" },
    { default: "180", description: "per-worker advisory budget in seconds", name: "timeout" },
    ROSTER_OPTION,
    {
      description: "closed answer set, comma-separated (e.g. ship,hold)",
      name: "vocabulary",
    },
    {
      description: "cluster paraphrased answers with a blind merge worker before tallying",
      flag: "boolean",
      name: "merge",
    },
    {
      description: "harness hint for the merge worker (default: first roster slot)",
      name: "merge-harness",
    },
    { description: "the question every sealed juror answers", name: "task", required: true },
  ],
  summarize(decision, report: RunReport): readonly string[] {
    const lines = [
      `run      ${report.runId} (${report.runDir})`,
      `decision ${String(decision["decision"] ?? "(none)")}${decision["tie"] === true ? " (tie; definition order decided)" : ""}`,
    ];
    const independence = decision["independence"] as
      | { acceptedAnswers: number; duplicateRate: number; groups: number }
      | undefined;
    if (independence !== undefined) {
      lines.push(
        `votes    ${independence.acceptedAnswers} answers, ${independence.groups} groups, duplicate rate ${independence.duplicateRate.toFixed(2)}`,
      );
    }
    const diversity = decision["diversity"] as { harnesses: number; models: number } | undefined;
    if (diversity !== undefined) {
      lines.push(
        `roster   ${diversity.harnesses} harnesses, ${diversity.models} models (caller-reported)`,
      );
    }
    const clusters = decision["mergeClusters"] as
      | { label: string; members: string[] }[]
      | undefined;
    if (clusters !== undefined) {
      for (const cluster of clusters) {
        lines.push(`merged   ${cluster.label} <- ${cluster.members.join(" | ").slice(0, 90)}`);
      }
    }
    if (typeof decision["mergeFallback"] === "string") {
      lines.push(`merged   fallback: unmerged tally stands`);
    }
    const failures = decision["failures"] as { class: string; workerId: string }[] | undefined;
    if ((failures?.length ?? 0) > 0) {
      lines.push(`failures ${JSON.stringify(failures)}`);
    }
    for (const risk of (decision["residualRisks"] ?? []) as {
      claimId: string;
      confidence: number;
      falsifier: string;
    }[]) {
      lines.push(`risk     ${risk.claimId} (conf ${risk.confidence}): ${risk.falsifier}`);
    }
    return lines;
  },
};
