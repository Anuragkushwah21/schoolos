import { ChartEmpty } from "@/components/charts/chart-figure";
import { Tooltip } from "@/components/charts/trend-area";

/**
 * Bars and columns.
 *
 * Shared specs, applied here once: marks capped at 24px so the band keeps its
 * air, a 4px rounded data-end with a square foot at the baseline, hairline
 * axes, and values labelled at the tip rather than on a grid of their own.
 */

/** A bar rounded only at the end the data grows towards. */
function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  grows: "right" | "up",
): string {
  const r = Math.max(0, Math.min(radius, grows === "right" ? width : height, 12));

  if (grows === "right") {
    const right = x + width;
    return `M ${x},${y} H ${right - r} Q ${right},${y} ${right},${y + r} V ${y + height - r} Q ${right},${y + height} ${right - r},${y + height} H ${x} Z`;
  }

  const bottom = y + height;
  return `M ${x},${bottom} V ${y + r} Q ${x},${y} ${x + r},${y} H ${x + width - r} Q ${x + width},${y} ${x + width},${y + r} V ${bottom} Z`;
}

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  /** Extra tooltip line. */
  detail?: string;
  /** Overrides the accent — used for the ordinal funnel ramp. */
  color?: string;
};

/**
 * Horizontal bars: the right form when labels are long or numerous, because
 * the text runs along the reading direction instead of being turned on its side.
 */
export function BarChart({
  data,
  formatValue = (value: number) => value.toLocaleString("en-IN"),
  labelWidth = 120,
  width = 720,
  emptyMessage = "Nothing to show yet.",
}: {
  data: BarDatum[];
  formatValue?: (value: number) => string;
  labelWidth?: number;
  /**
   * viewBox width. An SVG scales to its container, and its text scales with
   * it, so a chart in a narrow column needs a narrower viewBox to keep labels
   * at a readable size.
   */
  width?: number;
  emptyMessage?: string;
}) {
  if (!data.length) return <ChartEmpty>{emptyMessage}</ChartEmpty>;

  const W = width;
  const rowHeight = 30;
  const bar = 18;
  const right = 56;
  const H = data.length * rowHeight + 8;
  const max = Math.max(...data.map((row) => row.value), 1);
  const plotW = W - labelWidth - right;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${data.length} bars, highest ${formatValue(max)}.`}
    >
      <line
        x1={labelWidth}
        x2={labelWidth}
        y1={4}
        y2={H - 4}
        style={{ stroke: "var(--viz-axis)" }}
        strokeWidth={1}
      />

      {data.map((row, index) => {
        const y = index * rowHeight + 4;
        const width = Math.max((row.value / max) * plotW, row.value > 0 ? 3 : 0);
        const barY = y + (rowHeight - bar) / 2;

        return (
          <g key={row.key} className="group">
            <rect x={0} y={y} width={W} height={rowHeight} fill="transparent" tabIndex={0}>
              <title>
                {`${row.label}: ${formatValue(row.value)}${row.detail ? ` · ${row.detail}` : ""}`}
              </title>
            </rect>

            <text
              x={labelWidth - 10}
              y={y + rowHeight / 2 + 4}
              textAnchor="end"
              className="fill-foreground text-[12px]"
            >
              {row.label.length > 22 ? `${row.label.slice(0, 21)}…` : row.label}
            </text>

            <path
              d={barPath(labelWidth, barY, width, bar, 4, "right")}
              style={{ fill: row.color ?? "var(--viz-accent)" }}
              className="transition-opacity group-hover:opacity-85"
            />

            <text
              x={labelWidth + width + 8}
              y={y + rowHeight / 2 + 4}
              className="fill-muted-foreground text-[11px] tabular-nums"
            >
              {formatValue(row.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Columns over a time axis: one series, one colour, value on the tallest cap. */
export function ColumnChart({
  data,
  formatValue = (value: number) => value.toLocaleString("en-IN"),
  width = 720,
  emptyMessage = "Nothing to show yet.",
}: {
  data: BarDatum[];
  formatValue?: (value: number) => string;
  /** viewBox width — see `BarChart`. */
  width?: number;
  emptyMessage?: string;
}) {
  if (!data.length) return <ChartEmpty>{emptyMessage}</ChartEmpty>;

  const W = width;
  const H = 180;
  const PAD = { top: 20, right: 10, bottom: 26, left: 32 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(...data.map((row) => row.value), 1);
  const band = plotW / data.length;
  const bar = Math.min(band - 8, 24);
  const peak = data.reduce((best, row) => (row.value > best.value ? row : best), data[0]!);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={`${data.length} columns, highest ${formatValue(max)} in ${peak.label}.`}
    >
      {[0, max].map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={PAD.top + plotH - (tick / max) * plotH}
            y2={PAD.top + plotH - (tick / max) * plotH}
            style={{ stroke: "var(--viz-grid)" }}
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={PAD.top + plotH - (tick / max) * plotH + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[11px] tabular-nums"
          >
            {tick}
          </text>
        </g>
      ))}

      {data.map((row, index) => {
        const height = (row.value / max) * plotH;
        const x = PAD.left + index * band + (band - bar) / 2;
        const y = PAD.top + plotH - height;

        return (
          <g key={row.key} className="group">
            <rect
              x={PAD.left + index * band}
              y={PAD.top}
              width={band}
              height={plotH}
              fill="transparent"
              tabIndex={0}
            >
              <title>
                {`${row.label}: ${formatValue(row.value)}${row.detail ? ` · ${row.detail}` : ""}`}
              </title>
            </rect>

            {row.value > 0 ? (
              <path
                d={barPath(x, y, bar, height, 4, "up")}
                style={{ fill: row.color ?? "var(--viz-accent)" }}
                className="transition-opacity group-hover:opacity-85"
              />
            ) : null}

            <text
              x={PAD.left + index * band + band / 2}
              y={H - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {row.label}
            </text>

            {row.key === peak.key && row.value > 0 ? (
              <text
                x={PAD.left + index * band + band / 2}
                y={y - 6}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-medium tabular-nums"
              >
                {formatValue(row.value)}
              </text>
            ) : null}

            <Tooltip
              x={PAD.left + index * band + band / 2}
              y={y}
              width={W}
              lines={[row.label, formatValue(row.value), ...(row.detail ? [row.detail] : [])]}
            />
          </g>
        );
      })}
    </svg>
  );
}

export type StackSegment = { key: string; label: string; value: number; color: string };

/**
 * One horizontal bar split into parts of a whole — today's register, a
 * school's statuses. Segments are separated by a 2px gap in the surface
 * colour rather than by strokes, and a segment is labelled inside only when
 * the text actually fits.
 */
export function StackedBar({
  segments,
  emptyMessage = "Nothing marked yet.",
}: {
  segments: StackSegment[];
  emptyMessage?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (!total) return <ChartEmpty>{emptyMessage}</ChartEmpty>;

  const W = 720;
  const H = 48;
  const gap = 2;
  const present = segments.filter((segment) => segment.value > 0);

  // Offsets are computed up front rather than accumulated while mapping, so
  // rendering stays a pure function of the props.
  const offsets = present.reduce<number[]>((acc, segment, index) => {
    const previous = index === 0 ? 0 : acc[index - 1]! + (present[index - 1]!.value / total) * W;
    acc.push(index === 0 ? 0 : previous);
    return acc;
  }, []);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label={present
        .map((segment) => `${segment.label} ${Math.round((segment.value / total) * 100)}%`)
        .join(", ")}
    >
      {present.map((segment, index) => {
        const width = (segment.value / total) * W - (index < present.length - 1 ? gap : 0);
        const x = offsets[index]!;

        const share = Math.round((segment.value / total) * 100);
        const text = `${segment.value} · ${share}%`;
        const fits = width > text.length * 7 + 16;

        return (
          <g key={segment.key} className="group">
            <rect
              x={x}
              y={8}
              width={Math.max(width, 2)}
              height={28}
              rx={4}
              style={{ fill: segment.color }}
              className="transition-opacity group-hover:opacity-85"
            >
              <title>{`${segment.label}: ${segment.value} (${share}%)`}</title>
            </rect>
            {fits ? (
              <text
                x={x + width / 2}
                y={26}
                textAnchor="middle"
                className="text-[12px] font-medium"
                fill="#ffffff"
              >
                {text}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A ratio against a limit. The track is a light step of the same hue, so the
 * whole bar reads as one scale rather than fill-versus-background.
 */
export function Meter({
  value,
  max,
  label,
  tone = "accent",
}: {
  value: number;
  max: number;
  label: string;
  tone?: "accent" | "good" | "warning";
}) {
  const share = max > 0 ? Math.min(value / max, 1) : 0;
  const fill =
    tone === "good" ? "var(--viz-good)" : tone === "warning" ? "var(--viz-warning)" : "var(--viz-accent)";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{`${value} / ${max}`}</span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--viz-track)" }}
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: fill }} />
      </div>
    </div>
  );
}

/** A 12-point trend for a stat tile: context in grey, the latest point in accent. */
export function Sparkline({ values, ariaLabel }: { values: number[]; ariaLabel: string }) {
  const points = values.slice(-12);
  if (points.length < 2) return null;

  const W = 96;
  const H = 28;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min;
  const step = W / (points.length - 1);

  // An unvarying run (every day attended) has no shape to show, so it sits on
  // the middle line rather than being pinned to the top by a fake range.
  const y = (value: number) => (span === 0 ? H / 2 : H - 2 - ((value - min) / span) * (H - 6));

  const path = points.map((value, index) => `${index * step},${y(value)}`).join(" L ");
  const lastX = (points.length - 1) * step;
  const lastY = y(points[points.length - 1]!);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-24" role="img" aria-label={ariaLabel}>
      <path
        d={`M ${path}`}
        fill="none"
        style={{ stroke: "var(--viz-neutral)" }}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.6}
      />
      <circle cx={lastX} cy={lastY} r={2.5} style={{ fill: "var(--viz-accent)" }} />
    </svg>
  );
}
