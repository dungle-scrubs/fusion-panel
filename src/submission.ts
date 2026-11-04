/**
 * Submission boundary (ADR-0003, caller-managed delegation): strict
 * parsing of one caller submission and validation of its claims and
 * dependency references. Pure module: no I/O.
 *
 * The submission is a strict tagged union: success is exactly
 * {claims, identity} and failure is exactly {failure} - a failure never
 * carries identity (even null), and unknown fields are rejected rather
 * than ignored.
 *
 * Claim references may cite the submitting worker's own claims (bare
 * C-refs, including same-submission siblings) or accepted record claims
 * from PRIOR waves (worker-scoped refs). A same-wave peer is never a
 * valid target: peers submit concurrently behind the wave barrier, so a
 * peer submitting first must not make its claims citable.
 */
import { validateClaim } from "./claim";
import { type EngineError, WORKER_ID_PATTERN } from "./run";

export interface SubmissionIdentity {
  readonly harness: string;
  readonly model: string;
  readonly sessionId: string;
}

export type Submission =
  | { readonly claims: readonly unknown[]; readonly identity: SubmissionIdentity }
  | { readonly failure: { readonly class: string; readonly detail?: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const IDENTITY_FIELDS = ["harness", "model", "sessionId"] as const;

/**
 * Parse one JSON object from the caller. Strict: exactly one of
 * {claims, identity} (success) or {failure} (failure) - anything else
 * is an input error, never silently coerced.
 */
export function parseSubmission(
  text: string,
): { errors: readonly EngineError[] } | { submission: Submission } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return {
      errors: [
        {
          code: "E104",
          detail: `submission is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  if (!isRecord(parsed)) {
    return { errors: [{ code: "E104", detail: "submission must be a JSON object" }] };
  }
  const hasClaims = "claims" in parsed;
  const hasFailure = "failure" in parsed;
  if (hasClaims && hasFailure) {
    return {
      errors: [{ code: "E104", detail: "submission must be either success or failure, not both" }],
    };
  }
  if (!hasClaims && !hasFailure) {
    return {
      errors: [
        {
          code: "E104",
          detail: 'submission must be {"claims":[...],"identity":{...}} or {"failure":{...}}',
        },
      ],
    };
  }
  if (hasFailure) {
    for (const key of Object.keys(parsed)) {
      if (key !== "failure") {
        return {
          errors: [
            {
              code: "E104",
              detail: `failure submissions permit only "failure", not "${key}"`,
            },
          ],
        };
      }
    }
    const failure = parsed["failure"];
    if (!isRecord(failure)) {
      return { errors: [{ code: "E104", detail: "failure must be an object {class, detail?}" }] };
    }
    for (const key of Object.keys(failure)) {
      if (key !== "class" && key !== "detail") {
        return { errors: [{ code: "E104", detail: `unknown failure field "${key}"` }] };
      }
    }
    const failureClass = failure["class"];
    if (typeof failureClass !== "string" || failureClass.trim().length === 0) {
      return {
        errors: [
          { code: "E104", detail: 'failure.class must be a non-empty string (e.g. "timeout")' },
        ],
      };
    }
    const detail = failure["detail"];
    if (detail !== undefined && typeof detail !== "string") {
      return { errors: [{ code: "E104", detail: "failure.detail must be a string when present" }] };
    }
    return {
      submission: {
        failure: {
          class: failureClass,
          ...(detail !== undefined ? { detail } : {}),
        },
      },
    };
  }
  for (const key of Object.keys(parsed)) {
    if (key !== "claims" && key !== "identity") {
      return { errors: [{ code: "E104", detail: `unknown submission field "${key}"` }] };
    }
  }
  const claims = parsed["claims"];
  if (!Array.isArray(claims)) {
    return { errors: [{ code: "E104", detail: "claims must be an array" }] };
  }
  const identity = parsed["identity"];
  if (!isRecord(identity)) {
    return {
      errors: [{ code: "E104", detail: "identity must be an object {harness, model, sessionId}" }],
    };
  }
  for (const key of Object.keys(identity)) {
    if (!(IDENTITY_FIELDS as readonly string[]).includes(key)) {
      return { errors: [{ code: "E104", detail: `unknown identity field "${key}"` }] };
    }
  }
  for (const field of IDENTITY_FIELDS) {
    const value = identity[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      return {
        errors: [
          {
            code: "E104",
            detail: `identity.${field} must be a non-empty string (model may be "unknown")`,
          },
        ],
      };
    }
  }
  return {
    submission: {
      claims,
      identity: {
        harness: String(identity.harness),
        model: String(identity.model),
        sessionId: String(identity.sessionId),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Claim-id normalization and dependency resolution
// ---------------------------------------------------------------------------

const SCOPED_ID = /^([a-z0-9-]+):(C[0-9]+)$/;

/** Split a claim id or dependency into its run-scoped form, if any. */
function scopedParts(raw: string): { local: string; workerId: string } | null {
  const match = SCOPED_ID.exec(raw);
  if (match === null) {
    return null;
  }
  return { local: match[2] ?? "", workerId: match[1] ?? "" };
}

function localIdOf(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const scoped = scopedParts(raw);
  return scoped === null ? raw : scoped.local;
}

/**
 * Strip run-scope prefixes so the flat schema validator sees bare ids.
 * Storage keeps prefixed dependencies (they reference stamped record
 * claims); a copied prefixed claim_id normalizes to its local form.
 */
function bareClaim(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) {
    return {};
  }
  const claim = { ...raw };
  const claimId = localIdOf(claim["claim_id"]);
  if (claimId !== null) {
    claim["claim_id"] = claimId;
  }
  if (Array.isArray(claim["dependencies"])) {
    claim["dependencies"] = claim["dependencies"].map((dep: unknown) => {
      const local = typeof dep === "string" ? localIdOf(dep) : null;
      return local === null ? dep : local;
    });
  }
  return claim;
}

function dependenciesOf(raw: Record<string, unknown>): readonly string[] {
  const deps = raw["dependencies"];
  return Array.isArray(deps) ? deps.map(String) : [];
}

/** The accepted-record view reference validation needs (RunState satisfies this). */
export interface ReferenceRecord {
  readonly claim: Record<string, unknown>;
  readonly wave: number;
}

/**
 * Validate a success submission's claims against the schema, duplicate
 * and reference rules. Nothing is committed until every claim passes.
 * Reference rules: a bare C-ref resolves against the submitting
 * worker's own accepted or in-submission claims and is remapped to run
 * scope; a worker-scoped ref must exist in the record from a PRIOR
 * wave. A same-wave peer is rejected: the wave barrier means peers
 * submit concurrently and cannot have been shown each other's claims.
 */
export function validateSuccessClaims(
  claims: readonly unknown[],
  workerId: string,
  state: { readonly accepted: readonly ReferenceRecord[]; readonly wave: number },
): { errors: readonly EngineError[] } | { stamped: readonly Record<string, unknown>[] } {
  const errors: string[] = [];
  const priorWave = new Set<string>();
  const currentWave = new Set<string>();
  for (const entry of state.accepted) {
    const id = String(entry.claim["claim_id"]);
    if (entry.wave < state.wave) {
      priorWave.add(id);
    } else {
      currentWave.add(id);
    }
  }
  const localIds = new Set<string>();
  const normalized: { raw: Record<string, unknown>; local: string }[] = [];

  for (const raw of claims) {
    if (!isRecord(raw)) {
      errors.push("claim must be a JSON object");
      continue;
    }
    const bare = bareClaim(raw);
    const verdict = validateClaim(bare);
    if (!verdict.valid) {
      errors.push(`${verdict.claim_id}: ${verdict.errors.join("; ")}`);
      continue;
    }
    const local = String(bare["claim_id"]);
    if (localIds.has(local)) {
      errors.push(`duplicate claim_id ${local} within this submission`);
      continue;
    }
    const own = `${workerId}:${local}`;
    if (priorWave.has(own) || currentWave.has(own)) {
      errors.push(`claim_id ${local} duplicates an already accepted claim for worker ${workerId}`);
      continue;
    }
    localIds.add(local);
    normalized.push({ raw, local });
  }

  // Dependency resolution runs after ids are known (a claim may cite a
  // sibling from the same submission).
  const stamped: Record<string, unknown>[] = [];
  for (const entry of normalized) {
    const claim = { ...entry.raw };
    claim["claim_id"] = `${workerId}:${entry.local}`;
    const deps = dependenciesOf(entry.raw);
    const resolved: string[] = [];
    let depsValid = true;
    for (const dep of deps) {
      const scoped = scopedParts(dep);
      if (scoped === null) {
        if (!/^C[0-9]+$/.test(dep)) {
          errors.push(
            `${entry.local}: dependency "${dep}" must be a C[0-9]+ ref or a worker-scoped ref`,
          );
          depsValid = false;
          continue;
        }
        const target = `${workerId}:${dep}`;
        if (!localIds.has(dep) && !priorWave.has(target)) {
          errors.push(
            `${entry.local}: dependency ${dep} does not match any claim of worker ${workerId} (own or in this submission)`,
          );
          depsValid = false;
          continue;
        }
        resolved.push(target);
        continue;
      }
      if (!WORKER_ID_PATTERN.test(scoped.workerId)) {
        errors.push(`${entry.local}: dependency "${dep}" names an invalid worker scope`);
        depsValid = false;
        continue;
      }
      if (priorWave.has(dep) || (scoped.workerId === workerId && localIds.has(scoped.local))) {
        resolved.push(dep);
        continue;
      }
      if (currentWave.has(dep)) {
        errors.push(
          `${entry.local}: dependency ${dep} is a same-wave peer claim; dependencies may cite prior waves or your own claims only`,
        );
        depsValid = false;
        continue;
      }
      errors.push(`${entry.local}: dependency ${dep} does not match any claim in the run record`);
      depsValid = false;
    }
    if (!depsValid) {
      continue;
    }
    if (resolved.length > 0) {
      claim["dependencies"] = resolved;
    }
    stamped.push(claim);
  }

  if (errors.length > 0) {
    return { errors: errors.map((detail) => ({ code: "E201", detail: `claims: ${detail}` })) };
  }
  return { stamped };
}
