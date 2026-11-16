# Doctor Configuration And Checks

## Modes

| Mode | Use | Writes |
|---|---|---|
| `--fast` | Every task start and handoff recovery | No |
| `--deep` | Pre-review validation and full probe pass | No |
| `--release` | Strict release candidate gate | No |
| `--role` | Validate actor binding and optionally a planned action sequence | No |
| `--write` | Regenerate only `CONTEXT-RESUME.md` | One context file |

Fast and deep share deterministic source checks. Deep is the explicit integration point for running the full project probe set before review; release adds placeholder and stricter evidence checks.

## Probe Types

| Probe | Required fields | Failure |
|---|---|---|
| `file_exists` | `path` | File missing |
| `file_regex` | `file`, `pattern` | Required implementation anchor missing |
| `file_not_regex` | `file`, `pattern` | Forbidden or stale implementation present |
| `glob_not_matches` | `globs`, `pattern` | Forbidden pattern found in matching files |
| `json_path_equals` | `file`, `path`, `value` | Structured value differs |
| `test_marker` | `path`, `marker` | Test marker missing |
| `git_commit_exists` | `commit` | Commit cannot be resolved |
| `evidence_sha256` | `file`, `sha256` | Evidence missing or changed |
| `manual` | Human evidence | Release remains blocked |

High-risk product, compliance, and security rules must have at least one machine probe. A manual-only rule cannot clear a release.

## Stable Error Families

- `SCHEMA_*`: invalid source structure.
- `*_REF_INVALID`: a file, decision, commit, or evidence pointer is dead.
- `UNTRUSTED_DECISION_ACCEPTED`: an agent proposal is treated as accepted user intent.
- `RULE_REVERSED_WITHOUT_DECISION`: current contract outcome no longer matches its decision.
- `FORBIDDEN_CURRENT_CLAIM`: a current document states a superseded rule.
- `PROBE_*`: a required code or structured fact does not match.
- `CLOSED_TASK_STILL_OPEN`: task ledger and work state disagree.
- `EXTERNAL_GATE_STALE`: external receipt exceeds its allowed age.
- `RELEASE_VERSION_DRIFT`: declared, manifest, and observed SHA differ.
- `RELEASE_PLACEHOLDER`: release candidate contains unresolved text.
- `SECRET_*`: high-confidence credential material exists.
- `RESUME_SOURCE_STALE` or `RESUME_TAMPERED`: generated recovery cache is invalid.
- `ROLE_BINDING_*`: role identity is missing, duplicated, or conflicts with a binding.
- `ROLE_DISPATCH_*`: coordinator investigation lacks a real worker dispatch or has unsafe priority.
- `ROLE_ACTION_FORBIDDEN`: coordinator attempted exploration, debugging, implementation, or broad history work.
- `ROLE_VERIFY_BUDGET_EXCEEDED`: acceptance expanded into a full investigation.
- `ROLE_EVIDENCE_POINTER_REQUIRED`: verification is not tied to evidence named by a worker.
- `ROLE_FOLLOW_ON_FORBIDDEN`: a verification anomaly was followed instead of re-dispatched.
- `ROLE_SUMMARY_TOO_LONG`: worker report exceeds the coordinator context budget.

## Output Contract

Normal output is designed to remain under 20 lines. Blocking output includes:

- stable code;
- path and line where available;
- related rule ID;
- concise explanation;
- required action.

Use `--json` for complete diagnostics. Exit code 0 is pass, 1 is block, and 2 is configuration failure.
