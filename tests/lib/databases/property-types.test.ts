import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/db/migrate';
import * as schema from '@/db/schema';
import { propertyType } from '@/db/schema';
import { propTypeLabel } from '@/lib/databases/property-labels';
import { coerce } from '@/lib/databases/rows';
import { createT } from '@/lib/i18n/t';
import enMessages from '../../../messages/en.json';
import { startPostgres, stopPostgres } from '../../helpers/db';

const t = createT('en', enMessages as Record<string, string>);

describe('property-type labels (#242)', () => {
  it('renders Title-Case labels via i18n', () => {
    expect(propTypeLabel('multi_select', t)).toBe('Multi-select');
    expect(propTypeLabel('created_time', t)).toBe('Created time');
    expect(propTypeLabel('last_edited_by', t)).toBe('Last edited by');
    expect(propTypeLabel('text', t)).toBe('Text');
  });
});

describe('new property types: enum + coercion (#243)', () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const uri = await startPostgres();
    await runMigrations(uri);
    sql = postgres(uri);
  });

  afterAll(async () => {
    await sql.end();
    await stopPostgres();
  });

  it('enum includes the 8 new members after migration', () => {
    for (const v of [
      'person',
      'file',
      'email',
      'phone',
      'created_time',
      'last_edited_time',
      'created_by',
      'last_edited_by',
    ]) {
      expect(propertyType.enumValues).toContain(v);
    }
  });

  it('the property_type pg enum was extended in the DB', async () => {
    const rows = (await sql`
      SELECT e.enumlabel AS label
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'property_type'
    `) as unknown as Array<{ label: string }>;
    const labels = rows.map((r) => r.label);
    expect(labels).toContain('person');
    expect(labels).toContain('last_edited_by');
  });

  it('db_rows.updated_by column exists', async () => {
    const rows = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'db_rows' AND column_name = 'updated_by'
    `) as unknown as Array<{ column_name: string }>;
    expect(rows.length).toBe(1);
  });

  it('coerce email lowercases + validates', () => {
    expect(coerce('email', 'A@B.COM')).toBe('a@b.com');
    expect(coerce('email', 'not an email')).toBeNull();
  });

  it('coerce phone trims string', () => {
    expect(coerce('phone', ' +1 (555) ')).toBe('+1 (555)');
    expect(coerce('phone', 42)).toBeNull();
  });

  it('coerce person dedupes id array', () => {
    expect(coerce('person', ['a', 'a', 'b', '', '  '])).toEqual(['a', 'b']);
    expect(coerce('person', 'nope')).toEqual([]);
  });

  it('coerce file keeps object-shaped entries only', () => {
    const files = [{ id: '1', name: 'a.png' }];
    expect(coerce('file', files)).toEqual(files);
    expect(coerce('file', ['bad', 1, null])).toEqual([]);
    expect(coerce('file', 'nope')).toEqual([]);
  });

  it('coerce computed types never persist a value', () => {
    expect(coerce('created_time', '2024-01-01')).toBeNull();
    expect(coerce('last_edited_time', Date.now())).toBeNull();
    expect(coerce('created_by', 'uid')).toBeNull();
    expect(coerce('last_edited_by', 'uid')).toBeNull();
  });

  void schema;
});
