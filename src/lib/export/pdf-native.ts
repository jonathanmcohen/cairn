import type { Browser } from '@playwright/test';
import { pageToPdfHtml } from './pdf';

// biome-ignore lint/suspicious/noExplicitAny: mirrors pageToPdfHtml's ExportPage shape
type ExportPage = { id: string; title: string; content: any };

/**
 * Headless-Chromium singleton. Lazy-launched on first pageToPdf call inside the
 * process; reused for every subsequent call. Closing per-request would add the
 * full Chromium boot cost (~1.5s cold) to every PDF — the v0.8.0 design
 * §6 risk #6 calls for the singleton explicitly.
 */
let browserPromise: Promise<Browser> | null = null;
let sigtermHandlerInstalled = false;

function installSigtermHandlerOnce(): void {
  if (sigtermHandlerInstalled) return;
  sigtermHandlerInstalled = true;
  // Gracefully close the browser when the container is asked to terminate.
  // Best-effort: if close throws, we exit anyway — the process is going away.
  const close = async (): Promise<void> => {
    const p = browserPromise;
    browserPromise = null;
    if (p) {
      try {
        const b = await p;
        await b.close();
      } catch {
        // ignore — the process is shutting down
      }
    }
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    installSigtermHandlerOnce();
    // Dynamic import so next-build standalone never traces @playwright/test
    // at module-load time. The standalone bundle omits playwright-core/browsers.json,
    // causing a module-load crash for EVERY export format (md/json/html/docx too)
    // if this is a static import (#140). Only reached when CAIRN_NATIVE_PDF==='1'.
    const { chromium } = await import('@playwright/test');
    browserPromise = chromium.launch({
      // Sandboxing is intentionally permissive — Cairn runs as a single
      // user in its container; matches the v0.6 P14 a11y-test launch flags.
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browserPromise;
}

/**
 * Render `page` to a real PDF Buffer via headless Chromium. Uses the
 * existing `pageToPdfHtml(page)` so every block type prints identically to
 * the browser-print HTML fallback path; only the rasterizer differs.
 *
 * Letter format, 1-inch margins, backgrounds printed. `networkidle` waits
 * for inlined images/styles to settle. The returned bytes begin with the
 * `%PDF-` magic header.
 */
export async function pageToPdf(page: ExportPage): Promise<Buffer> {
  const html = pageToPdfHtml(page);
  const browser = await getBrowser();
  const pwPage = await browser.newPage();
  try {
    await pwPage.setContent(html, { waitUntil: 'networkidle' });
    const buf = await pwPage.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '1in', bottom: '1in', left: '1in', right: '1in' },
    });
    return buf;
  } finally {
    await pwPage.close();
  }
}

/** Test-only: close the singleton between integration tests. */
export async function closePdfNativeBrowserForTests(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) {
    const b = await p;
    await b.close();
  }
}
