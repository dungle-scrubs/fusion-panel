# Go/No-Go

`fusion gonogo --task <t> [--reviewers N] [--timeout <sec>] [--harness <hint>] [--model <hint>] [--roster <harness:model>] [--json]`

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
   The action is required. Missing or unsupported actions return E201
   and keep the job pending. A reviewer who cannot verify enough must
   explicitly choose `abstain`; silence never becomes a fabricated vote.
2. Mechanical veto rule: **any `escalate` or `abstain` blocks; no
   outvoting.** Verdict otherwise: GO WITH CONSTRAINT when any reviewer
   named a constraint (all constraints carry into the record), else GO.

## What the decision record carries

`decision` (the verdict), `vetoRule`, `blockingConcerns` (each block with
its concern, action, falsifier, reviewer), `constraints` (the union),
`positions` (reviewer positions referencing stamped claims in the event record),
`reviewers`, `provenanceLimits`.

## Guarantees and limits

- Guaranteed: the veto is a mechanical property of the tally, not a
  judgment; blocks carry falsifiers so the gate says what would reopen
  it. Fusion issues only the task in reviewer briefs. The caller enforces
  separate worker contexts.
- Limits: one wave, no appeal path - a blocked gate is re-run as a new
  gate once the falsifier is satisfied; reviewers judge the artifact
  through the task text and their own repo access, so the task must name
  what to inspect.

Identity is caller-reported and isolation is caller-enforced. The decision's
`provenanceLimits` records both limits. Fusion cannot prove worker independence.

## Run artifacts

`.fusion/runs/<runId>/` - `run.json`, `state.json`, `events.ndjson`, `decision.json`.
