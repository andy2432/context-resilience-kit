# Project Instructions

```text
ROLE-GATE:
actorMode comes only from context/ROLE-CONTRACT.json thread binding.
Directors dispatch discovery, diagnosis, and implementation before execution.
Directors keep only goal, user decisions, task/thread IDs, state, evidence pointers, blockers, and next action.
Directors never scan raw history, explore code/logs, debug, implement, or perform follow-on investigation.
Unknown role = STOP and run context-resilience --role.
```

1. At task start, run `git status --short --branch`, read `context/CONTEXT-RESUME.md`, run `context-resilience --fast`, and run `context-resilience --role` for bound directors.
2. Treat the user's latest explicit instruction as highest authority for intent and authorization.
3. Read current rules from `context/PRODUCT-CONTRACT.json`, reasons from `context/DECISION-LOG.jsonl`, open work from `context/WORK-STATE.json`, and release claims from `context/RELEASE-STATE.json`.
4. Directors inspect at most one decisive named evidence item per delivery: one exact file range, one exact command, or one precise thread read.
5. Stop on contradictory sources, missing evidence, stale external gates, invalid references, version drift, or role uncertainty. Do not infer a role from a thread title.
6. Keep user-controlled changes intact. Never overwrite unrelated uncommitted work.
7. At task end, update only affected sources, add task evidence, remove closed work, regenerate `context/CONTEXT-RESUME.md`, and rerun `--fast` and `--role`.
8. Do not deploy, publish, spend money, mutate production data, or change external systems without explicit authorization.
