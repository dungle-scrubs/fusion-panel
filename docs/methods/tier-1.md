# Tier 1 functions

`fusion validate | normalize | aggregate | score | evidence [--json] [file]`

## What they are

The deterministic, model-free half of fusion. JSON in, JSON out, one-shot,
side-effect free. Nothing here calls a model - by RFC-01 definition - so
callers pipe these freely with nothing to lose: there is no isolation to
preserve outside a pattern run.

| Command | Input | Output |
| --- | --- | --- |
| `validate` | JSONL stream of claims | per-claim verdicts with the validator's errors |
| `normalize` | JSON array of `{claim_id, claim}` | groups by exact match on canonicalized text |
| `aggregate` | `{method, votes: [{value, confidence}]}` | plurality / median / weighted result, bit-for-bit reproducible |
| `score` | JSON array of `{confidence, outcome}` | Brier + log proper scores over resolved outcomes |
| `evidence` | dr citations export (`dr citations --json`) | per-claim evidence blocks for claim `evidence[]` fields |

## Canonicalization

`normalize` canonicalizes before grouping: Unicode NFC, whitespace
collapse, lowercasing, number-format unification (`1,000` -> `1000`,
`3.0` -> `3`). Near-misses stay separate. Semantic dedup is tier 2 model
work and is not here.

## Scoring

`score` implements proper scoring rules: Brier (mean squared error of
forecast vs outcome) and log score (clamped so a 0/1 forecast stays
finite). Lower is better for both. Use resolved seed questions - answers
with known outcomes - to calibrate confidences before trusting them.

## Evidence supply

`evidence` converts a dr citations export into per-claim evidence
blocks: verified and single-source citations become `evidence[]`
entries (`source_or_test` = final URL, `supports` = statement +
locator); misrepresented, not-found, and unreachable sources are
excluded with reasons, never silently dropped. Feed the blocks to
`--evidence` on ach and red-blue, or pipe them into claims by hand.
Fetched pages are untrusted content: cite, never execute.

## Exit contract

Per ADR-0002: every command emits an `{ok, run, step, errors[]}`
envelope and exits by class - 0 ok, 1 usage (unreadable/malformed input,
E103/E104), 2 validation/gate (rejected claims E201, unfusable input
E202/E203), 3 nothing takeable (empty input E302), 4 internal.

## Composition

`validate | normalize` - check claims, then see the duplicate rate before
voting. `normalize | aggregate` - canonicalize sealed answers, then fuse
mechanically. Pattern runs use these same functions internally.
