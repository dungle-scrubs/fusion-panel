/**
 * Tier 2 run engine (ADR-0003, caller-managed delegation). Fusion owns
 * pattern construction, stage barriers, claim validation, anonymized
 * stage inputs, deterministic fusion, run registration and durable
 * records. The calling harness owns delegation: it executes worker jobs
 * with its own tools and submits structured results. The engine never
 * spawns a process and never parses harness output.
 *
 * Module layout: this module orchestrates. src/submission.ts owns the
 * strict submission boundary (parsing and claim/reference validation);
 * src/run-store.ts owns all filesystem persistence and the exclusive
 * run lock, including the authoritative-commit-then-project order
 * documented there: state.json (with the committed event journal and,
 * when terminal, the decision) is the single authority, and
 * decision.json / events.ndjson are projections replayed from it. Views
 * read committed state only and never write.
 */
import {
  checkRegistration,
  type EngineError,
  type FusionEvent,
  isLegalTransition,
  JOB_ID_PATTERN,
  makeEvent,
  PROVENANCE_LIMITS,
  RUN_FORMAT,
  type RunRegistration,
  type RunStage,
  type StampedProvenance,
  stampProvenance,
  WORKER_ID_PATTERN,
  type WorkerConfig,
  type WorkerStage,
} from "./run";
import {
  type AcceptedRecord,
  acquireRunLock,
  createRunDir,
  type FailureRecord,
  loadRegistration,
  loadState,
  projectRun,
  type RunState,
  resolveRunDir,
  saveState,
  writeRegistration,
} from "./run-store";
import { parseSubmission, validateSuccessClaims } from "./submission";

export type { EngineError } from "./run";
export { parseSubmission } from "./submission";

export interface FusedOutput {
  readonly fusion: Record<string, unknown>;
  readonly decision: Record<string, unknown>;
}

export interface AcceptedClaim {
  readonly claim: Record<string, unknown>;
  readonly stage: WorkerStage;
  readonly workerId: string;
}

export type FuseFn = (accepted: readonly AcceptedClaim[]) => FusedOutput;

/**
 * Later-stage workers see prior claims without provenance (blind to
 * identity and model). `byWorker` groups the same claims per worker for
 * patterns whose later wave needs each worker's own prior output (Delphi
 * revision) while staying blind to the others' identities.
 */
export interface StageInput {
  readonly anonymizedClaims: readonly Record<string, unknown>[];
  readonly byWorker: ReadonlyMap<string, readonly Record<string, unknown>[]>;
}

export interface StageBuilders {
  readonly challenge?: (input: StageInput) => readonly WorkerConfig[];
  readonly verify?: (input: StageInput) => readonly WorkerConfig[];
}

/** One worker brief issued to the caller for execution. Not a reservation. */
export interface Job {
  readonly jobId: string;
  readonly workerId: string;
  readonly stage: WorkerStage;
  readonly prompt: string;
  readonly timeoutSec: number;
  readonly harness?: string;
  readonly model?: string;
}

export interface RunReport {
  readonly cause: "aborted" | "clean" | "failed";
  readonly decision: Record<string, unknown>;
  readonly runDir: string;
  readonly runId: string;
}

export type RunStatus = "done" | "failed" | "pending";

/** The shape every run-touching command returns to the CLI. */
export interface RunView {
  readonly runId: string;
  readonly runDir: string;
  readonly status: RunStatus;
  readonly jobs?: readonly Job[];
  readonly decision?: Record<string, unknown>;
}

export interface EngineOptions {
  readonly repoRoot: string;
  readonly now?: () => string;
}

/** Rebuild a pattern's stages/fuse from the frozen registration (CLI supplies the definition). */
export type SubmissionCheck = (
  job: Job,
  claims: readonly Record<string, unknown>[],
  accepted: readonly AcceptedClaim[],
) => readonly string[];

export type PatternRebuild = (
  reg: RunRegistration,
) =>
  | { error: string }
  | { stages?: StageBuilders; fuse: FuseFn; validateSubmission: SubmissionCheck };

export function jobIdOf(stage: WorkerStage, workerId: string): string {
  return `${stage}:${workerId}`;
}

function jobFromConfig(config: WorkerConfig, stage: WorkerStage): Job {
  return {
    jobId: jobIdOf(stage, config.workerId),
    workerId: config.workerId,
    stage,
    prompt: config.prompt,
    timeoutSec: config.timeoutSec,
    ...(config.harness !== undefined ? { harness: config.harness } : {}),
    ...(config.model !== undefined ? { model: config.model } : {}),
  };
}

function checkWaveJobs(jobs: readonly Job[]): void {
  const seen = new Set<string>();
  for (const job of jobs) {
    if (!WORKER_ID_PATTERN.test(job.workerId) || !JOB_ID_PATTERN.test(job.jobId)) {
      throw new Error(`pattern built an invalid job "${job.jobId}"`);
    }
    if (seen.has(job.jobId)) {
      throw new Error(`pattern built duplicate job "${job.jobId}" in one wave`);
    }
    seen.add(job.jobId);
    if (job.prompt.trim().length === 0) {
      throw new Error(`job ${job.jobId} requires a non-empty prompt`);
    }
    if (!(job.timeoutSec > 0)) {
      throw new Error(`job ${job.jobId} requires a positive timeoutSec`);
    }
  }
}

// ---------------------------------------------------------------------------
// Engine proper
// ---------------------------------------------------------------------------

function busyError(runId: string): EngineError {
  return {
    code: "E304",
    detail: `run ${runId} is busy (another fusion command holds the lock); retry`,
  };
}

function survivorsOf(state: RunState): number {
  const workers = new Set<string>();
  for (const entry of state.accepted) {
    if (entry.stage === "generate") {
      workers.add(entry.workerId);
    }
  }
  return workers.size;
}

function failureList(state: RunState): readonly { class: string; workerId: string }[] {
  return state.failures.map((f) => ({ class: f.class, workerId: f.workerId }));
}

/** Accepted claims in definition order: wave, then job position, then claim position. */
export function acceptedInDefinitionOrder(state: {
  accepted: readonly {
    claim: Record<string, unknown>;
    claimIndex: number;
    jobIndex: number;
    stage: WorkerStage;
    wave: number;
    workerId: string;
  }[];
}): readonly AcceptedClaim[] {
  return [...state.accepted]
    .sort((a, b) => a.wave - b.wave || a.jobIndex - b.jobIndex || a.claimIndex - b.claimIndex)
    .map((entry) => ({ claim: entry.claim, stage: entry.stage, workerId: entry.workerId }));
}

function stageInputOf(state: RunState): StageInput {
  const ordered = acceptedInDefinitionOrder(state);
  const anonymized = ordered.map((entry) => {
    const { provenance: _provenance, ...rest } = entry.claim;
    return rest;
  });
  const byWorker = new Map<string, Record<string, unknown>[]>();
  for (const entry of ordered) {
    const { provenance: _provenance, ...rest } = entry.claim;
    const existing = byWorker.get(entry.workerId);
    if (existing === undefined) {
      byWorker.set(entry.workerId, [rest]);
    } else {
      existing.push(rest);
    }
  }
  return { anonymizedClaims: anonymized, byWorker };
}

/**
 * Start a run: freeze run.json (with evidence snapshot), initialize
 * state with wave 0 jobs, and hand the first wave to the caller. The
 * caller executes the jobs; pending is a successful handoff. The run
 * directory is claimed atomically and never overwritten: a run id that
 * already exists is a usage error that retains every existing file.
 */
export function startRun(
  reg: RunRegistration,
  options: EngineOptions,
): { error: EngineError } | { view: RunView } {
  try {
    checkRegistration(reg);
  } catch (error) {
    return {
      error: {
        code: "E499",
        detail: `invalid registration: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  const now = options.now ?? (() => new Date().toISOString());
  const jobs = reg.workers.map((worker) => jobFromConfig(worker, "generate"));
  try {
    checkWaveJobs(jobs);
  } catch (error) {
    return {
      error: {
        code: "E499",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
  const created = createRunDir(options.repoRoot, reg.runId);
  if ("error" in created) {
    return { error: created.error };
  }
  const runDir = created.runDir;
  const lock = acquireRunLock(runDir);
  if ("busy" in lock) {
    return { error: busyError(reg.runId) };
  }
  if ("error" in lock) {
    return { error: lock.error };
  }
  try {
    const events: FusionEvent[] = [
      makeEvent(reg.runId, "stage", { stage: "REGISTERED" }, now()),
      makeEvent(reg.runId, "stage", { stage: "GENERATING" }, now()),
      makeEvent(
        reg.runId,
        "wave",
        {
          jobs: jobs.map((j) => ({ jobId: j.jobId, stage: j.stage, workerId: j.workerId })),
          wave: 0,
        },
        now(),
      ),
    ];
    writeRegistration(runDir, reg);
    const state: RunState = {
      accepted: [],
      failures: [],
      jobs,
      journal: events,
      pending: jobs.map((job) => job.jobId),
      runFormat: RUN_FORMAT,
      stage: "GENERATING",
      terminal: false,
      wave: 0,
    };
    saveState(runDir, state);
    projectRun(runDir, state);
    return {
      view: {
        jobs,
        runDir,
        runId: reg.runId,
        status: "pending",
      },
    };
  } finally {
    lock.release();
  }
}

interface AdvanceContext {
  readonly now: () => string;
  readonly rebuild: PatternRebuild;
  readonly reg: RunRegistration;
  readonly runDir: string;
  readonly runId: string;
}

function finalize(
  state: RunState,
  ctx: Pick<AdvanceContext, "now" | "runId">,
  cause: "aborted" | "clean" | "failed",
  decision: Record<string, unknown>,
): { events: readonly FusionEvent[] } {
  const events: FusionEvent[] = [];
  state.decision = decision;
  events.push(makeEvent(ctx.runId, "decision", decision, ctx.now()));
  if (cause === "clean") {
    state.stage = "DECIDING";
    events.push(makeEvent(ctx.runId, "stage", { stage: "DECIDING" }, ctx.now()));
    state.stage = "DONE";
    events.push(makeEvent(ctx.runId, "stage", { stage: "DONE" }, ctx.now()));
  } else {
    state.stage = "FAILED";
    events.push(makeEvent(ctx.runId, "stage", { stage: "FAILED" }, ctx.now()));
  }
  state.terminal = true;
  events.push(
    makeEvent(
      ctx.runId,
      "done",
      { cause, failures: failureList(state), survivors: survivorsOf(state) },
      ctx.now(),
    ),
  );
  return { events };
}

/**
 * Advance after a wave completes: build the next wave from the validated
 * record (definition order) or record the decision. Empty built waves
 * fall through to the next stage; the stage machine guarantees progress.
 */
function advance(
  state: RunState,
  ctx: AdvanceContext,
): { error?: EngineError; events: readonly FusionEvent[] } {
  const events: FusionEvent[] = [];
  const enter = (to: RunStage): void => {
    if (!isLegalTransition(state.stage, to)) {
      throw new Error(`illegal stage transition ${state.stage} -> ${to}`);
    }
    state.stage = to;
    events.push(makeEvent(ctx.runId, "stage", { stage: to }, ctx.now()));
  };

  if (state.stage === "GENERATING") {
    if (survivorsOf(state) === 0) {
      const decision = {
        cause: "failed",
        failures: failureList(state),
        note: "no surviving workers; pattern stages never ran",
        provenanceLimits: PROVENANCE_LIMITS,
        runId: ctx.runId,
        survivors: 0,
      };
      events.push(...finalize(state, ctx, "failed", decision).events);
      return { events };
    }
    enter("NORMALIZING");
  }

  const built = ctx.rebuild(ctx.reg);
  if ("error" in built) {
    return {
      error: {
        code: "E499",
        detail: `cannot rebuild pattern "${ctx.reg.pattern}": ${built.error}`,
      },
      events: [],
    };
  }
  const stages = built.stages;
  const fuse = built.fuse;

  const issueWave = (stage: WorkerStage, configs: readonly WorkerConfig[]): boolean => {
    enter(stage === "challenge" ? "CHALLENGING" : "VERIFYING");
    const jobs = configs.map((config) => jobFromConfig(config, stage));
    checkWaveJobs(jobs);
    state.jobs = jobs;
    state.wave += 1;
    state.pending = jobs.map((job) => job.jobId);
    events.push(
      makeEvent(
        ctx.runId,
        "wave",
        {
          jobs: jobs.map((j) => ({ jobId: j.jobId, stage: j.stage, workerId: j.workerId })),
          wave: state.wave,
        },
        ctx.now(),
      ),
    );
    return jobs.length > 0;
  };

  let deciding = false;
  if (state.stage === "NORMALIZING") {
    if (
      stages?.challenge !== undefined &&
      issueWave("challenge", stages.challenge(stageInputOf(state)))
    ) {
      return { events };
    }
    if (stages?.verify !== undefined && issueWave("verify", stages.verify(stageInputOf(state)))) {
      return { events };
    }
    deciding = true;
  } else if (state.stage === "CHALLENGING") {
    if (stages?.verify !== undefined && issueWave("verify", stages.verify(stageInputOf(state)))) {
      return { events };
    }
    deciding = true;
  } else if (state.stage === "VERIFYING") {
    deciding = true;
  }

  if (!deciding) {
    return {
      error: { code: "E499", detail: `cannot advance from stage ${state.stage}` },
      events: [],
    };
  }

  const fused = fuse(acceptedInDefinitionOrder(state));
  events.push(makeEvent(ctx.runId, "fusion", fused.fusion, ctx.now()));
  const decision = {
    ...fused.decision,
    cause: "clean",
    failures: failureList(state),
    provenanceLimits: PROVENANCE_LIMITS,
    runId: ctx.runId,
    survivors: survivorsOf(state),
  };
  events.push(...finalize(state, ctx, "clean", decision).events);
  return { events };
}

/**
 * The run view, read from committed state only: pending jobs, or the
 * terminal decision exactly as it was committed (never from a
 * projection, so an interrupted projection cannot yield a false done
 * with an empty decision).
 */
function viewOf(runDir: string, runId: string, state: RunState): RunView {
  if (state.terminal) {
    const decision = state.decision ?? {};
    const cause = decision["cause"];
    return {
      decision,
      runDir,
      runId,
      status: cause === "failed" || cause === "aborted" ? "failed" : "done",
    };
  }
  return {
    jobs: state.jobs.filter((job) => state.pending.includes(job.jobId)),
    runDir,
    runId,
    status: "pending",
  };
}

/**
 * Accept one submission for one job. Validation is total before any
 * commit: a rejected submission leaves the accepted state untouched and
 * the caller may correct and resubmit the same job. On the wave's last
 * terminal submission the engine advances (next wave or decision).
 * Commit order per run-store: the authoritative state (accepted claims,
 * pending removal, journal, and any terminal decision together) saves
 * atomically first; projections follow and never falsify the commit.
 */
export function submitToRun(
  repoRoot: string,
  runId: string,
  jobId: string,
  text: string,
  options: EngineOptions & { rebuild: PatternRebuild },
): { errors?: readonly EngineError[]; view?: RunView } {
  const checked = resolveRunDir(repoRoot, runId);
  if ("error" in checked) {
    return { errors: [checked.error] };
  }
  if (!JOB_ID_PATTERN.test(jobId)) {
    return {
      errors: [{ code: "E102", detail: `unknown job "${jobId}" (ids look like generate:w1)` }],
    };
  }
  const parsed = parseSubmission(text);
  if ("errors" in parsed) {
    return { errors: parsed.errors };
  }
  const runDir = checked.runDir;
  const reg = loadRegistration(runDir, runId);
  if ("error" in reg) {
    return { errors: [reg.error] };
  }
  const lock = acquireRunLock(runDir);
  if ("busy" in lock) {
    return { errors: [busyError(runId)] };
  }
  if ("error" in lock) {
    return { errors: [lock.error] };
  }
  try {
    const loaded = loadState(runDir);
    if ("error" in loaded) {
      return { errors: [loaded.error] };
    }
    const state = loaded.state;
    // Reconcile any interrupted projection from the committed journal
    // before mutating (idempotent; never appends duplicates).
    projectRun(runDir, state);
    if (state.terminal) {
      return {
        errors: [
          { code: "E204", detail: `run "${runId}" is already terminal; submissions are closed` },
        ],
      };
    }
    const job = state.jobs.find((entry) => entry.jobId === jobId);
    if (job === undefined) {
      const submitted = state.journal.some(
        (event) => event.kind === "submission" && event.payload.jobId === jobId,
      );
      return {
        errors: [
          {
            code: submitted ? "E204" : "E102",
            detail: submitted
              ? `job "${jobId}" already has a terminal submission; run fusion status --run ${runId}`
              : `run "${runId}" has no job "${jobId}" in its current wave`,
          },
        ],
      };
    }
    if (!state.pending.includes(jobId)) {
      return {
        errors: [
          {
            code: "E204",
            detail: `job "${jobId}" already has a terminal submission; rejected as a replay`,
          },
        ],
      };
    }

    const now = options.now ?? (() => new Date().toISOString());
    const events: FusionEvent[] = [];
    const jobIndex = state.jobs.findIndex((entry) => entry.jobId === jobId);

    if ("failure" in parsed.submission) {
      const failure = parsed.submission.failure;
      events.push(
        makeEvent(
          runId,
          "submission",
          { jobId, outcome: "failure", stage: job.stage, workerId: job.workerId },
          now(),
        ),
        makeEvent(
          runId,
          "failure",
          {
            class: failure.class,
            ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
            jobId,
            workerId: job.workerId,
          },
          now(),
        ),
      );
      const record: FailureRecord = {
        class: failure.class,
        ...(failure.detail !== undefined ? { detail: failure.detail } : {}),
        jobId,
        workerId: job.workerId,
      };
      state.failures = [...state.failures, record];
      state.pending = state.pending.filter((pending) => pending !== jobId);
    } else {
      const verdict = validateSuccessClaims(parsed.submission.claims, job.workerId, state);
      if ("errors" in verdict) {
        return { errors: verdict.errors };
      }
      const built = options.rebuild(reg.reg);
      if ("error" in built) {
        return { errors: [{ code: "E499", detail: `cannot rebuild pattern: ${built.error}` }] };
      }
      const patternErrors = built.validateSubmission(
        job,
        verdict.stamped,
        acceptedInDefinitionOrder(state),
      );
      if (patternErrors.length > 0) {
        return { errors: patternErrors.map((detail) => ({ code: "E201", detail })) };
      }
      const provenance: StampedProvenance = stampProvenance({
        harness: parsed.submission.identity.harness,
        model: parsed.submission.identity.model,
        runId,
        sessionId: parsed.submission.identity.sessionId,
        stampedAt: now(),
        workerId: job.workerId,
      });
      events.push(
        makeEvent(
          runId,
          "submission",
          {
            identity: { ...parsed.submission.identity },
            jobId,
            outcome: "success",
            stage: job.stage,
            workerId: job.workerId,
          },
          now(),
        ),
      );
      const newRecords: AcceptedRecord[] = [];
      verdict.stamped.forEach((claim, claimIndex) => {
        const stampedClaim = { ...claim, provenance };
        events.push(
          makeEvent(
            runId,
            "claim",
            { claim: stampedClaim, jobId, stage: job.stage, workerId: job.workerId },
            now(),
          ),
        );
        newRecords.push({
          claim: stampedClaim,
          claimIndex,
          jobId,
          jobIndex,
          stage: job.stage,
          wave: state.wave,
          workerId: job.workerId,
        });
      });
      state.accepted = [...state.accepted, ...newRecords];
      state.pending = state.pending.filter((pending) => pending !== jobId);
    }

    if (state.pending.length === 0) {
      const advanced = advance(state, {
        now,
        rebuild: options.rebuild,
        reg: reg.reg,
        runDir,
        runId,
      });
      if (advanced.error !== undefined) {
        return { errors: [advanced.error] };
      }
      events.push(...advanced.events);
    }

    state.journal = [...state.journal, ...events];
    saveState(runDir, state);
    projectRun(runDir, state);
    return { view: viewOf(runDir, runId, state) };
  } finally {
    lock.release();
  }
}

/**
 * Read a run's current handoff: pending jobs or the terminal decision.
 * Never advances stages and never writes run records.
 */
export function statusOfRun(
  repoRoot: string,
  runId: string,
): { errors?: readonly EngineError[]; view?: RunView } {
  const checked = resolveRunDir(repoRoot, runId);
  if ("error" in checked) {
    return { errors: [checked.error] };
  }
  const runDir = checked.runDir;
  const reg = loadRegistration(runDir, runId);
  if ("error" in reg) {
    return { errors: [reg.error] };
  }
  const loaded = loadState(runDir);
  if ("error" in loaded) {
    return { errors: [loaded.error] };
  }
  return { view: viewOf(runDir, runId, loaded.state) };
}

/**
 * Abort a run: record a failed terminal decision with the caller's
 * reason, retain partial events, execute no workers. Terminal runs
 * cannot abort again.
 */
export function abortRun(
  repoRoot: string,
  runId: string,
  reason: string,
  options: EngineOptions,
): { errors?: readonly EngineError[]; view?: RunView } {
  const checked = resolveRunDir(repoRoot, runId);
  if ("error" in checked) {
    return { errors: [checked.error] };
  }
  if (reason.trim().length === 0) {
    return { errors: [{ code: "E102", detail: "--reason must be non-empty" }] };
  }
  const runDir = checked.runDir;
  const reg = loadRegistration(runDir, runId);
  if ("error" in reg) {
    return { errors: [reg.error] };
  }
  const lock = acquireRunLock(runDir);
  if ("busy" in lock) {
    return { errors: [busyError(runId)] };
  }
  if ("error" in lock) {
    return { errors: [lock.error] };
  }
  try {
    const loaded = loadState(runDir);
    if ("error" in loaded) {
      return { errors: [loaded.error] };
    }
    const state = loaded.state;
    projectRun(runDir, state);
    if (state.terminal) {
      return {
        errors: [{ code: "E204", detail: `run "${runId}" is already terminal; it cannot abort` }],
      };
    }
    const now = options.now ?? (() => new Date().toISOString());
    const decision = {
      cause: "aborted",
      failures: failureList(state),
      provenanceLimits: PROVENANCE_LIMITS,
      reason,
      runId,
      survivors: survivorsOf(state),
    };
    const events = finalize(state, { now, runId }, "aborted", decision).events;
    state.journal = [...state.journal, ...events];
    saveState(runDir, state);
    projectRun(runDir, state);
    return { view: viewOf(runDir, runId, state) };
  } finally {
    lock.release();
  }
}
