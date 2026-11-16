# Contributing

1. Open an issue describing the failure mode and the decision being protected.
2. Add a deterministic scenario to the relevant test suite before changing policy.
3. Preserve a no-Kit or text-only baseline for new hard gates.
4. Run:

```bash
npm test
```

5. Update `CHANGELOG.md` and any user-facing reference documentation.
6. Do not include real chat records, credentials, customer data, private addresses, internal paths, or production snapshots.

Policy changes must state:

- what the old rule allowed incorrectly;
- which role or context layer owns the new rule;
- the blocked and allowed examples;
- migration or rollback impact;
- evidence that no allowed verification path was over-blocked.
