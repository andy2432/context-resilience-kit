---
schemaVersion: 1
status: active
updatedAt: 2026-01-01T00:00:00Z
verifiedAt: 2026-01-01T00:00:00Z
verifiedBy: replace-with-owner
sourceRefs:
  - src/index.js
reviewAfterDays: 90
---

# Project Context

Synthetic service used to demonstrate durable repository context.

## Topology

- `src/index.js`: public entry point.
- `context/`: durable context sources and generated recovery summary.

## Commands

- Check context: `context-resilience --fast`
- Check role: `context-resilience --role --role-input <request.json>`
- Rebuild resume: `context-resilience --write`

## Boundaries

- Context files carry decisions and evidence, not credentials.
- Live systems outrank a recorded release snapshot.
- Code describes implementation, not user intent.
