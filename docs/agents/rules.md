# Enforced agent rules

| Rule | Enforcement |
| --- | --- |
| With `--json`, every command invocation emits one JSON envelope, including parser errors. Usage errors use E106 and exit 1. Help and version remain plain successful output. | `tests/cli-protocol.test.ts` runs the bundled CLI for missing flags, unknown options and unknown commands. `tests/envelope.test.ts` checks exit classes and crash envelopes. |
| A job becomes terminal only after every submitted claim satisfies its method role, including required actions and target coverage. Invalid or incomplete role outputs return E201 without accepting partial results. | `tests/cli-protocol.test.ts` covers kinds, juror cardinality, gate actions, judge/umpire actions, references and coverage, plus corrected submissions. `PatternBuild` and `PatternRebuild` require a validator. `RoleContract` requires explicit kinds, count bounds and action policy; shared role/reference checks enforce them. Empty success is legal only where the count permits zero. |
| Method docs name fields that completed decisions actually contain (ADR-0001). | The bundled CLI lifecycle checks extract documented decision-field names and require each one in the actual completed record across all six methods. |

The envelope contract is defined in [ADR-0002](../adr/0002-envelope-and-exit-contract.md).
