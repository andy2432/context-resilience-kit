---
schemaVersion: 1
status: active
updatedAt: 2026-01-02T00:00:00Z
verifiedAt: 2026-01-02T00:00:00Z
verifiedBy: synthetic-review
sourceRefs:
  - src/index.js
reviewAfterDays: 3650
---

# Orchid Notes

Synthetic note service used only for Kit examples and tests.

## Topology

- `src/index.js`: public request boundary.
- `context/`: structured context sources and generated recovery summary.

## Commands

- Check: `node ../scripts/context-resilience.js --root . --fast`
- Check role plan: `node ../scripts/context-resilience.js --root . --role --role-input role-request.json`
- Regenerate: `node ../scripts/context-resilience.js --root . --write`

## Boundaries

- No real customer, credential, or infrastructure data.
- Context checks never deploy or mutate product state.
