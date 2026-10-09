// Types shared by the Electron main process, the optimization worker and the renderer.

export type PresetId = 'preserve' | 'balanced' | 'aggressive' | 'custom';
export type MeshCompression = 'none' | 'meshopt';
export type TextureFormat = 'original' | 'png' | 'jpeg';
export type TextureMaxSize = 0 | 4096 | 2048 | 1024 | 512; // 0 = keep original

export interface MeshSettings {
  simplify: boolean;
  ratio: number; // 0.05 – 1.0
  error: number; // relative to mesh extent, e.g. 0.01 = 1%
  lockBorder: boolean;
  prune: boolean;
  dedup: boolean;
  weld: boolean;
  join: boolean;
  reorder: boolean;
  quantize: boolean;
  compression: MeshCompression;
}

export interface TextureSettings {
  enabled: boolean;
  format: TextureFormat;
  quality: number; // 1 – 100
  maxSize: TextureMaxSize;
  preserveAlpha: boolean;
}

export interface OptimizeSettings {
  mesh: MeshSettings;
  texture: TextureSettings;
}

export interface ModelStats {
  triangles: number;
  vertices: number;
  meshes: number;
  primitives: number;
  materials: number;
  textures: number;
  /** Estimated: one draw call per rendered primitive (no batching/instancing assumed). */
  drawCalls: number;
  fileSize: number;
  textureBytes: number;
  extensions: string[];
}

export interface AnalyzeResult {
  path: string;
  fileName: string;
  /** GLB to show in the preview (source itself for .glb, a temporary conversion for .gltf). */
  previewPath: string;
  stats: ModelStats;
  warnings: string[];
}

export interface OptimizeRequest {
  inputPath: string;
  outputPath: string;
  settings: OptimizeSettings;
}

export interface OptimizeResult {
  outputPath: string;
  original: ModelStats;
  optimized: ModelStats;
  durationMs: number;
  warnings: string[];
  steps: string[];
}

export type OptimizeResponse =
  | { ok: true; result: OptimizeResult }
  | { ok: false; cancelled?: boolean; error: string };

export type AnalyzeResponse = { ok: true; result: AnalyzeResult } | { ok: false; error: string };

export interface ViewerPrefs {
  background: 'dark' | 'gray' | 'light';
  wireframe: boolean;
  syncCameras: boolean;
  grid: boolean;
}

export interface AppSettings {
  preset: PresetId;
  settings: OptimizeSettings;
  outputDir: string | null;
  viewer: ViewerPrefs;
}

export interface ModelOptimizerApi {
  openModelDialog(): Promise<string | null>;
  chooseFolder(defaultPath?: string | null): Promise<string | null>;
  getPathForFile(file: File): string;
  analyzeModel(path: string): Promise<AnalyzeResponse>;
  readModel(path: string): Promise<ArrayBuffer>;
  optimize(req: OptimizeRequest): Promise<OptimizeResponse>;
  cancelOptimize(): Promise<void>;
  onProgress(cb: (message: string) => void): () => void;
  loadSettings(): Promise<Partial<AppSettings> | null>;
  saveSettings(settings: AppSettings): Promise<void>;
  showInFolder(path: string): Promise<void>;
}
