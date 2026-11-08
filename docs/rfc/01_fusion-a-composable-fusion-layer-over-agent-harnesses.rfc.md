---
number: 01
title: "fusion: a composable fusion layer over agent harnesses"
type: feature
status: Accepted
author: "kevin"
date: 2026-09-23
---

# RFC-01: fusion: a composable fusion layer over agent harnesses

## Abstract

Agent sessions that need independent judgment from multiple models have no tool that guarantees independence. Prompting one agent to "act as five agents" shares context, leaks anchors, and converges through persuasive prose. This RFC specifies `fusion`, a CLI that composes runs of existing agent harnesses into auditable patterns: sealed parallel generation, adversarial challenge, and blind adjudication. The tool ships two tiers: deterministic pure functions the caller pipes freely, and pattern runs the tool executes itself, with isolation, provenance, and schema enforcement no prompt can provide. Users are agent sessions on these machines, across pi, Claude Code, and Codex.

## Introduction

The design space is mapped in `docs/design/fusion-panel-design-space.md`. Its central finding: a roomful of nominally different agents that share a model, prompt, and transcript converge through persuasion, and consensus is not evidence of independent agreement unless the harness proves the independence of the paths that produced it.

`fusion` implements that finding as a CLI. It is NOT a harness. A harness owns an agent's loop: context, tools, permissions. The six harnesses hcn drives (claude, codex, pi, muse, cursor, antigravity) own loops. `fusion` composes runs of harnesses. It is a harness at the pattern level only.

Scope boundaries - what this RFC does NOT cover, each declined by the decision map (issue #1):

- MCP server surface. A second distribution surface with its own upkeep. Own sessions already reach a CLI. Can return if the tool is ever published.
- Forecast market pattern. Needs a stream of resolvable tasks and outcome history first.
- Open-source publication. Users are own agent sessions. npm publication under dungle-scrubs happens only when the tool earns it.
- Mission control / andon pattern, correlation telemetry, calibration store. Deferred to v1 by the v0 scope decision (#4).
- Own model execution engine. Every agent invocation delegates to `hcn run` (#3).

## Terminology

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in RFC 2119.

- **harness**: the layer that owns an agent's loop - context, tools, permissions. hcn's six: claude, codex, pi, muse, cursor, antigravity.
- **fusion**: this CLI. A composition layer over harnesses.
- **tier 1**: deterministic pure functions, callable as one-shot subcommands, JSON in, JSON out. Model-free by definition.
- **tier 2 / pattern run**: an execution the tool owns end to end. The tool spawns sealed workers, enforces the claim schema, stamps provenance, streams events, and writes the decision record.
- **worker**: one agent invocation inside a pattern run, launched through `hcn run`.
- **claim**: the typed object every component exchanges (see Design).
- **provenance**: the tool-stamped record of who produced a claim: run, worker, harness, model, session.
- **decision record**: the final artifact of a pattern run: decision, minority report, rejected options, residual risks.
- **caller**: the agent session (or human) invoking `fusion`.

## Motivation

A caller agent can ask five subagents the same question, but the caller holds every intermediate result in its own context. The caller becomes the shared transcript the design doc warns against: anchors leak, errors propagate, and dissent collapses into the caller's prior. Sealed generation, blind adjudication, and mechanical aggregation MUST be properties of a tool boundary, not sentences in a prompt.

The callers already exist: agent sessions on these machines, on pi, Claude Code, and Codex. They need a CLI they can call and compose, with instructions the binary itself provides.

## Design

### Two tiers

**Tier 1 - pure functions.** `fusion normalize`, `fusion aggregate`, `fusion score`, `fusion validate`. Deterministic, model-free, one-shot. `normalize` deduplicates by exact match after deterministic normalization (whitespace, casing, Unicode NFC, number formats). Semantic dedup, embedding clustering, and any LLM canonicalization are tier 2 work. The caller MAY pipe these freely; nothing is lost by running them outside the tool because there is no isolation to lose.

**Tier 2 - pattern runs.** `fusion jury`, `fusion red-blue`, `fusion ach`. The tool:

1. Writes the frozen registration (`run.json`) before generation starts.
2. Spawns sealed workers via `hcn run` - separate processes, no shared transcript, memory off.
3. Validates every worker output against the claim schema at the tool boundary.
4. Stamps provenance from hcn `identity` events. Workers cannot set provenance fields.
5. Runs mechanical stages (normalize, aggregate, score) internally as tier 1 functions.
6. Streams the event contract, then writes the decision record.

Patterns the tool runs MUST NOT be defined by callers. Callers invoke a pattern with parameters. Pattern definitions are tool-side config. A justfile in a served repo MAY parameterize a pattern invocation (`just jury` = one `fusion jury` call with the repo's fixed arguments); a justfile MUST NOT try to reimplement a pattern's stages, because the guarantees come from the tool owning the run.

### Command grammar

```
fusion normalize | aggregate | score | validate   # tier 1, JSON in/out
fusion jury | red-blue | ach                      # tier 2 pattern runs
fusion skill                                       # prints caller instructions
```

`fusion skill` prints the complete caller-agent instructions to stdout: every command, the claim schema, composition recipes. The binary is the single source of truth; instructions cannot drift from behavior because they ship with it. An optional one-line wrapper skill in `~/.agents/skills` ("run `fusion skill` and follow it") gives pre-configured harnesses the trigger surface. Nothing else is maintained by hand.

### Claim schema

One flat schema for all patterns. Pattern-specific strictness is enforced at the pattern run's stage, not in the schema: jury requires `kind=answer`, ACH requires `dependencies`, red-blue requires `kind=objection`.

The schema (prototype-confirmed, ticket #5; schema.json sha256 prefix `a3615329f9e0a52c`):

- Required on every claim: `claim_id` (C-number), `kind` (answer | hypothesis | evidence | finding | objection), `claim`, `status` (observed | documented | inferred | unknown), `confidence` (number, [0,1]), `falsifier` (non-empty - required on every kind, including evidence).
- Optional: `evidence[]` (source_or_test + supports), `assumptions[]`, `dependencies[]` (C-number refs), `novelty` (new | confirms | contradicts | duplicates), `requested_action` (accept | test | revise | escalate | abstain).
- `provenance` is the ONLY tool-stamped block: runId, workerId, harness, model, sessionId, stampedAt. The validator MUST reject a claim where the agent set any provenance field.

### Streaming event contract

NDJSON, hcn-compatible where meanings match. Every event carries the run id. Every stream carries `schemaVersion` from day one.

- Reused from hcn, same shapes: `identity`, `message`, `question`, `error`, `failure`, `done` - the exit contract carries over: 0 clean, 1 failure, 2 refusal (fusion's own usage errors). A `question` event carries the run id; it is how a sealed worker escalates a genuine decision block to the caller. The tool holds the sealed state; the caller answers through a fusion resume path, and the worker's turn continues with that answer.
- Fusion-specific: `worker` (sealed agent spawned, with hcn identity provenance), `claim` (schema-validated claim entered the run), `stage` (pattern stage transition: generate, normalize, challenge, verify, decide), `fusion` (mechanical result - aggregate/score output; deterministic by construction), `decision` (decision record + minority report + rejected options).

### Run state on disk

Every pattern run writes `.fusion/runs/<runId>/` in the repo it serves:

- `run.json` - frozen registration: task, rubric, pattern, worker configs, stopping rule. Written before generation; append-only after.
- `events.ndjson` - the event stream, append-only. Any later session replays it to reconstruct the run.
- `decision.json` - the decision record.

`.fusion/` is git-ignored by default. Committing a run's decision record is the repo owner's explicit choice when a citation must survive. Cross-run state (calibration history, v1) lives outside repos in `~/.local/state/fusion/` and MUST NOT be written into a served repo.

### Budgets

Per-worker budgets in v0 are hcn `--timeout` and maxSteps equivalents. Token metering does not exist in hcn's normalized stream today (observed, ticket #3 spike); requesting it is an upstream feature request, not a v0 dependency.

## State Machine

A pattern run:

```
REGISTERED -> SPAWNING   (on: run.json written)
SPAWNING   -> GENERATING (on: all workers spawned, worker events emitted)
GENERATING -> NORMALIZING(on: all workers submitted claims OR per-worker timeout)
NORMALIZING -> CHALLENGING (on: pattern includes challenge; red-blue only)
CHALLENGING -> VERIFYING   (on: objections filed; verify stage where checks named)
VERIFYING  -> DECIDING   (on: checks resolved or none named)
NORMALIZING -> DECIDING  (jury, ach: no challenge stage)
DECIDING   -> DONE       (on: decision.json written, done event emitted)
any        -> FAILED     (on: failure event; run directory retains partial events)
GENERATING -> AWAITING-INPUT (on: question event from any worker; other workers continue)
CHALLENGING -> AWAITING-INPUT (on: question event)
AWAITING-INPUT -> prior stage (on: caller answers via resume)
AWAITING-INPUT -> FAILED     (on: caller aborts or question timeout)
```

Invalid transitions MUST be rejected: stages run in the listed order, once each. A FAILED run MUST retain its partial `events.ndjson` and a `failure` record in `run.json`.

## Error Handling

- Exit codes follow the hcn contract: 0 clean, 1 failure, 2 refusal (fusion rejected the invocation: unknown subcommand, malformed task, invalid pattern parameters).
- A worker that fails (hcn exit 1) does not fail the run: the pattern continues with the surviving workers, and the decision record MUST name the failed worker and its failure class. Provider-unavailable classes MAY trigger one reroute to a different harness.
- A claim that fails schema validation is rejected with the validator's errors; the run continues. Rejected claims stay in `events.ndjson` marked rejected.
- E001 schema-rejected claim (warning): recovery automatic, claim excluded from fusion.
- E002 worker failure (warning if survivors meet pattern minimum, critical below it): recovery reroute or continue; escalation to caller when below minimum.
- E003 registration failure (critical): run does not start; exit 2.
- E004 write failure on run directory (critical): run aborts, exit 1, partial events retained.

## Security Considerations

- **Trust boundaries.** The caller trusts the tool, not the workers. Workers are untrusted content producers: their outputs are claims validated at the boundary, never prose executed or forwarded raw. The decision record contains structured output, not worker transcripts, so prompt-injected content in worker outputs does not reach the caller as instructions.
- **Provenance integrity.** Workers cannot set provenance. The tool stamps it from hcn identity events. The validator rejects agent-authored provenance.
- **Secret material.** The privacy rule stands: work that puts secret material into model context runs on local models only. Pattern runs MUST accept a worker config that routes to pi's lmstudio providers for such work. Routing secret material to a hosted model through fusion is a caller error the skill text MUST warn against.
- **Blast radius.** The tool writes only inside `.fusion/runs/` of the invoked repo and `~/.local/state/fusion/`. It executes no worker tool calls itself - harnesses own that. Worst case is a wasted run and local files.
- **Input validation.** Every worker output passes schema validation before entering fusion. Unknown fields are rejected, not ignored.

## Alternatives Considered

- **Pure library only** (every component a one-shot subcommand, caller sequences everything). Rejected: the caller sees every intermediate output; isolation guarantees disappear. This is the shared-transcript failure the tool exists to prevent.
- **Pattern runs only** (no function-level surface). Rejected: composing a custom strategy becomes config-writing instead of piping.
- **Per-pattern claim schemas.** Rejected: three shapes to version and document; pattern-level strictness over one flat schema gives the same guarantees.
- **Own execution engine** (direct provider APIs, key management). Rejected: hcn already provides sealed processes, provenance, streaming, and six harness families; key ownership adds upkeep with no added capability.
- **`mosaic` or `fuse` as command word.** Rejected: mosaic names the doc's router concept, not the tool; fuse is a filesystem verb on Linux. `fusion` is free on PATH and matches the repo.
- **Hand-maintained skill file.** Rejected: two artifacts to keep in sync; they drift. The binary emits its own instructions.
- **Clean-slate event vocabulary.** Rejected: callers already parse hcn NDJSON; reuse halves the learning surface.
- **Buffered final document (no streaming).** Rejected: no progress, no early abort for long runs.

## Implementation Plan

Phases, each verifiable on its own; tickets carry the detail:

1. **CLI skeleton + claim schema as code.** `fusion validate` works end to end against the schema. Verify: sample claim sets pass and reject correctly.
2. **Tier 1 complete.** `normalize`, `aggregate`, `score` as deterministic subcommands. Verify: property tests on normalization; aggregate results reproducible bit-for-bit.
3. **Run engine.** Run registry, hcn worker spawning, provenance stamping, event emission, run directories. Verify: a two-worker echo run produces a reconstructable `events.ndjson`.
4. **Sealed Jury.** First pattern end to end. Verify: sealed workers produce independent claims; aggregate is mechanical; decision record written.
5. **Red-Blue-Umpire, then ACH Matrix.** Challenge and adjudication stages. Verify per pattern against its stage requirements.

Go/no-go after phase 4: the baseline pattern must show the pool has usable diversity before phases 5 proceeds (the design doc's own criterion for Sealed Jury).

## Open Questions

None open. The independent trail review (2026-09-23) raised three groups; the human resolved all of them the same day:

1. **Justfile rule (assumption A1)** - confirmed as written: a justfile MAY parameterize a pattern invocation; a justfile MUST NOT reimplement a pattern's stages.
2. **Question escalation** - confirmed: carry hcn's `question` event through the fusion stream with the run id; AWAITING-INPUT added to the state machine; the caller answers through a fusion resume path while the tool holds the sealed state.
3. **Normative additions** - confirmed as written: state-machine strictness (out-of-order transitions rejected, stages once each, FAILED retains partial events); E001-E004 taxonomy incl. naming failed workers in the decision record and one reroute on provider-unavailable; unknown claim fields rejected, not ignored; pattern runs MUST accept an lmstudio worker config for secret material and the skill text MUST carry the privacy warning.

npm publication remains a future product decision, outside this RFC's scope.

## References

Normative:

- `docs/design/fusion-panel-design-space.md` - the design space: mechanisms, control surfaces, the 8.4 protocol object this schema adapts, MOSAIC, prototype order.
- hcn skill (`~/.agents/skills/hcn/SKILL.md`) and its reference - the invocation layer: normalized flags, event schema, exit contract, question escalation.

Informative:

- Decision map: dungle-scrubs/fusion-panel#1 and its closed tickets #2-#9 - each decision with its reasons and rejected alternatives.
- Research: `research/execution-backends.md` (branch `research/execution-backends`) - backend evidence, token-metering spike, identity provenance finding.
