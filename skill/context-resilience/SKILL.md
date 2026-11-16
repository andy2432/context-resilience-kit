---
name: context-resilience
description: Initialize, audit, or recover durable repository context when compaction, conflicting documents, stale external gates, version drift, task handoff, or actor-role drift could cause a wrong decision.
---

# Context Resilience

Use this skill when a task must survive context compression or move to a new executor without relying on chat memory, or when a coordinator must remain a context firewall instead of drifting into investigation or implementation. It creates a small source-of-truth layer, validates it, gates actor actions, and generates a bounded recovery summary.

## Operating Rules

1. Treat `CONTEXT-RESUME.md` as generated navigation, never as independent evidence.
2. Read binding rules from `PRODUCT-CONTRACT.json`, decision history from `DECISION-LOG.jsonl`, unfinished work from `WORK-STATE.json`, and release claims from `RELEASE-STATE.json`.
3. The current user instruction controls intent and authorization. It does not silently rewrite a recorded decision; append a new decision and supersede the old one.
4. Block on contradictions, missing evidence, invalid references, accepted agent-only proposals, stale external gates, release placeholders, or version drift.
5. Run checks read-only by default. `--write` may change only `CONTEXT-RESUME.md`.
6. Never deploy, publish, spend money, mutate production data, or change an external system as part of a context check.
7. Resolve coordinator identity only from an exact thread binding in `ROLE-CONTRACT.json`. A title, recent task, or model self-description is not role evidence.
8. A bound coordinator dispatches discovery, diagnosis, and implementation before execution. It may verify only named worker evidence within budget and must re-dispatch any follow-on investigation.

## Run The Doctor

Resolve `SKILL_DIR` to this skill folder.

```bash
node "$SKILL_DIR/scripts/context-resilience.js" --root <repo> --fast
node "$SKILL_DIR/scripts/context-resilience.js" --root <repo> --deep
node "$SKILL_DIR/scripts/context-resilience.js" --root <repo> --release
node "$SKILL_DIR/scripts/context-resilience.js" --root <repo> --role
node "$SKILL_DIR/scripts/context-resilience.js" --root <repo> --role --role-input <request.json>
node "$SKILL_DIR/scripts/context-resilience.js" --root <repo> --write
```

Use `--json` only for automation. On any `BLOCK`, report the first actionable block and stop before editing or releasing.

## Recover A Thread

1. Run `git status --short --branch`.
2. Read `CONTEXT-RESUME.md`.
3. Run the doctor with `--fast`.
4. For a bound coordinator, run `--role` and load the generated role card.
5. If blocked, do not select one side of the conflict. Report the block and required action.
6. Read only the structured source paths relevant to the task.
7. State task ID, base SHA, scope, forbidden actions, acceptance evidence, dispatch state, and mutation authorization before editing.

Use [references/protocol.md](references/protocol.md) for the full start, handoff, and close protocol.
Use [references/role-protocol.md](references/role-protocol.md) for coordinator bindings, dispatch-first behavior, action whitelists, evidence budgets, and role-drift recovery.

## Initialize Or Migrate

Use `templates/` for the minimum source set and `examples/synthetic-repo/` as a known-good fixture. Preserve existing decision history by appending and superseding; do not rewrite it into a new form.

Use [references/migration.md](references/migration.md) for installation, gradual adoption, and rollback. Use [references/doctor.md](references/doctor.md) when configuring probes or diagnosing check codes.

## Verify Changes

Run:

```bash
node "$SKILL_DIR/tests/run-tests.js"
node "$SKILL_DIR/tests/boundary-tests.js"
node "$SKILL_DIR/tests/role-tests.js"
```

The first command covers cold start, repeated compression, hard-gate scenarios, and no-Kit baselines. The second verifies that checks are read-only, output is bounded, write mode is narrow, and the package contains no high-confidence credential material. The third compares text-only guidance with the role gate across coordinator drift, allowed verification, compression recovery, and forged dispatch state.

Read [references/failure-modes.md](references/failure-modes.md) before weakening any check or adding a manual exception.
