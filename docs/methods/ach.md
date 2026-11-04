# ACH Matrix

`fusion ach --task <t> [--workers N] [--timeout <sec>] [--evidence <file>] [--json]`

## What it is for

Explaining an observation that has more than one plausible cause. Analysts
file competing hypotheses and the evidence that bears on them; the tool
builds the hypotheses-x-evidence matrix mechanically and shows which
evidence discriminates and which is useless. Adapted from the CIA's
Analysis of Competing Hypotheses (design doc, RFC-01 phase 5).

The discipline ACH enforces: every hypothesis gets checked against every
piece of evidence - the step humans skip when cherry-picking support for a
favorite explanation.

## Mechanics (caller-managed, ADR-0003)

The command starts the run and returns all analyst jobs in one wave;
the caller executes each with its own delegation tools and submits
results with `fusion submit` (`{claims, identity}` or `{failure}`).
Isolation between analysts is caller-enforced.

1. Each sealed analyst files hypotheses (`kind=hypothesis`, each citing
   its evidence via `dependencies`) and evidence claims (each linking the
   hypotheses it bears on via `dependencies`, with `novelty`:
   `confirms` = consistent, `contradicts` = inconsistent). With
   `--evidence`, the prompt carries researched sources from a dr citations
   export and analysts cite those instead of recalling their own. One evidence
   claim carries one stance - a mixed stance means two claims.
2. A matrix cell (hypothesis, evidence) is consistent or inconsistent only
   when the link is bidirectional: the evidence names the hypothesis and
   the hypothesis cites the evidence. Otherwise the cell is `unlinked`.
3. ACH strictness at the pattern stage: a hypothesis with no evidence
   dependencies is rejected; so is evidence that links no hypothesis.
4. Classification:
   - **diagnostic** - evidence bearing on a proper subset of hypotheses
     (it supports some over the rest, or counts against one)
   - **consistent-with-all** - evidence confirming every hypothesis
     (cannot distinguish anything; weak)
   - evidence contradicting every hypothesis equally discriminates nothing
     and lands in neither list
5. **Least-disconfirmed** hypothesis: fewest inconsistent cells, ties
   broken toward more consistent cells, then first-seen. Its falsifier
   rides along as the sensitivity check.

## What the decision record carries

- `hypotheses`, `matrix` (every cell with its consistency), `leastDisconfirmed`
- `diagnosticEvidence`, `consistentWithAll`
- `rejectedClaims` (pattern-strictness rejections), `residualRisks`
  (the winner's falsifier)

## Guarantees and limits

- Guaranteed: the matrix is mechanical - no model scores consistency;
  run-scoped ids keep sealed analysts' same-numbered claims apart; a
  rejected submission leaves the run unchanged - the caller corrects
  the claims (the E201 lines name the fields) and resubmits the same
  job.
- Limits: sealed analysts cannot cross-cite, so with N workers the merged
  matrix is block-diagonal - each analyst's evidence bears only on their
  own hypotheses, and every item is "diagnostic" against the union. Cross-
  worker synthesis is tier 2 model work, deliberately absent.

## Run artifacts

`.fusion/runs/<runId>/` - `run.json` (frozen registration with the
evidence snapshot), `state.json`, `events.ndjson`, `decision.json` (the
matrix lives in both the fusion event and the record).
