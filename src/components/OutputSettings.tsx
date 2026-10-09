import { Icon, ICONS } from './ui';

interface Props {
  fileName: string;
  dir: string | null;
  fullPath: string | null;
  nameError: string | null;
  disabled: boolean;
  onFileName: (v: string) => void;
  onBrowse: () => void;
}

export default function OutputSettings({ fileName, dir, fullPath, nameError, disabled, onFileName, onBrowse }: Props) {
  return (
    <div className={`space-y-2 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <label className="block">
        <span className="mb-1 block text-[12px] text-muted">File name</span>
        <input
          className={`w-full rounded border bg-bg px-2 py-1.5 outline-none focus:border-accent ${nameError ? 'border-err' : 'border-line'}`}
          value={fileName}
          spellCheck={false}
          placeholder="model_optimized.glb"
          onChange={(e) => onFileName(e.target.value)}
        />
      </label>
      {nameError && <div className="text-[12px] text-err">{nameError}</div>}
      <div>
        <span className="mb-1 block text-[12px] text-muted">Folder</span>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1 truncate rounded border border-line bg-bg px-2 py-1.5 text-fg/80" title={dir ?? ''}>
            {dir ?? <span className="text-muted">Same folder as source</span>}
          </div>
          <button type="button" onClick={onBrowse} className="flex items-center gap-1.5 rounded border border-line bg-panel-2 px-2.5 hover:border-muted">
            <Icon d={ICONS.folder} className="size-3.5" />
            Browse
          </button>
        </div>
      </div>
      {fullPath && (
        <div className="text-[11.5px] break-all text-muted">
          Saves to: <span className="text-fg/80">{fullPath}</span>
        </div>
      )}
    </div>
  );
}
