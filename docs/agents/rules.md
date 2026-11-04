# Enforced agent rules

| Rule | Enforcement |
| --- | --- |
| With `--json`, every command invocation emits one JSON envelope, including parser errors. Usage errors use E106 and exit 1. Help and version remain plain successful output. | `tests/cli-protocol.test.ts` runs the bundled CLI for missing flags, unknown options and unknown commands. `tests/envelope.test.ts` checks exit classes and crash envelopes. |

The envelope contract is defined in [ADR-0002](../adr/0002-envelope-and-exit-contract.md).
