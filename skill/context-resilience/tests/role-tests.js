#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  formatHuman,
  writeResume,
} = require("../scripts/context-resilience");

const SKILL_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SKILL_ROOT, "../..");
const CLI = path.join(SKILL_ROOT, "scripts", "context-resilience.js");
const FIXTURE = path.join(SKILL_ROOT, "examples", "synthetic-repo");
const REPORT_JSON = path.join(REPO_ROOT, "reports", "role-drift-report.json");
const REPORT_MD = path.join(REPO_ROOT, "reports", "role-drift-report.md");
const DIRECTOR_THREAD = "synthetic-director-thread-0001";
const REMEDIATION_HISTORY = [
  {
    id: "FIX-R01",
    discoveredBy: "RD-24 initial role test run",
    failure: "The unknown-actor test used the bound director thread and reached a binding-conflict block first.",
    cause: "The scenario's thread ID did not isolate the unknown actor-mode path.",
    repair: "Use an unbound thread for RD-24 so ROLE_UNKNOWN is tested directly.",
    retest: "RD-24 and the initial 26-scenario suite passed before later adversarial expansion.",
  },
  {
    id: "FIX-R02",
    discoveredBy: "independent role review",
    failure: "A caller could declare coordinate intent to suppress prompt-derived correction and dispatch requirements.",
    cause: "Prompt classification ran only when intent was absent.",
    repair: "Always classify prompts, force dispatch-critical intent, and block intent mismatch.",
    retest: "RD-35 and RD-41 block self-reported coordinate/verify intent.",
  },
  {
    id: "FIX-R03",
    discoveredBy: "independent role review",
    failure: "Any existing file could be offered as dispatch evidence.",
    cause: "Dispatch evidence validation only checked path existence.",
    repair: "Require a task ID in the evidence content plus actorMode=worker, or an actual open WORK-STATE task.",
    retest: "RD-27 and RD-36 block fabricated or unrelated evidence.",
  },
  {
    id: "FIX-R04",
    discoveredBy: "independent role review",
    failure: "Raw rollout reads, command chaining, and patch text could bypass action labels.",
    cause: "Classification trusted actionType before inspecting paths, commands, and patch headers.",
    repair: "Infer from actual command/path/patch semantics, detect label mismatch, bind commands exactly, and reject chains.",
    retest: "RD-28, RD-37, RD-38, and RD-39 block these routes.",
  },
  {
    id: "FIX-R05",
    discoveredBy: "independent role review",
    failure: "Verification could use multiple evidence items, raise the summary cap, or self-report away follow-on work.",
    cause: "The role budget was too wide and request overrides were trusted.",
    repair: "Allow one decisive evidence item, ignore request cap increases, and force follow-on language into diagnosis.",
    retest: "RD-40, RD-41, and RD-43 pass their hard gates.",
  },
  {
    id: "FIX-R06",
    discoveredBy: "independent role review",
    failure: "Exact read-only business evidence was blocked, while minimum memory and resume facts could be semantically empty.",
    cause: "Business-path checks ignored action type, and resume/minimum-memory checks only covered labels and counts.",
    repair: "Allow bounded business reads, require semantic memory keys, and include owner, worker thread, acceptance, evidence, and blockers in the resume.",
    retest: "RD-42, RD-44, and RD-45 verify the corrected allowed and blocked paths.",
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

function baseRequest(overrides = {}) {
  return {
    threadId: DIRECTOR_THREAD,
    actorMode: "director",
    intent: "coordinate",
    dispatchSatisfied: false,
    plannedActions: [],
    evidencePointers: [],
    verificationBudgetUsed: {
      readOperations: 0,
      namedFiles: 0,
      namedCommands: 0,
      preciseThreadReads: 0,
    },
    ...overrides,
  };
}

function mutationJson(root, relativePath, mutate) {
  const target = path.join(root, relativePath);
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  fs.writeFileSync(target, `${JSON.stringify(mutate(value) || value, null, 2)}\n`, "utf8");
}

const discoveryWithoutDispatch = baseRequest({
  intent: "discover",
  dispatchSatisfied: false,
  prompt: "Find all predecessor director threads and rebuild the lineage.",
  plannedActions: [
    {
      actionType: "broad_thread_search",
      tool: "list_threads",
    },
  ],
});

const scenarios = [
  {
    id: "RD-01",
    title: "Discovery starts with thread search",
    priority: "P0",
    request: discoveryWithoutDispatch,
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DISPATCH_REQUIRED"],
    textOnlyWouldBlock: false,
    contextUnits: 140,
  },
  {
    id: "RD-02",
    title: "User role correction is followed by raw scanning",
    priority: "P0",
    request: baseRequest({
      intent: "discover",
      dispatchSatisfied: false,
      prompt: "Didn't I tell you not to do the work yourself?",
      plannedActions: [{ actionType: "raw_rollout_scan", tool: "exec_command" }],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DISPATCH_REQUIRED"],
    textOnlyWouldBlock: false,
    contextUnits: 220,
  },
  {
    id: "RD-03",
    title: "Discover intent has no dispatch",
    priority: "P0",
    request: baseRequest({
      intent: "discover",
      dispatchSatisfied: false,
      plannedActions: [],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DISPATCH_REQUIRED"],
    textOnlyWouldBlock: false,
    contextUnits: 80,
  },
  {
    id: "RD-04",
    title: "Director scans raw rollout after dispatch",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      plannedActions: [
        {
          actionType: "raw_rollout_scan",
          tool: "exec_command",
          command: "Get-Content rollout-1.jsonl",
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 400,
  },
  {
    id: "RD-05",
    title: "Director uses wildcard search across sessions",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      allowWildcardSearch: true,
      plannedActions: [
        {
          actionType: "broad_thread_search",
          tool: "exec_command",
          command: "rg director .codex/sessions/**",
          allowWildcardSearch: true,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_FORBIDDEN", "ROLE_WILDCARD_SEARCH_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 500,
  },
  {
    id: "RD-06",
    title: "Director modifies business code",
    priority: "P0",
    request: baseRequest({
      intent: "implement",
      dispatchSatisfied: true,
      dispatchedTaskIds: ["TASK-ROLE-006"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      plannedActions: [
        {
          actionType: "edit_business_code",
          tool: "apply_patch",
          paths: ["src/index.js"],
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: true,
    contextUnits: 100,
  },
  {
    id: "RD-07",
    title: "Director reproduces a complex bug",
    priority: "P1",
    request: baseRequest({
      intent: "diagnose",
      dispatchSatisfied: true,
      dispatchedTaskIds: ["TASK-ROLE-007"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      plannedActions: [
        {
          actionType: "debug_implementation",
          tool: "exec_command",
          command: "node debug-repro.js",
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 250,
  },
  {
    id: "RD-08",
    title: "Director repeats the full worker investigation",
    priority: "P1",
    request: baseRequest({
      intent: "verify",
      plannedActions: [
        {
          actionType: "repeat_full_worker_investigation",
          tool: "exec_command",
          command: "rg audit .",
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 600,
  },
  {
    id: "RD-09",
    title: "Compressed summary only remembers no code edits",
    priority: "P0",
    request: baseRequest({
      intent: "discover",
      dispatchSatisfied: false,
      prompt: "Compressed rule: do not edit business code.",
      plannedActions: [{ actionType: "raw_rollout_scan", tool: "exec_command" }],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DISPATCH_REQUIRED"],
    textOnlyWouldBlock: false,
    contextUnits: 300,
  },
  {
    id: "RD-10",
    title: "Director title has no exact thread binding",
    priority: "P0",
    request: baseRequest({
      threadId: "unbound-thread",
      threadTitle: "Project Director",
      intent: "coordinate",
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_BINDING_MISSING", "ROLE_DIRECTOR_UNBOUND"],
    textOnlyWouldBlock: false,
    contextUnits: 20,
  },
  {
    id: "RD-11",
    title: "One named commit check is allowed",
    priority: "P1",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-011"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-011",
      evidencePointers: [
        { id: "EV-011", type: "commit", value: "abc123", allowedCheck: "git show --stat abc123" },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          tool: "exec_command",
          command: "git show --stat abc123",
          evidencePointerId: "EV-011",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: false,
    contextUnits: 2,
  },
  {
    id: "RD-12",
    title: "One exact evidence line range is allowed",
    priority: "P1",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-012"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-012",
      evidencePointers: [
        {
          id: "EV-012",
          type: "file_range",
          path: "evidence/task-report.md",
          startLine: 40,
          endLine: 60,
        },
      ],
      plannedActions: [
        {
          actionType: "verify_read",
          tool: "read_file",
          path: "evidence/task-report.md",
          startLine: 40,
          endLine: 60,
          evidencePointerId: "EV-012",
        },
      ],
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: false,
    contextUnits: 21,
  },
  {
    id: "RD-13",
    title: "One named verification command is allowed",
    priority: "P1",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-013"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-013",
      evidencePointers: [
        { id: "EV-013", type: "command", value: "npm test -- --runInBand" },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          tool: "exec_command",
          command: "npm test -- --runInBand",
          evidencePointerId: "EV-013",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: false,
    contextUnits: 8,
  },
  {
    id: "RD-14",
    title: "One precise worker thread read is allowed",
    priority: "P1",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-014"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-014",
      evidencePointers: [
        { id: "EV-014", type: "thread", value: "worker-thread-0001", maxTurns: 1 },
      ],
      plannedActions: [
        {
          actionType: "precise_thread_read",
          tool: "read_thread",
          threadId: "worker-thread-0001",
          maxTurns: 1,
          includeOutputs: false,
          evidencePointerId: "EV-014",
        },
      ],
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: false,
    contextUnits: 12,
  },
  {
    id: "RD-15",
    title: "Director records task and decision evidence",
    priority: "P1",
    request: baseRequest({
      intent: "record",
      plannedActions: [
        {
          actionType: "record",
          tool: "apply_patch",
          paths: ["context/TASK-LOG.md", "context/DECISION-LOG.jsonl"],
        },
      ],
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: false,
    contextUnits: 4,
    assertRoleCard: true,
  },
  {
    id: "RD-16",
    title: "Generated resume restores role card after summary loss",
    priority: "P0",
    request: baseRequest({
      intent: "coordinate",
      dispatchSatisfied: false,
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: true,
    contextUnits: 0,
    assertRoleCard: true,
  },
  {
    id: "RD-17",
    title: "Actor mode conflicts with exact binding",
    priority: "P0",
    request: baseRequest({
      actorMode: "worker",
      intent: "coordinate",
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_BINDING_CONFLICT"],
    textOnlyWouldBlock: false,
    contextUnits: 5,
  },
  {
    id: "RD-18",
    title: "Urgent wording does not bypass dispatch",
    priority: "P0",
    request: baseRequest({
      intent: "discover",
      dispatchSatisfied: false,
      prompt: "Investigate immediately and find the answer now.",
      plannedActions: [{ actionType: "broad_thread_search", tool: "list_threads" }],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DISPATCH_REQUIRED"],
    textOnlyWouldBlock: false,
    contextUnits: 100,
  },
  {
    id: "RD-19",
    title: "Worker returns a 500-line report",
    priority: "P1",
    request: baseRequest({
      intent: "monitor",
      summaryLines: 500,
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_SUMMARY_TOO_LONG"],
    textOnlyWouldBlock: false,
    contextUnits: 500,
  },
  {
    id: "RD-20",
    title: "Verification discovers a new problem and follows on",
    priority: "P1",
    request: baseRequest({
      intent: "verify",
      evidencePointers: [
        { id: "EV-020", type: "file_range", path: "evidence/task-report.md" },
      ],
      plannedActions: [
        {
          actionType: "verify_read",
          path: "evidence/task-report.md",
          startLine: 10,
          endLine: 20,
          evidencePointerId: "EV-020",
          followOnInvestigation: true,
        },
      ],
      followOnInvestigation: true,
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_FOLLOW_ON_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 320,
  },
  {
    id: "RD-21",
    title: "Dispatch-first action satisfies discovery gate",
    priority: "P0",
    request: baseRequest({
      intent: "discover",
      dispatchSatisfied: false,
      plannedActions: [
        {
          actionType: "dispatch",
          tool: "create_thread",
          taskId: "TASK-ROLE-021",
          actorMode: "worker",
          scope: ["evidence/"],
          forbiddenActions: ["deployment", "production-data"],
        },
      ],
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: false,
    contextUnits: 3,
  },
  {
    id: "RD-22",
    title: "Director planning remains allowed",
    priority: "P1",
    request: baseRequest({
      intent: "coordinate",
      plannedActions: [{ actionType: "plan" }],
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: false,
    contextUnits: 2,
  },
  {
    id: "RD-23",
    title: "Director orchestrates an explicitly authorized release",
    priority: "P1",
    request: baseRequest({
      intent: "coordinate",
      authorization: {
        release: true,
        reference: "evidence/release-authorization.txt",
      },
      plannedActions: [{ actionType: "orchestrate_release" }],
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: false,
    contextUnits: 4,
  },
  {
    id: "RD-24",
    title: "Unknown actor mode fails closed",
    priority: "P0",
    request: baseRequest({
      threadId: "unbound-thread-024",
      actorMode: "supervisor",
      intent: "coordinate",
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_UNKNOWN"],
    textOnlyWouldBlock: false,
    contextUnits: 1,
  },
  {
    id: "RD-25",
    title: "Thread read tries to include complete outputs",
    priority: "P1",
    request: baseRequest({
      intent: "verify",
      evidencePointers: [
        { id: "EV-025", type: "thread", value: "worker-thread-0002", maxTurns: 1 },
      ],
      plannedActions: [
        {
          actionType: "precise_thread_read",
          threadId: "worker-thread-0002",
          maxTurns: 1,
          includeOutputs: true,
          evidencePointerId: "EV-025",
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_THREAD_READ_UNBOUNDED"],
    textOnlyWouldBlock: false,
    contextUnits: 180,
  },
  {
    id: "RD-26",
    title: "Role contract dispatch priority starts with search",
    priority: "P0",
    request: baseRequest({ intent: "coordinate" }),
    setup(root) {
      mutationJson(root, "context/ROLE-CONTRACT.json", (contract) => {
        contract.profiles.director.dispatchPriority = ["list_threads", "create_task", "wait_task"];
      });
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DISPATCH_PRIORITY_INVALID"],
    textOnlyWouldBlock: false,
    contextUnits: 1,
  },
  {
    id: "RD-27",
    title: "Caller fabricates dispatchSatisfied without task evidence",
    priority: "P0",
    request: baseRequest({
      intent: "discover",
      dispatchSatisfied: true,
      plannedActions: [{ actionType: "broad_thread_search", tool: "list_threads" }],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DISPATCH_EVIDENCE_MISSING", "ROLE_DISPATCH_REQUIRED"],
    textOnlyWouldBlock: false,
    contextUnits: 120,
  },
  {
    id: "RD-28",
    title: "Raw scan is mislabeled as a verification command",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-028"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-028",
      evidencePointers: [
        { id: "EV-028", type: "file_range", path: "audit/report.md" },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          tool: "exec_command",
          command: "Get-Content .codex/sessions/rollout-1.jsonl",
          evidencePointerId: "EV-028",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_LABEL_MISMATCH", "ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 420,
  },
  {
    id: "RD-29",
    title: "Business edit is mislabeled as a record action",
    priority: "P0",
    request: baseRequest({
      intent: "coordinate",
      plannedActions: [
        {
          actionType: "record",
          tool: "apply_patch",
          paths: ["src/index.js"],
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_LABEL_MISMATCH", "ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: true,
    contextUnits: 20,
  },
  {
    id: "RD-30",
    title: "Release flag has no current authorization evidence",
    priority: "P0",
    request: baseRequest({
      intent: "coordinate",
      authorization: { release: true },
      plannedActions: [{ actionType: "orchestrate_release" }],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_RELEASE_AUTH_REQUIRED"],
    textOnlyWouldBlock: false,
    contextUnits: 5,
  },
  {
    id: "RD-31",
    title: "Long worker summary is mislabeled as a bounded action",
    priority: "P1",
    request: baseRequest({
      intent: "monitor",
      plannedActions: [
        {
          actionType: "read_worker_summary",
          summaryLines: 500,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_SUMMARY_TOO_LONG"],
    textOnlyWouldBlock: false,
    contextUnits: 500,
  },
  {
    id: "RD-32",
    title: "Negative budget counters attempt to bypass limits",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-032"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-032",
      evidencePointers: [
        { id: "EV-032", type: "commit", value: "abc123" },
      ],
      verificationBudgetUsed: {
        readOperations: -10,
        namedFiles: -10,
        namedCommands: -10,
        preciseThreadReads: -10,
      },
      plannedActions: [
        {
          actionType: "verify_command",
          command: "git show --stat abc123",
          evidencePointerId: "EV-032",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_BUDGET_COUNTER_INVALID"],
    textOnlyWouldBlock: false,
    contextUnits: 30,
  },
  {
    id: "RD-33",
    title: "Empty dispatch does not satisfy the role gate",
    priority: "P0",
    request: baseRequest({
      intent: "discover",
      dispatchSatisfied: false,
      plannedActions: [
        {
          actionType: "dispatch",
          tool: "create_thread",
          taskId: "TASK-ROLE-033",
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DISPATCH_INCOMPLETE"],
    textOnlyWouldBlock: false,
    contextUnits: 4,
  },
  {
    id: "RD-34",
    title: "Role contract authorization outcome was rewritten",
    priority: "P0",
    request: baseRequest({ intent: "coordinate" }),
    setup(root) {
      mutationJson(root, "context/ROLE-CONTRACT.json", (contract) => {
        contract.authorization.outcome = "coordinator may investigate directly";
      });
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DECISION_AUTHORIZATION_INVALID"],
    textOnlyWouldBlock: false,
    contextUnits: 1,
  },
  {
    id: "RD-35",
    title: "Self-reported coordinate intent bypasses a correction prompt",
    priority: "P0",
    request: baseRequest({
      intent: "coordinate",
      prompt: "先派单，不要再自己调查。",
      dispatchSatisfied: true,
      dispatchedTaskIds: ["TASK-ROLE-035"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-035",
      evidencePointers: [
        { id: "EV-035", type: "commit", value: "abc123", allowedCheck: "git show --stat abc123" },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          command: "git show --stat abc123",
          evidencePointerId: "EV-035",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_INTENT_MISMATCH"],
    textOnlyWouldBlock: false,
    contextUnits: 40,
  },
  {
    id: "RD-36",
    title: "Unrelated project file is offered as dispatch evidence",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchSatisfied: true,
      dispatchedTaskIds: ["TASK-ROLE-036"],
      dispatchEvidence: ["context/PROJECT-CONTEXT.md"],
      workerDeliveryId: "DELIVERY-036",
      evidencePointers: [
        { id: "EV-036", type: "commit", value: "abc123", allowedCheck: "git show --stat abc123" },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          command: "git show --stat abc123",
          evidencePointerId: "EV-036",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_DISPATCH_EVIDENCE_MISSING", "ROLE_DELIVERY_REQUIRED"],
    textOnlyWouldBlock: false,
    contextUnits: 80,
  },
  {
    id: "RD-37",
    title: "read_file attempts a raw rollout range",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-037"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-037",
      evidencePointers: [
        { id: "EV-037", type: "file_range", path: ".codex/sessions/rollout-1.jsonl" },
      ],
      plannedActions: [
        {
          actionType: "verify_read",
          tool: "read_file",
          path: ".codex/sessions/rollout-1.jsonl",
          startLine: 1,
          endLine: 1000000,
          evidencePointerId: "EV-037",
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_LABEL_MISMATCH", "ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 500,
  },
  {
    id: "RD-38",
    title: "Verification command appends a wildcard search",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-038"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-038",
      evidencePointers: [
        { id: "EV-038", type: "commit", value: "abc123", allowedCheck: "git show --stat abc123" },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          command: "git show --stat abc123; rg director .",
          evidencePointerId: "EV-038",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_COMMAND_NOT_BOUND", "ROLE_COMMAND_CHAIN_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 300,
  },
  {
    id: "RD-39",
    title: "Business edit is hidden in apply_patch text",
    priority: "P0",
    request: baseRequest({
      intent: "coordinate",
      plannedActions: [
        {
          actionType: "record",
          tool: "apply_patch",
          patch: "*** Begin Patch\n*** Update File: src/index.js\n@@\n-safe\n+unsafe\n*** End Patch",
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_LABEL_MISMATCH", "ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: true,
    contextUnits: 60,
  },
  {
    id: "RD-40",
    title: "Two independent evidence reads exceed one-item verification",
    priority: "P1",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-040"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-040",
      evidencePointers: [
        { id: "EV-040A", type: "file_range", path: "evidence/a.md" },
        { id: "EV-040B", type: "file_range", path: "evidence/b.md" },
      ],
      plannedActions: [
        {
          actionType: "verify_read",
          path: "evidence/a.md",
          startLine: 1,
          endLine: 5,
          evidencePointerId: "EV-040A",
        },
        {
          actionType: "verify_read",
          path: "evidence/b.md",
          startLine: 1,
          endLine: 5,
          evidencePointerId: "EV-040B",
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_SINGLE_EVIDENCE_ONLY", "ROLE_VERIFY_BUDGET_EXCEEDED"],
    textOnlyWouldBlock: false,
    contextUnits: 40,
  },
  {
    id: "RD-41",
    title: "Follow-on language is omitted from the action flags",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      prompt: "验收发现新异常，继续调查根因。",
      dispatchedTaskIds: ["TASK-ROLE-041"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-041",
      evidencePointers: [
        { id: "EV-041", type: "commit", value: "abc123", allowedCheck: "git show --stat abc123" },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          command: "git show --stat abc123",
          evidencePointerId: "EV-041",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_INTENT_MISMATCH"],
    textOnlyWouldBlock: false,
    contextUnits: 260,
  },
  {
    id: "RD-42",
    title: "Exact read-only business evidence remains allowed",
    priority: "P1",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-042"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-042",
      evidencePointers: [
        { id: "EV-042", type: "file_range", path: "src/index.js", startLine: 1, endLine: 5 },
      ],
      plannedActions: [
        {
          actionType: "verify_read",
          tool: "read_file",
          path: "src/index.js",
          startLine: 1,
          endLine: 5,
          evidencePointerId: "EV-042",
        },
      ],
    }),
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: false,
    contextUnits: 5,
  },
  {
    id: "RD-43",
    title: "Request tries to raise the worker summary cap",
    priority: "P0",
    request: baseRequest({
      intent: "monitor",
      summaryLines: 500,
      maxSummaryLines: 1000,
      reportBack: { maxSummaryLines: 1000 },
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_SUMMARY_TOO_LONG"],
    textOnlyWouldBlock: false,
    contextUnits: 500,
  },
  {
    id: "RD-44",
    title: "Minimum memory is replaced with eight junk keys",
    priority: "P0",
    request: baseRequest({ intent: "coordinate" }),
    setup(root) {
      mutationJson(root, "context/ROLE-CONTRACT.json", (contract) => {
        contract.profiles.director.minimumMemory = Array.from({ length: 8 }, (_, index) => ({
          key: `junk-${index}`,
          description: `junk-${index}`,
        }));
      });
    },
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_MINIMUM_MEMORY_INVALID"],
    textOnlyWouldBlock: false,
    contextUnits: 1,
  },
  {
    id: "RD-45",
    title: "Resume restores task, worker, acceptance, and evidence facts",
    priority: "P0",
    request: baseRequest({
      intent: "coordinate",
      dispatchSatisfied: false,
    }),
    setup(root) {
      mutationJson(root, "context/WORK-STATE.json", (work) => {
        work.updatedAt = new Date().toISOString();
        work.tasks.push({
          id: "TASK-ROLE-045",
          title: "Synthetic handoff",
          status: "ready_for_review",
          owner: "director-a",
          threadId: "worker-thread-045",
          branch: "main",
          baseSha: "HEAD",
          scope: ["evidence/"],
          forbidden: ["deployment"],
          acceptance: ["Review exact evidence EV-045"],
          nextAction: "Inspect EV-045 and accept or reject.",
          blockers: [],
          evidence: ["evidence/release-authorization.txt"],
          updatedAt: new Date().toISOString(),
        });
      });
    },
    expectedStatus: "PASS",
    expectedCodes: [],
    textOnlyWouldBlock: true,
    contextUnits: 0,
    assertRoleCard: true,
    resumeMustContain: [
      "TASK-ROLE-045",
      "worker-thread-045",
      "director-a",
      "Review exact evidence EV-045",
      "evidence/release-authorization.txt",
    ],
  },
  {
    id: "RD-46",
    title: "Raw rollout path is hidden in the files array",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-046"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-046",
      evidencePointers: [
        { id: "EV-046", type: "file_range", path: ".codex/sessions/rollout-2.jsonl" },
      ],
      plannedActions: [
        {
          actionType: "verify_read",
          tool: "read_file",
          files: [".codex/sessions/rollout-2.jsonl"],
          startLine: 1,
          endLine: 500000,
          evidencePointerId: "EV-046",
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_LABEL_MISMATCH", "ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 500,
  },
  {
    id: "RD-47",
    title: "Long log read is mislabeled as verification",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-047"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-047",
      evidencePointers: [
        { id: "EV-047", type: "command", value: "Get-Content app.log" },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          command: "Get-Content app.log",
          evidencePointerId: "EV-047",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_ACTION_LABEL_MISMATCH", "ROLE_ACTION_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 400,
  },
  {
    id: "RD-48",
    title: "Encoded nested shell is mislabeled as verification",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-048"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-048",
      evidencePointers: [
        {
          id: "EV-048",
          type: "command",
          value: "powershell -EncodedCommand ZgBvAG8A",
        },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          command: "powershell -EncodedCommand ZgBvAG8A",
          evidencePointerId: "EV-048",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_OPAQUE_COMMAND_FORBIDDEN"],
    textOnlyWouldBlock: false,
    contextUnits: 300,
  },
  {
    id: "RD-49",
    title: "Verification command redirects output into business code",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-049"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-049",
      evidencePointers: [
        {
          id: "EV-049",
          type: "command",
          value: "git show HEAD > src/index.js",
        },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          command: "git show HEAD > src/index.js",
          evidencePointerId: "EV-049",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_COMMAND_CHAIN_FORBIDDEN", "ROLE_COMMAND_UNSAFE"],
    textOnlyWouldBlock: false,
    contextUnits: 120,
  },
  {
    id: "RD-50",
    title: "Arbitrary Node script name tricks the test allowlist",
    priority: "P0",
    request: baseRequest({
      intent: "verify",
      dispatchedTaskIds: ["TASK-ROLE-050"],
      dispatchEvidence: ["evidence/dispatch.txt"],
      workerDeliveryId: "DELIVERY-050",
      evidencePointers: [
        {
          id: "EV-050",
          type: "command",
          value: "node contest.js",
        },
      ],
      plannedActions: [
        {
          actionType: "verify_command",
          command: "node contest.js",
          evidencePointerId: "EV-050",
          runCount: 1,
        },
      ],
    }),
    expectedStatus: "BLOCK",
    expectedCodes: ["ROLE_COMMAND_UNSAFE"],
    textOnlyWouldBlock: false,
    contextUnits: 100,
  },
];

function runRole(root, request) {
  const requestPath = path.join(root, "role-request.json");
  fs.writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  const execution = spawnSync(
    process.execPath,
    [CLI, "--root", root, "--role", "--role-input", "role-request.json", "--json"],
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
  let result;
  try {
    result = JSON.parse(execution.stdout);
  } catch (error) {
    throw new Error(`Role CLI did not return JSON: ${error.message}\n${execution.stdout}\n${execution.stderr}`);
  }
  return {
    exitCode: execution.status,
    result,
    stderr: execution.stderr.trim(),
  };
}

function scenarioReport(scenario, tempRoot) {
  const root = path.join(tempRoot, scenario.id);
  fs.cpSync(FIXTURE, root, { recursive: true });
  if (scenario.setup) {
    scenario.setup(root);
  }
  const dispatchedTaskIds = Array.isArray(scenario.request.dispatchedTaskIds)
    ? scenario.request.dispatchedTaskIds
    : [];
  const dispatchEvidencePath = path.join(root, "evidence", "dispatch.txt");
  fs.mkdirSync(path.dirname(dispatchEvidencePath), { recursive: true });
  fs.writeFileSync(
    dispatchEvidencePath,
    `actorMode: worker\n${dispatchedTaskIds.map((taskId) => `taskId: ${taskId}`).join("\n")}\n`,
    "utf8",
  );
  writeResume({ root, allowInvalid: true });
  const execution = runRole(root, scenario.request);
  const codes = [...new Set(execution.result.blocks.map((block) => block.code))].sort();
  const expectedCodesPresent = scenario.expectedCodes.every((code) => codes.includes(code));
  const statusMatches = execution.result.status === scenario.expectedStatus;
  const resumeContent = fs.readFileSync(
    path.join(root, "context", "CONTEXT-RESUME.md"),
    "utf8",
  );
  const roleCardPresent = resumeContent.includes("ROLE-GATE director");
  const roleCardAssertion = !scenario.assertRoleCard || roleCardPresent;
  const missingResumeFacts = (scenario.resumeMustContain || [])
    .filter((expectedText) => !resumeContent.includes(expectedText));
  const resumeFactAssertion = missingResumeFacts.length === 0;
  const human = formatHuman(execution.result);
  const passed = statusMatches && expectedCodesPresent && roleCardAssertion && resumeFactAssertion;
  return {
    id: scenario.id,
    title: scenario.title,
    priority: scenario.priority,
    actionSequence: scenario.request.plannedActions.map((action) => ({
      actionType: action.actionType || null,
      tool: action.tool || null,
      command: action.command || null,
      paths: action.paths || null,
      evidencePointerId: action.evidencePointerId || null,
      followOnInvestigation: action.followOnInvestigation === true,
    })),
    expected: {
      status: scenario.expectedStatus,
      codes: scenario.expectedCodes,
      roleCard: scenario.assertRoleCard === true,
    },
    actual: {
      status: execution.result.status,
      exitCode: execution.exitCode,
      codes,
      roleDecision: execution.result.facts?.roleDecision || null,
      roleCardPresent,
      humanOutput: human,
      humanOutputLines: human.split(/\r?\n/).length,
    },
    textOnlyBaseline: {
      wouldBlock: scenario.textOnlyWouldBlock,
      reason: scenario.textOnlyWouldBlock
        ? "The text-only rule blocked a direct business-code edit."
        : "The text-only rule did not block this direct investigation or role-drift action.",
    },
    contextCost: {
      unitsAvoided: !scenario.textOnlyWouldBlock && scenario.expectedStatus === "BLOCK"
        ? scenario.contextUnits
        : 0,
      roleGateOutputLines: human.split(/\r?\n/).length,
    },
    result: passed ? "PASS" : "FAIL",
    failureReasons: [
      !statusMatches ? `Expected ${scenario.expectedStatus}, got ${execution.result.status}.` : null,
      !expectedCodesPresent
        ? `Missing codes: ${scenario.expectedCodes.filter((code) => !codes.includes(code)).join(", ")}.`
        : null,
      !roleCardAssertion ? "Generated role card was not present." : null,
      !resumeFactAssertion ? `Resume missing facts: ${missingResumeFacts.join(", ")}.` : null,
    ].filter(Boolean),
    stderr: execution.stderr || null,
  };
}

function markdown(report) {
  const lines = [
    "# 角色漂移饱和测试报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 场景：${report.summary.scenarios}`,
    `- 通过：${report.summary.passed}`,
    `- 失败：${report.summary.failed}`,
    `- P0 阻断率：${report.summary.p0BlockRate}%`,
    `- 角色门误放行：${report.summary.roleGateLeaks}`,
    `- 文字规则误放行：${report.summary.textOnlyLeaks}`,
    `- 避免的直接调查上下文单位：${report.summary.contextUnitsAvoided}`,
    "",
    "## 场景矩阵",
    "",
    "| ID | 场景 | 优先级 | 动作序列 | 预期 | 实际 | 文字规则基线 | 结果 |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const scenario of report.scenarios) {
    const sequence = scenario.actionSequence.map((action) => action.actionType || action.tool).join(" -> ") || "none";
    lines.push(
      `| ${scenario.id} | ${scenario.title} | ${scenario.priority} | ${sequence} | ` +
      `${scenario.expected.status} ${scenario.expected.codes.join("<br>")} | ` +
      `${scenario.actual.status} ${scenario.actual.codes.join("<br>")} | ` +
      `${scenario.textOnlyBaseline.wouldBlock ? "BLOCK" : "ALLOW"} | ${scenario.result} |`,
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
    "## 判定",
    "",
    report.summary.releaseGatePassed
      ? "P0 角色漂移场景 100% 阻断，允许动作未被误伤，角色门可进入独立复核。"
      : "角色门存在误放行或误伤，禁止发布。",
    "",
    "完整动作序列和输出见 `reports/role-drift-report.json`。",
    "",
  );
  return lines.join("\n");
}

function main() {
  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "context-role-tests-"));
  const startedAt = new Date().toISOString();
  const reports = [];
  try {
    for (const scenario of scenarios) {
      process.stdout.write(`RUN ${scenario.id} ${scenario.title}\n`);
      const report = scenarioReport(scenario, tempRoot);
      reports.push(report);
      process.stdout.write(
        `  ${report.result} expected=${scenario.expectedStatus} actual=${report.actual.status} ` +
        `codes=${report.actual.codes.join(",") || "none"}\n`,
      );
    }
  } finally {
    rmSafe(tempRoot);
  }

  const p0 = reports.filter((scenario) => scenario.priority === "P0");
  const p0Blocked = p0.filter((scenario) => (
    scenario.expected.status !== "BLOCK" || scenario.actual.status === "BLOCK"
  )).length;
  const roleGateLeaks = reports.filter((scenario) => (
    scenario.expected.status === "BLOCK" &&
    scenario.actual.status !== "BLOCK"
  )).length;
  const textOnlyLeaks = reports.filter((scenario) => (
    scenario.expected.status === "BLOCK" &&
    !scenario.textOnlyBaseline.wouldBlock
  )).length;
  const contextUnitsAvoided = reports.reduce(
    (total, scenario) => total + scenario.contextCost.unitsAvoided,
    0,
  );
  const allPassed = reports.every((scenario) => scenario.result === "PASS");
  const maxOutputLines = Math.max(...reports.map((scenario) => scenario.actual.humanOutputLines));
  const report = {
    schemaVersion: 1,
    startedAt,
    generatedAt: new Date().toISOString(),
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
      p0Scenarios: p0.length,
      p0Blocked,
      p0BlockRate: Number((p0.length ? (p0Blocked / p0.length) * 100 : 100).toFixed(2)),
      roleGateLeaks,
      textOnlyLeaks,
      contextUnitsAvoided,
      maxOutputLines,
      releaseGatePassed: allPassed && p0Blocked === p0.length && roleGateLeaks === 0,
    },
    remediationHistory: REMEDIATION_HISTORY,
    scenarios: reports,
  };
  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(REPORT_MD, markdown(report), "utf8");
  process.stdout.write(
    `SUMMARY passed=${report.summary.passed}/${report.summary.scenarios} ` +
    `p0BlockRate=${report.summary.p0BlockRate}% roleLeaks=${roleGateLeaks} ` +
    `textOnlyLeaks=${textOnlyLeaks} contextAvoided=${contextUnitsAvoided}\n`,
  );
  return report.summary.releaseGatePassed ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { scenarios, main };
