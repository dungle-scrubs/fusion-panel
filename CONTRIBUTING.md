# Contributing to fusion

Thanks for taking the time.

## Setup

```console
pnpm install
```

Requires Node 22+ and pnpm. Pattern commands return jobs for the calling
harness to execute. Development and panel runs do not require `hcn`.

`pnpm install` installs the git hooks through lefthook. The pre-commit hook
runs biome and tsc. The pre-push hook runs [trufflehog](https://github.com/trufflesecurity/trufflehog)
against the repository, so install it (`brew install trufflehog`) before
your first push.

## Everyday commands

```console
pnpm build        # bundle dist/cli.js
pnpm test         # vitest suite, including the persistent CLI lifecycle
pnpm lint         # biome check
pnpm typecheck    # tsc --noEmit
```

All four pass before every merge; CI runs the same set on each pull request.

## Making changes

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `perf:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor:`. Versions and the changelog are derived from them by release-please.
- A new pattern or tier-1 function ships with its doc under `docs/methods/` in the same pull request (ADR-0001), plus a selection rule with a counter-rule in `fusion skill` output.
- Claims flow through the flat schema in `src/claim.ts`; unknown fields stay rejected and provenance stays tool-stamped. The RFC and the ADRs under `docs/adr/` are the design record - read the governing one before changing what it covers.
- Tests exercise fuse functions, the persistent job lifecycle and CLI envelopes.
  Verify decisions and rejected submissions rather than implementation shape.

## Pull requests

Open one against `main`. Squash merges only. The PR template asks for the verification evidence; comment reviews run on every change.
