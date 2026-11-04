# fusion-panel - domain glossary

Canonical terms for this repository. RFC-01 defines the panel methods;
[ADR-0003](docs/adr/0003-caller-managed-delegation.md) defines caller-managed
delegation.

## Terms

- **fusion** - this CLI. A composition layer over agent harnesses; never
  called a harness itself.
- **harness** - the layer that owns an agent's loop, context, tools and
  permissions. The calling harness chooses how to execute worker jobs.
- **claim** - the typed object every component exchanges. Flat schema;
  `provenance` is the only tool-stamped block.
- **tier 1** - deterministic, model-free pure functions callable as
  one-shot subcommands: validate, normalize, aggregate, score.
- **tier 2 / pattern run** - a tool-owned sequence of worker jobs, schema
  enforcement, provenance stamping, events and a decision record. The caller
  executes jobs and enforces worker isolation.
- **pattern definition** - tool-side config that fully describes one
  pattern: its command flags, worker/stage construction, mechanical fuse,
  and human summary. One module per pattern; the dispatcher is generic.
  RFC-01: "Pattern definitions are tool-side config."
- **dispatcher** - the generic CLI layer that turns pattern definitions into
  subcommands and exposes the submission lifecycle, run identifiers, records,
  `--json` output and exit codes.
- **worker** - one agent invocation the caller delegates a job to.
- **job** - a worker brief and identifier issued by Fusion for one stage.
- **wave** - all jobs in a stage. The next wave starts after every current job
  has a terminal submission.
- **submission** - the caller's structured claims and worker identity, or a
  worker failure, for one job.
- **provenance** - the tool-stamped run and worker identifiers together with
  caller-reported harness, model and session metadata. Workers cannot set it.
  Fusion cannot independently verify caller-reported identity.
- **decision record** - the final artifact of a pattern run, written to
  `.fusion/runs/<runId>/decision.json`: decision, minority/rejected/risk
  content per pattern.
