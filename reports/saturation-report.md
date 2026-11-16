# 饱和测试报告

- 生成时间：2026-11-16T17:03:30.847Z
- Kit 版本：1.1.0
- 场景：16
- 通过：16
- 失败：0
- 硬门阻断率：100%
- Kit 信息恢复正确率：100%
- 无 Kit 基线正确率：11.11%
- 正常输出最大行数：4

## 场景矩阵

| ID | 场景 | 输入摘要 | 模式 | 预期 | 实际 | 无 Kit 基线 | 结果 |
|---|---|---|---|---|---|---|---|
| S01 | Complete cold start | No prior chat history, no inherited summary. | fast | PASS  | PASS  | ANSWER; accuracy=0.0% (0/8) | PASS |
| S02 | Five-percent summary omits key decision | Five-percent summary: Orchid Notes task is in progress. Build passed. | fast | PASS  | PASS  | ANSWER; accuracy=11.1% (1/9) | PASS |
| S03 | Summary of a summary compressed three times | Third-generation summary: One synthetic project. Work continues. No further facts retained. | fast | PASS  | PASS  | ANSWER; accuracy=11.1% (1/9) | PASS |
| S04 | Current documents contradict each other | The latest note says unsafe mode; the older contract says safe mode. | fast | BLOCK FORBIDDEN_CURRENT_CLAIM | BLOCK FORBIDDEN_CURRENT_CLAIM | PROCEED; decision=PROCEED | PASS |
| S05 | Current code conflicts with a user rule | Tests are green; current source sets public mode to unsafe. | fast | BLOCK PROBE_FILE_REGEX_MISSING | BLOCK PROBE_FILE_REGEX_MISSING | PROCEED; decision=PROCEED | PASS |
| S06 | Mid-task handoff with unfinished work | Previous executor stopped before handoff. Unfinished items may remain. | fast | PASS  | PASS  | ANSWER; accuracy=20.0% (2/10) | PASS |
| S07 | Production, manifest, and version endpoint drift | Release summary says deployed, but no version comparison is included. | release | BLOCK RELEASE_VERSION_DRIFT | BLOCK RELEASE_VERSION_DRIFT | AUTHORIZE_RELEASE; decision=AUTHORIZE_RELEASE | PASS |
| S08 | External approval evidence is expired | An approval screenshot exists, so the external gate is probably still valid. | release | BLOCK EXTERNAL_GATE_STALE | BLOCK EXTERNAL_GATE_STALE | AUTHORIZE_RELEASE; decision=AUTHORIZE_RELEASE | PASS |
| S09 | Agent suggestion recorded as a user decision | An agent proposal says safe mode can be removed. | fast | BLOCK UNTRUSTED_DECISION_ACCEPTED<br>RULE_REVERSED_WITHOUT_DECISION | BLOCK RULE_REVERSED_WITHOUT_DECISION<br>UNTRUSTED_DECISION_ACCEPTED | PROCEED; decision=PROCEED | PASS |
| S10 | Rule reversed without a new decision | Contract says unsafe mode; the original user decision still says safe mode. | fast | BLOCK RULE_REVERSED_WITHOUT_DECISION | BLOCK RULE_REVERSED_WITHOUT_DECISION | PROCEED; decision=PROCEED | PASS |
| S11 | Release candidate contains placeholder and token | Build succeeded, so the release candidate should be ready. | release | BLOCK RELEASE_PLACEHOLDER<br>SECRET_AWS_KEY | BLOCK RELEASE_PLACEHOLDER<br>SECRET_AWS_KEY | AUTHORIZE_RELEASE; decision=AUTHORIZE_RELEASE | PASS |
| S12 | Rule evidence reference no longer exists | The rule still appears in a summary; its evidence link is broken. | fast | BLOCK EVIDENCE_REF_INVALID | BLOCK EVIDENCE_REF_INVALID | PROCEED; decision=PROCEED | PASS |
| S13 | Task closed in ledger but still open in work state | Summary says the task is done, but work cleanup is unknown. | fast | BLOCK CLOSED_TASK_STILL_OPEN | BLOCK CLOSED_TASK_STILL_OPEN | PROCEED; decision=PROCEED | PASS |
| S14 | Generated resume was manually edited | Someone added a helpful fact directly to the recovery summary. | fast | BLOCK RESUME_TAMPERED | BLOCK RESUME_TAMPERED | PROCEED; decision=PROCEED | PASS |
| S15 | Path rename invalidates references | The main source file was renamed, but old links remain in context. | fast | BLOCK PROJECT_SOURCE_REF_INVALID<br>EVIDENCE_REF_INVALID<br>PROBE_REQUIRED_FILE_MISSING | BLOCK EVIDENCE_REF_INVALID<br>PROBE_REQUIRED_FILE_MISSING<br>PROBE_SCAN_FILE_MISSING<br>PROJECT_SOURCE_REF_INVALID | PROCEED; decision=PROCEED | PASS |
| S16 | Random combination: drift, stale external gate, and tamper | A combined failure is summarized as 'release looked fine yesterday'. | release | BLOCK RELEASE_VERSION_DRIFT<br>EXTERNAL_GATE_STALE<br>RESUME_TAMPERED | BLOCK EXTERNAL_GATE_STALE<br>RELEASE_VERSION_DRIFT<br>RESUME_TAMPERED | AUTHORIZE_RELEASE; decision=AUTHORIZE_RELEASE | PASS |

## 恢复问答

| 场景 | Kit | 无 Kit |
|---|---:|---:|
| S01 | 8/8 | 0/8 |
| S02 | 9/9 | 1/9 |
| S03 | 9/9 | 1/9 |
| S06 | 10/10 | 2/10 |

## 失败原因与修复记录

- FIX-001：Decision entries with supersededBy=null were incorrectly treated as missing fields. 原因：Required-field validation did not distinguish missing properties from intentional null values. 修复：Validate property presence for supersededBy and allow nullable threadId values. 复测：The synthetic example passed fast and release modes after regeneration.
- FIX-002：A freshly generated resume was incorrectly reported as hand-tampered. 原因：Payload extraction removed only one of the two separators after the metadata comment. 修复：Normalize all leading newlines before recomputing the resume payload hash. 复测：A generated resume passed freshness verification; manual tamper detection remained active.
- FIX-003：Tamper scenarios regenerated the resume after making their mutation, overwriting the test fault. 原因：The harness applied fault injection before its standard resume-generation step. 修复：Add a post-generation fault hook and run resume tamper injection only after --write-equivalent generation. 复测：S14 and S16 both return RESUME_TAMPERED, and the full suite passes.

## 结论

所有硬门场景均被阻断，信息恢复达到门槛，无 Kit 基线确实失败，可以进入独立复核。

完整机器可读结果见 `reports/saturation-report.json`。
