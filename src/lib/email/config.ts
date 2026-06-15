import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';
import { openSecret, sealSecret } from '@/lib/crypto/secret-box';
import { invalidateTransport } from './transport';

type Db = PostgresJsDatabase<typeof schema>;

// Read secrets/SMTP from process.env DIRECTLY, not the cached env(): env()
// memoizes on first call, so tests that mutate process.env (and any
// hypothetical runtime change) would otherwise see stale values. See CLAUDE.md.
function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

type SmtpEnv = {
  host: string | null;
  port: number;
  user: string | null;
  pass: string | null;
  from: string | null;
  secure: boolean;
};

function readSmtpEnv(): SmtpEnv {
  const port = Number(process.env.SMTP_PORT);
  return {
    host: process.env.SMTP_HOST ?? null,
    port: Number.isFinite(port) && port > 0 ? port : 587,
    user: process.env.SMTP_USER ?? null,
    pass: process.env.SMTP_PASS ?? null,
    from: process.env.SMTP_FROM ?? null,
    secure: process.env.SMTP_SECURE === 'true',
  };
}

export const TLS_MODES = ['starttls', 'tls', 'none'] as const;
export type TlsMode = (typeof TLS_MODES)[number];

const SINGLETON_ID = 'singleton';

/**
 * The effective SMTP config the transport actually sends with. Carries the
 * decrypted password — server-only, never serialized to the client (see
 * {@link getEmailConfigForDisplay} for the masked view).
 */
export type EffectiveEmailConfig = {
  host: string;
  port: number;
  tlsMode: TlsMode;
  user: string | null;
  pass: string | null;
  from: string;
  replyTo: string | null;
  source: 'db' | 'env';
};

/** Masked, client-safe view of the config — never includes the password. */
export type EmailConfigDisplay = {
  configured: boolean;
  source: 'db' | 'env' | 'none';
  host: string;
  port: number;
  tlsMode: TlsMode;
  username: string;
  fromAddress: string;
  replyTo: string;
  passwordSet: boolean;
};

export type SaveEmailConfigInput = {
  host: string;
  port: number;
  tlsMode: TlsMode;
  username: string | null;
  /** undefined = keep existing, non-empty string = replace, null = clear. */
  password?: string | null;
  fromAddress: string;
  replyTo: string | null;
};

function tlsModeFromSecure(secure: boolean): TlsMode {
  return secure ? 'tls' : 'starttls';
}

async function readRow(db: Db): Promise<schema.InstanceEmailConfig | null> {
  const [row] = await db
    .select()
    .from(schema.instanceEmailConfig)
    .where(eq(schema.instanceEmailConfig.id, SINGLETON_ID))
    .limit(1);
  return row ?? null;
}

/** Effective config: DB row wins, else env `SMTP_*`, else null (email off). */
export async function getEffectiveEmailConfig(db: Db): Promise<EffectiveEmailConfig | null> {
  const row = await readRow(db);
  if (row) {
    let pass: string | null = null;
    if (row.passwordEncrypted) {
      try {
        pass = openSecret(row.passwordEncrypted, authSecret());
      } catch {
        pass = null; // tampered / wrong key → treat as no auth password
      }
    }
    return {
      host: row.host,
      port: row.port,
      tlsMode: (TLS_MODES as readonly string[]).includes(row.tlsMode)
        ? (row.tlsMode as TlsMode)
        : 'starttls',
      user: row.username ?? null,
      pass,
      from: row.fromAddress,
      replyTo: row.replyTo ?? null,
      source: 'db',
    };
  }
  const e = readSmtpEnv();
  if (!e.host) return null;
  return {
    host: e.host,
    port: e.port,
    tlsMode: tlsModeFromSecure(e.secure),
    user: e.user,
    pass: e.pass,
    from: e.from ?? e.user ?? 'cairn@localhost',
    replyTo: null,
    source: 'env',
  };
}

/** Masked view for the admin form. Never returns the password itself. */
export async function getEmailConfigForDisplay(db: Db): Promise<EmailConfigDisplay> {
  const cfg = await getEffectiveEmailConfig(db);
  if (!cfg) {
    return {
      configured: false,
      source: 'none',
      host: '',
      port: 587,
      tlsMode: 'starttls',
      username: '',
      fromAddress: '',
      replyTo: '',
      passwordSet: false,
    };
  }
  return {
    configured: true,
    source: cfg.source,
    host: cfg.host,
    port: cfg.port,
    tlsMode: cfg.tlsMode,
    username: cfg.user ?? '',
    fromAddress: cfg.from,
    replyTo: cfg.replyTo ?? '',
    passwordSet: cfg.pass != null && cfg.pass !== '',
  };
}

/**
 * Upsert the instance email config singleton. Password is write-once:
 * `password` undefined keeps the stored value, a non-empty string replaces it
 * (encrypted), an explicit empty string / null clears it. Invalidates the
 * cached transport so the next send picks up the change.
 */
export async function saveEmailConfig(
  db: Db,
  input: SaveEmailConfigInput,
  actorUserId: string | null,
): Promise<void> {
  const existing = await readRow(db);

  let passwordEncrypted: Buffer | null | undefined;
  if (input.password === undefined) {
    passwordEncrypted = existing?.passwordEncrypted ?? null;
  } else if (input.password === null || input.password === '') {
    passwordEncrypted = null;
  } else {
    passwordEncrypted = sealSecret(input.password, authSecret());
  }

  const values = {
    id: SINGLETON_ID,
    host: input.host,
    port: input.port,
    tlsMode: input.tlsMode,
    username: input.username,
    passwordEncrypted: passwordEncrypted ?? null,
    fromAddress: input.fromAddress,
    replyTo: input.replyTo,
    updatedAt: new Date(),
    updatedBy: actorUserId,
  };

  await db
    .insert(schema.instanceEmailConfig)
    .values(values)
    .onConflictDoUpdate({
      target: schema.instanceEmailConfig.id,
      set: {
        host: values.host,
        port: values.port,
        tlsMode: values.tlsMode,
        username: values.username,
        passwordEncrypted: values.passwordEncrypted,
        fromAddress: values.fromAddress,
        replyTo: values.replyTo,
        updatedAt: values.updatedAt,
        updatedBy: values.updatedBy,
      },
    });

  invalidateTransport();
}

/**
 * First-boot migration: copy the existing `SMTP_*` env into the DB row so the
 * admin sees today's values in the form. No-ops when a row already exists or no
 * env host is configured. Returns true iff a row was inserted.
 */
export async function migrateEnvEmailConfigOnce(db: Db): Promise<boolean> {
  const existing = await readRow(db);
  if (existing) return false;
  const e = readSmtpEnv();
  if (!e.host) return false;

  await db.insert(schema.instanceEmailConfig).values({
    id: SINGLETON_ID,
    host: e.host,
    port: e.port,
    tlsMode: tlsModeFromSecure(e.secure),
    username: e.user,
    passwordEncrypted: e.pass ? sealSecret(e.pass, authSecret()) : null,
    fromAddress: e.from ?? e.user ?? 'cairn@localhost',
    replyTo: null,
  });
  invalidateTransport();
  return true;
}

export type TestEmailResult = { ok: true } | { ok: false; error: string };

/**
 * Send a one-off test email to `to` using the effective config. Surfaces the
 * SMTP/nodemailer error string verbatim on failure so the admin can act on the
 * real reason. Returns `{ok:false, error:'not_configured'}` when email is off.
 */
export async function sendTestEmail(db: Db, to: string): Promise<TestEmailResult> {
  const { getTransport } = await import('./transport');
  const transport = await getTransport(db);
  if (!transport) return { ok: false, error: 'not_configured' };
  const cfg = await getEffectiveEmailConfig(db);
  const from = cfg?.from ?? 'cairn@localhost';
  try {
    await transport.sendMail({
      from,
      to,
      subject: 'Cairn test email',
      text: 'This is a test email from your Cairn instance. SMTP is configured correctly.',
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
