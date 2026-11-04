# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0](https://github.com/dungle-scrubs/fusion-panel/compare/fusion-panel-v0.2.2...fusion-panel-v0.3.0) (2026-11-04)


### ⚠ BREAKING CHANGES

* let calling harnesses execute panel jobs ([#69](https://github.com/dungle-scrubs/fusion-panel/issues/69))

### Added

* blind merge stage on jury ([63b51aa](https://github.com/dungle-scrubs/fusion-panel/commit/63b51aa373841dc2685452a51449f6b2a562cc0c))
* bounded vocabulary on jury and delphi ([d719110](https://github.com/dungle-scrubs/fusion-panel/commit/d719110a74f3b349f8e142c5a01980dcee0c63d5))
* deep-research evidence supply for pattern runs ([ca24350](https://github.com/dungle-scrubs/fusion-panel/commit/ca24350c79f5e2462292033290bcfa9b4f3b3c62))
* let calling harnesses execute panel jobs ([#69](https://github.com/dungle-scrubs/fusion-panel/issues/69)) ([4669477](https://github.com/dungle-scrubs/fusion-panel/commit/4669477419030a828b8d0b4f5237c708934484dc))
* per-worker rosters and diversity counts on all patterns ([00eebca](https://github.com/dungle-scrubs/fusion-panel/commit/00eebca915eeaf4f3ef83a3b0c17c1122e76815a))
* suspend and resume for worker questions ([83a80ad](https://github.com/dungle-scrubs/fusion-panel/commit/83a80ad72319b99ef3eaae602340583c62ea1010))

## [0.2.2](https://github.com/dungle-scrubs/fusion-panel/compare/fusion-panel-v0.2.1...fusion-panel-v0.2.2) (2026-09-24)


### Added

* TypeScript 7.0.2 with explicit node types ([#51](https://github.com/dungle-scrubs/fusion-panel/issues/51)) ([27d7f95](https://github.com/dungle-scrubs/fusion-panel/commit/27d7f95af3a3f2fbe1e482f053ec54568950d17c))


### Changed

* point release workflow at main ([#53](https://github.com/dungle-scrubs/fusion-panel/issues/53)) ([eadc699](https://github.com/dungle-scrubs/fusion-panel/commit/eadc6992de30b49b84065b2bce1b34f23e6f19e7))

## [0.2.1](https://github.com/dungle-scrubs/fusion-panel/compare/fusion-panel-v0.2.0...fusion-panel-v0.2.1) (2026-09-24)


### Fixed

* correct install command to @dungle-scrubs/fusion-panel ([#48](https://github.com/dungle-scrubs/fusion-panel/issues/48)) ([502b0a3](https://github.com/dungle-scrubs/fusion-panel/commit/502b0a362385a44b095a55618efcd10d6dea9889))
* strip ./ prefix from bin path ([#47](https://github.com/dungle-scrubs/fusion-panel/issues/47)) ([a0040d3](https://github.com/dungle-scrubs/fusion-panel/commit/a0040d3eda7e22cdb60099b4035fe75f5a5703db))


### Changed

* one doc per method ([#24](https://github.com/dungle-scrubs/fusion-panel/issues/24)) ([a29e4d6](https://github.com/dungle-scrubs/fusion-panel/commit/a29e4d653a6c68a2dedbe9a50ffb5f09d2dc97d0))
* PatternDefinition owns each pattern; dispatcher is generic ([#22](https://github.com/dungle-scrubs/fusion-panel/issues/22)) ([d2893cf](https://github.com/dungle-scrubs/fusion-panel/commit/d2893cfdba1cbae4ea847de227f700f3d34094c0))
* public release readiness ([#37](https://github.com/dungle-scrubs/fusion-panel/issues/37)) ([12ffbc3](https://github.com/dungle-scrubs/fusion-panel/commit/12ffbc30567da96e78ab5026a1cda4e8ed81f0c5))
* rename fusion-harness to fusion-panel ([#46](https://github.com/dungle-scrubs/fusion-panel/issues/46)) ([7374c0c](https://github.com/dungle-scrubs/fusion-panel/commit/7374c0c500dce67e603cdbea20d7ada6df993705))
* trigger release-please after workflow permission fix ([#49](https://github.com/dungle-scrubs/fusion-panel/issues/49)) ([e468c8a](https://github.com/dungle-scrubs/fusion-panel/commit/e468c8a6ed358228f5fdf767c0350a0105e52b03))

## [Unreleased]

### Added

- **patterns:** six tool-owned problem-solving runs - jury, red-blue, ach, delphi, shortlist, gonogo - each with sealed workers through `hcn`, schema validation at the boundary, tool-stamped provenance, and a mechanical fuse
- **cli:** tier-1 pure functions (validate, normalize, aggregate, score), model-free and deterministic
- **cli:** `fusion skill` emits the complete caller guide, including per-method selection rules with counter-rules
- **engine:** staged waves with anonymized handoff, run-scoped claim ids, one retry with validator errors fed back, replayable event streams, and durable per-invocation command records
- **errors:** envelope contract with E-codes and exit classes (0 ok, 1 usage, 2 validation/gate, 3 nothing takeable, 4 internal); crashes surface as E499 envelopes, never as usage errors
