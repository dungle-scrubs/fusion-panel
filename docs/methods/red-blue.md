# Red-Blue-Umpire

`fusion red-blue --task <t> --burden <b> [--timeout <sec>] [--evidence <file>] [--harness <hint>] [--model <hint>] [--roster <harness:model>] [--json]`

## What it is for

A claim set that should survive adversarial review before you rely on it.
One worker proposes; another attacks; a third resolves facts; a fourth -
without harness or model metadata - assesses the record against a standard you set.
Adapted from adversarial review and moot-court mechanisms (design doc,
RFC-01 phase 5).

## Mechanics (caller-managed, ADR-0003)

Up to four role jobs over three waves, in stage order (GENERATING,
CHALLENGING, VERIFYING). The command starts the run and returns the
claimant job; each later wave is issued only after every job of the
current wave has a terminal submission. The caller executes each job
with its own delegation tools and submits results with `fusion submit`
(`{claims, identity}` or `{failure}`); budgets are advisory and
isolation is caller-enforced.

1. **Claimant** (`generate:w-red`) files 1-4 atomic claims. Named
   executable checks go in the falsifier or an `evidence[]` entry
   (backticked command). With `--evidence`, the prompt carries researched
   sources from a dr citations export - the file content is frozen into
   the run record, so later waves survive the file changing or
   disappearing - and the claimant cites those instead of recalling its
   own.
2. **Opponent** (`challenge:w-blue`) sees the claims anonymized - no
   provenance, no harness or model - and must challenge with
   zero to four `kind=objection` claims. Each objection's `dependencies`
   names exactly one claimant record ID, such as `w-red:C1`. Zero
   objections is a successful result with `claims: []` and identity.
   Free-form critique never passes the schema.
3. **Umpire** (`verify:w-umpire`) is issued only when objections exist.
   It submits exactly one evidence ruling per objection, each naming that
   objection as its sole dependency and carrying a required action.
   Duplicate or missing rulings return E201. Where a check
   names a command, the caller's worker may run it and report the result
   as `status=observed` evidence. Ruling semantics ride on
   `requested_action`: `accept` = objection sustained (target falls),
   `revise` = overruled (target survives), `test` = inconclusive.
4. **Judge** (`verify:w-judge`) sees the claims and objections and assesses
   them against the `--burden`. The judge and umpire work in the same wave,
   so the judge does not see umpire rulings. Fusion applies those rulings
   mechanically when both jobs finish. Judge verdict `accept` means that
   the record the judge saw meets the burden. The judge submits exactly
   one answer with required action `accept`, `revise`, `escalate` or
   `abstain`. With no objections, this is the only verify job; no
   artificial umpire failure is recorded.

Budgets are symmetric: every role gets the same `--timeout` hint.

## What the decision record carries

- `decision` and `judgeVerdict` - the ruling and its accept/revise/escalate/abstain verdict
- `survivingClaims` - claim ids that no sustained objection removed
- `rejectedOptions` - each with its ruling reason
- `residualRisks` - unresolved objections (inconclusive checks) with their targets
- `provenanceLimits` - identity is caller-reported and isolation is caller-enforced

## Guarantees and limits

- Guaranteed: challenge must be typed objections (schema-enforced), the
  judge sees no harness, model or session metadata, stage barriers hold, and a
  failed role does not fail the run while survivors remain (submit a
  `{failure}` for it).
- Limits: one judge, no appeal path; id references across roles resolve
  through run-scoped ids (`w-red:C1`), so a worker's own claim ids stay
  worker-scoped; a rejected submission leaves the run unchanged - correct
  the claims and resubmit the same job. Fusion cannot verify what the
  caller reports about which harness or model actually ran.

Identity is caller-reported and isolation is caller-enforced. Role names remain
visible in claim references. The judge's assessment precedes the umpire rulings;
a sequential reconsideration of those rulings is outside this method's current
three-wave protocol.

## Run artifacts

`.fusion/runs/<runId>/` - `run.json` (frozen registration with the
burden as rubric and the evidence snapshot), `state.json`,
`events.ndjson`, `decision.json`.
