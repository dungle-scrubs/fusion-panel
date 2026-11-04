import type { AcceptedClaim, FusedOutput, RunReport, StageInput } from "./engine";
import {
  checkClaimActions,
  checkClaimKinds,
  checkClaimReferences,
  DEFAULT_HARNESS_HINT,
  diversityCounts,
  HARNESS_OPTION,
  type PatternDefinition,
  type PatternOptions,
  ROSTER_OPTION,
  resolveRoster,
} from "./pattern";
import { canonicalize } from "./tier1";

export const SHORTLIST_MIN_WORKERS = 2;
export const SHORTLIST_DEFAULT_GENERATORS = 3;
export const SHORTLIST_DEFAULT_JUDGES = 2;

export function generatorPrompt(task: string): string {
  return [
    "You are one sealed proposer in an option-generation panel.",
    "You cannot see the other proposers. Work independently.",
    `TASK: ${task}`,
    "",
    "Propose 1-3 distinct, self-contained options. Each option: one JSON",
    "object per line, nothing else, with these fields:",
    '- claim_id: "C1", "C2", ... (one per option)',
    '- kind: "answer"',
    "- claim: the option in one sentence, specific enough to act on",
    '- status ("observed"|"documented"|"inferred"|"unknown"), confidence [0,1],',
    "  falsifier (what evidence would rule this option out)",
    "",
    "Do NOT include a provenance field. It is tool-stamped; a claim that sets it is rejected.",
  ].join("\n");
}

export function judgePrompt(task: string, rubric: string): (input: StageInput) => string {
  return (input: StageInput) =>
    [
      "You are one blind judge in an option shortlisting panel.",
      "You see anonymized options; who proposed them and with what model is",
      "hidden from you. Judge the options only.",
      `TASK: ${task}`,
      `RUBRIC: ${rubric}`,
      "",
      "Score EVERY option listed below. For each option emit exactly one",
      "JSON object on its own line, with these fields:",
      '- claim_id: "C1", "C2", ... (your own ids, one per scored option)',
      '- kind: "answer"',
      "- claim: your one-sentence note on this option against the rubric",
      "- dependencies: [the option's id exactly as listed below]",
      '- requested_action: "accept" (advance) | "revise" (advance with the',
      '  required change named in your note) | "abstain" (drop) |',
      '  "escalate" (needs a human decision)',
      '- status ("observed"|"documented"|"inferred"|"unknown"), confidence [0,1],',
      "  falsifier",
      "",
      "Do NOT include a provenance field.",
      "",
      "OPTIONS (anonymized, one JSON per line):",
      input.anonymizedClaims.map((c) => JSON.stringify(c)).join("\n"),
    ].join("\n");
}

export interface OptionTally {
  readonly accepts: number;
  readonly abstains: number;
  readonly escalates: number;
  readonly meanConfidence: number;
  readonly notes: readonly string[];
  readonly revises: number;
}

/**
 * Mechanical shortlist fusion. Options are generate-stage answer claims,
 * deduplicated by canonical text across proposers. Verdicts are
 * challenge-stage claims whose dependencies target an option's id. An
 * option advances when accepts are the strict majority of its verdicts;
 * the shortlist ranks by accepts, then mean confidence, then first-seen.
 * Options with no verdicts are flagged unscored rather than dropped.
 */
export function shortlistFuse(accepted: readonly AcceptedClaim[]): FusedOutput & {
  decision: Record<string, unknown>;
} {
  const optionClaims = accepted.filter(
    (a) => a.stage === "generate" && a.claim["kind"] === "answer",
  );
  const verdicts = accepted.filter((a) => a.stage === "challenge" && a.claim["kind"] === "answer");

  const groups = new Map<string, { canonical: string; members: typeof optionClaims }>();
  const order: string[] = [];
  for (const entry of optionClaims) {
    const canonical = canonicalize(String(entry.claim["claim"] ?? ""));
    const existing = groups.get(canonical);
    if (existing === undefined) {
      groups.set(canonical, { canonical, members: [entry] });
      order.push(canonical);
    } else {
      existing.members.push(entry);
    }
  }

  const memberIdsOf = (group: { members: typeof optionClaims }) =>
    new Set(group.members.map((m) => String(m.claim["claim_id"] ?? "")));

  const tallies = new Map<
    string,
    {
      accepts: number;
      abstains: number;
      escalates: number;
      confidences: number[];
      notes: string[];
      revises: number;
    }
  >();
  for (const canonical of order) {
    tallies.set(canonical, {
      accepts: 0,
      abstains: 0,
      escalates: 0,
      confidences: [],
      notes: [],
      revises: 0,
    });
  }

  for (const verdict of verdicts) {
    const deps = Array.isArray(verdict.claim["dependencies"])
      ? verdict.claim["dependencies"].map(String)
      : [];
    for (const canonical of order) {
      const group = groups.get(canonical);
      if (group === undefined) {
        continue;
      }
      if (!deps.some((d) => memberIdsOf(group).has(d))) {
        continue;
      }
      const tally = tallies.get(canonical);
      if (tally === undefined) {
        continue;
      }
      const action = String(verdict.claim["requested_action"] ?? "");
      if (action === "accept") {
        tally.accepts += 1;
      } else if (action === "revise") {
        tally.revises += 1;
      } else if (action === "abstain") {
        tally.abstains += 1;
      } else if (action === "escalate") {
        tally.escalates += 1;
      }
      tally.confidences.push(Number(verdict.claim["confidence"] ?? 0));
      tally.notes.push(String(verdict.claim["claim"] ?? ""));
      break;
    }
  }

  const scored = (tally: {
    accepts: number;
    abstains: number;
    escalates: number;
    revises: number;
  }) => tally.accepts + tally.revises + tally.abstains + tally.escalates;

  const shortlist: { canonical: string; tally: OptionTally }[] = [];
  const dropped: { canonical: string; reason: string; tally: OptionTally }[] = [];
  const unscored: string[] = [];
  for (const canonical of order) {
    const raw = tallies.get(canonical);
    const group = groups.get(canonical);
    if (raw === undefined || group === undefined) {
      continue;
    }
    const tally: OptionTally = {
      accepts: raw.accepts,
      abstains: raw.abstains,
      escalates: raw.escalates,
      meanConfidence:
        raw.confidences.length === 0
          ? 0
          : raw.confidences.reduce((a, b) => a + b, 0) / raw.confidences.length,
      notes: raw.notes,
      revises: raw.revises,
    };
    const total = scored(raw);
    if (total === 0) {
      unscored.push(canonical);
      continue;
    }
    if (raw.accepts > total / 2) {
      shortlist.push({ canonical, tally });
    } else {
      const dominant =
        raw.abstains >= raw.escalates && raw.abstains >= raw.revises
          ? "dropped (abstain majority)"
          : raw.escalates >= raw.revises
            ? "escalated to human"
            : "needs revision";
      dropped.push({ canonical, reason: dominant, tally });
    }
  }

  shortlist.sort(
    (a, b) => b.tally.accepts - a.tally.accepts || b.tally.meanConfidence - a.tally.meanConfidence,
  );

  return {
    decision: {
      decision: shortlist[0]?.canonical ?? null,
      diversity: diversityCounts(accepted.map((a) => a.claim)),
      dropped: dropped.map((d) => ({ canonical: d.canonical, reason: d.reason, tally: d.tally })),
      pattern: "shortlist",
      rejectedOptions: [],
      residualRisks: unscored.map((canonical) => ({ canonical, reason: "unscored by any judge" })),
      shortlist: shortlist.map((s) => ({ canonical: s.canonical, tally: s.tally })),
      unscored,
    },
    fusion: {
      advanced: shortlist.length,
      dropped: dropped.length,
      options: order.length,
      unscored: unscored.length,
    },
  };
}

export const shortlistDefinition: PatternDefinition = {
  build(options: PatternOptions) {
    const task = String(options["task"] ?? "");
    const rubric = String(options["rubric"] ?? "");
    if (task.trim().length === 0 || rubric.trim().length === 0) {
      return { error: "--task and --rubric must be non-empty" };
    }
    const generators = Number(options["generators"] ?? SHORTLIST_DEFAULT_GENERATORS);
    const judges = Number(options["judges"] ?? SHORTLIST_DEFAULT_JUDGES);
    if (!Number.isInteger(generators) || generators < SHORTLIST_MIN_WORKERS) {
      return { error: `--generators must be an integer >= ${SHORTLIST_MIN_WORKERS}` };
    }
    if (!Number.isInteger(judges) || judges < SHORTLIST_MIN_WORKERS) {
      return { error: `--judges must be an integer >= ${SHORTLIST_MIN_WORKERS}` };
    }
    const timeout = Number(options["timeout"] ?? 300);
    if (!(timeout > 0)) {
      return { error: "--timeout must be positive seconds" };
    }
    const rostered = resolveRoster(options, generators + judges);
    if ("error" in rostered) {
      return { error: rostered.error };
    }
    const roster = rostered.roster;
    const slotOf = (index: number): { harness: string; model?: string } =>
      roster[index] ?? { harness: DEFAULT_HARNESS_HINT };
    const base = (index: number): { harness: string; model?: string; timeoutSec: number } => {
      const slot = slotOf(index);
      return {
        harness: slot.harness,
        ...(slot.model !== undefined ? { model: slot.model } : {}),
        timeoutSec: timeout,
      };
    };
    return {
      fuse: shortlistFuse,
      validateSubmission(job, claims, accepted) {
        const errors = checkClaimKinds(claims, ["answer"]);
        if (job.stage === "generate") {
          if (claims.length > 3) errors.push("proposers submit at most three options");
          return errors;
        }
        const options = new Set(
          accepted
            .filter((entry) => entry.stage === "generate" && entry.claim.kind === "answer")
            .map((entry) => String(entry.claim.claim_id)),
        );
        return [
          ...errors,
          ...checkClaimActions(claims, ["accept", "revise", "abstain", "escalate"]),
          ...checkClaimReferences(claims, options, {
            singleTarget: true,
            uniqueTargets: true,
            coverAll: true,
          }),
        ];
      },
      rubric,
      stages: {
        challenge: (input: StageInput) =>
          Array.from({ length: judges }, (_, index) => ({
            ...base(generators + index),
            prompt: judgePrompt(task, rubric)(input),
            workerId: `w-judge-${index + 1}`,
          })),
      },
      stoppingRule:
        "proposers file options; every judge scores every option against the rubric; the caller executes each job or reports its failure",
      task,
      workers: Array.from({ length: generators }, (_, index) => ({
        ...base(index),
        prompt: generatorPrompt(task),
        workerId: `w-prop-${index + 1}`,
      })),
    };
  },
  command: "shortlist",
  description:
    "Shortlist pattern run: sealed proposers generate options; blind judges score " +
    "every option against the rubric (accept/revise/abstain/escalate); the tool tallies " +
    "mechanically and ranks the majority-accept shortlist. Starts a caller-managed run " +
    "and returns the first wave of jobs. Exit codes follow the shared command contract.",
  options: [
    {
      default: String(SHORTLIST_DEFAULT_GENERATORS),
      description: "number of sealed proposers",
      name: "generators",
    },
    {
      default: String(SHORTLIST_DEFAULT_JUDGES),
      description: "number of blind judges",
      name: "judges",
    },
    HARNESS_OPTION,
    { description: "model hint passed to every worker", name: "model" },
    { default: "300", description: "per-worker advisory budget in seconds", name: "timeout" },
    ROSTER_OPTION,
    { description: "the standard every option is scored against", name: "rubric", required: true },
    {
      description: "the open problem proposers generate options for",
      name: "task",
      required: true,
    },
  ],
  summarize(decision, report: RunReport): readonly string[] {
    const lines = [
      `run       ${report.runId} (${report.runDir})`,
      `decision  ${String(decision["decision"] ?? "(none)")}`,
    ];
    for (const entry of (decision["shortlist"] ?? []) as {
      canonical: string;
      tally: OptionTally;
    }[]) {
      lines.push(
        `advance   ${entry.tally.accepts}a/${entry.tally.revises}r/${entry.tally.abstains}x conf ${entry.tally.meanConfidence.toFixed(2)} - ${entry.canonical.slice(0, 70)}`,
      );
    }
    for (const entry of (decision["dropped"] ?? []) as { canonical: string; reason: string }[]) {
      lines.push(`dropped   ${entry.reason} - ${entry.canonical.slice(0, 70)}`);
    }
    for (const canonical of (decision["unscored"] ?? []) as string[]) {
      lines.push(`unscored  ${canonical.slice(0, 70)}`);
    }
    return lines;
  },
};
