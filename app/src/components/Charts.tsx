import { useId } from 'react';
import type { Point } from '../lib/analytics';

/** Shared geometry. SVG uses a fixed viewBox and scales to 100% width. */
const W = 640;
const PAD = { l: 8, r: 8, t: 14, b: 22 };

function bounds(data: Point[]) {
  const vs = data.map((d) => d.v);
  let min = Math.min(...vs);
  let max = Math.max(...vs);
  if (min === max) {
    min = min * 0.9;
    max = max * 1.1 || 1;
  }
  // pad the range a touch
  const span = max - min;
  return { min: Math.max(0, min - span * 0.1), max: max + span * 0.1 };
}

function xAt(i: number, n: number) {
  if (n <= 1) return PAD.l;
  return PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
}

function dateLabels(data: Point[]): { x: number; label: string }[] {
  if (data.length < 2) return [];
  const idxs = [0, Math.floor((data.length - 1) / 2), data.length - 1];
  return idxs.map((i) => ({
    x: xAt(i, data.length),
    label: new Date(data[i].t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }));
}

export function LineChart({
  data,
  color = '#ff2222',
  height = 200,
  format = (v: number) => v.toFixed(2),
}: {
  data: Point[];
  color?: string;
  height?: number;
  format?: (v: number) => string;
}) {
  const id = useId().replace(/:/g, '');
  if (data.length === 0) return null;
  const H = height;
  const { min, max } = bounds(data);
  const yAt = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);
  const pts = data.map((d, i) => `${xAt(i, data.length).toFixed(1)},${yAt(d.v).toFixed(1)}`);
  const linePath = `M ${pts.join(' L ')}`;
  const areaPath = `${linePath} L ${xAt(data.length - 1, data.length).toFixed(1)},${(H - PAD.b).toFixed(1)} L ${PAD.l},${(H - PAD.b).toFixed(1)} Z`;
  const last = data[data.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* gridlines */}
      {[0, 0.5, 1].map((g) => {
        const y = PAD.t + g * (H - PAD.t - PAD.b);
        return (
          <g key={g}>
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={PAD.l + 2} y={y - 3} fontSize="11" fill="rgb(var(--slate-500))">
              {format(max - g * (max - min))}
            </text>
          </g>
        );
      })}
      <path d={areaPath} fill={`url(#g${id})`} />
      <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xAt(data.length - 1, data.length)} cy={yAt(last.v)} r="3.5" fill={color} />
      {dateLabels(data).map((d, i) => (
        <text key={i} x={d.x} y={H - 6} fontSize="11" fill="rgb(var(--slate-500))" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
          {d.label}
        </text>
      ))}
    </svg>
  );
}

export function BarChart({
  data,
  color = '#9bff5a',
  height = 200,
  format = (v: number) => v.toFixed(0),
}: {
  data: Point[];
  color?: string;
  height?: number;
  format?: (v: number) => string;
}) {
  if (data.length === 0) return null;
  const H = height;
  const max = Math.max(...data.map((d) => d.v)) * 1.1 || 1;
  const innerW = W - PAD.l - PAD.r;
  const gap = data.length > 40 ? 1 : 2;
  const bw = innerW / data.length - gap;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
      {[0, 0.5, 1].map((g) => {
        const y = PAD.t + g * (H - PAD.t - PAD.b);
        return (
          <g key={g}>
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={PAD.l + 2} y={y - 3} fontSize="11" fill="rgb(var(--slate-500))">
              {format(max - g * max)}
            </text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.v / max) * (H - PAD.t - PAD.b);
        const x = PAD.l + i * (bw + gap);
        const y = H - PAD.b - h;
        return <rect key={i} x={x} y={y} width={Math.max(bw, 0.5)} height={h} rx="1" fill={color} opacity="0.85" />;
      })}
      {dateLabels(data).map((d, i) => (
        <text key={i} x={d.x} y={H - 6} fontSize="11" fill="rgb(var(--slate-500))" textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
          {d.label}
        </text>
      ))}
    </svg>
  );
}
