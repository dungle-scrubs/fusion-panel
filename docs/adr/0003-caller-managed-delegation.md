# Caller-managed delegation

Fusion controls panel methods and accepts structured results. The calling
harness chooses and runs delegates through its own tools. HCN is no longer a
runtime requirement or a supported execution path inside Fusion.

This replaces RFC-01's tool-owned worker execution, HCN identity source, and
isolation guarantees. The user requested this separation so any calling harness
can use its native delegation. Pattern stages remain tool-side definitions;
callers execute returned jobs rather than reimplementing the method.

## Protocol

A pattern command freezes its registration and returns the first wave of jobs.
Each job carries a run-scoped identifier, worker identifier, stage, prompt and
advisory routing and timeout settings. The caller gives each worker only its
brief, then submits its claims and actual identity through `fusion submit`.
A failed worker is submitted as a failure instead. Fusion validates the claim
schema and the method's role contract before accepting a job: required kinds,
cardinality, actions, vocabulary and target coverage. Malformed votes and
rulings return E201 and stay pending for correction. Valid scoring formulas
remain unchanged; silently discarded malformed fields are not supported
outcomes. Every pattern declares a validator; each role contract explicitly
specifies kinds, count bounds and whether an action is required. Fusion stamps
provenance and returns the remaining jobs. Once a wave is complete, Fusion
builds the next wave from the validated record or writes its decision.

Empty success is accepted only when the role count permits zero. An opponent
reporting no objections submits an empty claim array with identity; the run
records success and issues only the judge, with no unnecessary umpire job.
Other empty results remain pending with E201. The committed submission journal
identifies replays even when a successful job produced no claims.

`fusion status` returns pending jobs or a terminal decision across invocations.
`fusion abort` records a terminal failure with the caller's reason. The caller
handles worker questions, session continuation, deadlines and routing retries;
Fusion does not resume a harness session.

Each wave uses definition order, regardless of submission order, so completion
order cannot change mechanical tie-breaking. Claims cannot reference a peer in
the same wave, even if that peer has already submitted.

Successful start, submit, status and abort commands use exit 0. Their `status`
field distinguishes pending work, a completed panel and a failed panel. A
successful command does not mean the panel recommended proceeding. ADR-0002's
envelope and error classes remain in force. E204 rejects replayed submissions
and mutations of terminal runs. E304 reports lock contention and permits a later
retry. Earlier HCN run formats are rejected with E102 rather than interpreted
as new runs. Tier-1 commands keep their existing contracts.

## Trust and persistence

Fusion enforces claim schemas, stage barriers, duplicate-submission rejection,
anonymized downstream records and mechanical decisions. It cannot observe
worker contexts or prove independence. Isolation is caller-enforced. Harness,
model and session identifiers are caller-reported, and run outputs say so.
Workers cannot set the tool-stamped provenance block in their claims.

Runs remain under `.fusion/runs/<runId>/`. `run.json` is a frozen registration.
An atomic replacement of `state.json` commits progress, accepted claims, the
event journal and any terminal decision together. `events.ndjson` and
`decision.json` are readable projections of that committed state. Mutations
reconcile missing event suffixes without appending duplicate events. Status
reads committed state without changing run records.

Mutations take an exclusive run lock. A conflicting lock reports busy, even
when its owner appears dead. Fusion never removes another owner's lock.
Caller evidence is frozen at registration so later stages do not depend on a
mutable external file.

## Consequences

Any harness with shell access can run a complete panel without an HCN adapter.
Fusion keeps one execution protocol and no process launcher. Callers now own
isolation, model access and execution budgets. Existing panel scripts must adopt
the job submission loop; this is an intentional CLI contract change. Package
publication and migration of already recorded HCN runs are outside this change.
