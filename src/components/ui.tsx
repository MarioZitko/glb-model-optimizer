// Small hand-rolled controls (no component library needed for this app).
import { useState, type ReactNode } from 'react';

export function Icon({ d, className = 'size-4' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  info: 'M12 16v-4m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z',
  chevron: 'm9 6 6 6-6 6',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5',
  warn: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  cube: 'M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7 12 12l8.7-5M12 22V12',
};

/** Hover tooltip rendered with fixed positioning so scrolling panels don't clip it. */
export function Tip({ text }: { text: ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  return (
    <span
      className="inline-flex cursor-help text-muted hover:text-fg"
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setPos({ x: Math.min(r.left, window.innerWidth - 300), y: r.bottom + 6 });
      }}
      onMouseLeave={() => setPos(null)}
    >
      <Icon d={ICONS.info} className="size-3.5" />
      {pos && (
        <span
          style={{ left: pos.x, top: pos.y }}
          className="pointer-events-none fixed z-50 w-72 rounded-md border border-line bg-panel-2 p-2.5 text-[12px] leading-snug font-normal text-fg shadow-xl shadow-black/50"
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function Label({ children, tip }: { children: ReactNode; tip?: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-[12.5px] text-fg/90">
      {children}
      {tip && <Tip text={tip} />}
    </span>
  );
}

export function Toggle(props: { label: string; tip?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; note?: string }) {
  const { label, tip, checked, onChange, disabled, note } = props;
  return (
    <div className={`flex items-center justify-between gap-3 py-1 ${disabled ? 'opacity-45' : ''}`}>
      <div className="min-w-0">
        <Label tip={tip}>{label}</Label>
        {note && <div className="text-[11px] text-muted">{note}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line'} ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

export function Slider(props: {
  label: string;
  tip?: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  format?: (v: number) => string;
}) {
  const { label, tip, value, min, max, step, onChange, disabled, format } = props;
  return (
    <div className={`py-1 ${disabled ? 'opacity-45' : ''}`}>
      <div className="mb-1 flex items-center justify-between">
        <Label tip={tip}>{label}</Label>
        <input
          type="number"
          className="tabular w-20 rounded border border-line bg-bg px-1.5 py-0.5 text-right text-[12px] outline-none focus:border-accent"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
      </div>
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        title={format ? format(value) : String(value)}
      />
    </div>
  );
}

export function Select<T extends string | number>(props: {
  label: string;
  tip?: ReactNode;
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const { label, tip, value, options, onChange, disabled } = props;
  return (
    <div className={`flex items-center justify-between gap-3 py-1 ${disabled ? 'opacity-45' : ''}`}>
      <Label tip={tip}>{label}</Label>
      <select
        className="rounded border border-line bg-bg px-2 py-1 text-[12.5px] outline-none focus:border-accent"
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const opt = options.find((o) => String(o.value) === e.target.value);
          if (opt) onChange(opt.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Collapsible({ title, children, defaultOpen = false, badge }: { title: string; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 py-1.5 text-[12.5px] text-muted hover:text-fg">
        <Icon d={ICONS.chevron} className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
        {badge}
      </button>
      {open && <div className="ml-1 border-l border-line pl-3">{children}</div>}
    </div>
  );
}

export function Notice({ kind, children }: { kind: 'warn' | 'err' | 'info'; children: ReactNode }) {
  const color = kind === 'err' ? 'text-err border-err/30 bg-err/5' : kind === 'warn' ? 'text-warn border-warn/30 bg-warn/5' : 'text-muted border-line bg-panel-2';
  return (
    <div className={`flex gap-2 rounded-md border px-2.5 py-1.5 text-[12px] leading-snug ${color}`}>
      <Icon d={kind === 'info' ? ICONS.info : ICONS.warn} className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 break-words whitespace-pre-line">{children}</div>
    </div>
  );
}
