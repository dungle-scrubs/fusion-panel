# fusion

A composable fusion layer over agent harnesses: consensus you can audit.

fusion defines panel methods, validates worker claims and computes decisions you
can audit. Your calling harness runs the workers through its own delegation
tools. Fusion returns each stage's briefs, accepts structured results and keeps
the decision record. Worker isolation is caller-enforced and identity is
caller-reported.

```console
$ fusion jury --task "Is this migration plan sound?" --workers 3 --json | jq '{runId, status, jobs: [.jobs[].jobId]}'
{
  "runId": "r88f84947",
  "status": "pending",
  "jobs": [
    "generate:w1",
    "generate:w2",
    "generate:w3"
  ]
}
```

## Install

Requires Node 22+. Fusion does not require `hcn`. A calling harness with shell
access executes the worker jobs through its own tools.

```console
npm install -g @dungle-scrubs/fusion-panel
```

## Usage

### Get independent answers

```sh
fusion jury --task "Ship or hold the Friday release?" --workers 3 --json
```

Give each returned job's `prompt` to a separate worker using your harness's
native delegation tool. Keep peers' answers out of each worker's context.
Fusion does not launch processes or enforce those separate contexts.

### Submit a worker's result

Save the result and the identity reported by your harness as `submission.json`:

```json
{
  "claims": [{
    "claim_id": "C1",
    "kind": "answer",
    "claim": "Hold the release.",
    "status": "inferred",
    "confidence": 0.8,
    "falsifier": "The migration passes against a production-sized copy."
  }],
  "identity": {
    "harness": "your-harness",
    "model": "your-model",
    "sessionId": "your-worker-invocation-id"
  }
}
```

```sh
fusion submit --run <runId> --job generate:w1 submission.json --json
```

Use the run and job IDs from the handoff. Submit once for each job. A failed
worker uses `{"failure":{"class":"timeout"}}` instead of claims and identity.
The response contains the remaining jobs, the next stage's jobs, or the final
decision. `status: "pending"` is a successful handoff, not a completed panel.

### Recover a panel's progress

```sh
fusion status --run <runId> --json
fusion abort --run <runId> --reason "The question no longer needs a decision" --json
```

`status` returns pending jobs or the recorded decision across invocations.
`abort` records a failed outcome. Successful commands exit 0; read `status` to
distinguish pending, done and failed panels.

### Concepts

**Patterns.** Six problem-solving methods, each with tool-owned stages: `jury` (independent votes on a bounded question), `red-blue` (claims must survive adversarial challenge against a stated burden), `ach` (competing hypotheses for an observed outcome), `delphi` (one round of anonymized peer revision), `shortlist` (open generation ranked by blind judges), `gonogo` (a ship/block gate where one NO-GO blocks, no outvoting). Run `fusion skill` for the selection rules with their counter-rules.

**Claims.** The typed object every component exchanges: one flat schema with a falsifier required on every kind, unknown fields rejected, and provenance stamped only by the tool. Workers are untrusted content producers - nothing they write executes.

**Mechanical fusion.** No model decides a pattern's outcome. Tier-1 functions (validate, normalize, aggregate, score) are deterministic and model-free; pattern runs use exactly those functions to count, group, and rank.

## Reference

`fusion skill` prints the complete caller guide, including submission schemas.
Pattern commands accept optional harness, model, roster and timeout hints. The
caller chooses actual routing, permissions, session handling and budgets.

Runs live under `.fusion/runs/<runId>/`: frozen `run.json`, mutable `state.json`,
append-only `events.ndjson` and the terminal `decision.json`. Claims reject
worker-authored provenance. Fusion stamps caller-reported identity explicitly.

Existing scripts that expected a pattern command to launch workers must adopt
the submission loop. Earlier HCN run records remain on disk and are rejected as
incompatible by the new commands.

- [Method reference](docs/methods/README.md)
- [Caller-managed delegation](docs/adr/0003-caller-managed-delegation.md)
- [Exit codes and error envelopes](docs/adr/0002-envelope-and-exit-contract.md)

## Contributing

```console
pnpm install
pnpm build        # bundle dist/cli.js
pnpm test         # vitest suite
pnpm lint         # biome
pnpm typecheck    # tsc --noEmit
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, ...) - release-please derives versions and the changelog from them.

## Status

All six patterns use caller-managed delegation in this checkout. This change
has not been published to npm. The caller handles worker questions and session
continuation. Multi-round Delphi and the calibration store remain deferred.

## License

MIT
