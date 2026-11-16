# New Thread Recovery Prompt

Use the repository at `<absolute-repo-path>`.

1. Do not rely on prior chat text or an inherited summary as evidence.
2. Run `git status --short --branch`.
3. Read `context/CONTEXT-RESUME.md`.
4. Run `node <kit-path> --fast`.
5. If the check blocks, report the first block and stop. Do not select a side in a contradiction.
6. Read only the source files named by the resume for the requested task.
7. State the task ID, base SHA, allowed scope, forbidden actions, acceptance evidence, and release/mutation authorization before editing.
8. Do not deploy, publish, spend money, mutate production data, or change external systems unless the current user explicitly authorizes that action.

Return a short opening report with:

- current branch and HEAD;
- relevant rule IDs and decision IDs;
- open task and next action;
- release and external-gate claims that affect the task;
- exact source paths you will read next.
