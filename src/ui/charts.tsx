import { useMemo, useRef, useState } from "preact/hooks";
import { fmtDateTime, fmtNumber } from "../lib/format";

export interface Point {
  at: number;
  v: number;
}

/** Tiny trend line for table rows and stat tiles. De-emphasised line, accent end-dot. */
export function Sparkline({ points, width = 84, height = 22, max }: { points: Point[]; width?: number; height?: number; max?: number }) {
  if (points.length < 2) return <span class="spark spark--empty" style={{ width, height }} aria-hidden="true" />;
  const t0 = points[0].at;
  const t1 = points[points.length - 1].at;
  const hi = Math.max(max ?? 0, ...points.map((p) => p.v)) || 1;
  const lo = max != null ? 0 : Math.min(...points.map((p) => p.v));
  const span = hi - lo || 1;
  const pad = 3;
  const x = (p: Point) => pad + ((p.at - t0) / (t1 - t0 || 1)) * (width - pad * 2);
  const y = (p: Point) => height - pad - ((p.v - lo) / span) * (height - pad * 2);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(1)},${y(p).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  return (
    <svg class="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--text-3)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={x(last)} cy={y(last)} r="2.5" fill="var(--chart-1)" stroke="var(--surface)" stroke-width="1.5" />
    </svg>
  );
}

/** Area/line trend with a snapping crosshair + tooltip. One series, so no legend: the card title names it. */
export function TrendChart({ points, height = 160, max, unit = "", label = "Trend" }: { points: Point[]; height?: number; max?: number; unit?: string; label?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [w, setW] = useState(600);
  const padL = 52;
  const padR = 14;
  const padT = 10;
  const padB = 24;

  const measure = (el: SVGSVGElement | null) => {
    if (el && Math.abs(el.clientWidth - w) > 2) setW(el.clientWidth);
  };

  const { ticks, x, y, path, area, xTicks } = useMemo(() => {
    const t0 = points[0]?.at ?? 0;
    const t1 = points[points.length - 1]?.at ?? 1;
    const hiRaw = Math.max(1, ...points.map((p) => p.v));
    const hi = niceMax(max != null ? Math.min(max, hiRaw * 1.25) : hiRaw * 1.15);
    const x = (at: number) => padL + ((at - t0) / (t1 - t0 || 1)) * (w - padL - padR);
    const y = (v: number) => padT + (1 - v / hi) * (height - padT - padB);
    const ticks = [0, hi / 2, hi];
    const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    const area = points.length ? `${path}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z` : "";
    const xTicks = points.length > 1 ? [t0, t0 + (t1 - t0) / 2, t1] : [];
    return { ticks, x, y, path, area, xTicks };
  }, [points, w, height, max]);

  const onMove = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    let bd = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(x(p.at) - px);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    setHover(best);
  };

  const hp = hover != null ? points[hover] : null;
  const fmtTick = (v: number) => (v >= 10000 ? new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(v) : fmtNumber(Math.round(v)));
  const fmtTime = (t: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", ...(points.length && points[points.length - 1].at - points[0].at > 86400000 ? { day: "numeric", month: "short" } : {}) }).format(t);

  return (
    <div class="trend" style={{ height }}>
      <svg
        ref={(el) => {
          (ref as { current: SVGSVGElement | null }).current = el;
          measure(el);
        }}
        width="100%"
        height={height}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        tabIndex={0}
        role="img"
        class="trend__svg"
        aria-label={`${label}: ${points.length} samples from ${fmtNumber(points[0]?.v ?? 0)}${unit} to ${fmtNumber(points[points.length - 1]?.v ?? 0)}${unit}. Use left and right arrow keys to read individual samples.`}
        onKeyDown={(e) => {
          const last = points.length - 1;
          const cur = hover ?? last;
          if (e.key === "ArrowLeft") (e.preventDefault(), setHover(Math.max(0, cur - 1)));
          else if (e.key === "ArrowRight") (e.preventDefault(), setHover(Math.min(last, cur + 1)));
          else if (e.key === "Home") (e.preventDefault(), setHover(0));
          else if (e.key === "End") (e.preventDefault(), setHover(last));
        }}
        onBlur={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--border-subtle)" stroke-width="1" />
            <text x={padL - 8} y={y(t) + 4} text-anchor="end" class="trend__tick">
              {fmtTick(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={t} x={x(t)} y={height - 6} text-anchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} class="trend__tick">
            {fmtTime(t)}
          </text>
        ))}
        <path d={area} fill="var(--chart-1)" fill-opacity="0.1" />
        <path d={path} fill="none" stroke="var(--chart-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        {hp && (
          <>
            <line x1={x(hp.at)} x2={x(hp.at)} y1={padT} y2={height - padB} stroke="var(--border-strong)" stroke-width="1" />
            <circle cx={x(hp.at)} cy={y(hp.v)} r="4.5" fill="var(--chart-1)" stroke="var(--surface)" stroke-width="2" />
          </>
        )}
        {!hp && points.length > 0 && <circle cx={x(points[points.length - 1].at)} cy={y(points[points.length - 1].v)} r="4" fill="var(--chart-1)" stroke="var(--surface)" stroke-width="2" />}
      </svg>
      {hp && (
        <div class="trend__tip" role="status" style={{ left: Math.min(w - 170, Math.max(0, x(hp.at) - 80)) }}>
          <div class="trend__tipv">
            {fmtNumber(hp.v)}
            {unit}
          </div>
          <div class="muted">{fmtDateTime(new Date(hp.at).toISOString())}</div>
        </div>
      )}
    </div>
  );
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * p;
}
