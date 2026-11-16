# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project uses semantic versioning.

## [1.1.0] - 2026-11-17

### Added

- Coordinator `ROLE-CONTRACT.json` with exact thread bindings, allowed actions, forbidden actions, dispatch priority, minimum memory, and bounded verification.
- `--role` action-plan gate and generated resume role card.
- Dispatch evidence requirements so a caller cannot self-assert successful delegation.
- 50 coordinator role-drift tests, including text-only baselines, forged dispatch, action-label spoofing, command redirection/chaining, budget abuse, and compression recovery.
- MIT-licensed standalone repository packaging and GitHub Actions CI.

### Changed

- Resume freshness hashes now include the role contract.
- Boundary checks now cover role mode and verify it remains read-only.

## [1.0.0] - 2026-11-16

### Added

- Initial context schemas, templates, generated resume, rule probes, release gates, and 16 saturation scenarios.
