#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const KIT_VERSION = "1.1.0";
const SCHEMA_VERSION = 1;
const ACTIVE_RULE_STATUSES = new Set(["active", "accepted"]);
const TERMINAL_DECISION_STATUSES = new Set(["superseded", "historical", "revoked"]);
const OPEN_TASK_STATUSES = new Set([
  "proposed",
  "active",
  "accepted",
  "ready_for_review",
  "blocked",
  "waiting_external",
  "unverified",
]);
const TRUSTED_DECISION_SOURCES = new Set([
  "user",
  "director",
  "external",
  "technical-constraint",
]);
const MACHINE_PROBE_TYPES = new Set([
  "file_exists",
  "file_regex",
  "file_not_regex",
  "glob_not_matches",
  "json_path_equals",
  "test_marker",
  "git_commit_exists",
  "evidence_sha256",
]);
const ROLE_ACTION_TYPES = new Set([
  "plan",
  "dispatch",
  "monitor",
  "read_worker_summary",
  "verify_read",
  "verify_command",
  "precise_thread_read",
  "record",
  "orchestrate_release",
  "broad_thread_search",
  "raw_rollout_scan",
  "history_reconstruction",
  "open_ended_code_exploration",
  "debug_implementation",
  "edit_business_code",
  "long_log_analysis",
  "repeat_full_worker_investigation",
  "self_assign_unscoped_audit",
]);
const DISPATCH_REQUIRED_INTENTS = new Set(["discover", "diagnose", "implement"]);
const DIRECTOR_FORBIDDEN_ACTIONS = new Set([
  "broad_thread_search",
  "raw_rollout_scan",
  "history_reconstruction",
  "open_ended_code_exploration",
  "debug_implementation",
  "edit_business_code",
  "long_log_analysis",
  "repeat_full_worker_investigation",
  "self_assign_unscoped_audit",
]);
const DIRECTOR_PRE_DISPATCH_ACTIONS = new Set(["plan", "dispatch", "monitor"]);
const VERIFY_ACTION_TYPES = new Set([
  "verify_read",
  "verify_command",
  "precise_thread_read",
]);
const BUSINESS_PATH_PATTERNS = [
  /(^|\/)(?:src|app|server|services|packages|lib)\//i,
  /(^|\/)(?:client|frontend|backend|api)\//i,
  /\.(?:ts|tsx|js|jsx|mjs|cjs|vue|go|rs|java|kt|py|sql|css|scss|html)$/i,
];
const DEFAULT_CONFIG = {
  schemaVersion: 1,
  projectName: "Synthetic Project",
  paths: {
    projectContext: "context/PROJECT-CONTEXT.md",
    productContract: "context/PRODUCT-CONTRACT.json",
    decisionLog: "context/DECISION-LOG.jsonl",
    workState: "context/WORK-STATE.json",
    releaseState: "context/RELEASE-STATE.json",
    roleContract: "context/ROLE-CONTRACT.json",
    taskLog: "context/TASK-LOG.md",
    contextResume: "context/CONTEXT-RESUME.md",
  },
  git: {
    enabled: true,
    requireBaseShaAncestor: true,
  },
  releaseScan: {
    include: ["src/**", "app/**", "packages/**", "services/**"],
    exclude: [
      "**/*.md",
      "**/*.example",
      "**/*.template",
      "**/__tests__/**",
      "**/tests/**",
      "**/test/**",
      "**/fixtures/**",
    ],
    placeholders: [
      "CHANGE_ME",
      "REPLACE_ME",
      "YOUR_API_KEY",
      "TODO_REQUIRED",
      "[CONTACT_REQUIRED]",
    ],
    maxExternalEvidenceAgeHours: 168,
  },
  role: {
    enabled: true,
    allowTitleInference: false,
    maxSummaryLines: 20,
  },
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function toPosix(value) {
  return value.replaceAll("\\", "/");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortSha(value) {
  return typeof value === "string" ? value.slice(0, 12) : "";
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, override) {
  if (!isPlainObject(base)) {
    return override;
  }
  if (!isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = mergeDeep(base[key], value);
  }
  return merged;
}

function loadConfig(root) {
  const configPath = path.join(root, ".context-resilience.json");
  if (!fs.existsSync(configPath)) {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      configPath,
      exists: false,
    };
  }
  return {
    config: mergeDeep(DEFAULT_CONFIG, readJson(configPath)),
    configPath,
    exists: true,
  };
}

function relativeRef(root, filePath) {
  return toPosix(path.relative(root, filePath));
}

function lineNumberAt(content, offset) {
  if (offset < 0) {
    return null;
  }
  return content.slice(0, offset).split(/\r?\n/).length;
}

function globToRegExp(glob) {
  const normalized = toPosix(glob);
  let pattern = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (char === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          pattern += "(?:.*/)?";
        } else {
          pattern += ".*";
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`, "i");
}

function matchesAnyGlob(relativePath, globs) {
  const normalized = toPosix(relativePath);
  return (globs || []).some((glob) => globToRegExp(glob).test(normalized));
}

function walkFiles(root, current = root) {
  if (!fs.existsSync(current)) {
    return [];
  }
  const files = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if ([".git", "node_modules", ".cache", "dist", "build"].includes(entry.name)) {
      continue;
    }
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(root, fullPath));
    } else if (entry.isFile()) {
      files.push(relativeRef(root, fullPath));
    }
  }
  return files.sort();
}

function parseJsonPath(expression) {
  if (!expression || expression === "$") {
    return [];
  }
  const normalized = expression.startsWith("$.") ? expression.slice(2) : expression;
  return normalized
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
}

function valueAtPath(value, expression) {
  return parseJsonPath(expression).reduce(
    (current, key) => (current == null ? undefined : current[key]),
    value,
  );
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function splitRef(ref) {
  if (typeof ref !== "string") {
    return { file: "", anchor: "" };
  }
  const [file, anchor = ""] = ref.split("#", 2);
  return { file, anchor };
}

function isExternalRef(ref) {
  return /^(?:https?:|mailto:|urn:)/i.test(String(ref || ""));
}

function ensureRelativeRef(root, ref) {
  const { file } = splitRef(ref);
  if (!file || isExternalRef(file)) {
    return true;
  }
  const resolved = path.resolve(root, file);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function refExists(root, ref) {
  if (isExternalRef(ref)) {
    return true;
  }
  const { file } = splitRef(ref);
  if (!file || !ensureRelativeRef(root, ref)) {
    return false;
  }
  return fs.existsSync(path.resolve(root, file));
}

function parseYamlFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return null;
  }
  const result = {};
  let currentArray = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    const arrayItem = line.match(/^\s+-\s+(.+)$/);
    if (arrayItem && currentArray) {
      result[currentArray].push(arrayItem[1].trim());
      continue;
    }
    const keyValue = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!keyValue) {
      continue;
    }
    const [, key, rawValue = ""] = keyValue;
    if (!rawValue) {
      result[key] = [];
      currentArray = key;
    } else {
      result[key] = rawValue.trim().replace(/^["']|["']$/g, "");
      currentArray = null;
    }
  }
  return result;
}

function parseTaskMetadata(taskLog) {
  const records = [];
  const pattern = /<!--\s*task-meta\s*([\s\S]*?)-->/g;
  let match;
  while ((match = pattern.exec(taskLog)) !== null) {
    const offset = match.index;
    try {
      records.push({
        value: JSON.parse(match[1].trim()),
        line: lineNumberAt(taskLog, offset),
      });
    } catch (error) {
      records.push({
        parseError: error.message,
        raw: match[1].trim(),
        line: lineNumberAt(taskLog, offset),
      });
    }
  }
  return records;
}

function parseDecisionLog(content) {
  const records = [];
  content.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) {
      return;
    }
    try {
      records.push({ value: JSON.parse(line), line: index + 1 });
    } catch (error) {
      records.push({ parseError: error.message, raw: line, line: index + 1 });
    }
  });
  return records;
}

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

function addUnique(target, item) {
  const key = `${item.code}|${item.path || ""}|${item.line || ""}|${item.ruleId || ""}`;
  if (!target.some((candidate) => `${candidate.code}|${candidate.path || ""}|${candidate.line || ""}|${candidate.ruleId || ""}` === key)) {
    target.push(item);
  }
}

function validateProductContract(contract, result) {
  if (!isPlainObject(contract)) {
    result.blocks.push(issue("SCHEMA_PRODUCT_CONTRACT", "PRODUCT-CONTRACT must be a JSON object."));
    return;
  }
  if (contract.schemaVersion !== SCHEMA_VERSION) {
    result.blocks.push(issue("SCHEMA_VERSION", "PRODUCT-CONTRACT schemaVersion must be 1."));
  }
  if (!Array.isArray(contract.items)) {
    result.blocks.push(issue("SCHEMA_PRODUCT_ITEMS", "PRODUCT-CONTRACT.items must be an array."));
    return;
  }
  const ids = new Set();
  for (const [index, item] of contract.items.entries()) {
    const location = `items[${index}]`;
    for (const key of [
      "id",
      "title",
      "class",
      "status",
      "authority",
      "statement",
      "decisionId",
      "decisionOutcome",
      "owner",
      "verifiedAt",
      "verifiedBy",
      "evidence",
      "probes",
    ]) {
      if (item?.[key] === undefined || item?.[key] === null || item?.[key] === "") {
        result.blocks.push(issue("SCHEMA_RULE_FIELD", `${location}.${key} is required.`));
      }
    }
    if (!/^INV-[A-Z0-9-]+$/.test(String(item?.id || ""))) {
      result.blocks.push(issue("SCHEMA_RULE_ID", `${location}.id must match INV-[A-Z0-9-]+.`));
    }
    if (ids.has(item?.id)) {
      result.blocks.push(issue("DUPLICATE_RULE_ID", `Duplicate rule id: ${item.id}`, { ruleId: item.id }));
    }
    ids.add(item?.id);
    if (!Array.isArray(item?.evidence) || item.evidence.length === 0) {
      result.blocks.push(issue("RULE_EVIDENCE_MISSING", `${item?.id || location} needs at least one evidence reference.`, {
        ruleId: item?.id,
      }));
    }
    if (!Array.isArray(item?.probes) || item.probes.length === 0) {
      result.blocks.push(issue("RULE_PROBE_MISSING", `${item?.id || location} needs at least one probe.`, {
        ruleId: item?.id,
      }));
    } else if (
      ["product", "compliance", "security"].includes(item.class) &&
      !item.probes.some((probe) => MACHINE_PROBE_TYPES.has(probe.type))
    ) {
      result.blocks.push(issue(
        "RULE_MACHINE_PROBE_MISSING",
        `${item.id} is high risk and has no machine probe.`,
        { ruleId: item.id },
      ));
    }
  }
}

function validateDecisionLog(records, result) {
  const decisions = new Map();
  for (const record of records) {
    if (record.parseError) {
      result.blocks.push(issue("DECISION_JSONL_PARSE", `Invalid JSONL: ${record.parseError}`, {
        path: record.path,
        line: record.line,
      }));
      continue;
    }
    const decision = record.value;
    for (const key of [
      "id",
      "key",
      "date",
      "status",
      "sourceType",
      "owner",
      "decision",
      "outcome",
      "reason",
      "evidence",
      "supersedes",
    ]) {
      if (decision[key] === undefined || decision[key] === null || decision[key] === "") {
        result.blocks.push(issue("SCHEMA_DECISION_FIELD", `DECISION-LOG line ${record.line} is missing ${key}.`, {
          path: record.path,
          line: record.line,
        }));
      }
    }
    if (!Object.hasOwn(decision, "supersededBy")) {
      result.blocks.push(issue("SCHEMA_DECISION_FIELD", `DECISION-LOG line ${record.line} is missing supersededBy.`, {
        path: record.path,
        line: record.line,
      }));
    }
    if (!/^DEC-[A-Z0-9-]+$/.test(String(decision.id || ""))) {
      result.blocks.push(issue("SCHEMA_DECISION_ID", `Invalid decision id at line ${record.line}.`, {
        path: record.path,
        line: record.line,
      }));
    }
    if (decisions.has(decision.id)) {
      result.blocks.push(issue("DUPLICATE_DECISION_ID", `Duplicate decision id: ${decision.id}`, {
        path: record.path,
        line: record.line,
      }));
    }
    decisions.set(decision.id, { ...decision, _line: record.line });
    if (
      ACTIVE_RULE_STATUSES.has(decision.status) &&
      !TRUSTED_DECISION_SOURCES.has(decision.sourceType)
    ) {
      result.blocks.push(issue(
        "UNTRUSTED_DECISION_ACCEPTED",
        `${decision.id} is accepted from sourceType=${decision.sourceType}; only user/director/external/technical-constraint can bind.`,
        { path: record.path, line: record.line },
      ));
    }
    if (!Array.isArray(decision.evidence) || decision.evidence.length === 0) {
      result.blocks.push(issue("DECISION_EVIDENCE_MISSING", `${decision.id} needs at least one evidence reference.`, {
        path: record.path,
        line: record.line,
      }));
    } else {
      for (const evidence of decision.evidence) {
        const ref = typeof evidence === "string" ? evidence : evidence.ref;
        if (ref && !refExists(result.root, ref)) {
          result.blocks.push(issue("DECISION_REF_INVALID", `${decision.id} references missing evidence: ${ref}`, {
            path: record.path,
            line: record.line,
          }));
        }
      }
    }
  }

  for (const decision of decisions.values()) {
    for (const targetId of decision.supersedes || []) {
      const target = decisions.get(targetId);
      if (!target) {
        result.blocks.push(issue("DECISION_SUPERSEDES_MISSING", `${decision.id} supersedes missing ${targetId}.`, {
          path: result.config.paths.decisionLog,
          line: decision._line,
        }));
      } else if (target.supersededBy !== decision.id) {
        result.blocks.push(issue("DECISION_SUPERSESSION_ASYMMETRIC", `${target.id}.supersededBy must be ${decision.id}.`, {
          path: result.config.paths.decisionLog,
          line: target._line,
        }));
      }
    }
    if (decision.supersededBy) {
      const replacement = decisions.get(decision.supersededBy);
      if (!replacement) {
        result.blocks.push(issue("DECISION_REPLACEMENT_MISSING", `${decision.id} points to missing replacement ${decision.supersededBy}.`, {
          path: result.config.paths.decisionLog,
          line: decision._line,
        }));
      } else if (!(replacement.supersedes || []).includes(decision.id)) {
        result.blocks.push(issue("DECISION_SUPERSESSION_ASYMMETRIC", `${decision.supersededBy}.supersedes must include ${decision.id}.`, {
          path: result.config.paths.decisionLog,
          line: replacement._line,
        }));
      }
    }
  }

  const activeByKey = new Map();
  for (const decision of decisions.values()) {
    if (!ACTIVE_RULE_STATUSES.has(decision.status)) {
      continue;
    }
    const existing = activeByKey.get(decision.key);
    if (existing && !decision.supersedes?.includes(existing.id)) {
      result.blocks.push(issue(
        "DECISION_KEY_CONFLICT",
        `Decision key ${decision.key} has multiple active decisions: ${existing.id}, ${decision.id}.`,
        { path: result.config.paths.decisionLog, line: decision._line },
      ));
    } else {
      activeByKey.set(decision.key, decision);
    }
  }
  result.decisions = decisions;
  result.activeDecisionsByKey = activeByKey;
}

function validateRuleDecisionBindings(contract, result) {
  if (!contract || !Array.isArray(contract.items)) {
    return;
  }
  for (const rule of contract.items) {
    const decision = result.decisions?.get(rule.decisionId);
    if (!decision) {
      result.blocks.push(issue(
        "RULE_DECISION_MISSING",
        `${rule.id} references missing decision ${rule.decisionId}.`,
        { path: result.config.paths.productContract, ruleId: rule.id },
      ));
      continue;
    }
    if (!ACTIVE_RULE_STATUSES.has(decision.status)) {
      result.blocks.push(issue(
        "RULE_DECISION_INACTIVE",
        `${rule.id} references inactive decision ${decision.id}.`,
        { path: result.config.paths.productContract, ruleId: rule.id },
      ));
    }
    if (decision.outcome !== rule.decisionOutcome) {
      result.blocks.push(issue(
        "RULE_REVERSED_WITHOUT_DECISION",
        `${rule.id}.decisionOutcome differs from ${decision.id}.outcome; append a new decision and supersede the old one.`,
        { path: result.config.paths.productContract, ruleId: rule.id },
      ));
    }
  }
}

function validateRoleContract(roleContract, result) {
  if (!result.config.role?.enabled) {
    return;
  }
  if (!isPlainObject(roleContract)) {
    result.blocks.push(issue("ROLE_CONTRACT_MISSING", "ROLE-CONTRACT.json must be present when role gating is enabled.", {
      path: result.config.paths.roleContract,
    }));
    return;
  }
  if (roleContract.schemaVersion !== SCHEMA_VERSION) {
    result.blocks.push(issue("ROLE_CONTRACT_SCHEMA", "ROLE-CONTRACT schemaVersion must be 1.", {
      path: result.config.paths.roleContract,
    }));
  }
  if (!Number.isInteger(roleContract.revision) || roleContract.revision < 1) {
    result.blocks.push(issue("ROLE_CONTRACT_REVISION", "ROLE-CONTRACT revision must be a positive integer.", {
      path: result.config.paths.roleContract,
    }));
  }
  if (
    roleContract.authorization?.sourceType !== "user" ||
    !roleContract.authorization?.reference ||
    !refExists(result.root, roleContract.authorization.reference)
  ) {
    result.blocks.push(issue(
      "ROLE_AUTHORIZATION_INVALID",
      "ROLE-CONTRACT changes require a user authorization reference to an existing decision/evidence file.",
      { path: result.config.paths.roleContract },
    ));
  }
  const authorizationDecision = result.decisions?.get(roleContract.authorization?.decisionId);
  if (
    !authorizationDecision ||
    !ACTIVE_RULE_STATUSES.has(authorizationDecision.status) ||
    authorizationDecision.sourceType !== "user" ||
    authorizationDecision.outcome !== roleContract.authorization?.outcome
  ) {
    result.blocks.push(issue(
      "ROLE_DECISION_AUTHORIZATION_INVALID",
      "ROLE-CONTRACT authorization must reference an active user decision with the same outcome.",
      { path: result.config.paths.roleContract },
    ));
  }
  for (const profileName of ["director", "worker"]) {
    const profile = roleContract.profiles?.[profileName];
    if (!isPlainObject(profile)) {
      result.blocks.push(issue("ROLE_PROFILE_MISSING", `ROLE-CONTRACT is missing profiles.${profileName}.`, {
        path: result.config.paths.roleContract,
      }));
      continue;
    }
    if (!Array.isArray(profile.allowedActions) || profile.allowedActions.length === 0) {
      result.blocks.push(issue("ROLE_ALLOWLIST_EMPTY", `${profileName}.allowedActions must not be empty.`, {
        path: result.config.paths.roleContract,
      }));
    }
    for (const action of profile.allowedActions || []) {
      if (profileName === "director" && !ROLE_ACTION_TYPES.has(action)) {
        result.blocks.push(issue("ROLE_ACTION_UNKNOWN", `${profileName} allowlist contains unknown action ${action}.`, {
          path: result.config.paths.roleContract,
        }));
      }
    }
    if (profileName === "director") {
      for (const requiredAction of ["plan", "dispatch", "monitor", "read_worker_summary", "record"]) {
        if (!(profile.allowedActions || []).includes(requiredAction)) {
          result.blocks.push(issue(
            "ROLE_REQUIRED_ACTION_MISSING",
            `director.allowedActions must include ${requiredAction}.`,
            { path: result.config.paths.roleContract },
          ));
        }
      }
      if (profile.handoffRequired !== true) {
        result.blocks.push(issue("ROLE_HANDOFF_NOT_REQUIRED", "director.handoffRequired must be true.", {
          path: result.config.paths.roleContract,
        }));
      }
      if (!Array.isArray(profile.forbiddenActions)) {
        result.blocks.push(issue("ROLE_FORBIDDEN_LIST", "director.forbiddenActions must be an array.", {
          path: result.config.paths.roleContract,
        }));
      } else {
        for (const forbidden of DIRECTOR_FORBIDDEN_ACTIONS) {
          if (!profile.forbiddenActions.includes(forbidden)) {
            result.blocks.push(issue(
              "ROLE_REQUIRED_FORBIDDEN_ACTION_MISSING",
              `director.forbiddenActions must include ${forbidden}.`,
              { path: result.config.paths.roleContract },
            ));
          }
        }
      }
      const budget = profile.verificationBudget || {};
      const budgetChecks = [
        ["maxReadOperationsPerDelivery", 1],
        ["maxNamedFiles", 1],
        ["maxNamedCommands", 1],
        ["maxPreciseThreadReads", 1],
      ];
      for (const [key, maximum] of budgetChecks) {
        if (!Number.isInteger(budget[key]) || budget[key] < 0 || budget[key] > maximum) {
          result.blocks.push(issue(
            "ROLE_VERIFY_BUDGET_INVALID",
            `director.verificationBudget.${key} must be an integer from 0 to ${maximum}.`,
            { path: result.config.paths.roleContract },
          ));
        }
      }
      if (budget.allowWildcardSearch !== false || budget.allowFollowOnInvestigation !== false) {
        result.blocks.push(issue(
          "ROLE_VERIFY_BUDGET_UNSAFE",
          "director verification budget must disable wildcard search and follow-on investigation.",
          { path: result.config.paths.roleContract },
        ));
      }
      const requiredMemoryKeys = [
        "role",
        "goal",
        "work",
        "acceptance_evidence",
        "decisions",
        "blockers_external",
        "next_action",
        "forbidden_actions",
      ];
      const memoryKeys = new Set(
        Array.isArray(profile.minimumMemory)
          ? profile.minimumMemory.map((item) => item?.key).filter(Boolean)
          : [],
      );
      if (requiredMemoryKeys.some((key) => !memoryKeys.has(key))) {
        result.blocks.push(issue(
          "ROLE_MINIMUM_MEMORY_INVALID",
          `director.minimumMemory must define keys: ${requiredMemoryKeys.join(", ")}.`,
          { path: result.config.paths.roleContract },
        ));
      }
      if (!Array.isArray(profile.dispatchPriority) || profile.dispatchPriority.length < 3) {
        result.blocks.push(issue(
          "ROLE_DISPATCH_PRIORITY_MISSING",
          "director.dispatchPriority must define the ordered dispatch-first actions.",
          { path: result.config.paths.roleContract },
        ));
      } else if (!["create_task", "send_task"].includes(profile.dispatchPriority[0])) {
        result.blocks.push(issue(
          "ROLE_DISPATCH_PRIORITY_INVALID",
          "director.dispatchPriority must begin with create_task or send_task.",
          { path: result.config.paths.roleContract },
        ));
      }
    }
  }
  result.roleBindings = new Map();
  if (!Array.isArray(roleContract.bindings)) {
    result.blocks.push(issue("ROLE_BINDINGS_SCHEMA", "ROLE-CONTRACT.bindings must be an array.", {
      path: result.config.paths.roleContract,
    }));
    return;
  }
  for (const binding of roleContract.bindings) {
    if (!binding?.threadId || !binding?.profile) {
      result.blocks.push(issue("ROLE_BINDING_FIELD", "Each role binding needs threadId and profile.", {
        path: result.config.paths.roleContract,
      }));
      continue;
    }
    if (!roleContract.profiles?.[binding.profile]) {
      result.blocks.push(issue(
        "ROLE_BINDING_PROFILE",
        `Binding ${binding.threadId} references unknown profile ${binding.profile}.`,
        { path: result.config.paths.roleContract },
      ));
    }
    if (result.roleBindings.has(binding.threadId)) {
      result.blocks.push(issue(
        "ROLE_BINDING_DUPLICATE",
        `Thread ${binding.threadId} has multiple role bindings.`,
        { path: result.config.paths.roleContract },
      ));
    }
    result.roleBindings.set(binding.threadId, binding);
  }
  result.roleContract = roleContract;
}

function classifyRolePrompt(prompt) {
  const text = String(prompt || "");
  const correction = /不是让你.*自己|不要自己干活|你是不是忘了.*职责|先派单|为什么.*忘记.*要求|dispatch first/i;
  const explicitVerify = /只读核验|独立验收|复核这个证据|确认这个 commit|确认这个测试|核对这一行|verify this evidence|check this commit/i;
  const implementation = /修复代码|实现功能|修改代码|调试|定位 bug|提交代码|部署|上线|fix code|implement|debug|deploy/i;
  const discovery = /重新研究|继续研究|查清|调查|梳理|重建|重读|核对历史|读取.*线程|找.*前任|分析原因|具体方案|饱和测试|investigate|research|trace|find.*thread|rebuild.*history/i;
  const followOn = /发现.*(?:异常|问题)|继续.*(?:调查|追查)|根因|进一步查|顺藤摸瓜|follow.?on|新问题|new anomaly|continue investigating/i;
  if (correction.test(text)) {
    return { intent: "discover", dispatchRequired: true, reason: "role correction forces dispatch-first" };
  }
  if (explicitVerify.test(text)) {
    return { intent: "verify", dispatchRequired: false, reason: "explicit bounded verification" };
  }
  if (implementation.test(text)) {
    return { intent: "implement", dispatchRequired: true, reason: "implementation belongs to a worker" };
  }
  if (followOn.test(text)) {
    return { intent: "diagnose", dispatchRequired: true, reason: "follow-on investigation belongs to a worker" };
  }
  if (discovery.test(text)) {
    return { intent: "discover", dispatchRequired: true, reason: "open-ended investigation belongs to a worker" };
  }
  return { intent: "coordinate", dispatchRequired: false, reason: "coordination is allowed for director" };
}

function canonicalToolName(name) {
  return String(name || "")
    .replace(/^mcp__[^_]+__/, "")
    .replace(/^mcp__.+?__/, "");
}

function pathLooksLikeBusiness(relativePath) {
  return BUSINESS_PATH_PATTERNS.some((pattern) => pattern.test(toPosix(relativePath || "")));
}

function isSafeVerificationCommand(command) {
  const value = String(command || "").trim();
  if (!value || /[;&|`<>\r\n]|\$\(|%0a/i.test(value)) {
    return false;
  }
  if (/(?:^|\s)--output(?:=|\s)|(?:^|\s)-o(?:\s|=)/i.test(value)) {
    return false;
  }
  return [
    /^git\s+(?:show|diff|status|rev-parse|cat-file|hash-object)(?:\s|$)/i,
    /^npm\s+test(?:\s|$)/i,
    /^npx\s+(?:jest|vitest)(?:\s|$)/i,
    /^node\s+--test(?:\s|$)/i,
    /^(?:pytest|ctest)(?:\s|$)/i,
    /^(?:sha256sum|shasum)(?:\s|$)/i,
    /^Get-FileHash(?:\s|$)/i,
  ].some((pattern) => pattern.test(value));
}

function inferRoleAction(action) {
  const tool = canonicalToolName(action.tool);
  const command = String(action.command || "");
  const pathCandidates = [
    action.path,
    ...(action.paths || []),
    ...(action.files || []),
  ].filter(Boolean).map(String);
  if (/\.codex[\\/]+(?:sessions|archived_sessions)|session_index\.jsonl|rollout-.*\.jsonl|thread_history_\d+\.sqlite/i.test(command)) {
    return "raw_rollout_scan";
  }
  if (/Get-ChildItem[\s\S]+sessions|ForEach-Object[\s\S]+rollout/i.test(command)) {
    return "raw_rollout_scan";
  }
  if (/rg|Select-String|Get-ChildItem/.test(command) && (action.paths || []).length > 1) {
    return "open_ended_code_exploration";
  }
  if (/git\s+(?:show|status|diff|rev-parse)|npm\s+test|node\s+.*test|pytest|ctest/i.test(command)) {
    return "verify_command";
  }
  if (/(?:^|[\\/])(?:Get-Content|type|cat|tail|head|Select-String)\s|Get-Content\s/i.test(command)) {
    return "long_log_analysis";
  }
  if (
    pathCandidates.some((candidate) => (
      /\.codex[\\/]+(?:sessions|archived_sessions)|session_index\.jsonl|rollout-.*\.jsonl|thread_history_\d+\.sqlite/i.test(candidate)
    ))
  ) {
    return "raw_rollout_scan";
  }
  if (["create_thread", "send_message_to_thread", "create_task", "send_task"].includes(tool)) {
    return "dispatch";
  }
  if (["wait_threads", "wait_agent", "monitor_task"].includes(tool)) {
    return "monitor";
  }
  if (tool === "list_threads") {
    return "broad_thread_search";
  }
  if (tool === "read_thread") {
    return "precise_thread_read";
  }
  if (tool === "apply_patch") {
    const patchText = String(action.patch || action.diff || "");
    const patchPaths = [
      ...(action.paths || []),
      ...Array.from(
        patchText.matchAll(/^\*\*\*\s+(?:(?:Update|Add|Delete) File|Move to):\s+(.+)$/gm),
        (match) => match[1].trim(),
      ),
    ];
    if (patchPaths.length === 0 || patchPaths.some(pathLooksLikeBusiness)) {
      return "edit_business_code";
    }
    return "record";
  }
  if (tool === "exec_command") {
    return "open_ended_code_exploration";
  }
  if (["read_file", "read_document"].includes(tool)) {
    return "verify_read";
  }
  return action.actionType || "self_assign_unscoped_audit";
}

function validateRoleRequest(root, roleContract, request, result, workState) {
  if (!result.config.role?.enabled) {
    result.warnings.push(issue("ROLE_GATE_DISABLED", "Role gating is disabled for this repository."));
    return;
  }
  if (!isPlainObject(request)) {
    result.blocks.push(issue("ROLE_REQUEST_INVALID", "Role request must be a JSON object."));
    return;
  }
  const threadId = request.threadId || null;
  const binding = threadId ? result.roleBindings?.get(threadId) : null;
  const bindingProfile = binding?.profile || null;
  const requestedActor = request.actorMode || bindingProfile;
  if (request.threadTitle && /director|总监/i.test(request.threadTitle) && !binding) {
    result.blocks.push(issue(
      "ROLE_BINDING_MISSING",
      "A title containing director/总监 is not role evidence. Bind the thread ID in ROLE-CONTRACT.json.",
      { path: result.config.paths.roleContract },
    ));
  }
  if (!requestedActor) {
    result.blocks.push(issue("ROLE_UNKNOWN", "actorMode is unknown and the thread has no role binding.", {
      path: result.config.paths.roleContract,
    }));
    return;
  }
  if (bindingProfile && request.actorMode && request.actorMode !== bindingProfile) {
    result.blocks.push(issue(
      "ROLE_BINDING_CONFLICT",
      `Thread binding=${bindingProfile} conflicts with actorMode=${request.actorMode}.`,
      { path: result.config.paths.roleContract },
    ));
    return;
  }
  if (request.actorMode === "director" && !bindingProfile) {
    result.blocks.push(issue(
      "ROLE_DIRECTOR_UNBOUND",
      "Director mode requires an exact threadId binding; title or recent task cannot infer the role.",
      { path: result.config.paths.roleContract },
    ));
    return;
  }
  if (requestedActor === "worker") {
    result.facts.roleDecision = "ALLOW_WORKER";
    return;
  }
  if (requestedActor !== "director") {
    result.blocks.push(issue("ROLE_UNKNOWN", `Unknown actorMode: ${requestedActor}.`, {
      path: result.config.paths.roleContract,
    }));
    return;
  }

  const profile = roleContract.profiles.director;
  let intent = request.intent;
  let dispatchRequired = Boolean(request.dispatchRequired);
  if (request.prompt) {
    const classification = classifyRolePrompt(request.prompt);
    dispatchRequired ||= classification.dispatchRequired;
    if (classification.dispatchRequired) {
      if (intent && intent !== classification.intent) {
        result.blocks.push(issue(
          "ROLE_INTENT_MISMATCH",
          `Declared intent=${intent} conflicts with prompt-derived intent=${classification.intent}.`,
          { path: result.config.paths.roleContract },
        ));
      }
      intent = classification.intent;
    } else if (!intent) {
      intent = classification.intent;
    }
  }
  intent ||= "coordinate";
  dispatchRequired ||= DISPATCH_REQUIRED_INTENTS.has(intent);
  const openTaskIds = new Set((workState?.tasks || []).map((task) => task.id));
  const hasTaskBinding = (
    Array.isArray(request.dispatchedTaskIds) &&
    request.dispatchedTaskIds.some((taskId) => openTaskIds.has(taskId))
  );
  const dispatchedTaskIds = Array.isArray(request.dispatchedTaskIds)
    ? request.dispatchedTaskIds
    : [];
  const hasDispatchEvidence = hasTaskBinding || (
    Array.isArray(request.dispatchEvidence) &&
    request.dispatchEvidence.some((entry) => {
      const ref = typeof entry === "string" ? entry : entry?.ref;
      const explicitTaskId = isPlainObject(entry) ? entry.taskId : null;
      if (!ref || !refExists(root, ref)) {
        return false;
      }
      const content = readText(path.join(root, splitRef(ref).file));
      const taskIds = explicitTaskId ? [explicitTaskId] : dispatchedTaskIds;
      return taskIds.some((taskId) => content.includes(taskId)) &&
        /actorMode\s*[:=]\s*["']?worker["']?/i.test(content);
    })
  );
  let dispatchSatisfied = Boolean(request.dispatchSatisfied);
  if (dispatchSatisfied && !hasDispatchEvidence) {
    result.blocks.push(issue(
      "ROLE_DISPATCH_EVIDENCE_MISSING",
      "dispatchSatisfied=true requires at least one dispatched task ID or dispatch evidence pointer.",
      { path: result.config.paths.roleContract },
    ));
    dispatchSatisfied = false;
  }
  if (intent === "verify" && (!hasDispatchEvidence || !request.workerDeliveryId)) {
    result.blocks.push(issue(
      "ROLE_DELIVERY_REQUIRED",
      "Director verification requires a worker task/delivery ID and evidence pointers.",
      { path: result.config.paths.roleContract },
    ));
  }
  const actions = Array.isArray(request.plannedActions) ? request.plannedActions : [];
  if (actions.length === 0 && dispatchRequired && !dispatchSatisfied) {
    result.blocks.push(issue(
      "ROLE_DISPATCH_REQUIRED",
      "Director discovery/diagnosis/implementation requires a worker dispatch before execution.",
      { path: result.config.paths.roleContract, action: "Create or send a worker task first." },
    ));
    return;
  }

  const evidencePointers = new Map(
    (request.evidencePointers || []).map((pointer) => [pointer.id, pointer]),
  );
  const used = request.verificationBudgetUsed || {};
  const counterEntries = [
    ["readOperations", used.readOperations || 0],
    ["namedFiles", used.namedFiles || 0],
    ["namedCommands", used.namedCommands || 0],
    ["preciseThreadReads", used.preciseThreadReads || 0],
  ];
  if (counterEntries.some(([, value]) => !Number.isInteger(value) || value < 0)) {
    result.blocks.push(issue(
      "ROLE_BUDGET_COUNTER_INVALID",
      "Verification budget counters must be non-negative integers.",
      { path: result.config.paths.roleContract },
    ));
  }
  let reads = Math.max(0, Number.isInteger(used.readOperations) ? used.readOperations : 0);
  let namedFiles = Math.max(0, Number.isInteger(used.namedFiles) ? used.namedFiles : 0);
  let namedCommands = Math.max(0, Number.isInteger(used.namedCommands) ? used.namedCommands : 0);
  let preciseThreadReads = Math.max(
    0,
    Number.isInteger(used.preciseThreadReads) ? used.preciseThreadReads : 0,
  );
  let totalVerificationActions = 0;
  let sawDispatch = dispatchSatisfied;
  let violationCount = 0;

  for (const originalAction of actions) {
    const actionType = inferRoleAction(originalAction);
    const action = { ...originalAction, actionType };
    if (originalAction.actionType && originalAction.actionType !== actionType) {
      result.blocks.push(issue(
        "ROLE_ACTION_LABEL_MISMATCH",
        `Declared actionType=${originalAction.actionType} conflicts with inferred actionType=${actionType}.`,
        {
          path: result.config.paths.roleContract,
          action: "Use the actual tool and command semantics; a label cannot downgrade an action.",
        },
      ));
      violationCount += 1;
    }
    if (!ROLE_ACTION_TYPES.has(actionType)) {
      result.blocks.push(issue("ROLE_ACTION_UNKNOWN", `Unknown planned action: ${actionType}.`, {
        path: result.config.paths.roleContract,
      }));
      violationCount += 1;
      continue;
    }
    if (actionType === "dispatch") {
      if (
        action.actorMode !== "worker" ||
        !action.taskId ||
        !Array.isArray(action.scope) ||
        action.scope.length === 0 ||
        !Array.isArray(action.forbiddenActions) ||
        action.forbiddenActions.length === 0
      ) {
        result.blocks.push(issue(
          "ROLE_DISPATCH_INCOMPLETE",
          "A director dispatch needs actorMode=worker, taskId, scope, and forbiddenActions.",
          {
            path: result.config.paths.roleContract,
            action: "Use the dispatch template before any investigation.",
          },
        ));
        violationCount += 1;
      } else {
        sawDispatch = true;
      }
      continue;
    }
    if (dispatchRequired && !sawDispatch && !DIRECTOR_PRE_DISPATCH_ACTIONS.has(actionType)) {
      result.blocks.push(issue(
        "ROLE_DISPATCH_REQUIRED",
        `Director intent=${intent} attempted ${actionType} before worker dispatch.`,
        {
          path: result.config.paths.roleContract,
          action: "Move create_task/send_task before any investigation, read, command, or edit.",
        },
      ));
      violationCount += 1;
      continue;
    }
    if (DIRECTOR_FORBIDDEN_ACTIONS.has(actionType)) {
      result.blocks.push(issue(
        "ROLE_ACTION_FORBIDDEN",
        `Director cannot execute ${actionType}; delegate it to a worker.`,
        { path: result.config.paths.roleContract },
      ));
      violationCount += 1;
      continue;
    }
    if (!profile.allowedActions.includes(actionType)) {
      result.blocks.push(issue(
        "ROLE_ACTION_NOT_ALLOWED",
        `${actionType} is not in director.allowedActions.`,
        { path: result.config.paths.roleContract },
      ));
      violationCount += 1;
      continue;
    }
    if (
      actionType === "record" &&
      ((action.paths || []).some(pathLooksLikeBusiness) || pathLooksLikeBusiness(action.path))
    ) {
      result.blocks.push(issue(
        "ROLE_BUSINESS_EDIT_FORBIDDEN",
        "A record action cannot target business implementation paths.",
        { path: result.config.paths.roleContract },
      ));
      violationCount += 1;
      continue;
    }
    if (action.followOnInvestigation === true && !profile.verificationBudget.allowFollowOnInvestigation) {
      result.blocks.push(issue(
        "ROLE_FOLLOW_ON_FORBIDDEN",
        "A director verification anomaly must be returned or re-dispatched, not investigated further.",
        { path: result.config.paths.roleContract },
      ));
      violationCount += 1;
      continue;
    }
    if (
      actionType === "read_worker_summary" &&
      Number(action.summaryLines || 0) > Number(result.config.role?.maxSummaryLines || 20)
    ) {
      result.blocks.push(issue(
        "ROLE_SUMMARY_TOO_LONG",
        `Worker summary exceeds ${result.config.role?.maxSummaryLines || 20} lines.`,
        { path: result.config.paths.roleContract },
      ));
      violationCount += 1;
    }
    if (VERIFY_ACTION_TYPES.has(actionType)) {
      totalVerificationActions += 1;
      reads += 1;
      if (!action.evidencePointerId || !evidencePointers.has(action.evidencePointerId)) {
        result.blocks.push(issue(
          "ROLE_EVIDENCE_POINTER_REQUIRED",
          `${actionType} requires a named evidencePointerId supplied by the worker.`,
          { path: result.config.paths.roleContract },
        ));
        violationCount += 1;
      }
      if (actionType === "verify_read") {
        const files = action.files || (action.path ? [action.path] : []);
        namedFiles += Math.max(1, new Set(files).size);
        if (
          !Number.isInteger(action.startLine) ||
          !Number.isInteger(action.endLine) ||
          action.startLine < 1 ||
          action.endLine < action.startLine
        ) {
          result.blocks.push(issue(
            "ROLE_EXACT_RANGE_REQUIRED",
            "Director verify_read requires an exact positive startLine/endLine range.",
            { path: result.config.paths.roleContract },
          ));
          violationCount += 1;
        }
        if ((action.files || []).length > 1) {
          result.blocks.push(issue(
            "ROLE_MULTI_FILE_READ",
            "Director verification accepts at most one named file per action.",
            { path: result.config.paths.roleContract },
          ));
          violationCount += 1;
        }
      }
      if (actionType === "verify_command") {
        namedCommands += 1;
        const pointer = evidencePointers.get(action.evidencePointerId);
        const expectedCommands = [
          pointer?.allowedCheck,
          pointer?.value,
          pointer?.command,
        ].filter((value) => typeof value === "string" && value.length > 0);
        if (!action.command) {
          result.blocks.push(issue(
            "ROLE_NAMED_COMMAND_REQUIRED",
            "Director verify_command requires the exact command named by the worker.",
            { path: result.config.paths.roleContract },
          ));
          violationCount += 1;
        }
        if (
          expectedCommands.length === 0 ||
          !expectedCommands.includes(action.command)
        ) {
          result.blocks.push(issue(
            "ROLE_COMMAND_NOT_BOUND",
            "Director command must exactly match the worker-named allowedCheck/value.",
            { path: result.config.paths.roleContract },
          ));
          violationCount += 1;
        }
        if (/[;&|`<>\r\n]|\$\(|%0a/i.test(String(action.command || ""))) {
          result.blocks.push(issue(
            "ROLE_COMMAND_CHAIN_FORBIDDEN",
            "Director verification cannot chain commands or pipe into another command.",
            { path: result.config.paths.roleContract },
          ));
          violationCount += 1;
        }
        if (/-EncodedCommand|Invoke-Expression|\biex\b|\bbash\s+-c\b|\bcmd(?:\.exe)?\s+\/c\b/i.test(String(action.command || ""))) {
          result.blocks.push(issue(
            "ROLE_OPAQUE_COMMAND_FORBIDDEN",
            "Director verification cannot use encoded or nested shell execution.",
            { path: result.config.paths.roleContract },
          ));
          violationCount += 1;
        }
        if (!isSafeVerificationCommand(action.command)) {
          result.blocks.push(issue(
            "ROLE_COMMAND_UNSAFE",
            "Verification command is outside the conservative read-only acceptance allowlist.",
            {
              path: result.config.paths.roleContract,
              action: "Use a named read-only command such as git show/status/rev-parse, a test runner, or a hash check.",
            },
          ));
          violationCount += 1;
        }
        if (action.runCount !== undefined && action.runCount !== 1) {
          result.blocks.push(issue(
            "ROLE_COMMAND_RUN_ONCE",
            "Director may run a named verification command once.",
            { path: result.config.paths.roleContract },
          ));
          violationCount += 1;
        }
      }
      if (actionType === "precise_thread_read") {
        preciseThreadReads += 1;
        const pointer = evidencePointers.get(action.evidencePointerId);
        if (
          !action.threadId ||
          pointer?.value !== action.threadId ||
          !Number.isInteger(action.maxTurns) ||
          action.maxTurns < 1 ||
          action.maxTurns > 2 ||
          action.includeOutputs !== false
        ) {
          result.blocks.push(issue(
            "ROLE_THREAD_READ_UNBOUNDED",
            "Director thread verification must use the exact worker-named ID, maxTurns<=2, and includeOutputs=false.",
            { path: result.config.paths.roleContract },
          ));
          violationCount += 1;
        }
      }
    }
    if (actionType === "orchestrate_release") {
      if (
        request.authorization?.release !== true ||
        !request.authorization?.reference ||
        !refExists(root, request.authorization.reference)
      ) {
        result.blocks.push(issue(
          "ROLE_RELEASE_AUTH_REQUIRED",
          "Director release orchestration requires explicit current authorization and an existing evidence reference.",
          { path: result.config.paths.roleContract },
        ));
        violationCount += 1;
      }
    }
  }

  const budget = profile.verificationBudget;
  if (
    reads > budget.maxReadOperationsPerDelivery ||
    namedFiles > budget.maxNamedFiles ||
    namedCommands > budget.maxNamedCommands ||
    preciseThreadReads > budget.maxPreciseThreadReads
  ) {
    result.blocks.push(issue(
      "ROLE_VERIFY_BUDGET_EXCEEDED",
      `Verification budget exceeded: reads=${reads}/${budget.maxReadOperationsPerDelivery}, ` +
      `files=${namedFiles}/${budget.maxNamedFiles}, commands=${namedCommands}/${budget.maxNamedCommands}, ` +
      `threadReads=${preciseThreadReads}/${budget.maxPreciseThreadReads}.`,
      { path: result.config.paths.roleContract },
    ));
    violationCount += 1;
  }
  if (totalVerificationActions > 1) {
    result.blocks.push(issue(
      "ROLE_SINGLE_EVIDENCE_ONLY",
      `Director may inspect one decisive evidence item per delivery, not ${totalVerificationActions}.`,
      {
        path: result.config.paths.roleContract,
        action: "Keep one named evidence item, summarize it, and re-dispatch any further question.",
      },
    ));
    violationCount += 1;
  }
  const maxSummaryLines = Math.min(
    20,
    Number(result.config.role?.maxSummaryLines || 20),
  );
  if (
    (request.summaryLines || 0) > maxSummaryLines ||
    (request.reportBack?.receivedSummaryLines || 0) > maxSummaryLines
  ) {
    result.blocks.push(issue(
      "ROLE_SUMMARY_TOO_LONG",
      `Worker summary exceeds ${maxSummaryLines} lines; request a compressed summary and evidence pointers.`,
      { path: result.config.paths.roleContract },
    ));
    violationCount += 1;
  }
  if (
    request.allowWildcardSearch === true ||
    actions.some((action) => action.allowWildcardSearch === true)
  ) {
    result.blocks.push(issue(
      "ROLE_WILDCARD_SEARCH_FORBIDDEN",
      "Director cannot use wildcard or broad search to discover scope.",
      { path: result.config.paths.roleContract },
    ));
    violationCount += 1;
  }
  if (request.followOnInvestigation === true) {
    result.blocks.push(issue(
      "ROLE_FOLLOW_ON_FORBIDDEN",
      "Director cannot follow a verification anomaly into a new investigation.",
      { path: result.config.paths.roleContract },
    ));
    violationCount += 1;
  }
  result.facts.roleDecision = violationCount === 0 ? "ALLOW_DIRECTOR" : "BLOCK_DIRECTOR";
  result.facts.roleIntent = intent;
  result.facts.dispatchRequired = dispatchRequired;
  result.facts.verificationBudget = {
    reads,
    namedFiles,
    namedCommands,
    preciseThreadReads,
  };
}

function validateEvidenceRefs(root, ownerId, evidence, itemPath, result) {
  for (const evidenceItem of evidence || []) {
    const ref = typeof evidenceItem === "string" ? evidenceItem : evidenceItem.ref;
    if (!ref || !refExists(root, ref)) {
      result.blocks.push(issue(
        "EVIDENCE_REF_INVALID",
        `${ownerId} references missing evidence: ${ref || "<empty>"}`,
        { path: itemPath, ruleId: ownerId.startsWith("INV-") ? ownerId : undefined },
      ));
    }
  }
}

function runRegexProbe(root, probe, ruleId, mustMatch, result) {
  const filePath = path.join(root, probe.file);
  if (!fs.existsSync(filePath)) {
    result.blocks.push(issue(
      mustMatch ? "PROBE_REQUIRED_FILE_MISSING" : "PROBE_SCAN_FILE_MISSING",
      `${ruleId} probe file does not exist: ${probe.file}`,
      { path: probe.file, ruleId },
    ));
    return;
  }
  const content = readText(filePath);
  let expression;
  try {
    expression = new RegExp(probe.pattern, probe.flags || "m");
  } catch (error) {
    result.blocks.push(issue("PROBE_REGEX_INVALID", `${ruleId} has invalid regex: ${error.message}`, {
      path: probe.file,
      ruleId,
    }));
    return;
  }
  const match = expression.exec(content);
  if (mustMatch && !match) {
    result.blocks.push(issue(
      "PROBE_FILE_REGEX_MISSING",
      `${ruleId} expected /${probe.pattern}/ in ${probe.file}.`,
      { path: probe.file, ruleId, action: probe.action || "Restore the required implementation or append an approved decision." },
    ));
  }
  if (!mustMatch && match) {
    result.blocks.push(issue(
      "PROBE_FILE_REGEX_FORBIDDEN",
      `${ruleId} found forbidden /${probe.pattern}/ in ${probe.file}.`,
      {
        path: probe.file,
        line: lineNumberAt(content, match.index),
        ruleId,
        action: probe.action || "Remove the stale implementation or append a superseding decision.",
      },
    ));
  }
}

function runRuleProbes(root, contract, result, mode) {
  if (!contract || !Array.isArray(contract.items)) {
    return;
  }
  for (const rule of contract.items) {
    if (!ACTIVE_RULE_STATUSES.has(rule.status) || !Array.isArray(rule.probes)) {
      continue;
    }
    for (const probe of rule.probes) {
      switch (probe.type) {
        case "file_exists": {
          if (!probe.path || !refExists(root, probe.path)) {
            result.blocks.push(issue("PROBE_FILE_MISSING", `${rule.id} expected file: ${probe.path}`, {
              path: probe.path,
              ruleId: rule.id,
            }));
          }
          break;
        }
        case "file_regex":
          runRegexProbe(root, probe, rule.id, true, result);
          break;
        case "file_not_regex":
          runRegexProbe(root, probe, rule.id, false, result);
          break;
        case "test_marker":
          runRegexProbe(root, {
            file: probe.path,
            pattern: String(probe.marker || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          }, rule.id, true, result);
          break;
        case "json_path_equals": {
          const targetPath = path.join(root, probe.file || "");
          if (!fs.existsSync(targetPath)) {
            result.blocks.push(issue("PROBE_JSON_FILE_MISSING", `${rule.id} JSON probe file missing: ${probe.file}`, {
              path: probe.file,
              ruleId: rule.id,
            }));
            break;
          }
          let target;
          try {
            target = readJson(targetPath);
          } catch (error) {
            result.blocks.push(issue("PROBE_JSON_INVALID", `${rule.id} cannot parse ${probe.file}: ${error.message}`, {
              path: probe.file,
              ruleId: rule.id,
            }));
            break;
          }
          const actual = valueAtPath(target, probe.path);
          if (!deepEqual(actual, probe.value)) {
            result.blocks.push(issue(
              "PROBE_JSON_VALUE_MISMATCH",
              `${rule.id} expected ${probe.path}=${JSON.stringify(probe.value)}, got ${JSON.stringify(actual)}.`,
              { path: probe.file, ruleId: rule.id },
            ));
          }
          break;
        }
        case "glob_not_matches": {
          const files = walkFiles(root);
          const expression = new RegExp(probe.pattern, probe.flags || "m");
          for (const file of files) {
            if (!matchesAnyGlob(file, probe.globs || [])) {
              continue;
            }
            if (matchesAnyGlob(file, probe.exclude || [])) {
              continue;
            }
            const content = readText(path.join(root, file));
            const match = expression.exec(content);
            if (match) {
              result.blocks.push(issue(
                "PROBE_GLOB_FORBIDDEN",
                `${rule.id} found forbidden /${probe.pattern}/ in ${file}.`,
                { path: file, line: lineNumberAt(content, match.index), ruleId: rule.id },
              ));
            }
          }
          break;
        }
        case "git_commit_exists": {
          if (!result.git.enabled || !result.git.available) {
            result.warnings.push(issue("PROBE_GIT_SKIPPED", `${rule.id} git probe skipped because Git is unavailable.`, {
              ruleId: rule.id,
            }));
            break;
          }
          if (!probe.commit || !result.git.commitExists(probe.commit)) {
            result.blocks.push(issue("PROBE_COMMIT_MISSING", `${rule.id} references missing commit ${probe.commit}.`, {
              ruleId: rule.id,
            }));
          }
          break;
        }
        case "evidence_sha256": {
          const filePath = path.join(root, probe.file || "");
          if (!fs.existsSync(filePath)) {
            result.blocks.push(issue("PROBE_EVIDENCE_MISSING", `${rule.id} evidence file missing: ${probe.file}`, {
              path: probe.file,
              ruleId: rule.id,
            }));
          } else if (sha256(fs.readFileSync(filePath)) !== probe.sha256) {
            result.blocks.push(issue("PROBE_EVIDENCE_HASH", `${rule.id} evidence hash changed: ${probe.file}`, {
              path: probe.file,
              ruleId: rule.id,
            }));
          }
          break;
        }
        case "manual": {
          if (mode === "release") {
            result.blocks.push(issue(
              "MANUAL_PROBE_IN_RELEASE",
              `${rule.id} still requires manual evidence and cannot be machine-cleared for release.`,
              { ruleId: rule.id },
            ));
          } else {
            result.warnings.push(issue("MANUAL_PROBE", `${rule.id} requires manual evidence; release remains blocked.`, {
              ruleId: rule.id,
            }));
          }
          break;
        }
        default:
          result.blocks.push(issue("PROBE_UNSUPPORTED", `${rule.id} uses unsupported probe type ${probe.type}.`, {
            ruleId: rule.id,
          }));
      }
    }

    for (const claim of rule.forbiddenClaims || []) {
      const targets = claim.glob
        ? walkFiles(root).filter((file) => globToRegExp(claim.glob).test(file))
        : [claim.path];
      for (const target of targets) {
        if (!target) {
          continue;
        }
        const filePath = path.join(root, target);
        if (!fs.existsSync(filePath)) {
          continue;
        }
        const content = readText(filePath);
        const expression = new RegExp(claim.pattern, claim.flags || "m");
        const match = expression.exec(content);
        if (match) {
          result.blocks.push(issue(
            "FORBIDDEN_CURRENT_CLAIM",
            `${rule.id} found stale claim /${claim.pattern}/ in ${target}.`,
            {
              path: target,
              line: lineNumberAt(content, match.index),
              ruleId: rule.id,
              action: claim.action || "Remove the stale claim or supersede the rule with a new decision.",
            },
          ));
        }
      }
    }
  }
}

function gitState(root, config) {
  const state = {
    enabled: Boolean(config.git?.enabled),
    available: false,
    head: null,
    branch: null,
    dirty: null,
    commitExists(commit) {
      if (!this.enabled || !this.available) {
        return false;
      }
      try {
        execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
          cwd: root,
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    },
    isAncestor(ancestor, descendant = "HEAD") {
      if (!this.enabled || !this.available) {
        return true;
      }
      try {
        execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
          cwd: root,
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    },
  };
  if (!state.enabled) {
    return state;
  }
  try {
    state.head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    state.branch = execFileSync("git", ["branch", "--show-current"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || "detached";
    state.dirty = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().length > 0;
    state.available = true;
  } catch {
    state.available = false;
  }
  return state;
}

function validateProjectContext(root, content, result) {
  const frontMatter = parseYamlFrontMatter(content);
  if (!frontMatter) {
    result.blocks.push(issue("PROJECT_FRONTMATTER_MISSING", "PROJECT-CONTEXT must start with YAML frontmatter.", {
      path: result.config.paths.projectContext,
    }));
    return;
  }
  for (const key of ["schemaVersion", "status", "updatedAt", "verifiedAt", "sourceRefs", "reviewAfterDays"]) {
    if (frontMatter[key] === undefined || frontMatter[key] === "") {
      result.blocks.push(issue("PROJECT_FRONTMATTER_FIELD", `PROJECT-CONTEXT frontmatter is missing ${key}.`, {
        path: result.config.paths.projectContext,
      }));
    }
  }
  if (!Array.isArray(frontMatter.sourceRefs)) {
    result.blocks.push(issue("PROJECT_SOURCE_REFS", "PROJECT-CONTEXT sourceRefs must be a list.", {
      path: result.config.paths.projectContext,
    }));
  } else {
    for (const ref of frontMatter.sourceRefs) {
      if (!refExists(root, ref)) {
        result.blocks.push(issue("PROJECT_SOURCE_REF_INVALID", `PROJECT-CONTEXT sourceRef is missing: ${ref}`, {
          path: result.config.paths.projectContext,
        }));
      }
    }
  }
  const verifiedAt = Date.parse(frontMatter.verifiedAt);
  const reviewAfterDays = Number(frontMatter.reviewAfterDays);
  if (Number.isFinite(verifiedAt) && Number.isFinite(reviewAfterDays)) {
    const ageDays = (Date.now() - verifiedAt) / 86_400_000;
    if (ageDays > reviewAfterDays) {
      result.warnings.push(issue("PROJECT_CONTEXT_STALE", `PROJECT-CONTEXT review is ${Math.floor(ageDays)} days old.`, {
        path: result.config.paths.projectContext,
      }));
    }
  }
  result.projectFrontMatter = frontMatter;
  result.projectDescription = content
    .replace(/^---[\s\S]*?---\s*/, "")
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.startsWith("#"))?.trim() || "";
}

function validateWorkState(work, taskMetadata, result) {
  if (!isPlainObject(work)) {
    result.blocks.push(issue("SCHEMA_WORK_STATE", "WORK-STATE must be a JSON object."));
    return;
  }
  if (work.schemaVersion !== SCHEMA_VERSION || !Array.isArray(work.tasks)) {
    result.blocks.push(issue("SCHEMA_WORK_STATE", "WORK-STATE requires schemaVersion=1 and tasks[]."));
    return;
  }
  const ids = new Set();
  const closedIds = new Set(
    taskMetadata
      .filter((record) => record.value && ["closed", "completed", "released"].includes(record.value.status))
      .map((record) => record.value.id),
  );
  for (const [index, task] of work.tasks.entries()) {
    const location = `tasks[${index}]`;
    for (const key of [
      "id",
      "title",
      "status",
      "owner",
      "threadId",
      "branch",
      "baseSha",
      "scope",
      "forbidden",
      "acceptance",
      "nextAction",
      "blockers",
      "evidence",
      "updatedAt",
    ]) {
      const nullable = key === "threadId";
      if (
        task?.[key] === undefined ||
        task?.[key] === "" ||
        (!nullable && task?.[key] === null)
      ) {
        result.blocks.push(issue("SCHEMA_TASK_FIELD", `${location}.${key} is required.`, {
          path: result.config.paths.workState,
        }));
      }
    }
    if (ids.has(task?.id)) {
      result.blocks.push(issue("DUPLICATE_TASK_ID", `Duplicate open task id: ${task.id}`, {
        path: result.config.paths.workState,
      }));
    }
    ids.add(task?.id);
    if (closedIds.has(task?.id)) {
      result.blocks.push(issue(
        "CLOSED_TASK_STILL_OPEN",
        `${task.id} is closed in TASK-LOG but remains in WORK-STATE.`,
        { path: result.config.paths.workState, taskId: task.id },
      ));
    }
    if (task?.status === "blocked") {
      if (!Array.isArray(task.blockers) || task.blockers.length === 0) {
        result.blocks.push(issue("BLOCKED_TASK_NO_BLOCKER", `${task.id} is blocked but has no blocker record.`, {
          path: result.config.paths.workState,
          taskId: task.id,
        }));
      } else {
        for (const blocker of task.blockers) {
          if (!blocker.reason || !blocker.owner || !blocker.nextCheck) {
            result.blocks.push(issue(
              "BLOCKER_INCOMPLETE",
              `${task.id} blocker needs reason, owner, and nextCheck.`,
              { path: result.config.paths.workState, taskId: task.id },
            ));
          }
        }
      }
    }
    validateEvidenceRefs(result.root, task?.id, task?.evidence, result.config.paths.workState, result);
    if (
      result.config.git?.requireBaseShaAncestor &&
      result.git.enabled &&
      result.git.available &&
      task?.baseSha &&
      task.baseSha !== "HEAD" &&
      !result.git.isAncestor(task.baseSha, "HEAD")
    ) {
      result.blocks.push(issue("TASK_BASE_SHA_INVALID", `${task.id} baseSha is not an ancestor of HEAD.`, {
        path: result.config.paths.workState,
        taskId: task.id,
      }));
    }
    if (task?.status === "active") {
      const updatedAt = Date.parse(task.updatedAt);
      if (Number.isFinite(updatedAt) && Date.now() - updatedAt > 72 * 3_600_000) {
        result.warnings.push(issue("OPEN_TASK_STALE", `${task.id} active task has not changed for over 72 hours.`, {
          path: result.config.paths.workState,
          taskId: task.id,
        }));
      }
    }
  }
  result.taskMetadata = taskMetadata;
}

function validateReleaseState(root, release, result, mode) {
  if (!isPlainObject(release)) {
    result.blocks.push(issue("SCHEMA_RELEASE_STATE", "RELEASE-STATE must be a JSON object."));
    return;
  }
  if (release.schemaVersion !== SCHEMA_VERSION || !isPlainObject(release.environments)) {
    result.blocks.push(issue("SCHEMA_RELEASE_STATE", "RELEASE-STATE requires schemaVersion=1 and environments{}."));
  }
  for (const [environmentName, environment] of Object.entries(release.environments || {})) {
    for (const [targetName, target] of Object.entries(environment || {})) {
      if (!isPlainObject(target)) {
        result.blocks.push(issue("SCHEMA_RELEASE_TARGET", `${environmentName}.${targetName} must be an object.`));
        continue;
      }
      validateEvidenceRefs(
        root,
        `${environmentName}.${targetName}`,
        target.evidence,
        result.config.paths.releaseState,
        result,
      );
      if (["deployed", "released"].includes(target.status) && !target.lastObservedAt) {
        result.blocks.push(issue(
          "RELEASE_CLAIM_UNOBSERVED",
          `${environmentName}.${targetName} claims ${target.status} without lastObservedAt.`,
          { path: result.config.paths.releaseState },
        ));
      }
    }
    const server = environment?.server;
    if (server && ["deployed", "released"].includes(server.status)) {
      if (!server.buildSha) {
        result.blocks.push(issue("RELEASE_BUILD_SHA_MISSING", `${environmentName}.server.buildSha is required.`));
      }
      if (result.git.enabled && result.git.available && server.buildSha && !result.git.commitExists(server.buildSha)) {
        result.blocks.push(issue(
          "RELEASE_BUILD_SHA_UNKNOWN",
          `${environmentName}.server.buildSha does not exist in Git: ${server.buildSha}`,
          { path: result.config.paths.releaseState },
        ));
      }
      let manifestBuildSha = null;
      if (server.manifest?.path) {
        const manifestPath = path.join(root, server.manifest.path);
        if (!fs.existsSync(manifestPath)) {
          result.blocks.push(issue(
            "RELEASE_MANIFEST_MISSING",
            `${environmentName} manifest file is missing: ${server.manifest.path}`,
            { path: server.manifest.path },
          ));
        } else {
          const manifestBytes = fs.readFileSync(manifestPath);
          if (server.manifest.sha256 && sha256(manifestBytes) !== server.manifest.sha256) {
            result.blocks.push(issue(
              "RELEASE_MANIFEST_HASH",
              `${environmentName} manifest SHA256 does not match.`,
              { path: server.manifest.path },
            ));
          }
          try {
            const manifest = JSON.parse(manifestBytes.toString("utf8"));
            manifestBuildSha = manifest.buildSha;
          } catch (error) {
            result.blocks.push(issue(
              "RELEASE_MANIFEST_INVALID",
              `${environmentName} manifest is not valid JSON: ${error.message}`,
              { path: server.manifest.path },
            ));
          }
        }
      }
      let observedBuildSha = null;
      if (server.versionFile?.path) {
        const versionPath = path.join(root, server.versionFile.path);
        if (!fs.existsSync(versionPath)) {
          result.blocks.push(issue(
            "RELEASE_VERSION_FILE_MISSING",
            `${environmentName} version observation file is missing: ${server.versionFile.path}`,
            { path: server.versionFile.path },
          ));
        } else {
          try {
            const observed = readJson(versionPath);
            observedBuildSha = observed.buildSha;
          } catch (error) {
            result.blocks.push(issue(
              "RELEASE_VERSION_FILE_INVALID",
              `${environmentName} version observation is not valid JSON: ${error.message}`,
              { path: server.versionFile.path },
            ));
          }
        }
      } else if (mode === "release") {
        result.blocks.push(issue(
          "RELEASE_VERSION_OBSERVATION_MISSING",
          `${environmentName} release claim has no captured /version observation file.`,
          { path: result.config.paths.releaseState },
        ));
      }
      const claims = [
        ["RELEASE-STATE", server.buildSha],
        ["manifest", manifestBuildSha],
        ["version", observedBuildSha],
      ].filter(([, value]) => value);
      if (new Set(claims.map(([, value]) => value)).size > 1) {
        result.blocks.push(issue(
          "RELEASE_VERSION_DRIFT",
          `${environmentName} build SHA mismatch: ${claims.map(([name, value]) => `${name}=${value}`).join(", ")}`,
          { path: result.config.paths.releaseState, action: "Stop release and reconcile declared, manifest, and observed versions." },
        ));
      }
    }
  }

  for (const gate of release.externalGates || []) {
    validateEvidenceRefs(root, gate.id, gate.evidence, result.config.paths.releaseState, result);
    if (["verified", "released", "deployed"].includes(gate.status)) {
      if (!gate.lastCheckedAt) {
        result.blocks.push(issue("EXTERNAL_GATE_UNOBSERVED", `${gate.id} is verified without lastCheckedAt.`, {
          path: result.config.paths.releaseState,
        }));
      }
      if (!Array.isArray(gate.evidence) || gate.evidence.length === 0) {
        result.blocks.push(issue("EXTERNAL_GATE_EVIDENCE_MISSING", `${gate.id} is verified without evidence.`, {
          path: result.config.paths.releaseState,
        }));
      }
      const checkedAt = Date.parse(gate.lastCheckedAt);
      const maxAgeHours = Number(
        gate.maxAgeHours || result.config.releaseScan?.maxExternalEvidenceAgeHours || 168,
      );
      if (Number.isFinite(checkedAt) && Date.now() - checkedAt > maxAgeHours * 3_600_000) {
        result.blocks.push(issue(
          "EXTERNAL_GATE_STALE",
          `${gate.id} evidence is older than ${maxAgeHours} hours.`,
          { path: result.config.paths.releaseState, action: "Recheck the external system and attach a fresh receipt." },
        ));
      }
    }
    if (gate.status === "waiting_external" && !gate.nextCheck) {
      result.warnings.push(issue("EXTERNAL_NEXT_CHECK_MISSING", `${gate.id} has no nextCheck.`, {
        path: result.config.paths.releaseState,
      }));
    }
  }
}

function scanReleaseCandidates(root, config, result, mode) {
  const scanConfig = config.releaseScan || {};
  const allFiles = walkFiles(root);
  const include = scanConfig.include || [];
  const exclude = scanConfig.exclude || [];
  const candidates = allFiles.filter(
    (file) => matchesAnyGlob(file, include) && !matchesAnyGlob(file, exclude),
  );
  const secretPatterns = [
    {
      code: "SECRET_PRIVATE_KEY",
      pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/m,
      message: "private key material",
    },
    {
      code: "SECRET_AWS_KEY",
      pattern: /\bAKIA[0-9A-Z]{16}\b/m,
      message: "AWS access key pattern",
    },
    {
      code: "SECRET_GITHUB_TOKEN",
      pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/m,
      message: "GitHub token pattern",
    },
    {
      code: "SECRET_OPENAI_TOKEN",
      pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/m,
      message: "API token pattern",
    },
  ];
  const placeholders = scanConfig.placeholders || [];
  for (const file of candidates) {
    const content = readText(path.join(root, file));
    for (const secret of secretPatterns) {
      const match = secret.pattern.exec(content);
      if (match) {
        result.blocks.push(issue(secret.code, `${file} contains ${secret.message}.`, {
          path: file,
          line: lineNumberAt(content, match.index),
          action: "Remove and revoke the credential before release.",
        }));
      }
    }
    if (mode === "release") {
      for (const placeholder of placeholders) {
        const expression = new RegExp(escapeRegExp(placeholder), "m");
        const match = expression.exec(content);
        if (match) {
          result.blocks.push(issue(
            "RELEASE_PLACEHOLDER",
            `${file} still contains release placeholder /${placeholder}/.`,
            {
              path: file,
              line: lineNumberAt(content, match.index),
              action: "Replace the placeholder with approved production content.",
            },
          ));
        }
      }
    }
  }
  result.metrics.releaseScanFiles = candidates.length;
}

function sourceHashes(root, config) {
  const sourcePaths = [
    config.paths.projectContext,
    config.paths.productContract,
    config.paths.decisionLog,
    config.paths.workState,
    config.paths.releaseState,
    config.paths.taskLog,
    ...(config.role?.enabled ? [config.paths.roleContract] : []),
  ];
  return Object.fromEntries(
    sourcePaths.map((relativePath) => {
      const filePath = path.join(root, relativePath);
      return [
        relativePath,
        fs.existsSync(filePath) ? sha256(fs.readFileSync(filePath)) : "MISSING",
      ];
    }),
  );
}

function buildResumePayload(context) {
  const roleContract = context.roleContract;
  const directorBinding = roleContract?.bindings?.find((binding) => binding.profile === "director");
  const lines = [
    "# CONTEXT RESUME",
    "",
    "> GENERATED FILE. DO NOT EDIT.",
    "> Rebuild with `context-resilience --write`; do not add facts here.",
    "",
    "## 0. ROLE-CARD",
  ];
  if (roleContract && directorBinding) {
    const profile = roleContract.profiles.director;
    const budget = profile.verificationBudget;
    lines.push(
      "```text",
      "ROLE-GATE director",
      `roleContract=${context.config.paths.roleContract}#profiles.director`,
      `roleRevision=${roleContract.revision}`,
      `directorThreads=${roleContract.bindings.filter((binding) => binding.profile === "director").map((binding) => binding.threadId).join(",")}`,
      "handoffRequired=true",
      `purpose=${profile.purpose || "context_firewall"}`,
      "discovery=dispatch_first",
      "diagnose=dispatch_first",
      "implement=forbidden",
      "verify=named_evidence_only",
      "keep=goal,user_decisions,task_ids,thread_ids,state,evidence_pointers,blockers,next_action",
      `verifyBudget=${budget.maxReadOperationsPerDelivery}_decision_evidence,${budget.maxNamedFiles}_named_file,${budget.maxNamedCommands}_named_command,${budget.maxPreciseThreadReads}_precise_thread_read`,
      "forbid=broad_search,raw_session_scan,rollout_parse,broad_code_read,debug,implementation,long_log_analysis,follow_on_audit",
      "if_role_unknown=STOP_AND_RUN_CONTEXT_DOCTOR_ROLE",
      "```",
    );
  } else {
    lines.push(
      "```text",
      "ROLE-GATE unbound",
      "actorMode=worker_by_default",
      "if_role_expected=READ_ROLE_CONTRACT_AND_STOP",
      "```",
    );
  }
  lines.push(
    "",
    "## 1. Project",
    `- name: ${context.config.projectName}`,
    `- purpose: ${context.projectDescription || "(see PROJECT-CONTEXT.md)"}`,
    "",
    "## 2. Repository Snapshot",
    `- branch: ${context.git.branch || "(not a git worktree)"}`,
    `- head: ${context.git.head || "(not available)"}`,
    `- worktree: ${context.git.dirty == null ? "unknown" : context.git.dirty ? "dirty" : "clean"}`,
    "",
    "## 3. Binding Rules",
  );
  const activeRules = (context.contract?.items || []).filter((rule) => ACTIVE_RULE_STATUSES.has(rule.status));
  for (const rule of activeRules.slice(0, 8)) {
    lines.push(`- ${rule.id}: ${rule.statement}`);
  }
  if (activeRules.length === 0) {
    lines.push("- none");
  }
  if (activeRules.length > 8) {
    lines.push(`- ... ${activeRules.length - 8} more in ${context.config.paths.productContract}`);
  }
  lines.push("", "## 4. Open Work");
  const tasks = context.work?.tasks || [];
  for (const task of tasks.slice(0, 5)) {
    lines.push(`- ${task.id}: ${task.status}; next=${task.nextAction}`);
    lines.push(`  owner=${task.owner || "unknown"}; thread=${task.threadId || "none"}`);
    if (task.acceptance?.length) {
      lines.push(`  acceptance=${task.acceptance.join("; ")}`);
    }
    if (task.evidence?.length) {
      lines.push(`  evidence=${task.evidence.join(",")}`);
    }
    if (task.blockers?.length) {
      lines.push(`  blockers=${task.blockers.map((blocker) => blocker.reason).join("; ")}`);
    }
  }
  if (tasks.length === 0) {
    lines.push("- none");
  }
  lines.push("", "## 5. Release State");
  for (const [environmentName, environment] of Object.entries(context.release?.environments || {})) {
    const server = environment?.server;
    if (server) {
      lines.push(`- ${environmentName}.server: ${server.status}; buildSha=${server.buildSha || "unknown"}`);
    }
    for (const [targetName, target] of Object.entries(environment || {})) {
      if (targetName !== "server" && target?.status) {
        lines.push(`- ${environmentName}.${targetName}: ${target.status}${target.version ? `; version=${target.version}` : ""}`);
      }
    }
  }
  lines.push("", "## 6. External Gates");
  const gates = context.release?.externalGates || [];
  for (const gate of gates.slice(0, 5)) {
    lines.push(`- ${gate.id}: ${gate.status}; ${gate.summary}`);
  }
  if (gates.length === 0) {
    lines.push("- none");
  }
  lines.push(
    "",
    "## 7. Next Reads",
    `- project: ${context.config.paths.projectContext}`,
    `- rules: ${context.config.paths.productContract}`,
    `- decisions: ${context.config.paths.decisionLog}`,
    `- work: ${context.config.paths.workState}`,
    `- release: ${context.config.paths.releaseState}`,
    `- task evidence: ${context.config.paths.taskLog}`,
    "",
    "## 8. Operating Boundary",
    "- Treat this file as navigation only; verify claims in the referenced source.",
    "- Block on contradictions, missing evidence, stale external gates, or version drift.",
    "- Never deploy, mutate production data, or spend money without explicit authorization.",
  );
  return `${lines.join("\n")}\n`;
}

function generateResume(context) {
  const payload = buildResumePayload(context);
  const metadata = {
    schemaVersion: SCHEMA_VERSION,
    kitVersion: KIT_VERSION,
    generatedAt: new Date().toISOString(),
    sourceHashes: sourceHashes(context.root, context.config),
    headAtGeneration: context.git.head,
    payloadSha256: sha256(payload),
  };
  return `<!-- context-resume-meta ${JSON.stringify(metadata)} -->\n\n${payload}`;
}

function parseResumeMetadata(content) {
  const match = content.match(/^<!--\s*context-resume-meta\s*(\{[\s\S]*?\})\s*-->/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function validateResume(context, result) {
  if (!fs.existsSync(path.join(context.root, context.config.paths.contextResume))) {
    result.blocks.push(issue(
      "RESUME_MISSING",
      "CONTEXT-RESUME.md is missing.",
      { path: context.config.paths.contextResume, action: "Run context-resilience --write." },
    ));
    return;
  }
  const content = readText(path.join(context.root, context.config.paths.contextResume));
  if (content.split(/\r?\n/).length > 120) {
    result.warnings.push(issue("RESUME_TOO_LONG", "CONTEXT-RESUME exceeds 120 lines.", {
      path: context.config.paths.contextResume,
    }));
  }
  if (Buffer.byteLength(content, "utf8") > 8 * 1024) {
    result.warnings.push(issue("RESUME_TOO_LARGE", "CONTEXT-RESUME exceeds 8 KiB.", {
      path: context.config.paths.contextResume,
    }));
  }
  const metadata = parseResumeMetadata(content);
  if (!metadata) {
    result.blocks.push(issue("RESUME_METADATA_INVALID", "CONTEXT-RESUME metadata is missing or invalid.", {
      path: context.config.paths.contextResume,
      action: "Regenerate instead of editing the file.",
    }));
    return;
  }
  const expectedHashes = sourceHashes(context.root, context.config);
  if (!deepEqual(metadata.sourceHashes, expectedHashes)) {
    result.blocks.push(issue("RESUME_SOURCE_STALE", "CONTEXT-RESUME source hashes are stale.", {
      path: context.config.paths.contextResume,
      action: "Run context-resilience --write after reviewing the changed sources.",
    }));
  }
  const markerEnd = content.indexOf("-->");
  const payload = content.slice(markerEnd + 3).replace(/^\r?\n+/, "");
  const expectedPayload = buildResumePayload(context);
  if (sha256(payload) !== metadata.payloadSha256 || payload !== expectedPayload) {
    result.blocks.push(issue("RESUME_TAMPERED", "CONTEXT-RESUME payload does not match its source-derived content.", {
      path: context.config.paths.contextResume,
      action: "Discard manual edits and regenerate the file.",
    }));
  }
  if (
    context.git.enabled &&
    context.git.available &&
    metadata.headAtGeneration &&
    metadata.headAtGeneration !== context.git.head
  ) {
    if (!context.git.isAncestor(metadata.headAtGeneration, "HEAD")) {
      result.blocks.push(issue("RESUME_HEAD_DIVERGED", "Generated HEAD is not an ancestor of current HEAD.", {
        path: context.config.paths.contextResume,
      }));
    } else {
      result.warnings.push(issue("RESUME_HEAD_BEHIND", "Repository HEAD advanced after RESUME generation.", {
        path: context.config.paths.contextResume,
      }));
    }
  }
}

function loadContext(root, mode, config) {
  const filePath = (relativePath) => path.join(root, relativePath);
  const context = {
    root,
    mode,
    config,
    git: null,
    projectContext: null,
    contract: null,
    decisions: null,
    work: null,
    release: null,
    taskLog: "",
  };
  context.git = gitState(root, config);
  const required = Object.entries(config.paths)
    .filter(([key]) => (
      (key !== "roleContract" || config.role?.enabled) &&
      (key !== "contextResume" || mode !== "write")
    ))
    .map(([, value]) => value);
  for (const relativePath of required) {
    if (!fs.existsSync(filePath(relativePath))) {
      const parsed = { path: relativePath };
      context.missing = (context.missing || []).concat(parsed);
    }
  }
  const readOptional = (relativePath) => (
    fs.existsSync(filePath(relativePath)) ? readText(filePath(relativePath)) : null
  );
  context.projectContext = readOptional(config.paths.projectContext);
  context.taskLog = readOptional(config.paths.taskLog) || "";

  const readJsonOptional = (relativePath) => {
    if (!fs.existsSync(filePath(relativePath))) {
      return null;
    }
    try {
      return readJson(filePath(relativePath));
    } catch (error) {
      context.jsonErrors = (context.jsonErrors || []).concat({
        path: relativePath,
        message: error.message,
      });
      return null;
    }
  };
  context.contract = readJsonOptional(config.paths.productContract);
  context.roleContract = config.role?.enabled
    ? readJsonOptional(config.paths.roleContract)
    : null;
  context.work = readJsonOptional(config.paths.workState);
  context.release = readJsonOptional(config.paths.releaseState);
  const decisionText = readOptional(config.paths.decisionLog);
  context.decisions = decisionText == null ? null : parseDecisionLog(decisionText);
  return context;
}

function runDoctor(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const mode = options.mode || "fast";
  const result = {
    root,
    mode,
    status: "PASS",
    blocks: [],
    warnings: [],
    metrics: {},
    facts: {},
    git: null,
    config: null,
    decisions: new Map(),
    activeDecisionsByKey: new Map(),
    taskMetadata: [],
  };

  let loaded;
  try {
    loaded = loadConfig(root);
    result.config = loaded.config;
  } catch (error) {
    result.status = "CONFIG_ERROR";
    result.blocks.push(issue("CONFIG_INVALID", `.context-resilience.json is invalid: ${error.message}`));
    return result;
  }

  const context = loadContext(root, mode, result.config);
  result.git = context.git;
  for (const missing of context.missing || []) {
    result.blocks.push(issue("REQUIRED_FILE_MISSING", `Required context file is missing: ${missing.path}`, {
      path: missing.path,
    }));
  }
  for (const error of context.jsonErrors || []) {
    result.blocks.push(issue("JSON_PARSE_ERROR", `Cannot parse ${error.path}: ${error.message}`, {
      path: error.path,
    }));
  }

  if (context.projectContext) {
    validateProjectContext(root, context.projectContext, result);
  }
  if (context.contract) {
    validateProductContract(context.contract, result);
  }
  if (context.decisions) {
    validateDecisionLog(context.decisions, result);
  }
  validateRuleDecisionBindings(context.contract, result);
  validateRoleContract(context.roleContract, result);

  for (const rule of context.contract?.items || []) {
    validateEvidenceRefs(root, rule.id, rule.evidence, result.config.paths.productContract, result);
  }
  const taskMetadata = parseTaskMetadata(context.taskLog);
  for (const record of taskMetadata) {
    if (record.parseError) {
      result.blocks.push(issue("TASK_META_INVALID", `TASK-LOG metadata is invalid: ${record.parseError}`, {
        path: result.config.paths.taskLog,
        line: record.line,
      }));
      continue;
    }
    const value = record.value;
    for (const key of [
      "id",
      "status",
      "baseSha",
      "commits",
      "verificationLevel",
      "verifiedBy",
      "changed",
      "notChanged",
      "evidence",
      "risks",
    ]) {
      if (value?.[key] === undefined || value?.[key] === null) {
        result.blocks.push(issue("TASK_META_FIELD", `TASK-LOG entry ${value?.id || "?"} is missing ${key}.`, {
          path: result.config.paths.taskLog,
          line: record.line,
        }));
      }
    }
    validateEvidenceRefs(root, value?.id, value?.evidence, result.config.paths.taskLog, result);
    if (
      result.config.git?.enabled &&
      result.git.available &&
      Array.isArray(value?.commits)
    ) {
      for (const commit of value.commits) {
        if (commit && commit !== "HEAD" && !result.git.commitExists(commit)) {
          result.blocks.push(issue("TASK_COMMIT_INVALID", `${value.id} references missing commit ${commit}.`, {
            path: result.config.paths.taskLog,
            line: record.line,
          }));
        }
      }
    }
  }

  if (context.work) {
    validateWorkState(context.work, taskMetadata, result);
  }
  if (context.release) {
    validateReleaseState(root, context.release, result, mode);
  }
  runRuleProbes(root, context.contract, result, mode);
  scanReleaseCandidates(root, result.config, result, mode);

  if (mode !== "write") {
    const contextForResume = {
      ...context,
      config: result.config,
      projectDescription: result.projectDescription,
    };
    validateResume(contextForResume, result);
  }
  if (mode === "role" && options.roleRequest !== undefined) {
    validateRoleRequest(root, context.roleContract, options.roleRequest, result, context.work);
  }

  result.metrics.ruleCount = context.contract?.items?.length || 0;
  result.metrics.openTasks = context.work?.tasks?.length || 0;
  result.metrics.decisionCount = context.decisions?.length || 0;
  result.metrics.externalGates = context.release?.externalGates?.length || 0;
  result.metrics.blockCount = result.blocks.length;
  result.metrics.warningCount = result.warnings.length;
  result.context = context;
  result.facts = {
    ...result.facts,
    ...queryContext(context),
  };
  result.status = result.blocks.length > 0 ? "BLOCK" : "PASS";
  return result;
}

function writeResume(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const loaded = loadConfig(root);
  let context;
  if (options.allowInvalid) {
    context = loadContext(root, "write", loaded.config);
  } else {
    const preflight = runDoctor({ root, mode: "write" });
    if (preflight.status !== "PASS") {
      throw new Error(
        `Refusing to write a resume from invalid sources:\n${formatHuman(preflight)}`,
      );
    }
    context = preflight.context;
  }
  const projectFrontMatter = context.projectContext
    ? parseYamlFrontMatter(context.projectContext)
    : null;
  const projectDescription = context.projectContext
    ? context.projectContext
      .replace(/^---[\s\S]*?---\s*/, "")
      .split(/\r?\n/)
      .find((line) => line.trim() && !line.startsWith("#"))?.trim() || ""
    : "";
  context.projectDescription = projectDescription;
  context.projectFrontMatter = projectFrontMatter;
  const outputPath = path.join(root, loaded.config.paths.contextResume);
  writeText(outputPath, generateResume(context));
  return {
    root,
    outputPath,
    config: loaded.config,
  };
}

function queryContext(context) {
  const activeRules = (context.contract?.items || [])
    .filter((rule) => ACTIVE_RULE_STATUSES.has(rule.status));
  const tasks = context.work?.tasks || [];
  const gates = context.release?.externalGates || [];
  const production = context.release?.environments?.production || {};
  return {
    projectName: context.config.projectName,
    branch: context.git?.branch || null,
    head: context.git?.head || null,
    decisions: Object.fromEntries(
      (context.decisions || [])
        .filter((record) => record.value && ACTIVE_RULE_STATUSES.has(record.value.status))
        .map((record) => [record.value.id, record.value.outcome]),
    ),
    ruleIds: activeRules.map((rule) => rule.id),
    ruleStatements: Object.fromEntries(activeRules.map((rule) => [rule.id, rule.statement])),
    openTasks: tasks.map((task) => ({
      id: task.id,
      status: task.status,
      nextAction: task.nextAction,
    })),
    productionStatus: production.server?.status || null,
    productionBuildSha: production.server?.buildSha || null,
    externalGates: gates.map((gate) => ({
      id: gate.id,
      status: gate.status,
    })),
    blockingGateIds: gates
      .filter((gate) => !["verified", "released", "deployed"].includes(gate.status))
      .map((gate) => gate.id),
    roleProfiles: Object.fromEntries(
      (context.roleContract?.bindings || []).map((binding) => [binding.threadId, binding.profile]),
    ),
    roleRevision: context.roleContract?.revision || null,
  };
}

function formatHuman(result) {
  const lines = [];
  lines.push(`CONTEXT ${result.status}`);
  lines.push(
    `mode=${result.mode} head=${shortSha(result.git?.head) || "none"} branch=${result.git?.branch || "none"} ` +
    `rules=${result.metrics.ruleCount} open=${result.metrics.openTasks} blocks=${result.blocks.length} warnings=${result.warnings.length}`,
  );
  if (result.blocks.length === 0 && result.warnings.length === 0) {
    lines.push(
      `checks=schema,refs,decisions,tasks,release,resume,secrets${result.facts.roleDecision ? ",role" : ""}`,
    );
    if (result.facts.roleDecision) {
      lines.push(`roleDecision=${result.facts.roleDecision} intent=${result.facts.roleIntent || "unknown"}`);
    }
    lines.push(`next=${result.mode === "release" ? "record release evidence and rerun --release" : "continue with task-scoped reads"}`);
    return lines.join("\n");
  }
  for (const warning of result.warnings.slice(0, 4)) {
    const location = warning.path ? ` ${warning.path}${warning.line ? `:${warning.line}` : ""}` : "";
    lines.push(`WARN ${warning.code}${location} ${warning.message}`);
  }
  for (const block of result.blocks.slice(0, Math.max(0, 14 - lines.length))) {
    const location = block.path ? ` ${block.path}${block.line ? `:${block.line}` : ""}` : "";
    lines.push(`BLOCK ${block.code}${location}${block.ruleId ? ` [${block.ruleId}]` : ""}`);
    lines.push(`  ${block.message}`);
    if (block.action) {
      lines.push(`  action: ${block.action}`);
    }
  }
  const omitted = Math.max(0, result.blocks.length + result.warnings.length - (lines.length - 2));
  if (omitted > 0) {
    lines.push(`more=${omitted}; run with --json for the complete list`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    mode: "fast",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") {
      options.root = argv[++index];
    } else if (arg === "--fast") {
      options.mode = "fast";
    } else if (arg === "--deep") {
      options.mode = "deep";
    } else if (arg === "--release") {
      options.mode = "release";
    } else if (arg === "--role") {
      options.mode = "role";
    } else if (arg === "--role-input") {
      options.roleInput = argv[++index];
    } else if (arg === "--write") {
      options.mode = "write";
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--version") {
      options.version = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  return [
    `context-resilience ${KIT_VERSION}`,
    "Usage: context-resilience [--root DIR] [--fast|--deep|--release|--role|--write] [--role-input FILE] [--json]",
    "",
    "  --fast      Validate schemas, references, decisions, tasks, release claims, resume freshness, and secrets.",
    "  --deep      Same checks plus every configured rule probe and release-candidate scan.",
    "  --release   Strict release gate: version drift, stale external gates, placeholders, and evidence.",
    "  --role      Validate actor bindings and, with --role-input, an action plan before execution.",
    "  --write     Regenerate CONTEXT-RESUME.md from structured sources.",
    "  --json      Print the complete machine-readable result.",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${printHelp()}\n`);
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${KIT_VERSION}\n`);
    return 0;
  }
  if (options.mode === "write") {
    const result = writeResume(options);
    const output = {
      status: "WROTE",
      output: toPosix(path.relative(result.root, result.outputPath)),
    };
    process.stdout.write(options.json ? `${JSON.stringify(output, null, 2)}\n` : `WROTE ${output.output}\n`);
    return 0;
  }
  if (options.roleInput) {
    const roleInputPath = path.resolve(options.root, options.roleInput);
    try {
      options.roleRequest = readJson(roleInputPath);
    } catch (error) {
      process.stderr.write(`CONTEXT CONFIG_ERROR\nCannot read role input ${roleInputPath}: ${error.message}\n`);
      return 2;
    }
  }
  const result = runDoctor(options);
  if (options.json) {
    const serializable = {
      ...result,
      decisions: undefined,
      activeDecisionsByKey: undefined,
      context: undefined,
      blocks: result.blocks,
      warnings: result.warnings,
    };
    process.stdout.write(`${JSON.stringify(serializable, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatHuman(result)}\n`);
  }
  return result.status === "PASS" ? 0 : 1;
}

module.exports = {
  DEFAULT_CONFIG,
  KIT_VERSION,
  buildResumePayload,
  classifyRolePrompt,
  formatHuman,
  generateResume,
  loadConfig,
  loadContext,
  main,
  parseDecisionLog,
  parseResumeMetadata,
  parseTaskMetadata,
  parseYamlFrontMatter,
  queryContext,
  readJson,
  runDoctor,
  sha256,
  sourceHashes,
  validateRoleContract,
  validateRoleRequest,
  walkFiles,
  writeResume,
};

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`CONTEXT CONFIG_ERROR\n${error.stack || error.message}\n`);
    process.exitCode = 2;
  }
}
