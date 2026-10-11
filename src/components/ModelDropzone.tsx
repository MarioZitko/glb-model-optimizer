import { useState } from 'react';
import type { AnalyzeResult } from '../types/model';
import { dirname, fmtBytes } from '../format';
import { Icon, ICONS } from './ui';

interface Props {
  source: AnalyzeResult | null;
  loading: boolean;
  disabled: boolean;
  onSelect: (path: string) => void;
  onRemove: () => void;
}

export default function ModelDropzone({ source, loading, disabled, onSelect, onRemove }: Props) {
  const [over, setOver] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  const browse = async () => {
    const p = await window.api.openModelDialog();
    if (p) onSelect(p);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && browse()}
        onKeyDown={(e) => e.key === 'Enter' && !disabled && browse()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (disabled) return;
          const file = e.dataTransfer.files[0];
          if (!file) return;
          if (!/\.(glb|gltf)$/i.test(file.name)) {
            setDropError(`"${file.name}" is not a .glb or .gltf file.`);
            return;
          }
          setDropError(null);
          onSelect(window.api.getPathForFile(file));
        }}
        className={`flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
          over ? 'border-accent bg-accent/10' : 'border-line bg-panel-2/50 hover:border-muted'
        } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        {loading ? (
          <>
            <div className="size-6 animate-spin rounded-full border-2 border-line border-t-accent" />
            <div className="text-muted">Analyzing model…</div>
          </>
        ) : (
          <>
            <Icon d={ICONS.upload} className="size-7 text-muted" />
            <div className="text-[13px]">
              Drop a <b>.glb</b> model here
            </div>
            <div className="text-[11.5px] text-muted">or click to browse · .gltf with external files also supported</div>
          </>
        )}
      </div>
      {dropError && <div className="mt-2 text-[12px] text-err">{dropError}</div>}
      {source && !loading && (
        <div className="mt-3 rounded-md border border-line bg-panel-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <Icon d={ICONS.cube} className="size-4 shrink-0 text-accent" />
            <div className="truncate font-medium" title={source.fileName}>
              {source.fileName}
            </div>
            <div className="tabular ml-auto shrink-0 text-muted">{fmtBytes(source.stats.fileSize)}</div>
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled}
              title="Remove model"
              className="shrink-0 rounded px-1.5 text-[15px] leading-none text-muted hover:bg-panel hover:text-err disabled:opacity-40"
            >
              ×
            </button>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted" title={source.path}>
            {dirname(source.path)}
          </div>
        </div>
      )}
    </div>
  );
}
