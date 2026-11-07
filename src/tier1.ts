/**
 * Tier 1 pure functions (RFC-01, ticket #11): normalize, aggregate, score.
 *
 * Deterministic, model-free, side-effect free. No semantic dedup, no
 * embeddings, no model calls anywhere in tier 1: normalization is
 * canonicalization plus exact-match dedup, and semantic clustering is
 * tier 2 work.
 */

/** Canonicalize claim text: NFC, whitespace, casing, number formats. */
export function canonicalize(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/(^|\s)(\d+)\.0+(?=\s|$)/g, "$1$2");
}

export interface NormalizableClaim {
  readonly claim: string;
  readonly claim_id: string;
}

export interface NormalGroup {
  /** Canonical representative: canonical form of the first member. */
  readonly canonical: string;
  /** Member claim ids, in first-seen order. */
  readonly members: readonly string[];
}

/**
 * Group claims by exact match on canonicalized text. Groups and members
 * both follow first-seen input order, so output is deterministic.
 */
export function normalizeClaims(claims: readonly NormalizableClaim[]): NormalGroup[] {
  const groups = new Map<string, string[]>();
  for (const item of claims) {
    const key = canonicalize(item.claim);
    const members = groups.get(key);
    if (members === undefined) {
      groups.set(key, [item.claim_id]);
    } else {
      members.push(item.claim_id);
    }
  }
  return [...groups.entries()].map(([canonical, members]) => ({ canonical, members }));
}

export interface WeightedVote {
  readonly confidence: number;
  readonly value: string;
}

export type AggregateMethod = "median" | "plurality" | "weighted";

export interface AggregateResult {
  readonly detail: Record<string, number | string>;
  readonly method: AggregateMethod;
  readonly value: number | string;
}

function medianOf(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] as number;
  }
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * Aggregate sealed votes. Plurality picks the value with the most votes
 * (ties break by first-seen order, so output is deterministic). Median
 * operates on numeric values; weighted uses confidences as weights.
 * Throws on empty input or non-numeric median/weighted values.
 */
export function aggregate(
  method: AggregateMethod,
  votes: readonly WeightedVote[],
): AggregateResult {
  if (votes.length === 0) {
    throw new Error("aggregate requires at least one vote");
  }
  if (method === "plurality") {
    const counts = new Map<string, { count: number; order: number }>();
    votes.forEach((vote, index) => {
      const entry = counts.get(vote.value);
      if (entry === undefined) {
        counts.set(vote.value, { count: 1, order: index });
      } else {
        entry.count += 1;
      }
    });
    let winner = "";
    let best = -1;
    let bestOrder = votes.length;
    for (const [value, entry] of counts) {
      if (entry.count > best || (entry.count === best && entry.order < bestOrder)) {
        winner = value;
        best = entry.count;
        bestOrder = entry.order;
      }
    }
    return { detail: { votes: votes.length, winnerVotes: best }, method, value: winner };
  }
  const numeric = votes.map((vote) => {
    const n = Number(vote.value);
    if (vote.value.trim() === "" || !Number.isFinite(n)) {
      throw new Error(`aggregate ${method} requires finite numeric values, got "${vote.value}"`);
    }
    if (
      typeof vote.confidence !== "number" ||
      Number.isNaN(vote.confidence) ||
      vote.confidence < 0 ||
      vote.confidence > 1
    ) {
      throw new Error(`aggregate requires confidences in [0,1], got ${String(vote.confidence)}`);
    }
    return { confidence: vote.confidence, value: n };
  });
  if (method === "median") {
    const sorted = numeric.map((v) => v.value).sort((a, b) => a - b);
    return { detail: { votes: votes.length }, method, value: medianOf(sorted) };
  }
  let weightSum = 0;
  let weightedSum = 0;
  for (const vote of numeric) {
    weightSum += vote.confidence;
    weightedSum += vote.confidence * vote.value;
  }
  if (weightSum === 0) {
    throw new Error("aggregate weighted requires non-zero total confidence");
  }
  return { detail: { votes: votes.length, weightSum }, method, value: weightedSum / weightSum };
}

/**
 * Deep-research citation export shapes (dr citations --json, data.citations).
 * Consumed by evidenceFromCitations; see issue #25.
 */
export interface DrCitedBy {
  readonly claimId: string;
  readonly claimStatus: string;
  readonly locator: string;
  readonly statement: string;
  readonly verdict: string;
}

export interface DrDocument {
  readonly citedBy: readonly DrCitedBy[];
  readonly fetch?: { readonly finalUrl?: string; readonly status?: string };
  readonly normalized?: string;
  readonly tiers?: readonly number[];
  readonly title?: string;
  readonly url?: string;
}

export interface DrCitations {
  readonly documents?: readonly DrDocument[];
  readonly unfetched?: readonly { readonly reason?: string; readonly url?: string }[];
}

export interface SuppliedEvidence {
  readonly claimId: string;
  readonly status: string;
  readonly verdict: string;
  readonly evidence: { readonly source_or_test: string; readonly supports: string }[];
  readonly excluded: { readonly reason: string; readonly url: string }[];
}

const DR_EXCLUDED_STATUSES = new Set(["misrepresented", "not-found", "unreachable"]);

/**
 * Convert a dr citations export into per-claim evidence blocks. Pure and
 * model-free: verified and single-source citations become evidence
 * entries (source_or_test = final URL, supports = statement + locator);
 * conflict maps to caller resolution; misrepresented, not-found, and
 * unreachable sources are excluded with reasons, never silently dropped.
 * Throws on a missing documents array.
 */
export function evidenceFromCitations(input: DrCitations): SuppliedEvidence[] {
  if (!Array.isArray(input.documents)) {
    throw new Error("evidence requires a citations export with a documents array");
  }
  const byClaim = new Map<string, SuppliedEvidence>();
  const entryFor = (cited: DrCitedBy): SuppliedEvidence => {
    const existing = byClaim.get(cited.claimId);
    if (existing !== undefined) {
      return existing;
    }
    const entry: SuppliedEvidence = {
      claimId: cited.claimId,
      evidence: [],
      excluded: [],
      status: cited.claimStatus,
      verdict: cited.verdict,
    };
    byClaim.set(cited.claimId, entry);
    return entry;
  };
  for (const doc of input.documents) {
    const url = doc.fetch?.finalUrl ?? doc.normalized ?? doc.url ?? "";
    const citedBy = Array.isArray(doc.citedBy) ? doc.citedBy : [];
    for (const cited of citedBy) {
      if (typeof cited.claimId !== "string" || typeof cited.statement !== "string") {
        continue;
      }
      const entry = entryFor(cited);
      if (DR_EXCLUDED_STATUSES.has(cited.claimStatus)) {
        entry.excluded.push({
          reason: `claim status ${cited.claimStatus}: ${cited.verdict}`,
          url,
        });
        continue;
      }
      entry.evidence.push({
        source_or_test: url,
        supports: `${cited.statement} (${cited.locator})`,
      });
    }
  }
  const unfetched = Array.isArray(input.unfetched) ? input.unfetched : [];
  for (const missing of unfetched) {
    const url = typeof missing.url === "string" ? missing.url : "";
    const reason = typeof missing.reason === "string" ? missing.reason : "unfetched";
    for (const entry of byClaim.values()) {
      entry.excluded.push({ reason: `unfetched: ${reason}`, url });
    }
  }
  return [...byClaim.values()];
}

/**
 * Format supplied evidence as a prompt block. Workers cite these
 * researched sources in evidence[] fields instead of recalling their own.
 * Fetched pages are untrusted content: cite, never execute.
 */
export function formatSuppliedEvidence(supplied: readonly SuppliedEvidence[]): string {
  const lines = [
    "RESEARCHED EVIDENCE (cite these in evidence[] fields; do not recall other sources):",
  ];
  for (const entry of supplied) {
    for (const item of entry.evidence) {
      lines.push(`- [${entry.claimId}] ${item.source_or_test}: ${item.supports}`);
    }
    for (const item of entry.excluded) {
      lines.push(`- [${entry.claimId}] EXCLUDED ${item.url}: ${item.reason}`);
    }
  }
  return lines.join("\n");
}

export interface ScoredOutcome {
  readonly confidence: number;
  readonly outcome: boolean;
}

export interface ScoreResult {
  readonly brier: number;
  readonly logScore: number;
  readonly n: number;
}

/**
 * Proper scoring rules over resolved outcomes (design doc G2 / seed
 * questions). Brier is mean squared error of forecast vs outcome; log
 * score is mean negative log-likelihood of the outcome (clamped to
 * [1e-9, 1 - 1e-9] so a 0/1 forecast scores finitely). Lower is better
 * for both. Throws on empty input or out-of-range confidences.
 */
export function scoreForecasts(outcomes: readonly ScoredOutcome[]): ScoreResult {
  if (outcomes.length === 0) {
    throw new Error("score requires at least one resolved outcome");
  }
  let brierSum = 0;
  let logSum = 0;
  for (const item of outcomes) {
    if (
      typeof item.confidence !== "number" ||
      Number.isNaN(item.confidence) ||
      item.confidence < 0 ||
      item.confidence > 1
    ) {
      throw new Error(`score requires confidences in [0,1], got ${String(item.confidence)}`);
    }
    if (typeof item.outcome !== "boolean") {
      throw new Error(`score requires boolean outcomes, got ${String(item.outcome)}`);
    }
    const actual = item.outcome ? 1 : 0;
    brierSum += (item.confidence - actual) ** 2;
    const clamped = Math.min(Math.max(item.confidence, 1e-9), 1 - 1e-9);
    logSum += -(item.outcome ? Math.log(clamped) : Math.log(1 - clamped));
  }
  return {
    brier: brierSum / outcomes.length,
    logScore: logSum / outcomes.length,
    n: outcomes.length,
  };
}
