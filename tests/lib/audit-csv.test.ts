// v0.10.0 D2 — RFC-4180 CSV serializer for the audit-log export. Pure unit
// tests: no DB, no HTTP. Covers quoting, the formula-injection guard (all
// four trigger chars), metadata-in-one-cell, and the fixed header row.
import { describe, expect, it } from 'vitest';
import {
  AUDIT_CSV_COLUMNS,
  auditCsvHeader,
  auditCsvRows,
  auditEntriesToCsv,
  csvField,
} from '@/lib/audit/csv';
import type { EnrichedAuditEntry } from '@/lib/audit/enrich';

function entry(overrides: Partial<EnrichedAuditEntry> = {}): EnrichedAuditEntry {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    workspaceId: '22222222-2222-2222-2222-222222222222',
    actorUserId: '33333333-3333-3333-3333-333333333333',
    action: 'page.published',
    targetType: 'page',
    targetId: '44444444-4444-4444-4444-444444444444',
    metadata: {},
    ip: '203.0.113.7',
    createdAt: new Date('2026-06-11T12:00:00.000Z'),
    actorName: 'Ada Lovelace',
    targetTitle: 'Plain title',
    targetHref: '/pages/44444444-4444-4444-4444-444444444444',
    ...overrides,
  };
}

/** Tiny RFC-4180 parser (quoted fields, doubled quotes, CRLF records). */
function parseCsv(raw: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (raw.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      record.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' && raw.charAt(i + 1) === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 2;
      continue;
    }
    if (ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

const METADATA_COL = AUDIT_CSV_COLUMNS.indexOf('metadata');
const TITLE_COL = AUDIT_CSV_COLUMNS.indexOf('targetTitle');

describe('csvField — RFC-4180 quoting', () => {
  it('passes plain values through unquoted', () => {
    expect(csvField('hello world')).toBe('hello world');
  });

  it('serializes null/undefined as the empty field', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('serializes Dates as ISO-8601', () => {
    expect(csvField(new Date('2026-06-11T12:00:00.000Z'))).toBe('2026-06-11T12:00:00.000Z');
  });

  it('quotes fields containing a comma', () => {
    expect(csvField('a,b')).toBe('"a,b"');
  });

  it('quotes fields containing a double-quote and doubles internal quotes', () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes fields containing LF and CR', () => {
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('line1\r\nline2')).toBe('"line1\r\nline2"');
  });
});

describe('csvField — formula-injection guard', () => {
  it.each(['=', '+', '-', '@'])('prefixes a leading %s with an apostrophe', (trigger) => {
    expect(csvField(`${trigger}payload`)).toBe(`'${trigger}payload`);
  });

  it('guards the audit trap title verbatim', () => {
    expect(csvField(`=cmd|' /C calc'!A0`)).toBe(`'=cmd|' /C calc'!A0`);
  });

  it('leaves trigger characters that are not the first char alone', () => {
    expect(csvField('a=b')).toBe('a=b');
    expect(csvField('x@y.example')).toBe('x@y.example');
  });

  it('applies the guard before quoting (guarded + quoted compose)', () => {
    expect(csvField('=a,b')).toBe(`"'=a,b"`);
  });
});

describe('auditCsvHeader — fixed column list', () => {
  it('emits the documented columns in order, CRLF-terminated', () => {
    expect(auditCsvHeader()).toBe(
      'id,workspaceId,createdAt,action,actorUserId,actorName,targetType,targetId,targetTitle,targetHref,ip,metadata\r\n',
    );
    expect(auditCsvHeader()).toBe(`${AUDIT_CSV_COLUMNS.join(',')}\r\n`);
  });
});

describe('auditCsvRows / auditEntriesToCsv', () => {
  it('serializes jsonb metadata (with comma, quote, newline) into ONE logical cell', () => {
    const metadata = { note: 'comma, "quoted"\nnewline', n: 2 };
    const csv = auditEntriesToCsv([entry({ metadata })]);
    const records = parseCsv(csv);
    expect(records).toHaveLength(2); // header + 1 data row despite nasty metadata
    const row = records[1] as string[];
    expect(row).toHaveLength(AUDIT_CSV_COLUMNS.length);
    expect(JSON.parse(row[METADATA_COL] as string)).toEqual(metadata);
  });

  it('guards a hostile targetTitle so the cell starts with an apostrophe', () => {
    const csv = auditEntriesToCsv([entry({ targetTitle: `=cmd|' /C calc'!A0` })]);
    expect(csv).toContain(`,'=cmd|' /C calc'!A0,`);
    const row = parseCsv(csv)[1] as string[];
    expect(row[TITLE_COL]).toBe(`'=cmd|' /C calc'!A0`);
  });

  it('emits one CRLF-terminated record per entry and round-trips every field', () => {
    const e = entry();
    const csv = auditEntriesToCsv([e, entry({ id: '55555555-5555-5555-5555-555555555555' })]);
    expect(csv.endsWith('\r\n')).toBe(true);
    const records = parseCsv(csv);
    expect(records).toHaveLength(3);
    const row = records[1] as string[];
    expect(row[AUDIT_CSV_COLUMNS.indexOf('id')]).toBe(e.id);
    expect(row[AUDIT_CSV_COLUMNS.indexOf('workspaceId')]).toBe(e.workspaceId);
    expect(row[AUDIT_CSV_COLUMNS.indexOf('createdAt')]).toBe('2026-06-11T12:00:00.000Z');
    expect(row[AUDIT_CSV_COLUMNS.indexOf('action')]).toBe('page.published');
    expect(row[AUDIT_CSV_COLUMNS.indexOf('actorName')]).toBe('Ada Lovelace');
    expect(row[AUDIT_CSV_COLUMNS.indexOf('ip')]).toBe('203.0.113.7');
    expect(row[METADATA_COL]).toBe('{}');
  });

  it('serializes null enrichment fields as empty cells', () => {
    const csv = auditCsvRows([
      entry({ actorUserId: null, actorName: null, targetTitle: null, targetHref: null, ip: null }),
    ]);
    const row = parseCsv(`${auditCsvHeader()}${csv}`)[1] as string[];
    expect(row[AUDIT_CSV_COLUMNS.indexOf('actorUserId')]).toBe('');
    expect(row[AUDIT_CSV_COLUMNS.indexOf('actorName')]).toBe('');
    expect(row[TITLE_COL]).toBe('');
    expect(row[AUDIT_CSV_COLUMNS.indexOf('targetHref')]).toBe('');
    expect(row[AUDIT_CSV_COLUMNS.indexOf('ip')]).toBe('');
  });
});
