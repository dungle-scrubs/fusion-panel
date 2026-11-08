---
number: 02
title: "Sealed-run hardening from review feedback"
type: feature
status: Draft
author: "kevin"
date: 2026-09-24
---

# RFC-02: Sealed-run hardening from review feedback

## Abstract

External review confirmed the core design and named three gaps. Jury grouping is exact-match only, so paraphrased agreement splinters into false disagreement. Worker questions have no resume path even though RFC-01 committed to one. Every worker in a run shares one harness and model, so the independence claim rests on process isolation alone. This RFC specifies bounded vocabularies plus an opt-in blind merge stage, a suspend and resume run command, and per-worker rosters. Tier 1 stays model-free and every agent invocation stays behind `hcn run`.

## Introduction

The review found the isolation model sound: separate processes, schema enforcement at the tool boundary, mechanical fusion with no model in the loop. It then named the three limits above, each of which the repo already admits somewhere: `docs/methods/jury.md` documents the exact-match limit, `src/run.ts` documents the missing resume edge, and the README status section lists caller resume and mixed-model rosters as not yet built.

This RFC covers exactly those three items, in this order: grouping, resume, rosters. Each capability passed the fit check against the product purpose in `CONTEXT.md` and the README, consensus callers can audit. Grouping fixes serve callers judging free-text answers. Resume completes a commitment RFC-01 already made. Rosters serve the model diversity the independence readout assumes.

Scope boundaries, what this RFC does NOT cover:

- Tier-1 semantic dedup. Declined by the fit check: `AGENTS.md` binds tier 1 to model-free and deterministic, and embedding clustering would add a vector dependency to a v0 CLI. Semantic work lives in a tier-2 merge stage or not at all.
- Multi-round delphi, the v1 calibration store, MCP surface, npm publication. Each belongs to its own decision and stays out.
- New patterns. No pattern is added here; jury, delphi, and shortlist gain options, and the dispatcher gains one command.

## Terminology

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL in this document are to be interpreted as described in RFC 2119.

- **vocabulary**: a caller-supplied closed answer set for one run, e.g. `ship,hold`. Workers MUST answer with exactly one member.
- **merge stage**: an opt-in tier-2 stage that clusters canonical answer groups by meaning. A sealed worker proposes the clusters; the tool applies them mechanically.
- **cluster**: the merge stage output: a set of canonical answers judged equivalent, with the mapping preserved in the decision record.
- **roster**: the per-worker list of harness and model assignments for one run.
- **suspended run**: a run in AWAITING-INPUT that the tool holds on disk until the caller resumes or aborts it.
- **pending question**: a worker question event not yet answered at suspension time, carried in `run.json`.

## Motivation

Three caller pains, one per item.

First, jury answers to free-text questions splinter. Three workers agreeing in different words report as three groups with duplicate rate 0.00, and the independence readout then signals disagreement where none exists. The README example itself shows 3 answers and 3 groups. Callers today either restrict jury to ship-or-hold questions by discipline or misread the readout. The tool SHOULD make the bounded case airtight and the free-text case honest.

Second, a worker that asks a genuine blocking question leaves the caller with no path back into the run. RFC-01 resolved question escalation as a carried event plus a fusion resume path with the tool holding sealed state. The engine carries the event but never suspends, so the committed path does not exist. Any run that hits a real question today either routes around the worker or dies.

Third, the independence story is process isolation only. `WorkerConfig` already carries per-worker harness and model, and provenance already stamps both per worker, but every pattern `build()` fans one `--harness` and one `--model` out to all workers. A caller that wants model diversity cannot ask for it, and the decision record cannot show whether three votes came from three models or one.

## Design

### Bounded vocabulary

`fusion jury` gains `--vocabulary "ship,hold"`: a comma-separated closed set.

- The worker prompt MUST instruct the worker to answer with exactly one vocabulary member, verbatim, as the full claim text.
- Pattern strictness MUST reject an answer outside the set with a named reason, the same way non-answer kinds are rejected today. The E001 one-retry path applies: the worker gets one correction round with the validator error fed back, then the rejection stands for the run.
- The decision record MUST carry the vocabulary. A run with a vocabulary reports groups that are exact by construction, so the duplicate rate reads as agreement rather than wording overlap.
- `fusion delphi` accepts the same flag for round 1, and round-2 revisions MUST stay inside it when round 1 used it: a revision that leaves the answer space breaks comparability with round 1. Other voting patterns MAY follow; no pattern MUST.

### Blind merge stage

`fusion jury` gains opt-in `--merge`. Delphi and shortlist MAY gain it later; this RFC specifies jury only.

- The merge worker runs on the same harness as the generators by default, with a `--merge-harness` override for a distinct one. Its input is the anonymized canonical answer list: no worker ids, no harness names, no session ids, no confidences. Blindness rules that bind challenge stages bind this one.
- The merge worker returns one claim per cluster, with `dependencies` linking the member canonical answers. Output passes the same schema validation as every worker output.
- The tool applies the mapping mechanically: plurality tallies over clusters instead of groups. Votes are never reinterpreted; only group membership changes, and only through a validated mapping the record preserves.
- The decision record MUST carry both the pre-merge groups and the cluster mapping, so a later reader sees what the model merged and can disagree with it. A merge that reads as laundering is a failed audit, not a pass.
- Merge worker failure or invalid output MUST fall back to the unmerged tally with a warning, mirroring E002 worker-failure handling: the run continues, the record names the failure.
- Tier-1 `normalize` and `aggregate` MUST NOT change. They stay model-free, side-effect free, and pipeable. The merge stage is tier 2 by definition.

### Resume

The dispatcher gains `fusion resume --run <runId> --worker <workerId> --answer <text>`, plus `--abort` to fail a suspended run explicitly.

- Pattern runs gain opt-in `--wait`. Without it, behavior is unchanged: question events are carried and the run continues with survivors. With it, the run suspends at the next stage boundary while any pending question is unanswered: registration frozen, `events.ndjson` flushed, `run.json` carrying `pendingQuestions`, `suspendedAt`, and a `waitUntil` deadline from `--wait-sec`.
- Resume loads the run directory under the current working directory `.fusion`, appends the caller answer as an event, and resumes that worker's hcn session with `hcn run <harness> --resume <sessionId> --prompt <answer>`. Session ids come from the tool's own worker events, never from caller input. The run re-enters its suspended stage and continues to a normal decision.
- The resume answer comes from the caller side of the trust boundary, so it MUST NOT pass claim validation. It is an answer to a worker question, not a claim. Every worker output produced after resume still passes schema validation unchanged.
- A suspended run with no decision exits E303, class 3, naming the run id and the pending count. Resume targets that do not exist, are not suspended, or name an unknown worker are E102 usage errors. Unreadable answer text is E104.
- `fusion resume` MUST reject run ids that resolve outside the current working directory `.fusion` tree.

### Rosters

Every pattern gains repeatable `--roster <harness>[:<model>]`: one flag per worker, position-mapped to worker index. This is the roster shape; no comma-separated fallback.

- When no `--roster` flag is given, current `--harness` and `--model` behavior is unchanged. When `--roster` is given, its length MUST equal the worker count or the build fails with E102 before any spawn.
- No engine change is required: `WorkerConfig` and per-worker provenance already exist. This item is CLI surface plus record content.
- The decision record SHOULD carry a mechanical diversity count: distinct harnesses and distinct models across accepted claims. It sits beside the duplicate rate as a second independence signal, computed the same deterministic way, with the same honesty rule: a three-model roster that shares one prior still shows its groups, and the count MUST NOT be presented as proof of independence.

Skill text updates ride with each item because `SKILL_TEXT` is generated from code: vocabulary and merge semantics in the jury recipe, resume in the run guarantees, roster examples under the privacy warning with local-only routing shown.

## State Machine

New edges; all existing edges unchanged:

```
GENERATING  -> AWAITING-INPUT (on: --wait set and a pending question stands at the wave end)
CHALLENGING -> AWAITING-INPUT (on: --wait set and a pending question stands at the stage end)
VERIFYING   -> AWAITING-INPUT (on: --wait set and a pending question stands at the stage end)
AWAITING-INPUT -> GENERATING | CHALLENGING | VERIFYING (on: fusion resume; re-enters the suspended stage)
AWAITING-INPUT -> FAILED     (on: fusion resume --abort, or past the --wait-sec hold deadline)
```

`src/run.ts` MUST gain the AWAITING-INPUT resume edges it currently documents as absent. Suspension persists `pendingQuestions` and `suspendedAt` in `run.json`; `events.ndjson` stays append-only across resume so any later session replays the full run including the suspension gap. Stages still run once each; resume re-enters, it never restarts.

## Error Handling

- E102 covers invalid invocation across all three items: roster length mismatch, resume against an unknown or non-suspended run, unknown worker id on resume, resume path escaping the run tree.
- E104 covers unreadable or malformed resume answer text.
- E303, exit class 3: run suspended awaiting input. Detail names the run id, the run directory, and the pending question count. This extends the E301/E302 sequence, not a new scheme.
- E001 one-retry covers vocabulary violations exactly like schema rejections: one correction round, then the rejection stands with its reason in the record.
- Merge stage failure follows the E002 pattern: warning when the run continues on the unmerged tally, named in the decision record, never silent.
- Crash and envelope handling per ADR-0002 is unchanged. Worker spawn failures stay typed outcomes in the run record.

## Security Considerations

- Trust boundaries do not move. The caller is trusted, workers are untrusted content producers, and the merge worker is untrusted too: its output is validated at the boundary and applied mechanically. A merge worker that returns garbage gets the fallback path, not an error path into the caller.
- The merge harness follows the resolved question 1: same harness as the generators by default, `--merge-harness` override. The merge worker MUST receive anonymized input only: canonical answer text with no worker ids, harness names, model names, session ids, or confidences. Anything that lets the merger weight answers by source breaks the blindness the challenge stages already guarantee.
- Resume answers originate on the trusted side and are passed verbatim as the hcn resume prompt. They MUST NOT be claim-validated, and they MUST NOT be written into the decision record as claims. Post-resume worker output keeps full schema validation, so a compromised-looking answer still cannot smuggle a malformed claim past the boundary.
- Rosters and secret material: a roster MUST be able to route every worker to local-only harnesses, and the skill text roster examples MUST show that routing. Routing secret material to a hosted model through any roster slot is a caller error under the existing privacy rule.
- Resume path confinement: `fusion resume` MUST resolve the run directory under the invoking working directory `.fusion` tree and reject anything else. A resume MUST NOT read or write another repo's runs.
- Pending questions are rendered in CLI output as data. They execute nothing and carry no provenance until answered.
- Worst case is a run held on disk until aborted or the `--wait-sec` deadline.

## Alternatives Considered

- **Embeddings or clustering inside tier 1.** Attractive because grouping would improve without spending a worker. Rejected: it breaks the model-free rule that `AGENTS.md` binds on every tier-1 surface, and it adds a vector dependency to a v0 CLI. Semantic judgment is tier-2 model work by definition.
- **Caller-side merge from the decision record.** Attractive because it needs no tool change: the record already carries canonical answers. Rejected: the merge would leave the audit trail, and the tool's record would keep reporting splintered groups while callers tally something else. The record MUST show what the model merged.
- **Always suspend on any worker question.** Attractive because it matches the letter of the RFC-01 resolution. Rejected: it changes default behavior and breaks the continue-with-survivors contract existing runs and tests rely on. Opt-in `--wait` keeps both.
- **Single comma-list roster flag.** Rejected in favor of repeatable `--roster`, resolved with no fallback: commander parses repeats cleanly, position mapping is explicit, and a length check gives the E102 error for free.

## Implementation Plan

One phase per item, each verifiable alone, docs riding in the same phase per ADR-0001:

1. **Vocabulary on jury.** Ship `--vocabulary` with prompt, strictness, E001 retry, and record content. Verify: a ship-or-hold run groups exactly; an off-vocabulary answer is rejected, retried once, then recorded with its reason. Update `docs/methods/jury.md` limits.
2. **Rosters.** Ship `--roster` on every pattern with the E102 length check and diversity counts in the record. Verify: a mixed harness and model run stamps per-worker provenance and reports distinct counts. Go or no-go after this phase: the diversity plumbing MUST be visible in live records before resume and merge spend continues.
3. **Resume.** Ship `--wait`, suspension with E303, and `fusion resume` with answer and abort paths. Verify: a `--wait` run suspends on a worker question; resume completes to a decision; a fresh session replays `events.ndjson` across the gap. Update the run guarantees in skill text.
4. **Merge stage.** Ship `--merge` on jury with blind input, validated mapping, fallback, and pre-versus-post record content. Verify: paraphrased agreement clusters; the record shows both; merge failure falls back to the unmerged tally with the failure named.

Each phase runs `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint` clean before merge, per repo rules.

## Open Questions

None open. All four draft questions resolved by kevin on 2026-09-24:

1. **Merge judge placement.** Resolved: configurable, default same harness as the generators, `--merge-harness` override.
2. **Resume hold duration.** Resolved: explicit timeout via `--wait-sec` with a stated default, confirmed against hcn session lifetimes before phase 3.
3. **Roster flag shape.** Resolved: repeatable `--roster`, no comma-separated fallback.
4. **Vocabulary in delphi round 2.** Resolved: round-2 revisions MUST stay inside the round-1 vocabulary.

## References

Normative:

- RFC-01 (`docs/rfc/01_fusion-a-composable-fusion-layer-over-agent-harnesses.rfc.md`) - tiers, claim schema, question escalation commitment, scope precedents.
- hcn skill (`~/.agents/skills/hcn/SKILL.md`) - `hcn run --resume` protocol, identity events, event schema, exit contract.
- ADR-0002 (`docs/adr/0002-envelope-and-exit-contract.md`) - envelope shape, exit classes, E-code sequencing.
- `CONTEXT.md` - canonical domain terms used throughout.

Informative:

- `docs/methods/jury.md` - the exact-match limit as documented today.
- `docs/methods/tier-1.md` - the model-free boundary this RFC preserves.
- Reviewer feedback thread, 2026-09-24 - the three gaps as reported.
- `docs/design/fusion-panel-design-space.md` - merge and roster background.
