"use client";

import { useMemo, useState } from "react";
import { fmtDate, money } from "@/lib/format";

export type Slice = { label: string; value: number; color: string };

export function Donut({ slices, centerLabel }: { slices: Slice[]; centerLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = 70;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const active = hover !== null ? slices[hover] : null;

  return (
    <div className="allocation-chart w-full min-w-0">
      <div className="allocation-content flex min-w-0 flex-col items-center gap-4">
      <div className="relative h-40 w-40 shrink-0 sm:h-44 sm:w-44">
        <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90" role="img" aria-label="Portfolio allocation chart">
          <circle className="donut-track" cx="90" cy="90" r={r} fill="none" strokeWidth="22" />
          {total > 0 &&
            slices.map((s, i) => {
              const frac = Math.max(0, s.value) / total;
              const len = frac * c;
              const el = (
                <circle
                  key={s.label}
                  cx="90"
                  cy="90"
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={hover === i ? 28 : 22}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  className="cursor-pointer transition-all duration-200"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-xs text-slate-500">{active ? active.label : centerLabel}</span>
          <span className="text-lg font-semibold text-slate-900">
            {money(active ? active.value : total, { compact: true })}
          </span>
          {active && total > 0 && (
            <span className="text-xs text-slate-500">{((active.value / total) * 100).toFixed(1)}%</span>
          )}
        </div>
      </div>
      <ul className="min-w-0 w-full space-y-1">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm transition ${
              hover === i ? "bg-slate-50" : ""
            }`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
              <span className="truncate text-slate-700">{s.label}</span>
            </span>
            <span className="ml-2 flex shrink-0 gap-2 tabular-nums">
              <span className="text-slate-500">{total > 0 ? ((s.value / total) * 100).toFixed(1) : "0.0"}%</span>
              <span className="w-20 text-right font-medium text-slate-900">{money(s.value, { compact: true })}</span>
            </span>
          </li>
        ))}
        {slices.length === 0 && <li className="text-sm text-slate-400">No holdings yet</li>}
      </ul>
      </div>
    </div>
  );
}

const W = 640;
const H = 220;
const P = { t: 16, r: 12, b: 24, l: 12 };

export type Point = { date: string; value: number; cost: number };

type HistoryRange = "1M" | "6M" | "1Y" | "ALL";
const HISTORY_RANGES: Array<{ value: HistoryRange; label: string; months?: number }> = [
  { value: "1M", label: "1 month", months: 1 },
  { value: "6M", label: "6 months", months: 6 },
  { value: "1Y", label: "1 year", months: 12 },
  { value: "ALL", label: "All time" },
];

export function HistoryChart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [range, setRange] = useState<HistoryRange>("6M");

  const visiblePoints = useMemo(() => {
    const selected = HISTORY_RANGES.find((item) => item.value === range);
    if (!selected?.months || points.length === 0) return points;
    const latest = new Date(`${points[points.length - 1].date}T00:00:00Z`);
    const cutoff = new Date(latest);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - selected.months);
    const cutoffDate = cutoff.toISOString().slice(0, 10);
    return points.filter((point) => point.date >= cutoffDate);
  }, [points, range]);

  const lifetime = useMemo(() => {
    if (!points.length) return null;
    let high = points[0];
    let low = points[0];
    for (const point of points.slice(1)) {
      if (point.value > high.value) high = point;
      if (point.value < low.value) low = point;
    }
    return { high, low };
  }, [points]);

  const { path, area, costPath, xs, ys, min, max } = useMemo(() => {
    const vals = visiblePoints.flatMap((p) => [p.value, p.cost]);
    let min = Math.min(...vals);
    let max = Math.max(...vals);
    if (!isFinite(min)) {
      min = 0;
      max = 1;
    }
    if (max - min < 1e-6) {
      min = min * 0.9;
      max = max * 1.1 || 1;
    }
    const pad = (max - min) * 0.1;
    min -= pad;
    max += pad;
    const n = visiblePoints.length;
    const xs = visiblePoints.map((_, i) => P.l + (n === 1 ? (W - P.l - P.r) / 2 : (i / (n - 1)) * (W - P.l - P.r)));
    const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
    const ys = visiblePoints.map((p) => y(p.value));
    const cys = visiblePoints.map((p) => y(p.cost));
    const line = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${v.toFixed(1)}`).join(" ");
    const path = line(ys);
    const area = n ? `${path} L${xs[n - 1]},${H - P.b} L${xs[0]},${H - P.b} Z` : "";
    return { path, area, costPath: line(cys), xs, ys, min, max };
  }, [visiblePoints]);

  if (points.length === 0) {
    return (
      <div className="grid h-[220px] place-items-center text-sm text-slate-400">
        History appears once you add holdings — a snapshot is saved daily whenever values change.
      </div>
    );
  }

  const up = visiblePoints[visiblePoints.length - 1].value >= visiblePoints[0].value;
  const stroke = up ? "#4f46e5" : "#e11d48";
  const h = hover !== null ? visiblePoints[hover] : visiblePoints[visiblePoints.length - 1];

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" aria-label="History period">
        {HISTORY_RANGES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => { setRange(item.value); setHover(null); }}
            className={`flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition sm:text-sm ${
              range === item.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
            aria-pressed={range === item.value}
          >
            {item.label}
          </button>
        ))}
      </div>
      {lifetime && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">All-time high</div>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{money(lifetime.high.value)}</div>
            <div className="text-xs text-slate-500">{fmtDate(lifetime.high.date)}</div>
          </div>
          <div className="rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">All-time low</div>
            <div className="mt-0.5 font-semibold tabular-nums text-slate-900">{money(lifetime.low.value)}</div>
            <div className="text-xs text-slate-500">{fmtDate(lifetime.low.date)}</div>
          </div>
        </div>
      )}
      <div className="mb-2 flex flex-col gap-1 text-sm sm:flex-row sm:items-baseline sm:justify-between">
        <span className="text-slate-500">{fmtDate(h.date)}</span>
        <span className="flex gap-4">
          <span>
            <span className="text-slate-400">Value </span>
            <span className="font-semibold text-slate-900">{money(h.value)}</span>
          </span>
          <span>
            <span className="text-slate-400">Cost </span>
            <span className="font-medium text-slate-600">{money(h.cost)}</span>
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[220px] w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * W;
          let best = 0;
          xs.forEach((v, i) => {
            if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i;
          });
          setHover(best);
        }}
      >
        <defs>
          <linearGradient id="hist-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={P.l} x2={W - P.r} y1={P.t + f * (H - P.t - P.b)} y2={P.t + f * (H - P.t - P.b)} stroke="#f1f5f9" />
        ))}
        <path d={area} fill="url(#hist-fill)" />
        <path d={costPath} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {visiblePoints.length === 1 && <circle cx={xs[0]} cy={ys[0]} r="4" fill={stroke} />}
        {hover !== null && (
          <>
            <line x1={xs[hover]} x2={xs[hover]} y1={P.t} y2={H - P.b} stroke="#cbd5e1" vectorEffect="non-scaling-stroke" />
            <circle cx={xs[hover]} cy={ys[hover]} r="4" fill="white" stroke={stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </>
        )}
        <text x={P.l} y={H - 6} fontSize="11" fill="#94a3b8">
          {fmtDate(visiblePoints[0].date)}
        </text>
        <text x={W - P.r} y={H - 6} fontSize="11" fill="#94a3b8" textAnchor="end">
          {fmtDate(visiblePoints[visiblePoints.length - 1].date)}
        </text>
      </svg>
      <span className="sr-only">
        Range {money(min)} to {money(max)}
      </span>
    </div>
  );
}
