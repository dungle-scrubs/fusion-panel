import type { ClaimKind, RequestedAction } from "./claim";
import type { FuseFn, RunReport, StageBuilders, SubmissionCheck } from "./engine";
import type { RunRegistration, WorkerConfig } from "./run";
import { type DrCitations, evidenceFromCitations, formatSuppliedEvidence } from "./tier1";

export interface OptionSpec {
  readonly default?: string;
  readonly description: string;
  readonly flag?: "boolean";
  readonly name: string;
  readonly required?: boolean;
}

export interface PatternBuild {
  readonly fuse: FuseFn;
  readonly rubric?: string;
  readonly stages?: StageBuilders;
  readonly validateSubmission: SubmissionCheck;
  readonly stoppingRule: string;
  readonly task: string;
  readonly workers: readonly WorkerConfig[];
}

export type PatternOptions = Record<string, string | boolean>;

export type BuildResult = { error: string } | PatternBuild;

export interface CountBounds {
  readonly min: number;
  readonly max: number;
}

export interface RoleContract {
  readonly kinds: readonly ClaimKind[];
  readonly count: CountBounds;
  readonly actions:
    | { readonly required: false }
    | {
        readonly required: true;
        readonly allowed: readonly RequestedAction[];
      };
}

export function checkClaimCount(count: number, bounds: CountBounds, label = "this job"): string[] {
  if (count >= bounds.min && count <= bounds.max) return [];
  return [
    `${label} requires ${bounds.min === bounds.max ? `exactly ${bounds.min}` : `${bounds.min}-${bounds.max}`} claims`,
  ];
}

export function checkRoleClaims(
  claims: readonly Record<string, unknown>[],
  contract: RoleContract,
): string[] {
  const errors = checkClaimCount(claims.length, contract.count);
  for (const claim of claims) {
    if (!contract.kinds.some((kind) => kind === claim.kind)) {
      errors.push(`${String(claim.claim_id)}: this job requires kind ${contract.kinds.join("|")}`);
    }
    if (
      contract.actions.required &&
      !contract.actions.allowed.some((action) => action === claim.requested_action)
    ) {
      errors.push(
        `${String(claim.claim_id)}: requested_action must be ${contract.actions.allowed.join("|")}`,
      );
    }
  }
  return errors;
}

export function checkClaimReferences(
  claims: readonly Record<string, unknown>[],
  targets: ReadonlySet<string>,
  policy: { singleTarget?: boolean; uniqueTargets?: boolean; coverAll?: boolean } = {},
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    const dependencies = Array.isArray(claim.dependencies) ? (claim.dependencies as string[]) : [];
    if (dependencies.length === 0 || (policy.singleTarget && dependencies.length !== 1)) {
      errors.push(
        `${String(claim.claim_id)}: dependencies must name ${policy.singleTarget ? "exactly one target" : "at least one target"}`,
      );
    }
    for (const dependency of dependencies) {
      if (!targets.has(dependency)) {
        errors.push(
          `${String(claim.claim_id)}: dependency ${dependency} is not a target for this role`,
        );
      }
      if (policy.uniqueTargets && seen.has(dependency)) {
        errors.push(`${String(claim.claim_id)}: target ${dependency} has more than one verdict`);
      }
      seen.add(dependency);
    }
  }
  if (policy.coverAll) {
    for (const target of targets) {
      if (!seen.has(target)) errors.push(`missing verdict for target ${target}`);
    }
  }
  return errors;
}

export interface RosterEntry {
  readonly harness: string;
  readonly model?: string;
}

/** Default harness hint: the caller delegates; fusion never launches anything. */
export const DEFAULT_HARNESS_HINT = "caller";

/**
 * File access a pattern build may need, injectable so the CLI can freeze
 * evidence file content at registration and rebuild later waves from the
 * snapshot instead of a mutable external file.
 */
export interface PatternIo {
  readonly readEvidence?: (path: string) => string;
}

export const ROSTER_OPTION: OptionSpec = {
  description:
    "per-worker harness[:model] hints, repeatable, position-mapped to worker index; " +
    "length must equal the worker count",
  name: "roster",
};

export const HARNESS_OPTION: OptionSpec = {
  default: DEFAULT_HARNESS_HINT,
  description: "harness hint for every worker (the caller owns routing and may override)",
  name: "harness",
};

/**
 * Resolve per-worker harness/model hints. Without --roster every worker
 * shares the --harness/--model pair. With it, each entry is one harness
 * or harness:model; the count MUST equal the worker count or the build
 * fails before any job is issued. Repeatable flags arrive as a
 * comma-joined string under commander, so split there too. Hints are
 * advisory: the caller may route a worker anywhere.
 */
export function resolveRoster(
  options: PatternOptions,
  workerCount: number,
): { error: string } | { roster: RosterEntry[] } {
  const fallback: RosterEntry = {
    harness: String(options["harness"] ?? DEFAULT_HARNESS_HINT),
    ...(options["model"] === undefined ? {} : { model: String(options["model"]) }),
  };
  const raw = options["roster"];
  if (raw === undefined) {
    return { roster: Array.from({ length: workerCount }, () => ({ ...fallback })) };
  }
  const entries = String(raw)
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const separator = part.indexOf(":");
      if (separator === -1) {
        return { harness: part };
      }
      const harness = part.slice(0, separator).trim();
      const model = part.slice(separator + 1).trim();
      return {
        harness,
        ...(model.length === 0 ? {} : { model }),
      };
    })
    .filter((entry) => entry.harness.length > 0);
  if (entries.length !== workerCount) {
    return {
      error: `--roster expects ${workerCount} entries (one per worker), got ${entries.length}`,
    };
  }
  return { roster: entries };
}

export interface DiversityCounts {
  readonly harnesses: number;
  readonly models: number;
}

/**
 * Mechanical diversity counts over accepted claims: distinct harnesses
 * and distinct models from stamped provenance. The identity fields are
 * caller-reported (ADR-0003), so these counts are a weak independence
 * signal at best, never proof of independence.
 */
export function diversityCounts(claims: readonly { provenance?: unknown }[]): DiversityCounts {
  const harnesses = new Set<string>();
  const models = new Set<string>();
  for (const item of claims) {
    const provenance = item.provenance;
    if (typeof provenance !== "object" || provenance === null) {
      continue;
    }
    const record = provenance as Record<string, unknown>;
    if (typeof record["harness"] === "string") {
      harnesses.add(record["harness"]);
    }
    if (typeof record["model"] === "string") {
      models.add(record["model"]);
    }
  }
  return { harnesses: harnesses.size, models: models.size };
}

export interface PatternDefinition {
  readonly command: string;
  readonly description: string;
  build(options: PatternOptions, io?: PatternIo): BuildResult;
  readonly options: readonly OptionSpec[];
  summarize(decision: Record<string, unknown>, report: RunReport): readonly string[];
}

export interface RegistrationContext {
  readonly evidenceSnapshot?: { path: string; content: string };
  readonly now: () => string;
  readonly patternOptions?: Record<string, string | boolean>;
  readonly runId: string;
}

export function toRegistration(
  build: PatternBuild,
  pattern: string,
  context: RegistrationContext,
): RunRegistration {
  return {
    evidenceSnapshot: context.evidenceSnapshot,
    pattern,
    ...(context.patternOptions !== undefined ? { patternOptions: context.patternOptions } : {}),
    registeredAt: context.now(),
    runId: context.runId,
    rubric: build.rubric,
    stoppingRule: build.stoppingRule,
    task: build.task,
    workers: build.workers,
  };
}

export const EVIDENCE_OPTION: OptionSpec = {
  description:
    "dr citations export file (dr citations --json); researched sources workers must cite; content is frozen into the run record",
  name: "evidence",
};

/**
 * Resolve --evidence into a formatted prompt block. Reads the dr
 * citations export through the injected reader (the CLI passes the
 * frozen snapshot on rebuild), converts mechanically, formats for
 * prompts. Returns an error string for unreadable or malformed input
 * (E102 at build).
 */
export function resolveEvidence(
  options: PatternOptions,
  readFile: (path: string) => string,
): { error: string } | { block?: string } {
  const raw = options["evidence"];
  if (raw === undefined) {
    return {};
  }
  const path = String(raw);
  if (path.trim().length === 0) {
    return { error: "--evidence requires a file path" };
  }
  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    return {
      error: `--evidence cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { error: `--evidence file ${path} is not valid JSON` };
  }
  const root =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const data =
    typeof root["data"] === "object" && root["data"] !== null
      ? (root["data"] as Record<string, unknown>)
      : {};
  const citations =
    typeof data["citations"] === "object" && data["citations"] !== null
      ? (data["citations"] as { documents?: unknown; unfetched?: unknown })
      : (root as { documents?: unknown; unfetched?: unknown });
  if (!Array.isArray(citations.documents)) {
    return { error: `--evidence file ${path} has no documents array` };
  }
  let block: string;
  try {
    block = formatSuppliedEvidence(evidenceFromCitations(citations as DrCitations));
  } catch (error) {
    return {
      error: `--evidence file ${path} is not a valid citations export: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { block };
}
