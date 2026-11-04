import type { AcceptedClaim, FusedOutput, RunReport } from "./engine";
import {
  checkClaimKinds,
  DEFAULT_HARNESS_HINT,
  diversityCounts,
  HARNESS_OPTION,
  type PatternDefinition,
  type PatternOptions,
  ROSTER_OPTION,
  resolveRoster,
} from "./pattern";

export const GONOGO_MIN_REVIEWERS = 2;
export const GONOGO_DEFAULT_REVIEWERS = 3;

export function gonogoPrompt(task: string): string {
  return [
    "You are one independent reviewer in a go/no-go gate.",
    "You cannot see the other reviewers. Judge on your own evidence.",
    `WHAT IS BEING GATED: ${task}`,
    "",
    "Inspect the artifact (you have repo access when the task names one) and",
    "reply with EXACTLY ONE JSON object and nothing else:",
    '- claim_id: "C1"',
    '- kind: "answer"',
    '- requested_action: "accept" for GO, "test" for GO WITH CONSTRAINT',
    '  (name the constraint in the claim text), "escalate" for NO-GO with a',
    '  blocking concern, or "abstain" when you cannot verify enough to judge',
    "- claim: your position in one sentence (for GO WITH CONSTRAINT, the",
    "  constraint itself; for NO-GO, the blocking concern)",
    '- status ("observed"|"documented"|"inferred"|"unknown"), confidence [0,1],',
    "  falsifier (for NO-GO: what evidence would clear the block)",
    "",
    "A NO-GO from any reviewer blocks the gate regardless of majority - file",
    "one only on a concern you can name and falsify.",
    "Do NOT include a provenance field. It is tool-stamped; a claim that sets it is rejected.",
  ].join("\n");
}

export interface ReviewerPosition {
  readonly action: string;
  readonly claimId: string;
  readonly confidence: number;
  readonly falsifier: string;
  readonly note: string;
  readonly workerId: string;
}

/**
 * Mechanical go/no-go fusion. Each reviewer's position rides on
 * requested_action: accept=GO, test=GO WITH CONSTRAINT, escalate=NO-GO,
 * abstain=NO-GO (unverifiable). The veto rule is mechanical: any escalate
 * or abstain blocks - no outvoting. Verdict: NO-GO when blocked; else GO
 * WITH CONSTRAINT when any test names a constraint; else GO. The record
 * carries every reviewer's position and each blocking concern with its
 * falsifier.
 */
export function gonogoFuse(accepted: readonly AcceptedClaim[]): FusedOutput & {
  decision: Record<string, unknown>;
} {
  const positions: ReviewerPosition[] = [];
  for (const entry of accepted) {
    if (entry.stage !== "generate" || entry.claim["kind"] !== "answer") {
      continue;
    }
    positions.push({
      action: String(entry.claim["requested_action"] ?? "abstain"),
      claimId: String(entry.claim["claim_id"] ?? ""),
      confidence: Number(entry.claim["confidence"] ?? 0),
      falsifier: String(entry.claim["falsifier"] ?? ""),
      note: String(entry.claim["claim"] ?? ""),
      workerId: entry.workerId,
    });
  }

  const blockers = positions.filter((p) => p.action === "escalate" || p.action === "abstain");
  const constrained = positions.filter((p) => p.action === "test");

  const verdict =
    blockers.length > 0 ? "NO-GO" : constrained.length > 0 ? "GO WITH CONSTRAINT" : "GO";

  return {
    decision: {
      blockingConcerns: blockers.map((b) => ({
        action: b.action,
        claimId: b.claimId,
        concern: b.note,
        falsifier: b.falsifier,
        workerId: b.workerId,
      })),
      constraints: constrained.map((c) => ({ constraint: c.note, workerId: c.workerId })),
      decision: verdict,
      diversity: diversityCounts(accepted.map((a) => a.claim)),
      pattern: "gonogo",
      positions: positions.map((p) => ({ ...p, workerId: p.workerId })),
      rejectedOptions: [],
      residualRisks: [],
      reviewers: positions.length,
      vetoRule: "any escalate or abstain blocks; no outvoting",
    },
    fusion: {
      blocked: blockers.length,
      constrained: constrained.length,
      go: positions.length - blockers.length - constrained.length,
      reviewers: positions.length,
      verdict,
    },
  };
}

export const gonogoDefinition: PatternDefinition = {
  build(options: PatternOptions) {
    const task = String(options["task"] ?? "");
    if (task.trim().length === 0) {
      return { error: "--task must be non-empty" };
    }
    const reviewers = Number(options["reviewers"] ?? GONOGO_DEFAULT_REVIEWERS);
    if (!Number.isInteger(reviewers) || reviewers < GONOGO_MIN_REVIEWERS) {
      return { error: `--reviewers must be an integer >= ${GONOGO_MIN_REVIEWERS}` };
    }
    const timeout = Number(options["timeout"] ?? 300);
    if (!(timeout > 0)) {
      return { error: "--timeout must be positive seconds" };
    }
    const rostered = resolveRoster(options, reviewers);
    if ("error" in rostered) {
      return { error: rostered.error };
    }
    const roster = rostered.roster;
    return {
      fuse: gonogoFuse,
      validateSubmission(_job, claims) {
        const errors = checkClaimKinds(claims, ["answer"], 1);
        for (const claim of claims) {
          if (
            claim.requested_action !== undefined &&
            !["accept", "test", "escalate", "abstain"].includes(String(claim.requested_action))
          ) {
            errors.push(
              `${String(claim.claim_id)}: gate action must be accept|test|escalate|abstain`,
            );
          }
        }
        return errors;
      },
      stoppingRule: "every reviewer returns one position or the caller reports its failure",
      task,
      workers: Array.from({ length: reviewers }, (_, index) => {
        const slot = roster[index] ?? { harness: DEFAULT_HARNESS_HINT };
        return {
          harness: slot.harness,
          ...(slot.model !== undefined ? { model: slot.model } : {}),
          prompt: gonogoPrompt(task),
          timeoutSec: timeout,
          workerId: `w-gate-${index + 1}`,
        };
      }),
    };
  },
  command: "gonogo",
  description:
    "Go/No-Go gate: independent reviewers each return GO, GO WITH CONSTRAINT, or " +
    "NO-GO; the mechanical veto rule is that any NO-GO blocks - no outvoting. " +
    "Starts a caller-managed run and returns the first wave of jobs.",
  options: [
    {
      default: String(GONOGO_DEFAULT_REVIEWERS),
      description: "number of independent reviewers",
      name: "reviewers",
    },
    HARNESS_OPTION,
    { description: "model hint passed to every reviewer", name: "model" },
    { default: "300", description: "per-reviewer advisory budget in seconds", name: "timeout" },
    ROSTER_OPTION,
    { description: "the decision or artifact being gated", name: "task", required: true },
  ],
  summarize(decision, report: RunReport): readonly string[] {
    const lines = [
      `run       ${report.runId} (${report.runDir})`,
      `verdict   ${String(decision["decision"] ?? "(none)")}`,
      `veto rule ${String(decision["vetoRule"] ?? "")}`,
    ];
    for (const blocker of (decision["blockingConcerns"] ?? []) as {
      action: string;
      concern: string;
      falsifier: string;
      workerId: string;
    }[]) {
      lines.push(
        `blocked by ${blocker.workerId} (${blocker.action}): ${blocker.concern.slice(0, 80)}`,
      );
      lines.push(`  clears   ${blocker.falsifier.slice(0, 90)}`);
    }
    for (const entry of (decision["constraints"] ?? []) as {
      constraint: string;
      workerId: string;
    }[]) {
      lines.push(`constraint ${entry.workerId}: ${entry.constraint.slice(0, 80)}`);
    }
    return lines;
  },
};
