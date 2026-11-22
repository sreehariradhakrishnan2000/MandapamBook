#!/usr/bin/env node
// CodeQL gate for repositories that can't upload to code scanning (private, without GitHub
// Code Security). Fails on any error- or warning-level finding that isn't in the reviewed
// accepted list.
//
//   node scripts/codeql-gate.mjs <sarif-dir> [accepted.json] [repo-root]
//
// An accepted entry pins one finding: the rule, the file and the exact (trimmed) text of the
// flagged line, plus the reason it was accepted. Matching on text rather than line numbers
// survives unrelated edits, while the same rule firing on any other line still fails.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [sarifDir, acceptedPath = '.github/codeql/accepted-findings.json', root = '.'] =
  process.argv.slice(2);
if (!sarifDir) {
  console.error('usage: codeql-gate.mjs <sarif-dir> [accepted.json] [repo-root]');
  process.exit(2);
}

const accepted = existsSync(acceptedPath) ? JSON.parse(readFileSync(acceptedPath, 'utf8')) : [];
for (const [i, a] of accepted.entries()) {
  if (!a.rule || !a.path || !a.line || typeof a.reason !== 'string' || a.reason.length < 20) {
    console.error(`${acceptedPath}[${i}]: needs rule, path, line and a reason (20+ chars)`);
    process.exit(2);
  }
}

const sourceLine = (path, n) => {
  try {
    return readFileSync(join(root, path), 'utf8').split(/\r?\n/)[n - 1]?.trim() ?? '';
  } catch {
    return '';
  }
};

const findings = [];
for (const file of readdirSync(sarifDir).filter((f) => f.endsWith('.sarif'))) {
  const sarif = JSON.parse(readFileSync(join(sarifDir, file), 'utf8'));
  for (const run of sarif.runs ?? []) {
    for (const r of run.results ?? []) {
      const level = r.level ?? 'warning';
      if (level !== 'error' && level !== 'warning') continue;
      const loc = r.locations?.[0]?.physicalLocation;
      const path = loc?.artifactLocation?.uri ?? '?';
      const line = loc?.region?.startLine ?? 0;
      findings.push({
        rule: r.ruleId ?? r.rule?.id ?? '?',
        path,
        line,
        text: sourceLine(path, line),
        message: (r.message?.text ?? '').split('\n')[0],
      });
    }
  }
}

const used = new Set();
const failing = findings.filter((f) => {
  const i = accepted.findIndex((a) => a.rule === f.rule && a.path === f.path && a.line === f.text);
  if (i === -1) return true;
  used.add(i);
  return false;
});

const acceptedCount = findings.length - failing.length;
for (const [i, a] of accepted.entries()) {
  if (!used.has(i))
    console.log(`::warning::Accepted finding no longer reported; remove it: ${a.rule} ${a.path}`);
}
for (const f of failing) {
  console.log(`::error file=${f.path},line=${f.line}::${f.rule}: ${f.message}`);
}
if (failing.length > 0) {
  console.error(
    `CodeQL: ${failing.length} finding(s) to fix (${acceptedCount} accepted). Fix them, or if one is` +
      ` a reviewed false positive, add it to ${acceptedPath} with the reason.`,
  );
  process.exit(1);
}
console.log(`CodeQL: no unaccepted findings (${acceptedCount} accepted)`);
