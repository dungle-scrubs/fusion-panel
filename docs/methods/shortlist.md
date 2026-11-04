# Shortlist

`fusion shortlist --task <t> --rubric <r> [--generators N] [--judges M] [--timeout] [--harness <hint>] [--model <hint>] [--roster <harness:model>] [--json]`

## What it is for

An open-ended problem with many possible answers where you need a ranked
few: name the launch strategy, pick the conference talk, choose the
vendor. Jury cannot help here - there is no bounded answer to vote on -
and red-blue attacks claims rather than ranking options. Shortlist fills
that gap: sealed generation, then blind judging against a rubric you
state up front.

## Mechanics (caller-managed, ADR-0003)

The command starts the run and returns the proposer jobs; the caller
executes each with its own delegation tools and submits results with
`fusion submit` (`{claims, identity}` or `{failure}`). The judging wave
is issued only after every proposer job is terminal. Isolation is
caller-enforced.

1. **Proposers** (generate stage): N sealed workers each file 1-3
   self-contained options as `kind=answer` claims.
2. **Judges** (the challenge wave, used as the judging wave): M fresh
   jobs see the anonymized options - no proposer identity, no model -
   and must score EVERY option, one verdict per option
   (`dependencies` targeting the option's record id):
   - `accept` - advance
   - `revise` - advance with a required change, named in the note
   - `abstain` - drop
   - `escalate` - needs a human decision
3. Mechanical tally (tier 1 canonicalization throughout):
   - duplicate options across proposers merge into one candidate, and
     verdicts against either instance fold into the same tally
   - an option **advances only on a strict majority of accepts** - a tie
     is not a majority
   - the shortlist ranks by accepts, then mean judge confidence, then
     first-seen
   - options no judge scored are flagged `unscored` as residual risks -
     never silently dropped

## What the decision record carries

`decision` (top-ranked option), `shortlist` (each advanced option with its
full tally and every judge note), `dropped` (each with its dominant
reason), `unscored`, `residualRisks`.

## Guarantees and limits

- Guaranteed: blindness by the engine's anonymized stage inputs; every
  number in the tally is mechanical; judges must score every option or
  the gap is visible; ties break by definition order, not submission
  order.
- Limits: judges score options as written - no clarification round (a
  revise-verdict note is the only feedback channel); one judging wave; a
  rejected submission leaves the run unchanged - correct the claims and
  resubmit the same job.

Identity is caller-reported and isolation is caller-enforced. The decision's
`provenanceLimits` records both limits. Opaque worker slots remain visible in
claim references, but harness, model and session metadata are removed from
later-stage records.

## Run artifacts

`.fusion/runs/<runId>/` - `run.json` (the rubric is frozen as the run's
rubric), `state.json`, `events.ndjson` (GENERATING then CHALLENGING; for
shortlist the challenge wave IS the judging wave), `decision.json`.
