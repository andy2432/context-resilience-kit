#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  formatHuman,
  sha256,
  writeResume,
} = require("../scripts/context-resilience");

const SKILL_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(SKILL_ROOT, "../..");
const CLI = path.join(SKILL_ROOT, "scripts", "context-resilience.js");
const FIXTURE = path.join(SKILL_ROOT, "examples", "synthetic-repo");
const REPORT_PATH = path.join(REPO_ROOT, "reports", "boundary-report.json");

function rmSafe(target) {
  const resolved = path.resolve(target);
  const tempRoot = path.resolve(os.tmpdir());
  if (!resolved.startsWith(tempRoot + path.sep)) {
    throw new Error(`Refusing to remove path outside temp root: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function walk(root, current = root) {
  const output = [];
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) {
      continue;
    }
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      output.push(...walk(root, fullPath));
    } else if (entry.isFile()) {
      const relativePath = path.relative(root, fullPath).replaceAll("\\", "/");
      output.push({
        path: relativePath,
        hash: sha256(fs.readFileSync(fullPath)),
      });
    }
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

function snapshot(root) {
  return Object.fromEntries(walk(root).map((item) => [item.path, item.hash]));
}

function changedPaths(before, after) {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths]
    .filter((relativePath) => before[relativePath] !== after[relativePath])
    .sort();
}

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
  if (execution.status !== 0 && execution.status !== 1) {
    throw new Error(`Unexpected CLI exit ${execution.status}: ${execution.stderr}`);
  }
  return JSON.parse(execution.stdout);
}

function main() {
  const start = new Date().toISOString();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "context-resilience-boundary-"));
  const fixtureRoot = path.join(tempRoot, "fixture");
  fs.cpSync(FIXTURE, fixtureRoot, { recursive: true });
  writeResume({ root: fixtureRoot });

  const checks = [];
  const beforeReadOnly = snapshot(fixtureRoot);
  const outputs = {};
  for (const mode of ["fast", "deep", "release", "role"]) {
    const result = runCli(fixtureRoot, mode);
    outputs[mode] = {
      status: result.status,
      humanOutput: formatHuman(result),
      humanOutputLines: formatHuman(result).split(/\r?\n/).length,
    };
  }
  const afterReadOnly = snapshot(fixtureRoot);
  const readOnlyChanges = changedPaths(beforeReadOnly, afterReadOnly);
  checks.push({
    id: "B01",
    requirement: "fast/deep/release/role checks do not modify the business tree",
    passed: readOnlyChanges.length === 0,
    evidence: { changedPaths: readOnlyChanges },
  });
  checks.push({
    id: "B02",
    requirement: "normal output remains below 20 lines",
    passed: Object.values(outputs).every((output) => output.humanOutputLines < 20),
    evidence: Object.fromEntries(
      Object.entries(outputs).map(([mode, output]) => [mode, output.humanOutputLines]),
    ),
  });

  const beforeWrite = snapshot(fixtureRoot);
  writeResume({ root: fixtureRoot });
  const afterWrite = snapshot(fixtureRoot);
  const writeChanges = changedPaths(beforeWrite, afterWrite);
  checks.push({
    id: "B03",
    requirement: "explicit write mode only changes CONTEXT-RESUME.md",
    passed: writeChanges.every((relativePath) => relativePath === "context/CONTEXT-RESUME.md"),
    evidence: { changedPaths: writeChanges },
  });

  const sensitivePatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bsk-[A-Za-z0-9_-]{24,}\b/,
  ];
  const files = walk(REPO_ROOT).filter((item) => (
    !item.path.startsWith("reports/") &&
    !item.path.startsWith(".git/")
  ));
  const findings = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(REPO_ROOT, file.path), "utf8");
    sensitivePatterns.forEach((pattern, index) => {
      if (pattern.test(content)) {
        findings.push({ path: file.path, patternIndex: index });
      }
    });
  }
  checks.push({
    id: "B04",
    requirement: "public repository contains no high-confidence credential material",
    passed: findings.length === 0,
    evidence: { scannedFiles: files.length, findings },
  });

  const core = fs.readFileSync(
    path.join(SKILL_ROOT, "scripts", "context-resilience.js"),
    "utf8",
  );
  const forbiddenRuntime = [
    "node:http",
    "node:https",
    "node:net",
    "node:tls",
  ].filter((moduleName) => core.includes(moduleName));
  checks.push({
    id: "B05",
    requirement: "doctor core has no network client or deployment integration",
    passed: forbiddenRuntime.length === 0,
    evidence: { forbiddenRuntime },
  });

  const privateContentPatterns = [
    {
      id: "windows_user_home_path",
      pattern: /[A-Z]:\\Users\\/i,
    },
    {
      id: "codex_private_thread_id",
      pattern: /\b01a[0-9a-f]{8}-[0-9a-f-]{20,}\b/i,
    },
    {
      id: "unix_private_workspace_path",
      pattern: /\/Users\/[^/\s]+\/Documents\/Codex/i,
    },
  ];
  const privateContentFindings = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(REPO_ROOT, file.path), "utf8");
    for (const marker of privateContentPatterns) {
      if (marker.pattern.test(content)) {
        privateContentFindings.push({
          path: file.path,
          marker: marker.id,
        });
      }
    }
  }
  checks.push({
    id: "B06",
    requirement: "public repository contains no internal workspace paths or private coordination IDs",
    passed: privateContentFindings.length === 0,
    evidence: { findings: privateContentFindings },
  });

  const installRoot = path.join(tempRoot, "install-mapping");
  const templateRoot = path.join(SKILL_ROOT, "templates");
  fs.mkdirSync(path.join(installRoot, "context"), { recursive: true });
  fs.copyFileSync(
    path.join(templateRoot, ".context-resilience.json"),
    path.join(installRoot, ".context-resilience.json"),
  );
  for (const entry of fs.readdirSync(templateRoot, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === ".context-resilience.json") {
      continue;
    }
    fs.copyFileSync(
      path.join(templateRoot, entry.name),
      path.join(installRoot, "context", entry.name),
    );
  }
  fs.mkdirSync(path.join(installRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(installRoot, "src", "index.js"),
    'const PUBLIC_MODE = "safe";\nmodule.exports = { PUBLIC_MODE };\n',
    "utf8",
  );
  let installMappingPassed = true;
  let installMappingError = null;
  try {
    writeResume({ root: installRoot });
    const fast = runCli(installRoot, "fast");
    const role = runCli(installRoot, "role");
    installMappingPassed = fast.status === "PASS" && role.status === "PASS";
  } catch (error) {
    installMappingPassed = false;
    installMappingError = error.message;
  }
  checks.push({
    id: "B07",
    requirement: "documented template-to-context installation mapping works end to end",
    passed: installMappingPassed,
    evidence: { error: installMappingError },
  });

  const invalidRoot = path.join(tempRoot, "missing-sources");
  fs.mkdirSync(invalidRoot, { recursive: true });
  const invalidWrite = spawnSync(
    process.execPath,
    [CLI, "--root", invalidRoot, "--write"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    },
  );
  checks.push({
    id: "B08",
    requirement: "write mode fails closed when required context sources are missing",
    passed:
      invalidWrite.status !== 0 &&
      !fs.existsSync(path.join(invalidRoot, "context", "CONTEXT-RESUME.md")),
    evidence: {
      exitCode: invalidWrite.status,
      resumeCreated: fs.existsSync(path.join(invalidRoot, "context", "CONTEXT-RESUME.md")),
    },
  });

  const placeholderRoot = path.join(tempRoot, "literal-placeholder");
  fs.cpSync(FIXTURE, placeholderRoot, { recursive: true });
  const placeholderConfigPath = path.join(placeholderRoot, ".context-resilience.json");
  const placeholderConfig = JSON.parse(fs.readFileSync(placeholderConfigPath, "utf8"));
  placeholderConfig.releaseScan.placeholders = ["[CONTACT_REQUIRED]"];
  fs.writeFileSync(
    placeholderConfigPath,
    `${JSON.stringify(placeholderConfig, null, 2)}\n`,
    "utf8",
  );
  fs.mkdirSync(path.join(placeholderRoot, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(placeholderRoot, "src", "mention.js"),
    "module.exports = { status: 'CONTACT_REQUIRED' };\n",
    "utf8",
  );
  writeResume({ root: placeholderRoot });
  const literalSafe = runCli(placeholderRoot, "release");
  fs.writeFileSync(
    path.join(placeholderRoot, "src", "placeholder.js"),
    "module.exports = { status: '[CONTACT_REQUIRED]' };\n",
    "utf8",
  );
  writeResume({ root: placeholderRoot });
  const literalBlocked = runCli(placeholderRoot, "release");
  checks.push({
    id: "B09",
    requirement: "configured placeholders are matched literally rather than as character classes",
    passed:
      literalSafe.status === "PASS" &&
      literalBlocked.status === "BLOCK" &&
      literalBlocked.blocks.some((block) => block.code === "RELEASE_PLACEHOLDER"),
    evidence: {
      safeStatus: literalSafe.status,
      blockedStatus: literalBlocked.status,
      blockedCodes: literalBlocked.blocks.map((block) => block.code),
    },
  });

  rmSafe(tempRoot);
  const report = {
    schemaVersion: 1,
    startedAt: start,
    generatedAt: new Date().toISOString(),
    node: process.version,
    checks,
    passed: checks.every((check) => check.passed),
    outputs,
  };
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  for (const check of checks) {
    process.stdout.write(`${check.passed ? "PASS" : "FAIL"} ${check.id} ${check.requirement}\n`);
  }
  return report.passed ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
