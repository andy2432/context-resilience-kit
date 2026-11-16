<!-- context-resume-meta {"schemaVersion":1,"kitVersion":"1.1.0","generatedAt":"2026-11-16T17:03:27.976Z","sourceHashes":{"context/PROJECT-CONTEXT.md":"00b01e74f376ff1d4e850075668f33fd47b510fe68e67e8bc927e03082fd6711","context/PRODUCT-CONTRACT.json":"a761c24a2b18fbe638ef47dbbdace8e301a55dccb2176bf21dc3f9e7c7d1fee3","context/DECISION-LOG.jsonl":"c4b450daea0e4c2d257fb8b8de908ef81c43018d371a6c35081caf3822477464","context/WORK-STATE.json":"77b1dd0601330d3072804508883e5b8bb528075c8bb210190b91a221a52beeab","context/RELEASE-STATE.json":"af73aef251e881d8f9042788f9f6a6fe3db75148624de1695fc47241262170ac","context/TASK-LOG.md":"f4854259d28289b198c1295e0bd55586fd4088a53fe9442a440b8278f119f90e","context/ROLE-CONTRACT.json":"6dc378bb98813b2d1b041638644115587a7dcbaabc2ec00d3cb5fde43a4b8ff6"},"headAtGeneration":null,"payloadSha256":"a896826abb004bca8ceddb631e2e0aac5541bcff32aaa61ba2f50281ab381083"} -->

# CONTEXT RESUME

> GENERATED FILE. DO NOT EDIT.
> Rebuild with `context-resilience --write`; do not add facts here.

## 0. ROLE-CARD
```text
ROLE-GATE director
roleContract=context/ROLE-CONTRACT.json#profiles.director
roleRevision=1
directorThreads=synthetic-director-thread-0001
handoffRequired=true
purpose=context_firewall
discovery=dispatch_first
diagnose=dispatch_first
implement=forbidden
verify=named_evidence_only
keep=goal,user_decisions,task_ids,thread_ids,state,evidence_pointers,blockers,next_action
verifyBudget=1_decision_evidence,1_named_file,1_named_command,1_precise_thread_read
forbid=broad_search,raw_session_scan,rollout_parse,broad_code_read,debug,implementation,long_log_analysis,follow_on_audit
if_role_unknown=STOP_AND_RUN_CONTEXT_DOCTOR_ROLE
```

## 1. Project
- name: Orchid Notes
- purpose: Synthetic note service used only for Kit examples and tests.

## 2. Repository Snapshot
- branch: (not a git worktree)
- head: (not available)
- worktree: unknown

## 3. Binding Rules
- INV-PUBLIC-MODE-001: The public boundary remains in safe mode.
- INV-NO-AUTO-DEPLOY-001: Context checks have no deployment side effect.
- INV-DIRECTOR-DISPATCH-001: Discovery, diagnosis, and implementation are dispatched before director execution.

## 4. Open Work
- none

## 5. Release State
- production.server: unverified; buildSha=unknown

## 6. External Gates
- EXT-SYNTHETIC-APPROVAL: unverified; Synthetic external approval is not available.

## 7. Next Reads
- project: context/PROJECT-CONTEXT.md
- rules: context/PRODUCT-CONTRACT.json
- decisions: context/DECISION-LOG.jsonl
- work: context/WORK-STATE.json
- release: context/RELEASE-STATE.json
- task evidence: context/TASK-LOG.md

## 8. Operating Boundary
- Treat this file as navigation only; verify claims in the referenced source.
- Block on contradictions, missing evidence, stale external gates, or version drift.
- Never deploy, mutate production data, or spend money without explicit authorization.
