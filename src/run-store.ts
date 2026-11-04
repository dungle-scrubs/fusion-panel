/**
 * Filesystem run store (ADR-0003, caller-managed delegation): owns
 * every read and write under .fusion/runs/<runId>/ so the engine
 * orchestrates without touching disks directly.
 *
 * Persistence order - state.json is the single authoritative commit:
 *   1. A mutation applies entirely to the in-memory state: accepted
 *      claims, pending removal, failures, stage transitions, the
 *      terminal decision, and the committed event journal all land in
 *      ONE atomic state.json replacement (write a sibling temp file,
 *      rename over the target).
 *   2. Projections run only AFTER the authoritative commit:
 *      decision.json is rewritten from the committed terminal decision,
 *      and events.ndjson receives an append-only suffix replayed from
 *      the committed journal.
 *   3. A failed or interrupted projection never rolls the commit back
 *      and never changes what a view returns: views read the decision
 *      from state.json, and the next mutation replays any missing
 *      event suffix from the journal, never appending duplicates.
 *
 * The mutation lock is exclusive and never stolen: a conflict is busy
 * (E304) regardless of the holder's recorded health or pid. A caller
 * may inspect and explicitly remove a stale lock outside the protocol.
 */
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type { Job } from "./engine";
import {
  type EngineError,
  type FusionEvent,
  RUN_FORMAT,
  RUN_ID_PATTERN,
  type RunRegistration,
  type RunStage,
  type WorkerStage,
} from "./run";

export interface AcceptedRecord {
  readonly claim: Record<string, unknown>;
  readonly claimIndex: number;
  readonly jobId: string;
  readonly jobIndex: number;
  readonly stage: WorkerStage;
  readonly wave: number;
  readonly workerId: string;
}

export interface FailureRecord {
  readonly class: string;
  readonly detail?: string;
  readonly jobId: string;
  readonly workerId: string;
}

export interface RunState {
  readonly runFormat: string;
  stage: RunStage;
  wave: number;
  jobs: readonly Job[];
  pending: readonly string[];
  accepted: readonly AcceptedRecord[];
  failures: readonly FailureRecord[];
  terminal: boolean;
  /** Terminal decision, committed atomically with the terminal state. */
  decision?: Record<string, unknown>;
  /** Committed event journal projections replay from; the audit record of record. */
  journal: readonly FusionEvent[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runDirOf(repoRoot: string, runId: string): string {
  return join(repoRoot, ".fusion", "runs", runId);
}

/** Validate the run id against its pattern before any path is built. */
export function resolveRunDir(
  repoRoot: string,
  runId: string,
): { error: EngineError } | { runDir: string } {
  if (!RUN_ID_PATTERN.test(runId)) {
    return {
      error: { code: "E102", detail: `unknown run "${runId}" (run ids match r[0-9a-f]{8})` },
    };
  }
  return { runDir: runDirOf(repoRoot, runId) };
}

/**
 * Claim the run's directory atomically: ensure .fusion/runs exists, then
 * create the individual run directory NON-recursively. EEXIST means the
 * run id is taken (run collision or replayed start) and the existing
 * files are retained untouched.
 */
export function createRunDir(
  repoRoot: string,
  runId: string,
): { error: EngineError } | { runDir: string } {
  const checked = resolveRunDir(repoRoot, runId);
  if ("error" in checked) {
    return checked;
  }
  try {
    mkdirSync(join(repoRoot, ".fusion", "runs"), { recursive: true });
    mkdirSync(checked.runDir);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const detail = error instanceof Error ? error.message : String(error);
    if (code === "EEXIST") {
      return {
        error: {
          code: "E102",
          detail: `run "${runId}" already exists; run ids are never reused - start a new run`,
        },
      };
    }
    return {
      error: { code: "E499", detail: `cannot create run directory for "${runId}": ${detail}` },
    };
  }
  return { runDir: checked.runDir };
}

/** Freeze the registration (with its format marker) into run.json. */
export function writeRegistration(runDir: string, reg: RunRegistration): void {
  writeFileSync(
    join(runDir, "run.json"),
    `${JSON.stringify({ ...reg, runFormat: RUN_FORMAT }, null, 2)}\n`,
  );
}

/** Load the frozen registration; reject pre-caller (hcn) formats with a usage error. */
export function loadRegistration(
  runDir: string,
  runId: string,
): { error: EngineError } | { reg: RunRegistration } {
  let text: string;
  try {
    text = readFileSync(join(runDir, "run.json"), "utf8");
  } catch {
    return { error: { code: "E102", detail: `unknown run "${runId}"` } };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { error: { code: "E102", detail: `run record for "${runId}" is not valid JSON` } };
  }
  if (!isRecord(parsed)) {
    return { error: { code: "E102", detail: `run record for "${runId}" is malformed` } };
  }
  if (parsed["runFormat"] !== RUN_FORMAT) {
    return {
      error: {
        code: "E102",
        detail: `run "${runId}" was recorded in an incompatible format (hcn-executed era); start a new run`,
      },
    };
  }
  return { reg: parsed as unknown as RunRegistration };
}

/**
 * Load the authoritative state. A state is corrupt when it is not
 * parseable, lacks the current run format or the committed journal, or
 * is terminal without its committed decision.
 */
export function loadState(runDir: string): { error: EngineError } | { state: RunState } {
  let text: string;
  try {
    text = readFileSync(join(runDir, "state.json"), "utf8");
  } catch {
    return {
      error: { code: "E499", detail: "run state is missing or unreadable; restart the run" },
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { error: { code: "E499", detail: "run state is corrupt; restart the run" } };
  }
  if (!isRecord(parsed) || parsed["runFormat"] !== RUN_FORMAT) {
    return { error: { code: "E499", detail: "run state is corrupt; restart the run" } };
  }
  if (!Array.isArray(parsed["journal"])) {
    return {
      error: { code: "E499", detail: "run state is corrupt (no event journal); restart the run" },
    };
  }
  if (parsed["terminal"] === true && !isRecord(parsed["decision"])) {
    return {
      error: {
        code: "E499",
        detail: "run state is corrupt (terminal without a decision); restart the run",
      },
    };
  }
  return { state: parsed as unknown as RunState };
}

/** Atomic state replacement: write a sibling temp file, then rename over state.json. */
export function saveState(runDir: string, state: RunState): void {
  const target = join(runDir, "state.json");
  const tmp = join(runDir, "state.json.tmp");
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, target);
}

function atomicWriteJson(runDir: string, name: string, value: Record<string, unknown>): void {
  const target = join(runDir, name);
  const tmp = join(runDir, `${name}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, target);
}

/**
 * Count the events already projected into events.ndjson. A missing file
 * is zero committed events. An unreadable file is unknown (null): the
 * caller must skip appending rather than risk a duplicate. A torn tail
 * line (interrupted append) is not a committed event.
 */
function committedProjection(
  path: string,
): { count: number; completeBytes: number; size: number } | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { count: 0, completeBytes: 0, size: 0 };
    }
    return null;
  }
  const completeBytes = bytes.lastIndexOf(0x0a) + 1;
  const lines = bytes.subarray(0, completeBytes).toString("utf8").split("\n");
  return {
    count: lines.filter((line) => line.length > 0).length,
    completeBytes,
    size: bytes.length,
  };
}

/**
 * Project the committed state onto disk: rewrite decision.json for a
 * terminal run and append the unprojected journal suffix to
 * events.ndjson. Best effort by design - it never throws and never
 * duplicates: a failed projection leaves the authoritative state
 * committed and the journal holding the full audit record, and the next
 * mutation replays exactly the missing suffix.
 */
export function projectRun(runDir: string, state: RunState): void {
  if (state.terminal) {
    try {
      atomicWriteJson(runDir, "decision.json", state.decision ?? {});
    } catch {
      // projection only; state.json and the journal keep the record
    }
  }
  const eventsPath = join(runDir, "events.ndjson");
  try {
    const have = committedProjection(eventsPath);
    if (have === null || have.count > state.journal.length) {
      return;
    }
    const suffix = state.journal.slice(have.count);
    if (suffix.length === 0 && have.completeBytes === have.size) {
      return;
    }
    const fd = openSync(eventsPath, "a");
    try {
      // Discard only an incomplete append. Complete journal entries stay intact.
      if (have.completeBytes !== have.size) {
        ftruncateSync(fd, have.completeBytes);
      }
      if (suffix.length > 0) {
        writeSync(fd, `${suffix.map((event) => JSON.stringify(event)).join("\n")}\n`);
      }
    } finally {
      closeSync(fd);
    }
  } catch {
    // projection only; state.json and the journal keep the record
  }
}

/**
 * Exclusive mutation lock per run: create the lock file with O_EXCL. A
 * conflict is busy (E304) regardless of who holds it or whether their
 * recorded pid is alive - the protocol never reads the lock content,
 * never kills, and never removes another owner's lock. The holder's
 * release() unlinks only its own file. An acquisition error other than
 * EEXIST is internal (E499), not busy.
 */
export function acquireRunLock(
  runDir: string,
): { busy: true } | { error: EngineError } | { release: () => void } {
  const lockPath = join(runDir, "lock");
  let fd: number;
  try {
    fd = openSync(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { busy: true };
    }
    return {
      error: {
        code: "E499",
        detail: `cannot acquire run lock: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  // Informational content for a human inspecting a stale lock; the
  // protocol itself never reads it.
  try {
    writeSync(fd, `${JSON.stringify({ at: new Date().toISOString(), pid: process.pid })}\n`);
  } catch (error) {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // already gone; nothing of ours to remove
    }
    return {
      error: {
        code: "E499",
        detail: `cannot write run lock: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
  closeSync(fd);
  return {
    release: () => {
      try {
        unlinkSync(lockPath);
      } catch {
        // already gone; nothing to release
      }
    },
  };
}
