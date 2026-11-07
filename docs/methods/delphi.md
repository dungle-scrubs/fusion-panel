# Delphi

`fusion delphi --task <t> [--workers N] [--vocabulary a,b] [--timeout <sec>] [--harness <hint>] [--model <hint>] [--roster <harness:model>] [--json]`

## What it is for

A question where independent judgment benefits from one bounded round of
peer exposure. Jury has zero interaction between workers by design; Delphi
is its counterpart with exactly one: round 2 sees the anonymized panel
record and may revise. Adapted from Delphi-panel mechanisms (design doc,
RFC-01).

Use it when anchoring on a first answer is the risk *and* some
cross-pollination is expected to help - estimation, forecasting-style
questions, and panels whose members correct each other's blind spots.

## Mechanics (caller-managed, ADR-0003)

The command starts the run and returns the round-1 jobs; the caller
executes each with its own delegation tools and submits results with
`fusion submit` (`{claims, identity}` or `{failure}`). The round-2 wave
is issued only after every round-1 job is terminal. Isolation is
caller-enforced.

1. **Round 1** (generate stage): N sealed workers, one `kind=answer`
   claim each.
2. **Round 2** (the challenge wave, used as the revision round): each
   worker with an accepted round-1 answer gets a fresh job that shows its
   OWN round-1 answer plus the full anonymized panel record - blind to
   the other panelists' identities and models. It revises or keeps its
   position, with `novelty` stating which (`confirms` = kept, `new` =
   revised). A worker that failed round 1 has no position to revise and
   gets no round-2 job.
3. Mechanical fusion, tier 1 canonicalization throughout:
   - **convergence** - duplicate rate within round 2: did wording-level
     groups collapse toward agreement?
   - **stability** - fraction of round-2 answers canonically equal to the
     same worker's round-1 answer: held positions vs revisions.
   - **decision** - round-2 plurality winner, first-seen tiebreak.

A panel that converges with high stability was already aligned; convergence
with low stability means minds changed - read the minority report before
trusting either.

With `--vocabulary a,b`, answers in both rounds must match a declared member
under canonical normalization. An off-vocabulary submission returns E201 and
leaves the job pending for correction. The decision records the vocabulary.

## What the decision record carries

`decision`, `delphi` (both rounds' answers/groups, convergence, stability),
`minorityReport` (losing round-2 groups with members and novelty),
`residualRisks` (minority answers with confidence >= 0.6 or their own
escalate/revise vote), `tie` (true when another round-2 group matched the
winner's votes and definition order decided), `pattern`. When every round-2
job fails, the run still completes with `decision` null; read `delphi.round2`
before trusting a null.

## Guarantees and limits

- Guaranteed: round 2 is blind to others' identities (engine-anonymized
  stage inputs); every signal is mechanical; ties break by definition
  order, not submission order.
- Limits: exactly one revision round (more rounds are a config change,
  deliberately absent); stability is measured by canonical comparison, not
  the self-reported novelty field (both are recorded); a rejected
  submission leaves the run unchanged - correct the claims (E201 lines
  name the fields) and resubmit the same job.

Identity is caller-reported and isolation is caller-enforced. The decision's
`provenanceLimits` records both limits. Opaque worker slots remain visible in
claim references, but harness, model and session metadata are removed from
later-stage records.

## Run artifacts

`.fusion/runs/<runId>/` - `run.json` (frozen registration), `state.json`,
`events.ndjson` (stage events show GENERATING then CHALLENGING; for
Delphi the challenge wave IS the revision round), `decision.json`.
