# Cairn v0.9.7 — Audit-3 Plan Suite (UI reachability + ui-ux-pro-max quality)

**Branch:** `patches/v0.9.7` (single PR #160). **HOLD for explicit merge.**
**Origin:** full-app UI-reachability audit (14 domains) + ui-ux-pro-max quality review (10 surfaces) of the live build. Zero-deferral in v0.9.7.

| Plan | Title | Tasks | Closes |
|---|---|---|---|
| G14 | Nav reachability: wire orphaned settings/admin pages + /search + /favorites routes | 7 | #161 |
| G15 | DB filters editor + group-by picker + kanban + full-page DB route | 9 | #162 |
| G16 | Mount row/file comments, backlinks, approval submit, status, translations, reminders | 16 | #163 |
| G17 | Search mode toggle (semantic/hybrid) + /search results + federated opt-in | 14 | #164 |
| G18 | Connectors landing (config forms + create + conflicts) + chat-bridge admin nav | 10 | #165 |
| G19 | DOI/PubMed citation lookup slash entry + bibliography toggle | 8 | #166 |
| G20 | SSO per-IdP login buttons + page-ACL management UI/API | 15 | #167 |
| G21 | E2EE keypair enrollment + workspace rekey (make E2E functional end-to-end) | 14 | #168 |
| G22 | UI critical: reduced-motion, focus rings, dark-mode contrast, touch targets, destructive confirms, modal focus-trap | 15 | #169 |
| G23 | UI polish: emoji→lucide, loading/empty states, font-size, truncation tooltips, single-image lightbox | 21 | #170 |

**Total ≈ 129 tasks.** Build order: G14 → G15 → G16 → G17 → G18 → G19 → G20 → G22 → G23 → G21 (E2EE last; security-sensitive). Then version stays 0.9.7; CHANGELOG addendum + full gate + release.

Migrations: latest is 0056 (automation builder). G20 (page-ACL write) + G21 (keypair enrollment) may add 0057+ — implementers number sequentially.
