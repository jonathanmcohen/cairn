import { describe, expect, it } from 'vitest';
import { parseArgs, parseDbUrl } from '../cli-internal.js';

describe('parseDbUrl', () => {
  it('parses a full postgres URL', () => {
    expect(parseDbUrl('postgres://cairn:s3cr3t@db.host:5433/cairndb')).toEqual({
      host: 'db.host',
      port: 5433,
      database: 'cairndb',
      user: 'cairn',
      password: 's3cr3t',
    });
  });

  it('defaults the port to 5432 when omitted', () => {
    expect(parseDbUrl('postgres://u:p@localhost/cairn').port).toBe(5432);
  });

  it('url-decodes user/password/db', () => {
    const r = parseDbUrl('postgres://u%40x:p%2Fw@h:5432/my%20db');
    expect(r.user).toBe('u@x');
    expect(r.password).toBe('p/w');
    expect(r.database).toBe('my db');
  });

  it('accepts the postgresql:// scheme', () => {
    expect(parseDbUrl('postgresql://u:p@h:5432/d').database).toBe('d');
  });

  it('throws on a non-postgres URL', () => {
    expect(() => parseDbUrl('mysql://u:p@h/d')).toThrow(/postgres/i);
  });

  it('throws when the database name is missing', () => {
    expect(() => parseDbUrl('postgres://u:p@h:5432/')).toThrow(/database/i);
  });
});

describe('parseArgs', () => {
  it('parses backup with --out', () => {
    expect(parseArgs(['backup', '--out', '/backups'])).toMatchObject({
      command: 'backup',
      out: '/backups',
      force: false,
    });
  });

  it('parses restore with --in and --force', () => {
    expect(parseArgs(['restore', '--in', '/b/x.tar', '--force'])).toMatchObject({
      command: 'restore',
      in: '/b/x.tar',
      force: true,
    });
  });

  it('defaults force to false', () => {
    expect(parseArgs(['restore', '--in', '/b/x.tar']).force).toBe(false);
  });

  it('throws on an unknown command', () => {
    expect(() => parseArgs(['nuke'])).toThrow(/unknown command/i);
  });

  it('throws when backup is missing --out', () => {
    expect(() => parseArgs(['backup'])).toThrow(/--out/);
  });

  it('throws when restore is missing --in', () => {
    expect(() => parseArgs(['restore', '--force'])).toThrow(/--in/);
  });
});
