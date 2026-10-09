import type { ModelStats, OptimizeResult } from '../types/model';
import { fmtBytes, fmtInt, fmtPct, fmtSeconds, pctChange } from '../format';
import { Collapsible, Icon, ICONS, Notice, Tip } from './ui';

interface Props {
  original: ModelStats | null;
  result: OptimizeResult | null;
  /** True when the shown result was produced from settings that differ from the current ones. */
  stale: boolean;
}

type Row = { label: string; key: keyof ModelStats; tip?: string; bytes?: boolean; estimated?: boolean };

const ROWS: Row[] = [
  { label: 'Triangles', key: 'triangles', tip: 'Rendered triangles counted from the index/vertex data of every mesh instance in the scene.' },
  { label: 'Vertices', key: 'vertices', tip: 'Vertices stored per rendered primitive. Welding shared vertices reduces this without changing the shape. Unity may split vertices further along hard edges/UV seams.' },
  { label: 'Meshes', key: 'meshes' },
  { label: 'Materials', key: 'materials' },
  { label: 'Textures', key: 'textures' },
  { label: 'Texture data', key: 'textureBytes', bytes: true, tip: 'Encoded (on-disk) size of all embedded images. GPU memory depends on resolution, not file size.' },
  { label: 'File size', key: 'fileSize', bytes: true, tip: 'Size of the GLB on disk. Includes geometry, textures and compression. Compression shrinks the file without reducing triangles.' },
  {
    label: 'Draw calls',
    key: 'drawCalls',
    estimated: true,
    tip: 'ESTIMATE, not measured in Unity: one draw call per mesh primitive (≈ submesh/material), without static/dynamic batching, SRP Batcher, instancing, shadows or multiple passes.',
  },
];

function Delta({ a, b, absolute }: { a: number; b: number; absolute?: boolean }) {
  if (absolute) {
    const d = b - a;
    return <span className={d < 0 ? 'text-ok' : d > 0 ? 'text-warn' : 'text-muted'}>{d === 0 ? '0' : `${d > 0 ? '+' : ''}${d}`}</span>;
  }
  const p = pctChange(a, b);
  return <span className={p !== null && p < -0.05 ? 'text-ok' : p !== null && p > 0.05 ? 'text-warn' : 'text-muted'}>{fmtPct(p)}</span>;
}

export default function ModelStatistics({ original, result, stale }: Props) {
  if (!original) {
    return <div className="flex h-full items-center justify-center text-muted">Load a model to see its statistics.</div>;
  }
  const opt = result?.optimized ?? null;
  const triRed = opt ? -(pctChange(original.triangles, opt.triangles) ?? 0) : null;
  const sizeRed = opt ? -(pctChange(original.fileSize, opt.fileSize) ?? 0) : null;

  return (
    <div className="flex h-full min-h-0 gap-4">
      <div className="flex w-64 shrink-0 flex-col gap-2">
        <Headline label="Original" value={`${fmtInt(original.triangles)} triangles`} sub={fmtBytes(original.fileSize)} />
        <Headline
          label="Optimized"
          value={opt ? `${fmtInt(opt.triangles)} triangles` : '—'}
          sub={opt ? fmtBytes(opt.fileSize) : 'Not optimized yet'}
          accent
        />
        {opt && (
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Triangle reduction" value={`${triRed!.toFixed(1)}%`} hint="Geometry" />
            <Metric label="File size reduction" value={`${sizeRed!.toFixed(1)}%`} hint="Disk" />
          </div>
        )}
        {result && <div className="text-[11.5px] text-muted">Processed in {fmtSeconds(result.durationMs)}</div>}
        {stale && <Notice kind="info">Settings changed since this result. Optimize again to update it.</Notice>}
      </div>

      <div className="min-w-0 flex-1 overflow-auto pr-1">
        <table className="tabular w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[11px] tracking-wider text-muted uppercase">
              <th className="py-1.5 font-medium">Metric</th>
              <th className="py-1.5 text-right font-medium">Original</th>
              <th className="py-1.5 text-right font-medium">Optimized</th>
              <th className="py-1.5 text-right font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const a = original[r.key] as number;
              const b = opt ? (opt[r.key] as number) : null;
              const fmt = (v: number) => (r.bytes ? fmtBytes(v) : fmtInt(v));
              return (
                <tr key={r.key} className="border-b border-line/50">
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      {r.label}
                      {r.estimated && <span className="rounded bg-warn/15 px-1 text-[10px] font-medium text-warn uppercase">est.</span>}
                      {r.tip && <Tip text={r.tip} />}
                    </span>
                  </td>
                  <td className="py-1.5 text-right">{fmt(a)}</td>
                  <td className="py-1.5 text-right">{b === null ? '—' : fmt(b)}</td>
                  <td className="py-1.5 text-right">{b === null ? '—' : <Delta a={a} b={b} absolute={r.estimated} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {result && (
          <div className="mt-2 space-y-1.5">
            {result.warnings.map((w, i) => (
              <Notice key={i} kind="warn">
                {w}
              </Notice>
            ))}
            <Collapsible title="Applied steps & extensions">
              <ul className="space-y-0.5 py-1 text-[12px] text-muted">
                {result.steps.map((s, i) => (
                  <li key={i} className="flex gap-1.5">
                    <Icon d={ICONS.check} className="mt-0.5 size-3 shrink-0 text-ok" />
                    {s}
                  </li>
                ))}
                <li className="pt-1">Extensions used: {opt!.extensions.length ? opt!.extensions.join(', ') : 'none (core glTF 2.0)'}</li>
              </ul>
            </Collapsible>
          </div>
        )}
      </div>
    </div>
  );
}

function Headline({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${accent ? 'border-accent/40 bg-accent/5' : 'border-line bg-panel-2'}`}>
      <div className="text-[10.5px] tracking-wider text-muted uppercase">{label}</div>
      <div className={`tabular text-[17px] font-semibold ${accent ? 'text-accent-2' : ''}`}>{value}</div>
      <div className="tabular text-[11.5px] text-muted">{sub}</div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 px-2.5 py-1.5">
      <div className="text-[10.5px] text-muted">{label}</div>
      <div className="tabular text-[15px] font-semibold text-ok">{value}</div>
      <div className="text-[10px] text-muted/70 uppercase">{hint}</div>
    </div>
  );
}
