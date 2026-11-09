'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Dependency-free inline-SVG chart primitives for the analytics tabs.
 * Keep them tiny on purpose — one line / one area / stat tiles. The
 * Studio dashboards use the same pattern.
 */

export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'good' | 'warn' | 'bad' | 'info';
}): JSX.Element {
  const toneClass = {
    default: 'bg-card',
    good: 'bg-emerald-50 dark:bg-emerald-950/30',
    warn: 'bg-amber-50 dark:bg-amber-950/30',
    bad: 'bg-rose-50 dark:bg-rose-950/30',
    info: 'bg-sky-50 dark:bg-sky-950/30',
  }[tone];
  return (
    <div className={cn('rounded-lg border p-4', toneClass)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold leading-tight">
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

type Series = {
  name: string;
  color: string;
  values: number[];
};

export function LineChart({
  labels,
  series,
  height = 220,
}: {
  labels: string[];
  series: Series[];
  height?: number;
}): JSX.Element {
  const w = 720;
  const h = height;
  const pad = { top: 12, right: 12, bottom: 24, left: 36 };
  const n = Math.max(labels.length, 1);
  const allVals = series.flatMap((s) => s.values);
  const max = Math.max(1, ...allVals);
  const stepX =
    n === 1
      ? 0
      : (w - pad.left - pad.right) / Math.max(1, n - 1);

  const xAt = (i: number): number => pad.left + stepX * i;
  const yAt = (v: number): number =>
    pad.top + (h - pad.top - pad.bottom) * (1 - v / max);

  // Y-axis ticks: 4 segments.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        className="h-[220px] w-full min-w-[520px]"
      >
        {ticks.map((t, idx) => {
          const y = yAt(t);
          return (
            <g key={idx}>
              <line
                x1={pad.left}
                x2={w - pad.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                className="text-muted/40"
                strokeDasharray="2 3"
              />
              <text
                x={pad.left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {t}
              </text>
            </g>
          );
        })}
        {series.map((s, si) => {
          if (s.values.length === 0) return null;
          const d = s.values
            .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(v)}`)
            .join(' ');
          return (
            <g key={si}>
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {s.values.map((v, i) => (
                <circle
                  key={i}
                  cx={xAt(i)}
                  cy={yAt(v)}
                  r={2.5}
                  fill={s.color}
                />
              ))}
            </g>
          );
        })}
        {labels.length <= 14
          ? labels.map((l, i) => (
              <text
                key={i}
                x={xAt(i)}
                y={h - 6}
                textAnchor="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {l}
              </text>
            ))
          : null}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: s.color }}
            />
            <span className="text-muted-foreground">{s.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function RangePicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}): JSX.Element {
  const options = [7, 14, 30, 60, 90];
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-card p-1">
      {options.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => onChange(d)}
          className={cn(
            'rounded px-2 py-1 text-xs',
            value === d
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {d}d
        </button>
      ))}
    </div>
  );
}

export function pct(n: number): string {
  if (!isFinite(n) || isNaN(n)) return '0%';
  return `${(n * 100).toFixed(1)}%`;
}

export function fmt(n: number): string {
  return n.toLocaleString();
}
