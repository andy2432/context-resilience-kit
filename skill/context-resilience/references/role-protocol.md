# Coordinator Role Protocol

## Purpose

A coordinator is a context firewall, not a more privileged worker. Its job is to preserve goal, user decisions, task and thread identities, state, evidence pointers, blockers, and the next action while delegating context-heavy work.

## Binding

- Store `ROLE-CONTRACT.json` beside the other durable context sources.
- Bind an exact `threadId` to `profiles.director` or `profiles.worker`.
- Never infer the role from a title, a recent task, model self-description, or user address.
- An unbound thread is a worker by default. If the work needs coordinator behavior, stop and bind or rebind explicitly.
- Role contract changes require a user authorization reference and a new revision.

## Dispatch-First

For a bound coordinator:

| Intent | Default decision |
|---|---|
| plan | allow |
| dispatch | allow |
| monitor | allow |
| verify | allow only against a worker delivery and named evidence |
| record | allow context/decision/acceptance records |
| discover | dispatch required |
| diagnose | dispatch required |
| implement | dispatch required, then remains forbidden to the coordinator |

`dispatchSatisfied=true` is not trusted without a dispatched task ID or dispatch evidence pointer.

## Action Whitelist

Allowed coordinator actions:

- plan work and update non-business context records;
- create, send, and monitor worker tasks;
- read a worker summary capped at 20 lines;
- verify one named commit, one exact file range, one named command, or one precise thread ID within budget;
- orchestrate a release only with explicit current release authorization.

Forbidden coordinator actions:

- broad thread search or candidate discovery;
- raw rollout, session, SQLite, or long-log parsing;
- open-ended code exploration, diagnosis, reproduction, or design implementation;
- business-code edits;
- repeat the worker's full investigation;
- continue investigating an anomaly discovered during acceptance;
- self-assign an unscoped audit.

## Verification Budget

Per worker delivery:

- at most one decisive evidence item;
- either one exact file range, one exact command, or one precise thread read;
- no more than one read operation and one named file;
- `maxTurns <= 2` and `includeOutputs=false` for a thread read;
- no wildcard search;
- no follow-on investigation.

An anomaly becomes a rejection, a worker question, or a new worker task.

## Minimum Memory

After compression, restore only:

1. `actorMode` and role contract revision;
2. latest user goal, authorization, and forbidden actions;
3. task IDs, worker thread IDs, status, and owner;
4. acceptance items and evidence pointers;
5. active decisions and supersession links;
6. blockers, user actions, and external state;
7. next action: wait, verify, reject, re-dispatch, or ask the user;
8. coordinator-forbidden exploration and implementation actions.

Do not retain full rollouts, all candidate bodies, command transcripts, code-search branches, worker reasoning, or observations already replaced by pointers.

## Request Example

```json
{
  "threadId": "bound-coordinator-thread",
  "actorMode": "director",
  "intent": "verify",
  "dispatchSatisfied": true,
  "dispatchedTaskIds": ["TASK-EXAMPLE-001"],
  "dispatchEvidence": ["evidence/dispatch.txt"],
  "workerDeliveryId": "DELIVERY-EXAMPLE-001",
  "evidencePointers": [
    {
      "id": "EV-001",
      "type": "commit",
      "value": "abcdef0",
      "allowedCheck": "git show --stat abcdef0"
    }
  ],
  "verificationBudgetUsed": {
    "readOperations": 0,
    "namedFiles": 0,
    "namedCommands": 0,
    "preciseThreadReads": 0
  },
  "plannedActions": [
    {
      "actionType": "verify_command",
      "command": "git show --stat abcdef0",
      "evidencePointerId": "EV-001",
      "runCount": 1
    }
  ]
}
```

Run:

```bash
context-resilience --root <repo> --role --role-input <request.json>
```

## Recovery

The generated resume starts with a role card. After compaction:

1. restore the role card;
2. rerun `--role`;
3. if the role is unknown or the contract is stale, stop;
4. if the intent is open-ended, dispatch before any search, read, command, or edit.
