import { getDb } from '@/db/client';
import { scanDigests } from '@/lib/email/digest';

async function main(): Promise<void> {
  const sent = await scanDigests(getDb());
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`[email:digest] sent ${sent} digest email(s)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[email:digest] failed', err);
  process.exit(1);
});
