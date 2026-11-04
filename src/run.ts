/**
 * Run registry core (RFC-01, ticket #12; ADR-0003 caller-managed
 * delegation): state machine, run registration, and the streaming event
 * contract. Pure module: no I/O, no spawning, no harness execution.
 */

export const SCHEMA_VERSION = "fusion/v0";
/** Frozen run.json format marker. Runs without it (hcn-executed era) are rejected as incompatible. */
export const RUN_FORMAT = "caller-managed/v1";
export const RUN_ID_PATTERN = /^r[0-9a-f]{8}$/;
export const WORKER_ID_PATTERN = /^w[a-z0-9-]+$/;
export const JOB_ID_PATTERN = /^(generate|challenge|verify):(w[a-z0-9-]+)$/;

/** Worker job stages the engine issues, in run order. */
export type WorkerStage = "challenge" | "generate" | "verify";

/**
 * Boundary error shared by the engine's modules: an E-code plus a
 * human-readable detail. E-code classes follow ADR-0002.
 */
export interface EngineError {
  readonly code: string;
  readonly detail: string;
}

export const RUN_STAGES = [
  "REGISTERED",
  "GENERATING",
  "NORMALIZING",
  "CHALLENGING",
  "VERIFYING",
  "DECIDING",
  "DONE",
  "FAILED",
] as const;
export type RunStage = (typeof RUN_STAGES)[number];

/**
 * Legal transitions the engine enforces. Stages run in order, once each.
 * FAILED is reachable from any non-terminal stage via abort or the
 * no-survivors gate; FAILED retains partial events.
 */
const TRANSITIONS: Record<Exclude<RunStage, "DONE" | "FAILED">, readonly RunStage[]> = {
  REGISTERED: ["GENERATING"],
  GENERATING: ["NORMALIZING"],
  NORMALIZING: ["CHALLENGING", "VERIFYING", "DECIDING"],
  CHALLENGING: ["VERIFYING", "DECIDING"],
  VERIFYING: ["DECIDING"],
  DECIDING: ["DONE"],
};

export function nextStages(from: RunStage): readonly RunStage[] {
  if (from === "DONE" || from === "FAILED") {
    return [];
  }
  return TRANSITIONS[from];
}

export function isLegalTransition(from: RunStage, to: RunStage): boolean {
  if (from === to) {
    return false;
  }
  if (to === "FAILED") {
    return from !== "DONE" && from !== "FAILED";
  }
  return nextStages(from).includes(to);
}

export interface WorkerConfig {
  /** Worker id within the run, e.g. w1. */
  readonly workerId: string;
  /** Caller hint: harness the caller may route this worker to. Never enforced. */
  readonly harness?: string;
  /** Caller hint: model id the caller may route this worker to. Never enforced. */
  readonly model?: string;
  /** Per-worker advisory wall-clock budget, seconds. */
  readonly timeoutSec: number;
  readonly prompt: string;
}

export interface RunRegistration {
  readonly runId: string;
  readonly pattern: string;
  readonly task: string;
  readonly rubric?: string;
  readonly stoppingRule: string;
  readonly workers: readonly WorkerConfig[];
  readonly registeredAt: string;
  /** Original pattern flags, for rebuilding stages at submit time. */
  readonly patternOptions?: Record<string, string | boolean>;
  /** Evidence file content frozen at registration (ADR-0003: no dependence on later file state). */
  readonly evidenceSnapshot?: { readonly path: string; readonly content: string };
}

export type FusionEventKind =
  | "claim"
  | "decision"
  | "done"
  | "failure"
  | "fusion"
  | "stage"
  | "submission"
  | "wave";

export interface FusionEvent {
  readonly schemaVersion: string;
  readonly runId: string;
  readonly kind: FusionEventKind;
  readonly at: string;
  readonly payload: Record<string, unknown>;
}

export function makeEvent(
  runId: string,
  kind: FusionEventKind,
  payload: Record<string, unknown>,
  at: string = new Date().toISOString(),
): FusionEvent {
  return { at, kind, payload, runId, schemaVersion: SCHEMA_VERSION };
}

export interface StampedProvenance {
  /** Marks every identity field as caller-reported; Fusion cannot verify it. */
  readonly source: "caller-reported";
  readonly harness: string;
  readonly model: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly stampedAt: string;
  readonly workerId: string;
}

/**
 * Stamp provenance for an accepted claim. runId/workerId come from the
 * tool's own run record; harness/model/sessionId are what the caller
 * reported for the worker, marked as such. Workers cannot set this block.
 */
export function stampProvenance(args: {
  harness: string;
  model: string;
  runId: string;
  sessionId: string;
  workerId: string;
  stampedAt?: string;
}): StampedProvenance {
  return {
    harness: args.harness,
    model: args.model,
    runId: args.runId,
    sessionId: args.sessionId,
    source: "caller-reported",
    stampedAt: args.stampedAt ?? new Date().toISOString(),
    workerId: args.workerId,
  };
}

/**
 * Stated wherever a run reports provenance or independence: Fusion cannot
 * observe worker contexts; the caller owns isolation and identity.
 */
export const PROVENANCE_LIMITS = {
  identity:
    "caller-reported: harness/model/sessionId are what the caller submitted; Fusion cannot verify them",
  isolation: "caller-enforced: Fusion launches no processes and cannot prove worker isolation",
} as const;

/** Validate a registration before freezing run.json. Throws on violation. */
export function checkRegistration(reg: RunRegistration): void {
  if (!RUN_ID_PATTERN.test(reg.runId)) {
    throw new Error(`runId must match r[0-9a-f]{8}, got "${reg.runId}"`);
  }
  if (reg.task.trim().length === 0) {
    throw new Error("registration requires a non-empty task");
  }
  if (reg.stoppingRule.trim().length === 0) {
    throw new Error("registration requires a stopping rule");
  }
  if (reg.workers.length === 0) {
    throw new Error("registration requires at least one worker");
  }
  const seen = new Set<string>();
  for (const worker of reg.workers) {
    if (!WORKER_ID_PATTERN.test(worker.workerId)) {
      throw new Error(`workerId must match w[a-z0-9-]+, got "${worker.workerId}"`);
    }
    if (seen.has(worker.workerId)) {
      throw new Error(`duplicate workerId "${worker.workerId}"`);
    }
    seen.add(worker.workerId);
    if (worker.prompt.trim().length === 0) {
      throw new Error(`worker ${worker.workerId} requires a non-empty prompt`);
    }
    if (!(worker.timeoutSec > 0)) {
      throw new Error(`worker ${worker.workerId} requires a positive timeoutSec`);
    }
  }
}
