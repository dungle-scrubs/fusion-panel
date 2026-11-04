# Go/No-Go

`fusion gonogo --task <t> [--reviewers N] [--timeout <sec>] [--json]`

## What it is for

A ship/block decision on one artifact - a release, a merge, a rollout -
where one reviewer with a nameable, falsifiable concern must be able to
stop it. Majority voting is exactly wrong here: a 2-1 GO with the 1
holding a real defect is a bad ship. The gate makes the veto mechanical.
Adapted from the design doc's andon/go-no-go family, reduced to a gate
without the mission-control subsystem (deferred, decision #4).

## Mechanics (caller-managed, ADR-0003)

The command starts the run and returns all reviewer jobs in one wave;
the caller executes each with its own delegation tools (repo access for
the reviewing worker is the caller's to grant) and submits results with
`fusion submit` (`{claims, identity}` or `{failure}`). Reviewer
isolation is caller-enforced.

1. N independent sealed reviewers. Each replies with one `kind=answer`
   claim whose
   `requested_action` carries the position:
   - `accept` - GO
   - `test` - GO WITH CONSTRAINT, the constraint named in the claim
   - `escalate` - NO-GO with a blocking concern; the falsifier states
     what evidence would clear the block
   - `abstain` - NO-GO as unverifiable (cannot judge)
   A missing `requested_action` counts as `abstain` - silence is never a
   GO.
2. Mechanical veto rule: **any `escalate` or `abstain` blocks; no
   outvoting.** Verdict otherwise: GO WITH CONSTRAINT when any reviewer
   named a constraint (all constraints carry into the record), else GO.

## What the decision record carries

`decision` (the verdict), `vetoRule`, `blockingConcerns` (each block with
its concern, action, falsifier, reviewer), `constraints` (the union),
`positions` (every reviewer's position with provenance on the claim),
`reviewers`.

## Guarantees and limits

- Guaranteed: the veto is a mechanical property of the tally, not a
  judgment; blocks carry falsifiers so the gate says what would reopen
  it; no cross-reviewer visibility - stage inputs are anonymized and
  there is only one wave.
- Limits: one wave, no appeal path - a blocked gate is re-run as a new
  gate once the falsifier is satisfied; reviewers judge the artifact
  through the task text and their own repo access, so the task must name
  what to inspect.

## Run artifacts

`.fusion/runs/<runId>/` - `run.json`, `events.ndjson`, `decision.json`.
