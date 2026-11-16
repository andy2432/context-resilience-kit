# Installation, Migration, And Rollback

## Installation

1. Place this folder at `$CODEX_HOME/skills/context-resilience`, or keep it in a repository and invoke the script by absolute path.
2. Copy `templates/.context-resilience.json` to the target repository root.
3. Copy every remaining file under `templates/` into the target repository's `context/` directory, preserving file names.
4. Bind exact coordinator thread IDs in `ROLE-CONTRACT.json`; leave unrelated threads unbound.
5. Remove the synthetic binding, open task, external gate, and example evidence before first real use.
6. Replace source references and probes with project-specific checks.
7. Run `--write`, then `--fast` and `--role`.
8. Make the repository instruction file require `--fast` and `--role` at task start and `--release` before release.

## Gradual Migration

1. Freeze old handover or summary files as historical entry points and add a pointer to `CONTEXT-RESUME.md`.
2. Move only current high-risk rules first. Keep each rule tied to an accepted decision and a machine probe.
3. Move only unfinished work into `WORK-STATE.json`; move completed history into the task ledger.
4. Record current release claims as `unverified` until a live observation exists.
5. Add task metadata only to new records; do not rewrite the full historical ledger.
6. Delete duplicate current-state prose after references point to the structured source.
7. Start in audit-only or manual role checks before enabling any optional client hooks; a static passing contract alone is not proof that the client hook is trusted.

## Rollback

The Kit is additive. To roll back:

1. Remove the start/close protocol references from the repository instruction file.
2. Disable or remove optional hook enforcement while retaining the role contract and evidence.
3. Restore the previous handover or current-state entry point.
4. Stop running the doctor.
5. Keep approved decision and task evidence files if they are useful; otherwise remove only files added by the migration in the same reviewed change.
6. Verify that no business or production state was changed by the Kit.

Rollback does not authorize modifying production data, deployment, or external systems.
