import { readFileSync } from "node:fs";
import type { AcceptedClaim, FusedOutput, RunReport, StageInput } from "./engine";
import {
  checkClaimKinds,
  DEFAULT_HARNESS_HINT,
  diversityCounts,
  EVIDENCE_OPTION,
  HARNESS_OPTION,
  type PatternDefinition,
  type PatternIo,
  type PatternOptions,
  ROSTER_OPTION,
  resolveEvidence,
  resolveRoster,
} from "./pattern";
import type { WorkerConfig } from "./run";

export interface RedBlueOptions {
  readonly burden: string;
  readonly harness: string;
  readonly model?: string;
  readonly task: string;
  readonly timeoutSec: number;
}

export interface RedBlueRoster {
  readonly blue: { harness: string; model?: string };
  readonly judge: { harness: string; model?: string };
  readonly red: { harness: string; model?: string };
  readonly umpire: { harness: string; model?: string };
}

export function claimantPrompt(task: string, supplied?: string): string {
  const evidenceBlock =
    supplied === undefined || supplied.trim().length === 0 ? [] : ["", supplied];
  return [
    "You are the claimant in a red-blue adversarial review.",
    `TASK: ${task}`,
    ...evidenceBlock,
    "",
    "File 1-4 atomic claims that together answer the task.",
    "Each claim: one JSON object with claim_id (C1, C2, ...), kind",
    "(answer|evidence|finding|hypothesis), claim (one sentence), status",
    '("observed"|"documented"|"inferred"|"unknown"), confidence [0,1],',
    "falsifier.",
    "If a claim can be checked by running a command, put the exact command",
    'in the falsifier, or in an evidence entry: evidence: [{"source_or_test":',
    '"the command in backticks", "supports": "what it shows"}] - evidence is',
    "an array of objects with exactly those two fields (plus optional url);",
    "source_or_test is never a top-level field.",
    "Do NOT include a provenance field. It is tool-stamped; a claim that sets it is rejected.",
    "Reply with one JSON object per claim, nothing else.",
  ].join("\n");
}

function claimsBlock(claims: readonly Record<string, unknown>[]): string {
  return claims.map((c) => JSON.stringify(c)).join("\n");
}

export function opponentPrompt(input: StageInput): string {
  return [
    "You are the opponent in a red-blue adversarial review.",
    "Challenge the claimant's claims on admissibility, relevance, credibility,",
    "or inference. Free-form critique is not accepted: every challenge must be",
    "an objection claim.",
    "",
    "CLAIMANT CLAIMS (one JSON per line):",
    claimsBlock(input.anonymizedClaims),
    "",
    "File 0-4 objections. Each objection: one JSON object with claim_id (C1, ...),",
    "Your OWN claim_id is exactly C1, C2, ... (a C plus digits, nothing else);",
    "never copy a record id like w-red:C1 as your own claim_id - reference",
    "record ids only in dependencies.",
    'kind: "objection", claim (the objection, one sentence), status',
    '("observed"|"documented"|"inferred"|"unknown"), confidence [0,1],',
    "falsifier, and dependencies: the claim_id(s) you target.",
    "Do NOT include a provenance field.",
    "Reply with one JSON object per objection, nothing else.",
  ].join("\n");
}

export function umpirePrompt(input: StageInput): string {
  return [
    "You are the umpire in a red-blue adversarial review.",
    "Resolve source facts for each objection against the claim it targets.",
    "Where a claim or objection names an executable check in backticks, run that",
    'command, and report the result as an evidence claim with status "observed"',
    "and the command as source_or_test.",
    "",
    "RECORD SO FAR (one JSON per line):",
    claimsBlock(input.anonymizedClaims),
    "",
    "File one ruling per objection: one JSON object with claim_id (C1, ...),",
    "Your OWN claim_id is exactly C1, C2, ... (a C plus digits, nothing else);",
    "never copy a record id like w-blue:C1 as your own claim_id - reference",
    "record ids only in dependencies.",
    'kind: "evidence", claim (what the check or source shows), status',
    '("observed"|"documented"|"inferred"|"unknown"), confidence,',
    "falsifier, dependencies: [the objection's claim_id], and requested_action:",
    '  "accept" = objection sustained (target claim falls),',
    '  "revise" = objection overruled (target claim survives),',
    '  "test"   = check inconclusive.',
    "Do NOT include a provenance field.",
    "Reply with one JSON object per ruling, nothing else.",
  ].join("\n");
}

export function judgePrompt(burden: string, input: StageInput): string {
  return [
    "You are the judge in a red-blue adversarial review.",
    "You see the anonymized record: claims and objections.",
    "The umpire works in the same wave; you do not see its rulings.",
    "Harness, model, and session metadata are hidden from you; role IDs remain visible.",
    `BURDEN: ${burden}`,
    "",
    "RECORD (one JSON per line):",
    claimsBlock(input.anonymizedClaims),
    "",
    "Assess the claims and objections against the burden and reply with EXACTLY ONE",
    'JSON object: claim_id "C1", kind "answer", claim (the ruling, one to three',
    "sentences naming what survives and what does not), status",
    '("observed"|"documented"|"inferred"|"unknown"), confidence [0,1],',
    "falsifier, requested_action: accept | revise | escalate | abstain",
    "(accept = the surviving record meets the burden).",
    "Do NOT include a provenance field.",
  ].join("\n");
}

export function redblueWorkers(
  options: RedBlueOptions,
  input: StageInput,
  phase: "challenge" | "verify",
  roster?: RedBlueRoster,
): readonly WorkerConfig[] {
  const slot = (role: keyof RedBlueRoster): { harness: string; model?: string } => {
    if (roster !== undefined) {
      return roster[role];
    }
    return {
      harness: options.harness,
      ...(options.model !== undefined ? { model: options.model } : {}),
    };
  };
  const base = (
    role: keyof RedBlueRoster,
  ): { harness: string; model?: string; timeoutSec: number } => ({
    ...slot(role),
    timeoutSec: options.timeoutSec,
  });
  if (phase === "challenge") {
    return [{ ...base("blue"), prompt: opponentPrompt(input), workerId: "w-blue" }];
  }
  return [
    { ...base("umpire"), prompt: umpirePrompt(input), workerId: "w-umpire" },
    { ...base("judge"), prompt: judgePrompt(options.burden, input), workerId: "w-judge" },
  ];
}

export interface RulingOutcome {
  readonly objectionId: string;
  readonly ruling: "overruled" | "sustained" | "unresolved";
  readonly targetId: string | null;
}

function claimIdOf(claim: Record<string, unknown>): string {
  return String(claim["claim_id"] ?? "");
}

function dependenciesOf(claim: Record<string, unknown>): readonly string[] {
  const deps = claim["dependencies"];
  return Array.isArray(deps) ? deps.map(String) : [];
}

/**
 * Mechanical red-blue resolution. Objections (challenge stage, kind=objection)
 * target claim_ids; rulings (verify stage, evidence claims) resolve them via
 * requested_action (accept=sustained, revise=overruled, test=unresolved).
 * The judge's answer claim becomes the ruling. No model in the loop.
 */
export function redblueFuse(accepted: readonly AcceptedClaim[]): FusedOutput {
  const base = accepted.filter((a) => a.stage === "generate");
  const objections = accepted.filter(
    (a) => a.stage === "challenge" && a.claim["kind"] === "objection",
  );
  const verifyClaims = accepted.filter((a) => a.stage === "verify");
  const rulings = verifyClaims.filter(
    (a) => a.claim["kind"] === "evidence" && a.claim["requested_action"] !== undefined,
  );
  const judge = verifyClaims.find(
    (a) => a.claim["kind"] === "answer" && a.claim["requested_action"] !== undefined,
  );

  const rulingsByObjection = new Map<string, RulingOutcome>();
  for (const objection of objections) {
    const objectionId = claimIdOf(objection.claim);
    const deps = dependenciesOf(objection.claim);
    const targetId = deps[0] ?? null;
    const rulingClaim = rulings.find((r) => dependenciesOf(r.claim).includes(objectionId));
    let ruling: RulingOutcome["ruling"] = "unresolved";
    if (rulingClaim !== undefined) {
      const action = String(rulingClaim.claim["requested_action"]);
      if (action === "accept") {
        ruling = "sustained";
      } else if (action === "revise") {
        ruling = "overruled";
      }
    }
    rulingsByObjection.set(objectionId, { objectionId, ruling, targetId });
  }

  const sustainedTargets = new Set<string>();
  const rejectedOptions: { claimId: string; reason: string }[] = [];
  for (const outcome of rulingsByObjection.values()) {
    if (outcome.ruling === "sustained" && outcome.targetId !== null) {
      sustainedTargets.add(outcome.targetId);
      const target = base.find((b) => claimIdOf(b.claim) === outcome.targetId);
      if (target !== undefined) {
        rejectedOptions.push({
          claimId: outcome.targetId,
          reason: `objection ${outcome.objectionId} sustained`,
        });
      }
    }
    if (outcome.ruling === "unresolved") {
      rejectedOptions.push({
        claimId: outcome.objectionId,
        reason: "objection unresolved: check inconclusive or no ruling",
      });
    }
  }

  const surviving = base.filter((b) => !sustainedTargets.has(claimIdOf(b.claim)));
  const unresolvedObjections = [...rulingsByObjection.values()].filter(
    (o) => o.ruling === "unresolved",
  );

  return {
    decision: {
      decision: judge ? String(judge.claim["claim"]) : null,
      diversity: diversityCounts(accepted.map((a) => a.claim)),
      judgeVerdict: judge ? String(judge.claim["requested_action"]) : null,
      pattern: "red-blue",
      rejectedOptions,
      residualRisks: unresolvedObjections.map((o) => ({
        objectionId: o.objectionId,
        targetId: o.targetId,
      })),
      survivingClaims: surviving.map((s) => claimIdOf(s.claim)),
    },
    fusion: {
      objections: objections.length,
      rulings: [...rulingsByObjection.values()],
      surviving: surviving.length,
    },
  };
}

export const redblueDefinition: PatternDefinition = {
  build(options: PatternOptions, io?: PatternIo) {
    const task = String(options["task"] ?? "");
    const burden = String(options["burden"] ?? "");
    if (task.trim().length === 0 || burden.trim().length === 0) {
      return { error: "--task and --burden must be non-empty" };
    }
    const timeout = Number(options["timeout"] ?? 300);
    if (!(timeout > 0)) {
      return { error: "--timeout must be positive seconds" };
    }
    const harness = String(options["harness"] ?? DEFAULT_HARNESS_HINT);
    const model = options["model"] === undefined ? undefined : String(options["model"]);
    const rostered = resolveRoster(options, 4);
    if ("error" in rostered) {
      return { error: rostered.error };
    }
    const [red, blue, umpire, judge] = rostered.roster as [
      { harness: string; model?: string },
      { harness: string; model?: string },
      { harness: string; model?: string },
      { harness: string; model?: string },
    ];
    const roleRoster: RedBlueRoster = {
      blue: blue ?? { harness: DEFAULT_HARNESS_HINT },
      judge: judge ?? { harness: DEFAULT_HARNESS_HINT },
      red: red ?? { harness: DEFAULT_HARNESS_HINT },
      umpire: umpire ?? { harness: DEFAULT_HARNESS_HINT },
    };
    const readEvidence = io?.readEvidence ?? ((path: string) => readFileSync(path, "utf8"));
    const evidenced = resolveEvidence(options, readEvidence);
    if ("error" in evidenced) {
      return { error: evidenced.error };
    }
    const supplied = evidenced.block;
    const patternOptions: RedBlueOptions = {
      burden,
      harness,
      ...(model !== undefined ? { model } : {}),
      task,
      timeoutSec: timeout,
    };
    return {
      fuse: redblueFuse,
      validateSubmission(job, claims) {
        if (job.workerId === "w-blue") return checkClaimKinds(claims, ["objection"]);
        if (job.workerId === "w-umpire") return checkClaimKinds(claims, ["evidence"]);
        if (job.workerId === "w-judge") return checkClaimKinds(claims, ["answer"], 1);
        return checkClaimKinds(claims, ["answer", "evidence", "finding", "hypothesis"]);
      },
      rubric: burden,
      stages: {
        challenge: (input) => redblueWorkers(patternOptions, input, "challenge", roleRoster),
        verify: (input) => redblueWorkers(patternOptions, input, "verify", roleRoster),
      },
      stoppingRule:
        "claimant files claims; opponent files objections; umpire rules; judge scores; the caller executes each job or reports its failure",
      task,
      workers: [
        {
          harness: roleRoster.red.harness,
          ...(roleRoster.red.model !== undefined ? { model: roleRoster.red.model } : {}),
          prompt: claimantPrompt(task, supplied),
          timeoutSec: timeout,
          workerId: "w-red",
        },
      ],
    };
  },
  command: "red-blue",
  description:
    "Red-Blue-Umpire pattern run: a claimant files atomic claims, an opponent " +
    "challenges with objection claims, an umpire resolves source facts (running " +
    "named executable checks), and a judge blind to worker identity scores the " +
    "surviving record against the burden. Starts a caller-managed run and returns " +
    "the first wave of jobs. Exit codes follow the shared command contract.",
  options: [
    { description: "the standard the surviving record must meet", name: "burden", required: true },
    HARNESS_OPTION,
    { description: "model hint passed to every role", name: "model" },
    {
      default: "300",
      description: "per-role advisory budget in seconds (symmetric)",
      name: "timeout",
    },
    {
      ...ROSTER_OPTION,
      description:
        "per-role harness[:model] in red,blue,umpire,judge order; repeatable, all four required when set",
    },
    EVIDENCE_OPTION,
    {
      description: "the question the claimant must answer with claims",
      name: "task",
      required: true,
    },
  ],
  summarize(decision, report: RunReport): readonly string[] {
    const lines = [
      `run      ${report.runId} (${report.runDir})`,
      `ruling   ${String(decision["decision"] ?? "(none)")}`,
      `verdict  ${String(decision["judgeVerdict"] ?? "(none)")}`,
      `claims   surviving ${JSON.stringify(decision["survivingClaims"])}`,
    ];
    for (const rejected of (decision["rejectedClaims"] ?? []) as {
      claimId: string;
      reason: string;
    }[]) {
      lines.push(`rejected ${rejected.claimId}: ${rejected.reason}`);
    }
    return lines;
  },
};
