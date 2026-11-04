# Security Policy

## Supported versions

The latest release on `main`.

## Reporting a vulnerability

Open a private security advisory: GitHub -> Security -> "Report a vulnerability" on this repository. Do not open a public issue for a suspected vulnerability.

You should hear back within a few days. If the report is confirmed, a fix ships as a patch release and the advisory is published after it lands.

## Trust model (worth knowing before you report)

Fusion returns worker jobs to the calling harness and treats submitted claims
as untrusted content. Fusion validates each claim, controls stage transitions
and computes the decision. Claims are data, never executable instructions.

The caller supplies worker identity and enforces separate worker contexts.
Provenance is tool-stamped, but its harness, model and session metadata are
caller-reported. Fusion cannot verify that identity or prove worker isolation.
Later-stage briefs include validated claims as evidence. The calling harness
must treat those claims as untrusted content when delegating the briefs.

Reports about claims changing run mechanics outside their defined schema, or
submissions bypassing stage and duplicate checks, are especially welcome.

Secret material must never enter a hosted model through fusion; local-model routing is the caller's responsibility and is documented in `fusion skill`.
