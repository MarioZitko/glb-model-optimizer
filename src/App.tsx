import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AnalyzeResult, AppSettings, MeshSettings, OptimizeResult, PresetId, TextureSettings, ViewerPrefs } from './types/model';
import { DEFAULT_SETTINGS, PRESETS } from './presets';
import { dirname, fmtSeconds, joinPath, stem } from './format';
import ModelDropzone from './components/ModelDropzone';
import OutputSettings from './components/OutputSettings';
import OptimizationPresets from './components/OptimizationPresets';
import { MeshSettingsPanel, TextureSettingsPanel } from './components/OptimizationSettings';
import ModelViewer, { CameraSync } from './components/ModelViewer';
import ModelStatistics from './components/ModelStatistics';
import { Icon, ICONS, Notice, Section } from './components/ui';

function mergeSettings(saved: Partial<AppSettings> | null): AppSettings {
  const d = DEFAULT_SETTINGS;
  if (!saved) return structuredClone(d);
  return {
    preset: saved.preset && (saved.preset === 'custom' || saved.preset in PRESETS) ? saved.preset : d.preset,
    settings: {
      mesh: { ...d.settings.mesh, ...saved.settings?.mesh },
      texture: { ...d.settings.texture, ...saved.settings?.texture },
    },
    outputDir: typeof saved.outputDir === 'string' ? saved.outputDir : null,
    viewer: { ...d.viewer, ...saved.viewer },
  };
}

function validateFileName(name: string): string | null {
  const n = name.trim();
  if (!n) return 'Enter a file name.';
  if (/[<>:"/\\|?*\x00-\x1f]/.test(n)) return 'The name contains characters Windows does not allow: < > : " / \\ | ? *';
  if (/^\.+$/.test(stem(n))) return 'Enter a valid file name.';
  return null;
}

export default function App() {
  const [cfg, setCfg] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [cfgLoaded, setCfgLoaded] = useState(false);

  const [source, setSource] = useState<AnalyzeResult | null>(null);
  const [sourceBytes, setSourceBytes] = useState<ArrayBuffer | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const [outputName, setOutputName] = useState('');

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [resultSettings, setResultSettings] = useState('');
  const [resultBytes, setResultBytes] = useState<ArrayBuffer | null>(null);

  const [resetKey, setResetKey] = useState(0);
  const sync = useMemo(() => new CameraSync(), []);

  // Persisted settings: load once, save (debounced) on every change.
  useEffect(() => {
    window.api.loadSettings().then((s) => {
      setCfg(mergeSettings(s));
      setCfgLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (!cfgLoaded) return;
    const t = setTimeout(() => window.api.saveSettings(cfg), 300);
    return () => clearTimeout(t);
  }, [cfg, cfgLoaded]);

  useEffect(() => window.api.onProgress(setProgress), []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(performance.now() - startedAt), 100);
    return () => clearInterval(t);
  }, [running, startedAt]);

  const outputDir = cfg.outputDir ?? (source ? dirname(source.path) : null);
  const nameError = source ? validateFileName(outputName) : null;
  const finalName = /\.glb$/i.test(outputName.trim()) ? outputName.trim() : `${outputName.trim()}.glb`;
  const outputPath = source && outputDir && !nameError ? joinPath(outputDir, finalName) : null;
  const samePath = !!outputPath && !!source && outputPath.toLowerCase() === source.path.toLowerCase();
  const canOptimize = !!source && !!outputPath && !samePath && !running && !sourceLoading;
  const stale = !!result && resultSettings !== JSON.stringify(cfg.settings);

  async function loadModel(p: string) {
    setSourceLoading(true);
    setSourceError(null);
    setRunError(null);
    setRunNotice(null);
    setResult(null);
    setResultBytes(null);
    const res = await window.api.analyzeModel(p);
    if (!res.ok) {
      setSource(null);
      setSourceBytes(null);
      setSourceError(res.error);
    } else {
      setSource(res.result);
      setOutputName(`${stem(res.result.fileName)}_optimized.glb`);
      try {
        setSourceBytes(await window.api.readModel(res.result.previewPath));
      } catch (err) {
        setSourceError(`Could not load preview: ${(err as Error).message}`);
      }
    }
    setSourceLoading(false);
  }

  async function optimize() {
    if (!source || !outputPath) return;
    setRunning(true);
    setRunError(null);
    setRunNotice(null);
    setProgress('Starting…');
    const t0 = performance.now();
    setStartedAt(t0);
    setElapsed(0);
    const settingsKey = JSON.stringify(cfg.settings);
    const res = await window.api.optimize({ inputPath: source.path, outputPath, settings: cfg.settings });
    if (res.ok) {
      setResult(res.result);
      setResultSettings(settingsKey);
      try {
        setResultBytes(await window.api.readModel(res.result.outputPath));
      } catch (err) {
        setRunError(`Saved, but the preview could not be loaded: ${(err as Error).message}`);
      }
    } else if (res.cancelled) {
      setRunNotice(res.error);
    } else {
      setRunError(res.error);
    }
    setElapsed(performance.now() - t0);
    setRunning(false);
  }

  const setPreset = (p: PresetId) =>
    setCfg((c) => (p === 'custom' ? { ...c, preset: p } : { ...c, preset: p, settings: { ...c.settings, mesh: { ...PRESETS[p].mesh } } }));
  const patchMesh = (patch: Partial<MeshSettings>) =>
    setCfg((c) => ({ ...c, preset: 'custom', settings: { ...c.settings, mesh: { ...c.settings.mesh, ...patch } } }));
  const patchTexture = (patch: Partial<TextureSettings>) =>
    setCfg((c) => ({ ...c, settings: { ...c.settings, texture: { ...c.settings.texture, ...patch } } }));
  const patchViewer = (patch: Partial<ViewerPrefs>) => setCfg((c) => ({ ...c, viewer: { ...c.viewer, ...patch } }));

  const browseOutput = async () => {
    const dir = await window.api.chooseFolder(outputDir);
    if (dir) setCfg((c) => ({ ...c, outputDir: dir }));
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line bg-panel px-4">
        <div className="flex size-6 items-center justify-center rounded bg-accent text-black">
          <Icon d={ICONS.cube} className="size-4" />
        </div>
        <h1 className="text-[13px] font-semibold tracking-[0.14em]">MODEL OPTIMIZER</h1>
        <span className="text-[11.5px] text-muted">TRELLIS → Unity GLB</span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left panel: input + configuration */}
        <aside className="flex w-[360px] shrink-0 flex-col border-r border-line bg-panel">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Section title="Source model">
              <ModelDropzone source={source} loading={sourceLoading} disabled={running} onSelect={loadModel} />
              {sourceError && (
                <div className="mt-2">
                  <Notice kind="err">{sourceError}</Notice>
                </div>
              )}
              {source?.warnings.map((w, i) => (
                <div key={i} className="mt-2">
                  <Notice kind="warn">{w}</Notice>
                </div>
              ))}
            </Section>

            <Section title="Output">
              <OutputSettings
                fileName={outputName}
                dir={outputDir}
                fullPath={outputPath}
                nameError={nameError ?? (samePath ? 'The output would overwrite the source model. Choose another name.' : null)}
                disabled={running}
                onFileName={setOutputName}
                onBrowse={browseOutput}
              />
            </Section>

            <Section title="Optimization preset">
              <div className={running ? 'pointer-events-none opacity-50' : ''}>
                <OptimizationPresets value={cfg.preset} onChange={setPreset} />
              </div>
            </Section>

            <Section title="Mesh">
              <MeshSettingsPanel mesh={cfg.settings.mesh} disabled={running} onMesh={patchMesh} />
            </Section>

            <Section
              title="Textures"
              right={<span className={`text-[11px] ${cfg.settings.texture.enabled ? 'text-accent' : 'text-muted'}`}>{cfg.settings.texture.enabled ? 'On' : 'Off'}</span>}
            >
              <TextureSettingsPanel texture={cfg.settings.texture} disabled={running} onTexture={patchTexture} />
            </Section>
          </div>

          <div className="shrink-0 space-y-2 border-t border-line bg-panel p-4">
            {running ? (
              <div className="flex gap-2">
                <div className="flex flex-1 items-center gap-2.5 rounded-md bg-accent/15 px-3 py-2.5">
                  <div className="size-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                  <div className="min-w-0 flex-1 truncate text-[12.5px]">{progress}</div>
                  <div className="tabular text-[12px] text-muted">{fmtSeconds(elapsed)}</div>
                </div>
                <button type="button" onClick={() => window.api.cancelOptimize()} className="rounded-md border border-line px-3 text-muted hover:border-err hover:text-err">
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!canOptimize}
                onClick={optimize}
                className="w-full rounded-md bg-accent py-2.5 text-[14px] font-semibold text-black transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
              >
                Optimize Model
              </button>
            )}
            {runError && <Notice kind="err">{runError}</Notice>}
            {runNotice && <Notice kind="info">{runNotice}</Notice>}
            {result && !running && !runError && (
              <div className="flex items-center gap-2 text-[12px] text-ok">
                <Icon d={ICONS.check} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">Saved in {fmtSeconds(result.durationMs)}</span>
                <button type="button" className="text-muted underline-offset-2 hover:text-fg hover:underline" onClick={() => window.api.showInFolder(result.outputPath)}>
                  Show in folder
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Right panel: previews + statistics */}
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Chip active={cfg.viewer.syncCameras} onClick={() => patchViewer({ syncCameras: !cfg.viewer.syncCameras })}>
              Sync cameras
            </Chip>
            <Chip active={cfg.viewer.wireframe} onClick={() => patchViewer({ wireframe: !cfg.viewer.wireframe })}>
              Wireframe
            </Chip>
            <Chip active={cfg.viewer.grid} onClick={() => patchViewer({ grid: !cfg.viewer.grid })}>
              Grid
            </Chip>
            <div className="ml-1 flex items-center gap-1 text-[11.5px] text-muted">
              Background
              {(['dark', 'gray', 'light'] as const).map((b) => (
                <button
                  key={b}
                  type="button"
                  title={b}
                  onClick={() => patchViewer({ background: b })}
                  className={`size-5 rounded border-2 ${cfg.viewer.background === b ? 'border-accent' : 'border-line'}`}
                  style={{ background: { dark: '#15181f', gray: '#3a3f4a', light: '#d9dce3' }[b] }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setResetKey((k) => k + 1)}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12px] text-muted hover:text-fg"
            >
              <Icon d={ICONS.reset} className="size-3.5" /> Reset views
            </button>
          </div>

          <div className="flex min-h-0 flex-1 gap-3">
            <ModelViewer
              id="original"
              title="Original model"
              bytes={sourceBytes}
              triangles={source?.stats.triangles ?? null}
              emptyText="Drop a model on the left to preview it"
              prefs={cfg.viewer}
              sync={sync}
              resetKey={resetKey}
            />
            <ModelViewer
              id="optimized"
              title="Optimized model"
              bytes={resultBytes}
              triangles={result?.optimized.triangles ?? null}
              emptyText={source ? 'Click “Optimize Model” to generate the optimized version' : 'The optimized output will appear here'}
              busy={running}
              prefs={cfg.viewer}
              sync={sync}
              resetKey={resetKey}
            />
          </div>

          <div className="h-[290px] shrink-0 rounded-lg border border-line bg-panel p-3">
            <ModelStatistics original={source?.stats ?? null} result={result} stale={stale} />
          </div>
        </main>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${active ? 'border-accent/60 bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg'}`}
    >
      {children}
    </button>
  );
}
