import { PRESETS } from '../presets';
import type { PresetId } from '../types/model';

const ORDER: PresetId[] = ['preserve', 'balanced', 'aggressive', 'custom'];

export default function OptimizationPresets({ value, onChange }: { value: PresetId; onChange: (p: PresetId) => void }) {
  const description =
    value === 'custom' ? 'Your own combination of the settings below.' : PRESETS[value].description;
  return (
    <div>
      <div className="grid grid-cols-4 gap-1 rounded-md bg-bg p-1">
        {ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`rounded px-1 py-1.5 text-[11.5px] leading-tight transition-colors ${
              value === id ? 'bg-accent font-medium text-black' : 'text-muted hover:bg-panel-2 hover:text-fg'
            }`}
          >
            {id === 'custom' ? 'Custom' : PRESETS[id].label.replace('Unity ', '')}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-muted">
        {description} Presets are starting points; the reached triangle count depends on the model.
      </p>
    </div>
  );
}
