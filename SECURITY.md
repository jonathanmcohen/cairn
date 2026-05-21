# Security Policy

Cairn is a self-hosted personal/team tool. We take security reports seriously
but cannot offer a paid bug bounty.

## Supported Versions

Only the latest `0.x` minor release is supported.

## Reporting a Vulnerability

Please report vulnerabilities by opening a private security advisory on GitHub:
https://github.com/jonathanmcohen/cairn/security/advisories/new

Include:

- A description of the issue.
- Steps to reproduce.
- Affected Cairn version (visible at `/api/health`).
- Suggested severity.

You can expect an initial acknowledgement within 7 days. We'll coordinate a
fix and a coordinated disclosure window if appropriate.

## Out of Scope

- Issues that require attacker-controlled access to the host or database.
- Self-hosted misconfigurations (e.g., a public Cairn instance with weak passwords).
- DoS via large payloads — Cairn enforces `CAIRN_MAX_UPLOAD_MB` and reasonable
  request limits; report only if there's a path to amplification.
