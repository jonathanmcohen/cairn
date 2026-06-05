import { describe, expect, it } from 'vitest';
import journal from '../../../drizzle/migrations/meta/_journal.json' with { type: 'json' };

// Regression guard for the v0.9.9 → v0.9.10 upgrade outage.
//
// drizzle's migrator (pg-core dialect `migrate()`) decides what to run by:
//   run entry IFF  max(applied.created_at) < entry.when
// where `entry.when` is the journal `when` field. It does NOT track applied
// migrations individually — it compares every journal entry against the single
// highest applied timestamp. So a migration whose `when` is <= an already-
// applied migration's `when` is SILENTLY SKIPPED on upgrade.
//
// v0.9.9 shipped 0063–0068 with hand-stamped `when` values EARLIER than 0062's,
// so on any DB that already had 0062 applied, drizzle skipped 0063–0068 and the
// boot-time `assertNoPendingMigrations` guard crash-looped the container.
//
// The Testcontainers harness applies *.sql in filename order (not via drizzle's
// `when` logic), so fresh-DB CI never caught it. These tests encode the actual
// invariant drizzle requires.

type Entry = { idx: number; when: number; tag: string };
const entries = (journal as { entries: Entry[] }).entries;

describe('migration journal `when` ordering (drizzle upgrade-safety)', () => {
  it('the newest migration carries the globally-largest `when`', () => {
    // A new migration must always have a `when` greater than every prior entry,
    // otherwise drizzle skips it once an earlier-but-larger entry is applied.
    const maxWhen = Math.max(...entries.map((e) => e.when));
    const last = entries.reduce((a, b) => (b.idx > a.idx ? b : a));
    expect(
      last.when,
      `highest-idx migration ${last.tag} (when=${last.when}) must hold the max when (${maxWhen})`,
    ).toBe(maxWhen);
  });

  it('every migration from idx 62 onward strictly increases `when`', () => {
    // Active v0.9.x range. Earlier entries contain two historically
    // grandfathered dips (idx 42, and the 0040/0041 round-number inserts) that
    // are already applied in the field; the rule is enforced from 0062 forward,
    // which is where new migrations land.
    const tail = entries.filter((e) => e.idx >= 62).sort((a, b) => a.idx - b.idx);
    for (let i = 1; i < tail.length; i++) {
      expect(
        tail[i]!.when,
        `${tail[i]!.tag} (when=${tail[i]!.when}) must be > ${tail[i - 1]!.tag} (when=${tail[i - 1]!.when})`,
      ).toBeGreaterThan(tail[i - 1]!.when);
    }
  });
});
