# fusion-panel

`fusion` defines panel methods; calling harnesses execute the worker jobs.
[ADR-0003](docs/adr/0003-caller-managed-delegation.md) governs delegation and
supersedes RFC-01's HCN execution and isolation guarantees. Domain terms live in
[CONTEXT.md](CONTEXT.md); use them as written.

## Decisions and docs

- Architecture decisions live in `docs/adr/`; read the governing ADR
  before changing what it covers.
- One doc per method under `docs/methods/` ([ADR-0001](docs/adr/0001-one-doc-per-method.md)):
  a new pattern or tier-1 function ships its doc in the same PR.
- Enforced rules and their checks: [docs/agents/rules.md](docs/agents/rules.md).

## Product word rules (bind the tool's surfaces)

- Never call the tool a harness. That word means loop-owners (claude,
  codex, pi, muse, cursor, antigravity).
- Tier 1 (validate/normalize/aggregate/score) stays model-free and
  deterministic.
- Worker execution belongs to the caller. Fusion returns jobs and accepts
  structured results; it never launches a harness.
- Identity is caller-reported and isolation is caller-enforced. Describe those
  limits wherever a run reports provenance or independence.
- Unknown claim fields are rejected, not ignored; provenance is the only
  tool-stamped claim block.

## Commands

- `pnpm build` - bundle `dist/cli.js`
- `pnpm test` / `pnpm vitest run` - full suite
- `pnpm typecheck`, `pnpm lint` - clean before every commit
- Binary for manual runs: `./dist/cli.js <command>`
