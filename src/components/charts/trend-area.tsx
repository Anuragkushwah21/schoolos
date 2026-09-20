import { ChartEmpty } from "@/components/charts/chart-figure";

/**
 * A single series over time: 2px line, a 10% wash beneath it, hairline grid.
 *
 * One series, so there is no legend — the caption says what is plotted. Days
 * with no register are gaps, not zeroes: a holiday is not 0% attendance, and
 * drawing it as one would be a lie the reader cannot see.
 *
 * Hover is CSS only. Each day owns a full-height hit target; hovering or
 * tabbing to it reveals that day's dot and tooltip, so the chart stays a
 * Server Component with no JavaScript shipped for it at all.
 */

export type TrendDatum = {
  key: string;
  label: string;
  /** null draws a gap. */
  value: number | null;
  /** Extra line in the tooltip, e.g. "38 of 40 present". */
  detail?: string;
};

const W = 720;
const H = 200;
const PAD = { top: 14, right: 14, bottom: 26, left: 36 };

export function TrendArea({
  data,
  max = 100,
  suffix = "%",
  emptyMessage = "Nothing marked yet.",
}: {
  data: TrendDatum[];
  max?: number;
  suffix?: string;
  emptyMessage?: string;
}) {
  const drawable = data.filter((point) => point.value !== null);
  if (drawable.length < 2) return <ChartEmpty>{emptyMessage}</ChartEmpty>;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const step = data.length > 1 ? plotW / (data.length - 1) : plotW;

  const x = (index: number) => PAD.left + index * step;
  const y = (value: number) => PAD.top + plotH - (Math.min(value, max) / max) * plotH;

  // Split into runs of consecutive marked days, so gaps break the line.
  const runs: Array<Array<{ index: number; value: number }>> = [];
  let run: Array<{ index: number; value: number }> = [];
  data.forEach((point, index) => {
    if (point.value === null) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push({ index, value: point.value });
    }
  });
  if (run.length) runs.push(run);

  const ticks = [0, max / 2, max];
  const labelEvery = Math.max(1, Math.ceil(data.length / 6));
  const last = drawable[drawable.length - 1]!;
  const lastIndex = data.findIndex((point) => point.key === last.key);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full overflow-visible"
      role="img"
      aria-label={`Trend over ${data.length} days, ending at ${last.value}${suffix}.`}
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(tick)}
            y2={y(tick)}
            style={{ stroke: "var(--viz-grid)" }}
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={y(tick) + 4}
            textAnchor="end"
            className="fill-muted-foreground text-[11px] tabular-nums"
          >
            {`${tick}${suffix}`}
          </text>
        </g>
      ))}

      {runs.map((segment, segmentIndex) => {
        const line = segment.map((p) => `${x(p.index)},${y(p.value)}`).join(" L ");
        const areaPath = `M ${x(segment[0]!.index)},${y(0)} L ${line} L ${x(
          segment[segment.length - 1]!.index,
        )},${y(0)} Z`;

        return (
          <g key={segmentIndex}>
            <path d={areaPath} style={{ fill: "var(--viz-accent)" }} opacity={0.1} />
            <path
              d={`M ${line}`}
              fill="none"
              style={{ stroke: "var(--viz-accent)" }}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}

      {/* The endpoint is the one value worth labelling directly. */}
      <circle
        cx={x(lastIndex)}
        cy={y(last.value!)}
        r={4}
        style={{ fill: "var(--viz-accent)", stroke: "var(--viz-surface)" }}
        strokeWidth={2}
      />
      <text
        x={x(lastIndex) + (lastIndex > data.length - 3 ? -8 : 8)}
        y={last.value! > max * 0.85 ? y(last.value!) + 16 : y(last.value!) - 10}
        textAnchor={lastIndex > data.length - 3 ? "end" : "start"}
        className="fill-foreground text-[11px] font-medium tabular-nums"
      >
        {`${last.value}${suffix}`}
      </text>

      {data.map((point, index) => (
        <g key={point.key} className="group">
          {index % labelEvery === 0 ? (
            <text
              x={x(index)}
              y={H - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {point.label.replace(/ \d{4}$/, "")}
            </text>
          ) : null}

          <rect
            x={x(index) - step / 2}
            y={PAD.top}
            width={step}
            height={plotH}
            fill="transparent"
            tabIndex={0}
            role="presentation"
          >
            <title>
              {`${point.label}: ${
                point.value === null ? "not marked" : `${point.value}${suffix}`
              }${point.detail ? ` · ${point.detail}` : ""}`}
            </title>
          </rect>

          {point.value === null ? null : (
            <circle
              cx={x(index)}
              cy={y(point.value)}
              r={4}
              style={{ fill: "var(--viz-accent)", stroke: "var(--viz-surface)" }}
              strokeWidth={2}
              className="pointer-events-none opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
            />
          )}

          <Tooltip
            x={x(index)}
            y={point.value === null ? PAD.top + plotH / 2 : y(point.value)}
            lines={[
              point.label,
              point.value === null ? "Not marked" : `${point.value}${suffix}`,
              ...(point.detail ? [point.detail] : []),
            ]}
          />
        </g>
      ))}
    </svg>
  );
}

/**
 * An SVG tooltip that appears on hover or keyboard focus of its group.
 * Width is measured from the text so nothing is ever clipped, and the box is
 * clamped inside the viewBox so edge points stay readable.
 */
export function Tooltip({
  x,
  y,
  lines,
  width = W,
}: {
  x: number;
  y: number;
  lines: string[];
  width?: number;
}) {
  const boxWidth = Math.max(...lines.map((line) => line.length)) * 6.1 + 20;
  const boxHeight = 16 * lines.length + 12;
  const left = Math.min(Math.max(x - boxWidth / 2, 4), width - boxWidth - 4);
  const top = Math.max(y - boxHeight - 12, 4);

  return (
    <g className="pointer-events-none opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      <rect
        x={left}
        y={top}
        width={boxWidth}
        height={boxHeight}
        rx={6}
        className="fill-popover stroke-border"
        strokeWidth={1}
      />
      {lines.map((line, index) => (
        <text
          key={line + index}
          x={left + 10}
          y={top + 20 + index * 16}
          className={
            index === 0
              ? "fill-muted-foreground text-[11px]"
              : "fill-popover-foreground text-[12px] font-medium"
          }
        >
          {line}
        </text>
      ))}
    </g>
  );
}
