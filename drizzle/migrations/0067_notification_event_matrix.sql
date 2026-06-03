-- 0067 — notification event-matrix expansion (#195).
-- (Plan I named this 0062, but 0062–0066 were already taken by landed work, so
-- the next free index is 0067.)
-- notifications.type is free-text; no enum to ALTER. We only seed the new
-- emailable per-type prefs rows for every existing workspace member, opt-in
-- (email_enabled / digest_only default false), idempotent via ON CONFLICT
-- against the (user_id, workspace_id, notification_type) primary key.
INSERT INTO notification_email_prefs (user_id, workspace_id, notification_type, email_enabled, digest_only)
SELECT wm.user_id, wm.workspace_id, t.notification_type, false, false
FROM workspace_members wm
CROSS JOIN (VALUES ('page_approval'), ('page_status'), ('page_lock')) AS t(notification_type)
ON CONFLICT (user_id, workspace_id, notification_type) DO NOTHING;
