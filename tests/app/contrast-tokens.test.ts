import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** Extract `--name: H S% L%;` from inside the `.dark { ... }` block. */
function darkToken(name: string): [number, number, number] {
  const dark = css.slice(css.indexOf('.dark {'), css.indexOf('@theme inline'));
  const m = dark.match(new RegExp(`--${name}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  if (!m) throw new Error(`missing dark token --${name}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
}

function lum([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(a: [number, number, number], b: [number, number, number]): number {
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('dark-mode semantic token contrast (AA, ≥4.5:1 on --card)', () => {
  const card = hslToRgb(...darkToken('card'));
  for (const token of ['destructive', 'success', 'warning'] as const) {
    it(`--${token} text reads ≥4.5:1 on the dark card`, () => {
      const fg = hslToRgb(...darkToken(token));
      expect(ratio(fg, card)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
