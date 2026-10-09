# Model Optimizer

A small, offline Windows desktop app that optimizes AI-generated GLB models (TRELLIS 1) for Unity.
Drop in a model, pick a preset, click **Optimize Model**, and compare the original and optimized versions side by side with real before/after statistics.

Built with Electron, React, TypeScript, Three.js / React Three Fiber, [glTF Transform](https://gltf-transform.dev) and [meshoptimizer](https://github.com/zeux/meshoptimizer).

## Download & run (no install needed)

Download the latest build from the [GitHub Releases page](https://github.com/MarioZitko/glb-model-optimizer/releases). Pick **one** of these files:

| File | What it is |
|---|---|
| `ModelOptimizer-<ver>-portable.exe` | **Easiest to share.** A single file: double-click to run. It unpacks itself to `%TEMP%` on each launch, so startup takes ~5–10 s. |
| `ModelOptimizer-<ver>-setup.exe` | Conventional installer (per-user, no admin rights needed), with Start menu/desktop shortcuts and an uninstaller. Starts instantly after install. |
| `ModelOptimizer-<ver>-win-x64.zip` | Same app as a plain folder. Extract anywhere and run `Model Optimizer.exe`. Starts instantly, but it's the largest download. |

Requirements: Windows 10 or 11, x64. You don't need Node.js, Python, Blender, an internet connection or admin rights.

Each build is roughly 90–150 MB. Most of that is the Electron runtime (Chromium), which every Electron app has to ship. That's too big for email attachments, so share a link (a GitHub Release, Google Drive or WeTransfer) or use a USB stick.

## Sharing a new version

Build output in `release/` is git-ignored, so it never goes into the repository. To publish a version:

1. Bump `version` in `package.json`.
2. Run `npm run dist` (takes a few minutes; the output goes to `release/`).
3. On GitHub, go to **Releases → Draft a new release**. Create a tag like `v1.0.1` and upload `ModelOptimizer-<ver>-portable.exe` (and optionally `-setup.exe`). GitHub allows files up to 2 GB.
4. Send the release link.

Don't upload the `win-unpacked` folder, `*.blockmap`, `*.nsis.7z` or `builder-debug.yml` from `release/`. They're intermediate build files.

### Windows SmartScreen warning

The app isn't code-signed, so the first launch may show **"Windows protected your PC"**. Click **More info → Run anyway**.
Files downloaded through a browser or Google Drive may also be marked as coming from the internet. You can also right-click the file → **Properties** → tick **Unblock**.

## Using it

1. Drag a `.glb` (or `.gltf` with its external files) onto **Source model**, or click it to browse.
   The model loads into the **Original** preview and its statistics are computed.
2. **Output:** edit the file name (default `<name>_optimized.glb`) and pick a folder (default: next to the source).
   The last folder you chose is remembered. You're asked before an existing file is replaced, and the source model can never be overwritten.
3. Choose a **preset** or adjust settings (changing any mesh setting switches to *Custom*).
4. Click **Optimize Model**. The optimized GLB is written, validated, reloaded and shown in the **Optimized** preview.
5. Compare: orbit/pan/zoom, **Sync cameras**, **Wireframe**, grid, background, **Reset views**.

Settings are saved in `%APPDATA%\Model Optimizer\settings.json`.

### Presets

Presets only set the mesh settings; texture settings stay as you configured them. Triangle targets aren't guaranteed: simplification stops early if it would exceed the error tolerance, and the app warns when that happens.

| Preset | Target ratio | Error tolerance | Notes |
|---|---|---|---|
| Preserve Quality | 0.75 | 0.001 | Light reduction + cleanup |
| **Unity Balanced** (default) | 0.50 | 0.01 | Plain GLB, no Unity packages needed |
| Unity Aggressive | 0.25 | 0.05 | Background props |

### What each step does (in order)

1. **Deduplicate** – merges identical accessors, materials and textures.
2. **Remove unused data** – prunes anything nothing references.
3. **Weld** – merges fully identical vertices. TRELLIS duplicates every vertex per triangle, so this usually removes >90% of vertices. UV seams are kept.
4. **Join** (off by default) – merges sibling meshes that share a material. Fewer draw calls, but the hierarchy changes.
5. **Simplify** – meshoptimizer edge collapse to the target ratio, within the error tolerance (relative to model size). *Lock mesh borders* keeps open edges fixed.
6. **Textures** (off by default) – see below.
7. **Reorder** – vertex-cache optimization; no visual change.
8. **Quantize** (off by default) – `KHR_mesh_quantization`.
9. **Meshopt compression** (off by default) – `EXT_meshopt_compression`. It includes reorder + quantization.

The result is written to a temporary file, checked with the official Khronos **glTF Validator**, reloaded, and only then moved to the destination. Statistics for both the original and the optimized model are counted from the actual glTF data.

### Textures

- **Color textures** (base color, emissive): keep the format, or convert to **JPEG** (quality 1–100) or **PNG**.
- **Data textures** (normal, metallic/roughness, occlusion) keep their format, because lossy JPEG distorts their values. They are only resized.
- **Maximum resolution** downsizes to fit 4096/2048/1024/512 and never upscales.
- **Preserve alpha:** textures used by BLEND/MASK materials stay PNG when JPEG is chosen. If this is disabled, alpha is dropped and those materials become OPAQUE (a warning is shown).
- UVs are never modified.
- **WebP/AVIF/KTX2 output is intentionally not offered.** Unity glTFast can't load WebP, and KTX2 needs extra tooling.

## Unity compatibility (glTFast)

| Setting | Extension | Unity requirement |
|---|---|---|
| Default output | none (core glTF 2.0) | glTFast only |
| Mesh quantization | `KHR_mesh_quantization` | Supported by glTFast out of the box |
| Meshopt compression | `EXT_meshopt_compression` | Install **`com.unity.meshopt.decompress`** |
| JPEG / PNG textures | none | Supported |

Draco is not offered: Meshopt gives similar size savings without shipping extra WASM files.
**Estimated draw calls** assume one draw call per mesh primitive (≈ submesh/material), with no batching, instancing, shadows or extra passes. It's a rough indicator, not a Unity measurement.

## Development

Requires Node.js 22+ (developed with Node 24 LTS).

```bash
git clone https://github.com/MarioZitko/glb-model-optimizer.git
cd glb-model-optimizer
npm install
npm run dev        # Vite dev server + Electron with hot reload for the UI
npm test           # bundles the engine, generates test models, runs 18 engine tests
npm run dist       # typecheck + build + package (portable exe, zip, NSIS) into release/
node scripts/e2e.mjs                                          # drive the dev build end to end (screenshots in test-fixtures/)
node scripts/e2e.mjs --exe "release/win-unpacked/Model Optimizer.exe"   # same against the packaged app
```

Note: npm 11+ may skip install scripts. If `node_modules/electron/dist/electron.exe` is missing after `npm install`, run `node node_modules/electron/install.js`.

### Project layout

```text
electron/
  main.ts        window, native dialogs, IPC, settings file, worker lifecycle (one job at a time)
  preload.ts     narrow typed API exposed as window.api (contextIsolation + sandbox, no nodeIntegration)
  worker.ts      runs in an Electron utilityProcess so the UI never blocks; cancel = kill
  engine.ts      pure Node optimization pipeline + statistics + validation (also used by tests)
src/
  App.tsx        layout and state
  components/    ModelDropzone, OutputSettings, OptimizationPresets, OptimizationSettings,
                 ModelViewer (R3F + camera sync), ModelStatistics, ui (small controls)
  presets.ts     preset definitions and defaults
  types/model.ts types shared by main, worker and renderer
scripts/         esbuild bundling, dev runner, fixtures, engine tests, e2e, icon
```

Everything is bundled by esbuild/Vite. Only `sharp` (native libvips, used for textures) ships in `node_modules`, and it's unpacked from the asar archive.

## Known limitations

- One model at a time (no batch processing), by design.
- Draco-compressed inputs can't be read. Re-export them without Draco.
- KTX2/WebP input textures are kept as-is (they aren't re-encoded).
- Skinned/animated models pass through cleanup, but simplification isn't tuned for skinning. Check the result.
- Tested on synthetic TRELLIS-like models (unwelded meshes, baked textures, multi-mesh, alpha, broken geometry, 1M triangles, unicode paths). Verify with your own TRELLIS exports and on a second PC.
