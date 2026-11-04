# Sealed Jury

`fusion jury --task <t> [--workers N] [--vocabulary <a,b>] [--timeout <sec>] [--merge] [--harness <hint>] [--model <hint>] [--roster <harness:model>] [--json]`

## What it is for

A question that benefits from independent judgment: when one model's
answer might anchor on its own phrasing or prior, N sealed workers answer
it separately and the tool fuses their answers mechanically. Adapted from
the nominal-group and jury mechanisms (design doc, RFC-01 phase 4).
For bounded questions with a known answer set, pass `--vocabulary`
(e.g. `ship,hold`): workers answer with exactly one member verbatim and
grouping is exact by construction.

## Mechanics (caller-managed, ADR-0003)

1. The command starts a run and returns its first wave of jobs
   (`generate:w1`...`generate:wN`) with full worker prompts, advisory
   `timeoutSec` budgets and optional harness/model hints. The caller
   executes each job with its own delegation tools, giving each worker
   only its brief, and enforces worker isolation - fusion launches
   nothing.
2. The caller submits each job result with `fusion submit`: a success
   (`{claims, identity}` - identity is what actually ran, caller-reported)
   or a failure (`{failure}`). Fusion validates claims at the boundary,
   remaps ids to run scope, and stamps provenance marked
   `caller-reported`.
3. Pattern strictness: only `kind=answer` claims enter fusion. Anything
   else is rejected with a reason (E201; correct and resubmit the same
   job).
4. Tier 1 canonicalization groups equivalent answers (NFC, whitespace,
   casing, number formats). Near-misses stay separate - there is no
   semantic dedup in the mechanical stage.
5. Plurality vote over the groups; ties break by definition order
   (worker order as issued), so submission order cannot change the
   outcome. When `--vocabulary` is set, answers outside the set are
   rejected with a named reason. The record carries the vocabulary.

With `--merge`, after the generate wave completes fusion issues one
blind merge job (`verify:w-merge`): it sees the distinct canonical
answers with their anonymized record ids (`w1:C1`, ...) and clusters
paraphrases by meaning, citing those record ids in its cluster
dependencies. The tally then runs over clusters; the record keeps
pre-merge groups and the mapping, and a failed or unusable merge falls
back to the unmerged tally.

## What the decision record carries

- `decision` - the winning canonical answer
- `independence` - accepted answers, distinct groups, duplicate rate: read
  this before trusting consensus. Three semantically identical answers
  phrased differently show as three groups; the tool refuses to pretend
  that was one answer.
- `minorityReport` - losing groups with their members
- `rejectedOptions` - pattern-rejected claims with reasons
- `residualRisks` - minority answers with confidence >= 0.6 or their own
  escalate/revise vote, each with its falsifier
- `provenanceLimits` - identity is caller-reported and isolation is
  caller-enforced; fusion cannot verify either

## Guarantees and limits

- Guaranteed: the registration is frozen before jobs are issued; claim
  schema enforcement at the boundary; stage barriers; the merge worker
  sees no provenance; mechanical fusion - no model in the fusion loop;
  replayable event stream.
- Limits: exact-match grouping splits semantically-equal answers with
  different wording - pass `--merge` for a blind merge worker; semantic
  dedup stays model work, deliberately absent from tier 1. Isolation and
  identity are the caller's to enforce and report; a worker whose
  submission is rejected leaves the run unchanged and the caller may
  correct and resubmit the same job.

Identity is caller-reported and isolation is caller-enforced. The decision's
`provenanceLimits` records both limits. Worker slots remain visible in record
IDs, but harness, model and session metadata are hidden from the merge worker.

## Run artifacts

`.fusion/runs/<runId>/` - `run.json` (frozen registration with format
marker), `state.json` (mutable progress), `events.ndjson`
(append-only), `decision.json`.
