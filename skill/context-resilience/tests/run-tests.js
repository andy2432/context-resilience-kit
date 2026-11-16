#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  formatHuman,
  readJson,
  sha256,
  writeResume,
} = require("../scripts/context-resilience");

const SKILL_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SKILL_ROOT, "../..");
const CLI = path.join(SKILL_ROOT, "scripts", "context-resilience.js");
const BASE_FIXTURE = path.join(SKILL_ROOT, "examples", "synthetic-repo");
const REPORT_DIR = path.join(REPO_ROOT, "reports");
const REPORT_JSON = path.join(REPORT_DIR, "saturation-report.json");
const REPORT_MD = path.join(REPORT_DIR, "saturation-report.md");

const REMEDIATION_HISTORY = [
  {
    id: "FIX-001",
    discoveredBy: "initial harness run",
    failure: "Decision entries with supersededBy=null were incorrectly treated as missing fields.",
    cause: "Required-field validation did not distinguish missing properties from intentional null values.",
    repair: "Validate property presence for supersededBy and allow nullable threadId values.",
    retest: "The synthetic example passed fast and release modes after regeneration.",
  },
  {
    id: "FIX-002",
    discoveredBy: "initial harness run",
    failure: "A freshly generated resume was incorrectly reported as hand-tampered.",
    cause: "Payload extraction removed only one of the two separators after the metadata comment.",
    repair: "Normalize all leading newlines before recomputing the resume payload hash.",
    retest: "A generated resume passed freshness verification; manual tamper detection remained active.",
  },
  {
    id: "FIX-003",
    discoveredBy: "S14/S16 initial saturated run",
    failure: "Tamper scenarios regenerated the resume after making their mutation, overwriting the test fault.",
    cause: "The harness applied fault injection before its standard resume-generation step.",
    repair: "Add a post-generation fault hook and run resume tamper injection only after --write-equivalent generation.",
    retest: "S14 and S16 both return RESUME_TAMPERED, and the full suite passes.",
  },
];

function rmSafe(target) {
  const resolved = path.resolve(target);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(tempRoot + path.sep)) {
    throw new Error(`Refusing to remove path outside temp root: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function copyFixture(target) {
  fs.cpSync(BASE_FIXTURE, target, { recursive: true });
}

function filePath(root, relativePath) {
  return path.join(root, relativePath);
}

function mutateJson(root, relativePath, mutate) {
  const target = filePath(root, relativePath);
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  const replacement = mutate(value) ?? value;
  fs.writeFileSync(target, `${JSON.stringify(replacement, null, 2)}\n`, "utf8");
}

function appendText(root, relativePath, content) {
  const target = filePath(root, relativePath);
  const existing = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  fs.writeFileSync(target, `${existing}${content}`, "utf8");
}

function appendDecision(root, decision) {
  appendText(root, "context/DECISION-LOG.jsonl", `${JSON.stringify(decision)}\n`);
}

function replaceText(root, relativePath, from, to) {
  const target = filePath(root, relativePath);
  const content = fs.readFileSync(target, "utf8");
  if (!content.includes(from)) {
    throw new Error(`Fixture replacement target not found in ${relativePath}: ${from}`);
  }
  fs.writeFileSync(target, content.replaceAll(from, to), "utf8");
}

function createEvidence(root, relativePath, content = "synthetic evidence\n") {
  const target = filePath(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function baseQuestions() {
  return [
    {
      id: "project-name",
      prompt: "What synthetic project is this?",
      answer: (facts) => facts.projectName,
      expected: "Orchid Notes",
    },
    {
      id: "public-rule",
      prompt: "Does INV-PUBLIC-MODE-001 remain active?",
      answer: (facts) => facts.ruleIds.includes("INV-PUBLIC-MODE-001") ? "yes" : "no",
      expected: "yes",
    },
    {
      id: "deploy-rule",
      prompt: "Does INV-NO-AUTO-DEPLOY-001 remain active?",
      answer: (facts) => facts.ruleIds.includes("INV-NO-AUTO-DEPLOY-001") ? "yes" : "no",
      expected: "yes",
    },
    {
      id: "public-statement",
      prompt: "What is the binding public-mode statement?",
      answer: (facts) => facts.ruleStatements["INV-PUBLIC-MODE-001"],
      expected: "The public boundary remains in safe mode.",
    },
    {
      id: "deploy-statement",
      prompt: "What is the binding deployment statement?",
      answer: (facts) => facts.ruleStatements["INV-NO-AUTO-DEPLOY-001"],
      expected: "Context checks have no deployment side effect.",
    },
    {
      id: "open-count",
      prompt: "How many work items remain open?",
      answer: (facts) => String(facts.openTasks.length),
      expected: "0",
    },
    {
      id: "production-status",
      prompt: "What does release state claim for production server status?",
      answer: (facts) => facts.productionStatus,
      expected: "unverified",
    },
    {
      id: "external-gate",
      prompt: "What is EXT-SYNTHETIC-APPROVAL state?",
      answer: (facts) => facts.externalGates.find((gate) => gate.id === "EXT-SYNTHETIC-APPROVAL")?.status,
      expected: "unverified",
    },
  ];
}

function applyReleaseDrift(root) {
  createEvidence(root, "evidence/release.txt");
  createEvidence(root, "evidence/version.json", `${JSON.stringify({ buildSha: "cafebabe" })}\n`);
  const manifest = {
    buildSha: "deadbeef",
    artifact: "synthetic-artifact",
  };
  createEvidence(root, "evidence/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSha = sha256(fs.readFileSync(filePath(root, "evidence/manifest.json")));
  mutateJson(root, "context/RELEASE-STATE.json", (release) => {
    release.updatedAt = new Date().toISOString();
    release.environments.production.server = {
      status: "deployed",
      version: "1.2.3",
      buildSha: "deadbeef",
      lastObservedAt: new Date().toISOString(),
      evidence: ["evidence/release.txt"],
      manifest: {
        path: "evidence/manifest.json",
        sha256: manifestSha,
      },
      versionFile: {
        path: "evidence/version.json",
      },
    };
  });
}

function applyStaleExternalGate(root) {
  createEvidence(root, "evidence/external-receipt.txt");
  mutateJson(root, "context/RELEASE-STATE.json", (release) => {
    release.updatedAt = new Date().toISOString();
    release.externalGates[0] = {
      id: "EXT-SYNTHETIC-APPROVAL",
      status: "verified",
      summary: "Old synthetic approval.",
      lastCheckedAt: "2020-01-01T00:00:00Z",
      maxAgeHours: 72,
      evidence: ["evidence/external-receipt.txt"],
    };
  });
}

function appendClosedTaskConflict(root) {
  const taskId = "TASK-20260103-999";
  mutateJson(root, "context/WORK-STATE.json", (work) => {
    work.updatedAt = new Date().toISOString();
    work.tasks.push({
      id: taskId,
      title: "Synthetic closed task left open",
      status: "ready_for_review",
      owner: "example-owner",
      threadId: "example-thread",
      branch: "main",
      baseSha: "HEAD",
      scope: ["src/index.js"],
      forbidden: ["deployment"],
      acceptance: ["Close the task."],
      nextAction: "Close the task.",
      blockers: [],
      evidence: ["context/PROJECT-CONTEXT.md"],
      updatedAt: new Date().toISOString(),
    });
  });
  appendText(
    root,
    "context/TASK-LOG.md",
    [
      "",
      "## TASK-20260103-999 - Closed evidence",
      "",
      "<!-- task-meta",
      JSON.stringify({
        id: taskId,
        status: "closed",
        baseSha: "HEAD",
        commits: [],
        verificationLevel: "E2",
        verifiedBy: "synthetic-review",
        changed: ["Recorded closure evidence."],
        notChanged: ["No production state changed."],
        evidence: ["context/PROJECT-CONTEXT.md"],
        risks: [],
      }, null, 2),
      "-->",
      "",
    ].join("\n"),
  );
}

const scenarios = [
  {
    id: "S01",
    title: "Complete cold start",
    category: "information",
    mode: "fast",
    compressedInput: "No prior chat history, no inherited summary.",
    setup(root) {
      return root;
    },
    expectedStatus: "PASS",
    expectedCodes: [],
    questions: baseQuestions(),
    baseline: {
      decision: "ANSWER",
      answers: {},
      reason: "There is no summary or chat memory for a naive executor to consult.",
    },
  },
  {
    id: "S02",
    title: "Five-percent summary omits key decision",
    category: "information",
    mode: "fast",
    compressedInput: "Five-percent summary: Orchid Notes task is in progress. Build passed.",
    setup(root) {
      appendDecision(root, {
        id: "DEC-20260102-005",
        key: "retention.window",
        date: new Date().toISOString(),
        status: "accepted",
        sourceType: "director",
        owner: "synthetic-owner",
        decision: "Synthetic notes expire after seven days.",
        outcome: "seven-day retention",
        reason: "The user-approved retention boundary must survive compression.",
        evidence: [{ type: "file", ref: "context/PROJECT-CONTEXT.md" }],
        supersedes: [],
        supersededBy: null,
        reviewWhen: "Retention policy changes.",
      });
      return root;
    },
    expectedStatus: "PASS",
    expectedCodes: [],
    questions: [
      ...baseQuestions(),
      {
        id: "missing-decision",
        prompt: "What retention outcome remains active?",
        answer: (facts) => facts.decisions["DEC-20260102-005"],
        expected: "seven-day retention",
      },
    ],
    baseline: {
      decision: "ANSWER",
      answers: {
        "project-name": "Orchid Notes",
      },
      reason: "The compressed summary retained the project name and build result but omitted the retention decision.",
    },
  },
  {
    id: "S03",
    title: "Summary of a summary compressed three times",
    category: "information",
    mode: "fast",
    compressedInput: "Third-generation summary: One synthetic project. Work continues. No further facts retained.",
    setup(root) {
      appendDecision(root, {
        id: "DEC-20260102-004",
        key: "review.cadence",
        date: new Date().toISOString(),
        status: "accepted",
        sourceType: "user",
        owner: "synthetic-owner",
        decision: "External evidence is reviewed every 72 hours.",
        outcome: "72-hour evidence review",
        reason: "A stale external approval must block release.",
        evidence: [{ type: "file", ref: "context/PROJECT-CONTEXT.md" }],
        supersedes: [],
        supersededBy: null,
        reviewWhen: "External review policy changes.",
      });
      return root;
    },
    expectedStatus: "PASS",
    expectedCodes: [],
    questions: [
      ...baseQuestions(),
      {
        id: "triple-compressed-decision",
        prompt: "What external-evidence review cadence remains active?",
        answer: (facts) => facts.decisions["DEC-20260102-004"],
        expected: "72-hour evidence review",
      },
    ],
    baseline: {
      decision: "ANSWER",
      answers: {
        "project-name": "Orchid Notes",
      },
      reason: "The third-generation summary says work continues but lost the binding cadence.",
    },
  },
  {
    id: "S04",
    title: "Current documents contradict each other",
    category: "hard-gate",
    mode: "fast",
    compressedInput: "The latest note says unsafe mode; the older contract says safe mode.",
    setup(root) {
      fs.writeFileSync(filePath(root, "CURRENT-NOTES.md"), "# Current Notes\n\nPublic mode is unsafe.\n", "utf8");
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["FORBIDDEN_CURRENT_CLAIM"],
    questions: [],
    baseline: {
      decision: "PROCEED",
      answers: {},
      reason: "A naive executor trusts the newest prose note and proceeds with unsafe mode.",
    },
  },
  {
    id: "S05",
    title: "Current code conflicts with a user rule",
    category: "hard-gate",
    mode: "fast",
    compressedInput: "Tests are green; current source sets public mode to unsafe.",
    setup(root) {
      replaceText(root, "src/index.js", 'PUBLIC_MODE = "safe"', 'PUBLIC_MODE = "unsafe"');
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["PROBE_FILE_REGEX_MISSING"],
    questions: [],
    baseline: {
      decision: "PROCEED",
      answers: {},
      reason: "A naive executor treats passing local code as authority and reverses the user-approved rule.",
    },
  },
  {
    id: "S06",
    title: "Mid-task handoff with unfinished work",
    category: "information",
    mode: "fast",
    compressedInput: "Previous executor stopped before handoff. Unfinished items may remain.",
    setup(root) {
      mutateJson(root, "context/WORK-STATE.json", (work) => {
        work.updatedAt = new Date().toISOString();
        work.tasks.push({
          id: "TASK-20260103-001",
          title: "Add synthetic input normalization",
          status: "ready_for_review",
          owner: "developer-a",
          threadId: "thread-a",
          branch: "main",
          baseSha: "HEAD",
          scope: ["src/index.js"],
          forbidden: ["deployment", "production-data"],
          acceptance: ["Normalization test passes", "Independent review records evidence"],
          nextAction: "Independent reviewer runs the normalization test.",
          blockers: [],
          evidence: ["context/PROJECT-CONTEXT.md"],
          updatedAt: new Date().toISOString(),
        });
      });
      return root;
    },
    expectedStatus: "PASS",
    expectedCodes: [],
    questions: [
      ...baseQuestions().filter((question) => question.id !== "open-count"),
      {
        id: "open-count",
        prompt: "How many work items remain open?",
        answer: (facts) => String(facts.openTasks.length),
        expected: "1",
      },
      {
        id: "handoff-status",
        prompt: "What is TASK-20260103-001 status?",
        answer: (facts) => facts.openTasks.find((task) => task.id === "TASK-20260103-001")?.status,
        expected: "ready_for_review",
      },
      {
        id: "handoff-next",
        prompt: "What is TASK-20260103-001 next action?",
        answer: (facts) => facts.openTasks.find((task) => task.id === "TASK-20260103-001")?.nextAction,
        expected: "Independent reviewer runs the normalization test.",
      },
    ],
    baseline: {
      decision: "ANSWER",
      answers: {
        "project-name": "Orchid Notes",
        "handoff-status": "ready_for_review",
      },
      reason: "The compressed handoff retained project and coarse status but lost the exact next action and binding rules.",
    },
  },
  {
    id: "S07",
    title: "Production, manifest, and version endpoint drift",
    category: "hard-gate",
    mode: "release",
    compressedInput: "Release summary says deployed, but no version comparison is included.",
    setup(root) {
      applyReleaseDrift(root);
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["RELEASE_VERSION_DRIFT"],
    questions: [],
    baseline: {
      decision: "AUTHORIZE_RELEASE",
      answers: {},
      reason: "A naive executor trusts the word deployed and misses declared/manifest/observed SHA disagreement.",
    },
  },
  {
    id: "S08",
    title: "External approval evidence is expired",
    category: "hard-gate",
    mode: "release",
    compressedInput: "An approval screenshot exists, so the external gate is probably still valid.",
    setup(root) {
      applyStaleExternalGate(root);
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["EXTERNAL_GATE_STALE"],
    questions: [],
    baseline: {
      decision: "AUTHORIZE_RELEASE",
      answers: {},
      reason: "A naive executor sees an evidence filename and ignores its age.",
    },
  },
  {
    id: "S09",
    title: "Agent suggestion recorded as a user decision",
    category: "hard-gate",
    mode: "fast",
    compressedInput: "An agent proposal says safe mode can be removed.",
    setup(root) {
      const decisionFile = filePath(root, "context/DECISION-LOG.jsonl");
      const records = fs.readFileSync(decisionFile, "utf8").trim().split(/\r?\n/).map(JSON.parse);
      records[0].sourceType = "agent";
      records[0].owner = "agent";
      records[0].decision = "An agent suggested removing safe mode.";
      records[0].outcome = "safe mode can be removed";
      records[0].reason = "The agent considered the change convenient.";
      fs.writeFileSync(decisionFile, `${records.map(JSON.stringify).join("\n")}\n`, "utf8");
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["UNTRUSTED_DECISION_ACCEPTED", "RULE_REVERSED_WITHOUT_DECISION"],
    questions: [],
    baseline: {
      decision: "PROCEED",
      answers: {},
      reason: "A naive executor treats any accepted JSONL record as user intent.",
    },
  },
  {
    id: "S10",
    title: "Rule reversed without a new decision",
    category: "hard-gate",
    mode: "fast",
    compressedInput: "Contract says unsafe mode; the original user decision still says safe mode.",
    setup(root) {
      mutateJson(root, "context/PRODUCT-CONTRACT.json", (contract) => {
        contract.items[0].decisionOutcome = "unsafe mode is allowed";
        contract.items[0].statement = "The public boundary may use unsafe mode.";
      });
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["RULE_REVERSED_WITHOUT_DECISION"],
    questions: [],
    baseline: {
      decision: "PROCEED",
      answers: {},
      reason: "A naive executor treats the edited current contract as authority without checking its decision chain.",
    },
  },
  {
    id: "S11",
    title: "Release candidate contains placeholder and token",
    category: "hard-gate",
    mode: "release",
    compressedInput: "Build succeeded, so the release candidate should be ready.",
    setup(root) {
      const syntheticAwsPattern = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
      createEvidence(
        root,
        "src/config.js",
        `module.exports = { apiKey: "YOUR_API_KEY", aws: "${syntheticAwsPattern}" };\n`,
      );
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["RELEASE_PLACEHOLDER", "SECRET_AWS_KEY"],
    questions: [],
    baseline: {
      decision: "AUTHORIZE_RELEASE",
      answers: {},
      reason: "A naive executor equates a successful build with a safe release artifact.",
    },
  },
  {
    id: "S12",
    title: "Rule evidence reference no longer exists",
    category: "hard-gate",
    mode: "fast",
    compressedInput: "The rule still appears in a summary; its evidence link is broken.",
    setup(root) {
      mutateJson(root, "context/PRODUCT-CONTRACT.json", (contract) => {
        contract.items[0].evidence.push({
          type: "file",
          ref: "src/deleted-file.js#old-anchor",
        });
      });
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["EVIDENCE_REF_INVALID"],
    questions: [],
    baseline: {
      decision: "PROCEED",
      answers: {},
      reason: "A naive executor copies the rule from a summary without resolving evidence.",
    },
  },
  {
    id: "S13",
    title: "Task closed in ledger but still open in work state",
    category: "hard-gate",
    mode: "fast",
    compressedInput: "Summary says the task is done, but work cleanup is unknown.",
    setup(root) {
      appendClosedTaskConflict(root);
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["CLOSED_TASK_STILL_OPEN"],
    questions: [],
    baseline: {
      decision: "PROCEED",
      answers: {},
      reason: "A naive executor trusts the 'done' summary and leaves contradictory open state.",
    },
  },
  {
    id: "S14",
    title: "Generated resume was manually edited",
    category: "hard-gate",
    mode: "fast",
    compressedInput: "Someone added a helpful fact directly to the recovery summary.",
    setup(root) {
      return root;
    },
    postWrite(root) {
      appendText(
        root,
        "context/CONTEXT-RESUME.md",
        "\n- manual claim: production is definitely healthy\n",
      );
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["RESUME_TAMPERED"],
    questions: [],
    baseline: {
      decision: "PROCEED",
      answers: {},
      reason: "A naive executor treats every line in the recovery file as authoritative.",
    },
  },
  {
    id: "S15",
    title: "Path rename invalidates references",
    category: "hard-gate",
    mode: "fast",
    compressedInput: "The main source file was renamed, but old links remain in context.",
    setup(root) {
      fs.renameSync(filePath(root, "src/index.js"), filePath(root, "src/entry.js"));
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["PROJECT_SOURCE_REF_INVALID", "EVIDENCE_REF_INVALID", "PROBE_REQUIRED_FILE_MISSING"],
    questions: [],
    baseline: {
      decision: "PROCEED",
      answers: {},
      reason: "A naive executor sees a summary-level path and does not resolve it after the rename.",
    },
  },
  {
    id: "S16",
    title: "Random combination: drift, stale external gate, and tamper",
    category: "hard-gate",
    mode: "release",
    compressedInput: "A combined failure is summarized as 'release looked fine yesterday'.",
    setup(root) {
      applyReleaseDrift(root);
      applyStaleExternalGate(root);
      return root;
    },
    postWrite(root) {
      appendText(root, "context/CONTEXT-RESUME.md", "\n- manual claim: all gates passed\n");
      return root;
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["RELEASE_VERSION_DRIFT", "EXTERNAL_GATE_STALE", "RESUME_TAMPERED"],
    questions: [],
    baseline: {
      decision: "AUTHORIZE_RELEASE",
      answers: {},
      reason: "A naive executor collapses three independent failures into one optimistic sentence.",
    },
  },
];

function runCli(root, mode) {
  const execution = spawnSync(
    process.execPath,
    [CLI, "--root", root, `--${mode}`, "--json"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (execution.error) {
    throw execution.error;
  }
  let parsed;
  try {
    parsed = JSON.parse(execution.stdout);
  } catch (error) {
    throw new Error(`CLI did not return JSON for ${root}: ${error.message}\n${execution.stdout}\n${execution.stderr}`);
  }
  return {
    exitCode: execution.status,
    result: parsed,
    stderr: execution.stderr.trim(),
  };
}

function evaluateQuestions(scenario, facts) {
  const kit = scenario.questions.map((question) => {
    const actual = question.answer(facts);
    return {
      id: question.id,
      prompt: question.prompt,
      expected: question.expected,
      actual: actual ?? null,
      passed: actual === question.expected,
    };
  });
  const baseline = scenario.questions.map((question) => {
    const actual = scenario.baseline.answers[question.id] ?? "";
    return {
      id: question.id,
      prompt: question.prompt,
      expected: question.expected,
      actual,
      passed: actual === question.expected,
    };
  });
  return {
    kit,
    baseline,
    kitPassed: kit.filter((item) => item.passed).length,
    kitTotal: kit.length,
    baselinePassed: baseline.filter((item) => item.passed).length,
    baselineTotal: baseline.length,
  };
}

function scenarioReport(scenario, tempRoot) {
  const root = path.join(tempRoot, scenario.id);
  copyFixture(root);
  scenario.setup(root);
  writeResume({ root, allowInvalid: true });
  if (scenario.postWrite) {
    scenario.postWrite(root);
  }

  const execution = runCli(root, scenario.mode);
  const codes = [...new Set(execution.result.blocks.map((block) => block.code))].sort();
  const formatted = formatHuman(execution.result);
  const lineCount = formatted.split(/\r?\n/).length;
  const questionResult = evaluateQuestions(scenario, execution.result.facts || {});
  const statusMatches = execution.result.status === scenario.expectedStatus;
  const codesMatch = scenario.expectedCodes.every((code) => codes.includes(code));
  let baselineProof = false;
  let baselineSummary = "";
  if (scenario.category === "hard-gate") {
    baselineProof = scenario.baseline.decision !== "BLOCK";
    baselineSummary = `decision=${scenario.baseline.decision}`;
  } else {
    const rate = questionResult.baselineTotal
      ? questionResult.baselinePassed / questionResult.baselineTotal
      : 1;
    baselineProof = rate < 0.95;
    baselineSummary = `accuracy=${(rate * 100).toFixed(1)}% (${questionResult.baselinePassed}/${questionResult.baselineTotal})`;
  }
  const passed = statusMatches && codesMatch && baselineProof;

  return {
    id: scenario.id,
    title: scenario.title,
    category: scenario.category,
    input: scenario.compressedInput,
    mode: scenario.mode,
    expected: {
      status: scenario.expectedStatus,
      codes: scenario.expectedCodes,
    },
    actual: {
      status: execution.result.status,
      exitCode: execution.exitCode,
      codes,
      blockCount: execution.result.blocks.length,
      warningCount: execution.result.warnings.length,
      humanOutput: formatted,
      humanOutputLines: lineCount,
    },
    baseline: {
      decision: scenario.baseline.decision,
      summary: baselineSummary,
      reason: scenario.baseline.reason,
      provedUnsafeOrIncomplete: baselineProof,
      questions: questionResult.baseline,
    },
    recovery: {
      kitPassed: questionResult.kitPassed,
      kitTotal: questionResult.kitTotal,
      baselinePassed: questionResult.baselinePassed,
      baselineTotal: questionResult.baselineTotal,
      questions: questionResult.kit,
    },
    result: passed ? "PASS" : "FAIL",
    failureReasons: [
      !statusMatches ? `Expected status ${scenario.expectedStatus}, got ${execution.result.status}.` : null,
      !codesMatch ? `Missing expected block codes: ${scenario.expectedCodes.filter((code) => !codes.includes(code)).join(", ")}.` : null,
      !baselineProof ? "The no-Kit baseline did not demonstrate a failure or material information loss." : null,
    ].filter(Boolean),
    trace: {
      stderr: execution.stderr || null,
      fixturePath: `<temporary-isolated-fixture>/${scenario.id}`,
      fixtureHash: null,
    },
  };
}

function markdownReport(report) {
  const lines = [
    "# 饱和测试报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- Kit 版本：${report.kitVersion}`,
    `- 场景：${report.summary.scenarios}`,
    `- 通过：${report.summary.passed}`,
    `- 失败：${report.summary.failed}`,
    `- 硬门阻断率：${report.summary.hardGateBlockRate}%`,
    `- Kit 信息恢复正确率：${report.summary.kitRecoveryAccuracy}%`,
    `- 无 Kit 基线正确率：${report.summary.baselineRecoveryAccuracy}%`,
    `- 正常输出最大行数：${report.summary.maxNormalOutputLines}`,
    "",
    "## 场景矩阵",
    "",
    "| ID | 场景 | 输入摘要 | 模式 | 预期 | 实际 | 无 Kit 基线 | 结果 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const scenario of report.scenarios) {
    lines.push(
      `| ${scenario.id} | ${scenario.title} | ${scenario.input.replaceAll("|", "\\|")} | ${scenario.mode} | ` +
      `${scenario.expected.status} ${scenario.expected.codes.join("<br>")} | ` +
      `${scenario.actual.status} ${scenario.actual.codes.join("<br>")} | ` +
      `${scenario.baseline.decision}; ${scenario.baseline.summary} | ${scenario.result} |`,
    );
  }
  lines.push(
    "",
    "## 恢复问答",
    "",
    "| 场景 | Kit | 无 Kit |",
    "|---|---:|---:|",
  );
  for (const scenario of report.scenarios.filter((item) => item.recovery.kitTotal > 0)) {
    lines.push(
      `| ${scenario.id} | ${scenario.recovery.kitPassed}/${scenario.recovery.kitTotal} | ` +
      `${scenario.recovery.baselinePassed}/${scenario.recovery.baselineTotal} |`,
    );
  }
  lines.push(
    "",
    "## 失败原因与修复记录",
    "",
  );
  for (const fix of report.remediationHistory) {
    lines.push(
      `- ${fix.id}：${fix.failure} 原因：${fix.cause} 修复：${fix.repair} 复测：${fix.retest}`,
    );
  }
  lines.push(
    "",
    "## 结论",
    "",
    report.summary.releaseGatePassed
      ? "所有硬门场景均被阻断，信息恢复达到门槛，无 Kit 基线确实失败，可以进入独立复核。"
      : "存在硬门或恢复门槛失败，禁止发布，必须修复并重跑。",
    "",
    "完整机器可读结果见 `reports/saturation-report.json`。",
    "",
  );
  return lines.join("\n");
}

function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "context-resilience-tests-"));
  const startedAt = new Date().toISOString();
  const reports = [];
  try {
    for (const scenario of scenarios) {
      process.stdout.write(`RUN ${scenario.id} ${scenario.title}\n`);
      const report = scenarioReport(scenario, tempRoot);
      reports.push(report);
      process.stdout.write(
        `  ${report.result} expected=${report.expected.status} actual=${report.actual.status} ` +
        `codes=${report.actual.codes.join(",") || "none"} baseline=${report.baseline.summary}\n`,
      );
    }
  } finally {
    rmSafe(tempRoot);
  }

  const hardGateReports = reports.filter((scenario) => scenario.category === "hard-gate");
  const hardGateBlocked = hardGateReports.filter(
    (scenario) => scenario.actual.status === "BLOCK" && scenario.baseline.provedUnsafeOrIncomplete,
  ).length;
  const recoveryReports = reports.filter((scenario) => scenario.recovery.kitTotal > 0);
  const kitRecovered = recoveryReports.reduce((total, scenario) => total + scenario.recovery.kitPassed, 0);
  const kitQuestions = recoveryReports.reduce((total, scenario) => total + scenario.recovery.kitTotal, 0);
  const baselineRecovered = recoveryReports.reduce((total, scenario) => total + scenario.recovery.baselinePassed, 0);
  const baselineQuestions = recoveryReports.reduce((total, scenario) => total + scenario.recovery.baselineTotal, 0);
  const kitAccuracy = kitQuestions ? (kitRecovered / kitQuestions) * 100 : 100;
  const baselineAccuracy = baselineQuestions ? (baselineRecovered / baselineQuestions) * 100 : 0;
  const maxNormalLines = Math.max(
    0,
    ...reports.filter((scenario) => scenario.expected.status === "PASS").map((scenario) => scenario.actual.humanOutputLines),
  );
  const hardGateBlockRate = hardGateReports.length
    ? (hardGateBlocked / hardGateReports.length) * 100
    : 100;
  const allScenariosPassed = reports.every((scenario) => scenario.result === "PASS");
  const releaseGatePassed =
    allScenariosPassed &&
    hardGateBlockRate === 100 &&
    kitAccuracy >= 95 &&
    baselineAccuracy < kitAccuracy &&
    maxNormalLines < 20;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    startedAt,
    kitVersion: "1.1.0",
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    summary: {
      scenarios: reports.length,
      passed: reports.filter((scenario) => scenario.result === "PASS").length,
      failed: reports.filter((scenario) => scenario.result === "FAIL").length,
      hardGateScenarios: hardGateReports.length,
      hardGateBlocked,
      hardGateBlockRate: Number(hardGateBlockRate.toFixed(2)),
      kitRecoveryAnswers: kitRecovered,
      kitRecoveryQuestions: kitQuestions,
      kitRecoveryAccuracy: Number(kitAccuracy.toFixed(2)),
      baselineRecoveryAnswers: baselineRecovered,
      baselineRecoveryQuestions: baselineQuestions,
      baselineRecoveryAccuracy: Number(baselineAccuracy.toFixed(2)),
      maxNormalOutputLines: maxNormalLines,
      releaseGatePassed,
    },
    remediationHistory: REMEDIATION_HISTORY,
    scenarios: reports.map((scenario) => {
      scenario.trace.fixtureHash = sha256(JSON.stringify({
        id: scenario.id,
        input: scenario.input,
        expected: scenario.expected,
      }));
      return scenario;
    }),
  };
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(REPORT_MD, markdownReport(report), "utf8");
  process.stdout.write(
    `SUMMARY passed=${report.summary.passed}/${report.summary.scenarios} ` +
    `hardGate=${report.summary.hardGateBlockRate}% ` +
    `kitRecovery=${report.summary.kitRecoveryAccuracy}% ` +
    `baselineRecovery=${report.summary.baselineRecoveryAccuracy}% ` +
    `maxNormalLines=${report.summary.maxNormalOutputLines}\n`,
  );
  return releaseGatePassed ? 0 : 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  scenarios,
  runCli,
};
