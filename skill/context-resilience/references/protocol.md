# Context Resilience Protocol

## Authority Order

1. Current user instruction for intent, scope, and authorization.
2. Active product contract plus accepted decision chain.
3. Live external or production observation.
4. Current code and reproducible tests, which describe implementation but do not override product intent.
5. Work and release state snapshots.
6. Task evidence ledger.
7. Project context and design documents.
8. Recovery resume, thread summaries, and model memory.

Sources 1 through 3 may change direction only through an explicit decision chain. Lower layers cannot silently override higher layers.

## Start Protocol

1. Run `git status --short --branch`.
2. Run the doctor in fast mode.
3. Resolve actor mode from `ROLE-CONTRACT.json`; run role mode for a bound coordinator.
4. Read the generated resume and its role card.
5. Read only task-relevant contract rules, decisions, work, and release entries.
6. Resolve every evidence reference needed for the task.
7. State the task ID, base SHA, allowed scope, forbidden actions, acceptance evidence, dispatch state, and external mutation authorization.
8. Stop if any required fact is unavailable, contradictory, or role-ambiguous.

## Handoff Protocol

Use all fields below; do not replace them with "continue later":

```text
Task:
Status:
Actor mode and contract revision:
Worker task and thread IDs:
Completed:
Not completed:
Stop reason:
Dependency owner and required action:
Next executable command or action:
Evidence:
Review time:
```

Create the handoff from structured work state. Do not ask a new executor to infer unfinished scope from chat prose.

## Close Protocol

1. Compare the diff with task scope and forbidden actions.
2. Run task acceptance checks and preserve raw evidence.
3. Append a task-meta record with changed, not changed, evidence, risks, and verification level.
4. Add a decision only when intent changed.
5. Update work state only for actual open work.
6. Update release state only after an observed deployment or external change.
7. Remove closed tasks from work state.
8. Regenerate the resume.
9. Run fast and role modes and do not close on a block.

## Evidence Levels

| Level | Evidence | Minimum use |
|---|---|---|
| E0 | Guess or prose claim | Not acceptable |
| E1 | Static source or document inspection | Initial review |
| E2 | Reproducible test, build, or command | Development complete |
| E3 | Independent rerun, end-to-end evidence, screenshots, before/after data | Acceptance |
| E4 | Production observation, external receipt, device or platform confirmation | Release or external gate |

Code completion is E1 or E2. It is not acceptance or release evidence by itself.
