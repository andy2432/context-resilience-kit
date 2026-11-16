# Known Failure Modes And Boundaries

## Boundaries

- The Kit detects contradictions and stale evidence. It does not prove that a user decision is wise.
- It does not replace authorization for deployment, publication, spending, production data, or external-platform changes.
- It does not make a naturally written historical document authoritative.
- It cannot validate an external state without a fresh receipt or live observation.
- It cannot infer business intent from tests or code.
- It cannot prove the absence of every secret; it catches high-confidence patterns and configured placeholders.
- It cannot enforce pre-tool actions unless an optional client hook or wrapper calls it before the tool. `--role` validates the supplied plan; bypassing the call remains an external integration risk.

## Known Failure Modes

1. **Probe gap:** a high-risk rule has no machine probe, so code can silently diverge. High-risk classes are therefore rejected without one.
2. **Decision laundering:** an agent suggestion is inserted as `sourceType=agent` but accepted. The doctor blocks this.
3. **Contract rewriting:** someone edits the product contract without changing the decision chain. Outcome comparison blocks this.
4. **Evidence drift:** files move or commits disappear. Reference checks block stale pointers.
5. **Version theater:** deployment prose is treated as live proof. Release mode requires declared, manifest, and observed versions to agree.
6. **Stale gate:** an old approval screenshot is reused. Gates require timestamps and allowed ages.
7. **Summary tampering:** a manual "fact" is added to the generated resume. Payload hashing blocks it.
8. **Task zombie:** a closed ledger item remains open. Cross-file state reconciliation blocks it.
9. **Baseline-free test:** a test records only Kit success. The shipped tests require a no-Kit baseline to fail or lose material information.
10. **Secret false confidence:** textual scanning cannot replace a dedicated secret scanner. Use repository secret scanning in addition to this Kit.
11. **Narrow role summary:** "Do not edit business code" does not block history scanning, code exploration, debugging, or long-log analysis. The role card and action gate explicitly cover those actions.
12. **Boolean dispatch forgery:** `dispatchSatisfied=true` without task/thread evidence is insufficient. The doctor requires dispatch evidence.
13. **Verification expansion:** a single anomaly can restart a full investigation inside the coordinator. Follow-on investigation is blocked; reject or create a new worker task.
14. **Title inference:** a thread called "director" without an exact binding is not a coordinator. Unknown role fails closed.

## Safe To Weaken

Do not weaken hard gates for convenience. If a rule is wrong, append a new accepted decision, update the contract, update the probe, regenerate the resume, and rerun the full scenario suite. Allowing a manual bypass without evidence turns the Kit back into advisory prose.
