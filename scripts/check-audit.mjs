#!/usr/bin/env node
// Fail if `pnpm audit --json` reports any high/critical advisory not covered by
// a non-expired entry in audit-ci-ignore.json. Usage: node check-audit.mjs <audit.json> <ignore.json>
import { readFileSync } from 'node:fs';

const [, , auditPath, ignorePath] = process.argv;
const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
const ignore = JSON.parse(readFileSync(ignorePath, 'utf8'));
const now = Date.now();

const active = new Set(
  (ignore.ignores ?? [])
    .filter((e) => {
      if (!e.id || !e.expires) {
        console.error(`ignore entry missing id/expires: ${JSON.stringify(e)}`);
        process.exit(2);
      }
      const exp = Date.parse(e.expires);
      if (Number.isNaN(exp)) {
        console.error(`ignore entry has invalid expires: ${e.expires}`);
        process.exit(2);
      }
      if (exp < now) {
        console.error(`ignore for ${e.id} EXPIRED on ${e.expires} — re-review or bump the dep`);
        return false;
      }
      return true;
    })
    .map((e) => String(e.id)),
);

// pnpm audit --json shape: { advisories: { <id>: { severity, ... } } } or NDJSON
// depending on version. Normalize both.
const advisories = [];
if (audit.advisories) {
  for (const a of Object.values(audit.advisories)) advisories.push(a);
} else if (Array.isArray(audit)) {
  for (const a of audit) if (a.advisory) advisories.push(a.advisory);
}

const blocking = advisories.filter(
  (a) =>
    ['high', 'critical'].includes(a.severity) && !active.has(String(a.id ?? a.github_advisory_id)),
);

if (blocking.length > 0) {
  console.error(`BLOCKING advisories (high/critical, not ignored): ${blocking.length}`);
  for (const a of blocking)
    console.error(`  - [${a.severity}] ${a.id ?? a.github_advisory_id}: ${a.title}`);
  process.exit(1);
}
