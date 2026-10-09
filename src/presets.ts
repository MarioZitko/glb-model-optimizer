import type { AppSettings, MeshSettings, PresetId } from './types/model';

const cleanup = { prune: true, dedup: true, weld: true, join: false, reorder: true, lockBorder: false, quantize: false, compression: 'none' } as const;

/** Presets set the mesh settings only; texture settings are left as the user configured them. */
export const PRESETS: Record<Exclude<PresetId, 'custom'>, { label: string; description: string; mesh: MeshSettings }> = {
  preserve: {
    label: 'Preserve Quality',
    description: 'Light reduction (~75% of triangles kept) with a strict error tolerance, plus safe cleanup.',
    mesh: { ...cleanup, simplify: true, ratio: 0.75, error: 0.001 },
  },
  balanced: {
    label: 'Unity Balanced',
    description: 'Targets ~50% of triangles with a moderate tolerance. Plain GLB: no decoder packages needed in Unity.',
    mesh: { ...cleanup, simplify: true, ratio: 0.5, error: 0.01 },
  },
  aggressive: {
    label: 'Unity Aggressive',
    description: 'Targets ~25% of triangles with a looser tolerance. For background props and decorations.',
    mesh: { ...cleanup, simplify: true, ratio: 0.25, error: 0.05 },
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  preset: 'balanced',
  settings: {
    mesh: { ...PRESETS.balanced.mesh },
    texture: { enabled: false, format: 'original', quality: 85, maxSize: 0, preserveAlpha: true },
  },
  outputDir: null,
  viewer: { background: 'dark', wireframe: false, syncCameras: true, grid: true },
};
