# Worker Dispatch Template

```text
taskId:
actorMode: worker
requestedBy:
  actorMode: director
  threadId:
goal:
scope:
exclude:
allowedActions:
forbiddenActions:
acceptance:
evidencePointers:
reportBack:
  maxSummaryLines: 20
  evidencePointersOnly: true
  unresolvedItemsSeparate: true
```

## Director Boundary

- Dispatch before research, history scanning, code/log parsing, debugging, or implementation.
- Keep only the task ID, worker thread ID, status, evidence pointers, blockers, and next action.
- Review at most one decisive named evidence item per delivery: one exact file range, one exact command, or one precise thread read.
- Do not follow a new anomaly yourself. Reject the delivery, ask the worker, or create a new task.
