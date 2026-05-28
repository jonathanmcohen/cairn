type SparklineProps = {
  values: number[];
  width?: number;
  height?: number;
};

/**
 * Pure-SVG sparkline. No chart-library dep — just a path of M/L commands.
 * `values` is expected oldest-first; the spline scales to `max(1, ...values)`
 * so an all-zero input still renders a flat baseline (and never divides by 0).
 *
 * a11y: the `aria-label` summarizes total requests + day count so screen
 * readers don't see a meaningless "image" element.
 *
 * v0.9.0 G1 P10 — used in /settings/admin/api-keys for the 14d sparkline.
 */
export function Sparkline({ values, width = 100, height = 24 }: SparklineProps) {
  if (values.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        aria-label="No usage data"
        role="img"
        xmlns="http://www.w3.org/2000/svg"
      />
    );
  }
  const max = Math.max(1, ...values);
  const step = values.length === 1 ? 0 : width / (values.length - 1);
  const points = values.map((v, i) => {
    const x = i * step;
    const y = height - (v / max) * height;
    return { x, y };
  });
  const d = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const sum = values.reduce((a, b) => a + b, 0);
  return (
    <svg
      width={width}
      height={height}
      aria-label={`Total ${sum} requests across last ${values.length} days`}
      role="img"
      className="text-muted-foreground"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}
