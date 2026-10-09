// Optimization engine: pure Node.js (no Electron APIs) so it can run in the worker and in tests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Document, Logger, NodeIO, Primitive, Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, listTextureSlots, meshopt, prune, quantize, reorder, simplify, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import validator from 'gltf-validator';
import type { AnalyzeResult, ModelStats, OptimizeRequest, OptimizeResult, TextureSettings } from '../src/types/model';

export type ProgressFn = (message: string) => void;

let ioPromise: Promise<NodeIO> | null = null;

function getIO(): Promise<NodeIO> {
  ioPromise ??= (async () => {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
    return new NodeIO()
      .setLogger(new Logger(Logger.Verbosity.WARN))
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  })();
  return ioPromise;
}

/** Reads a .glb or .gltf (with external resources) and returns the document plus total on-disk size. */
async function readModel(filePath: string): Promise<{ doc: Document; fileSize: number }> {
  const io = await getIO();
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.glb' && ext !== '.gltf') throw new Error('Unsupported file type. Please choose a .glb or .gltf file.');
  try {
    if (ext === '.glb') {
      const bytes = await fs.readFile(filePath);
      return { doc: await io.readBinary(new Uint8Array(bytes)), fileSize: bytes.byteLength };
    }
    const jsonDoc = await io.readAsJSON(filePath);
    let fileSize = (await fs.stat(filePath)).size;
    for (const res of Object.values(jsonDoc.resources)) fileSize += res.byteLength;
    return { doc: await io.readJSON(jsonDoc), fileSize };
  } catch (err) {
    throw new Error(explainReadError(err));
  }
}

function explainReadError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/ENOENT/.test(msg)) return `A file or one of its external resources is missing: ${msg}`;
  if (/draco/i.test(msg)) return 'This model uses Draco compression, which is not supported. Re-export it without Draco.';
  if (/magic|Invalid glb|JSON|Unexpected token|chunk/i.test(msg)) return `The file is not a valid glTF/GLB model (${msg}).`;
  return `Could not read model: ${msg}`;
}

function primitiveTriangles(prim: Primitive): number {
  const indices = prim.getIndices();
  const position = prim.getAttribute('POSITION');
  const count = indices ? indices.getCount() : position ? position.getCount() : 0;
  switch (prim.getMode()) {
    case Primitive.Mode.TRIANGLES:
      return Math.floor(count / 3);
    case Primitive.Mode.TRIANGLE_STRIP:
    case Primitive.Mode.TRIANGLE_FAN:
      return Math.max(0, count - 2);
    default:
      return 0;
  }
}

/** Counts what the default scene actually renders (node instances included), from real accessor data. */
export function computeStats(doc: Document, fileSize: number): ModelStats {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let triangles = 0;
  let vertices = 0;
  let drawCalls = 0;
  scene?.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    for (const prim of mesh.listPrimitives()) {
      triangles += primitiveTriangles(prim);
      vertices += prim.getAttribute('POSITION')?.getCount() ?? 0;
      drawCalls++;
    }
  });
  return {
    triangles,
    vertices,
    meshes: root.listMeshes().length,
    primitives: root.listMeshes().reduce((n, m) => n + m.listPrimitives().length, 0),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    drawCalls,
    fileSize,
    textureBytes: root.listTextures().reduce((n, t) => n + (t.getImage()?.byteLength ?? 0), 0),
    extensions: root.listExtensionsUsed().map((e) => e.extensionName),
  };
}

function inputWarnings(doc: Document, stats: ModelStats): string[] {
  const warnings: string[] = [];
  if (stats.triangles === 0) warnings.push('The model contains no triangle geometry. Simplification will have no effect.');
  const nonTri = doc
    .getRoot()
    .listMeshes()
    .flatMap((m) => m.listPrimitives())
    .filter((p) => p.getMode() !== Primitive.Mode.TRIANGLES).length;
  if (nonTri > 0) warnings.push(`${nonTri} primitive(s) are not plain triangle lists (points/lines/strips) and will not be simplified.`);
  if (stats.extensions.includes('KHR_draco_mesh_compression'))
    warnings.push('Input uses Draco compression; the output will be written without Draco.');
  return warnings;
}

export async function analyzeModel(filePath: string, tempDir: string): Promise<AnalyzeResult> {
  const { doc, fileSize } = await readModel(filePath);
  const stats = computeStats(doc, fileSize);
  let previewPath = filePath;
  if (path.extname(filePath).toLowerCase() === '.gltf') {
    // The renderer can only load self-contained bytes, so pack .gltf + resources into a temporary GLB.
    const io = await getIO();
    await fs.mkdir(tempDir, { recursive: true });
    previewPath = path.join(tempDir, `preview-${Date.now()}.glb`);
    await fs.writeFile(previewPath, await io.writeBinary(doc));
  }
  return { path: filePath, fileName: path.basename(filePath), previewPath, stats, warnings: inputWarnings(doc, stats) };
}

// ---------------------------------------------------------------------------------------------
// Textures

const COLOR_SLOTS = new Set(['baseColorTexture', 'emissiveTexture', 'diffuseTexture', 'specularColorTexture', 'sheenColorTexture']);
const EXT_FOR_MIME: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg' };

/** True if the texture feeds baseColor of a material whose alpha actually matters. */
function usesAlpha(doc: Document, texture: Texture): boolean {
  return doc
    .getRoot()
    .listMaterials()
    .some((m) => m.getBaseColorTexture() === texture && m.getAlphaMode() !== 'OPAQUE');
}

async function optimizeTextures(doc: Document, t: TextureSettings, warnings: string[], steps: string[]): Promise<void> {
  const textures = doc.getRoot().listTextures();
  let changed = 0;
  for (const texture of textures) {
    const image = texture.getImage();
    const mime = texture.getMimeType();
    const label = texture.getName() || texture.getURI() || `texture ${textures.indexOf(texture)}`;
    if (!image) continue;
    if (mime !== 'image/png' && mime !== 'image/jpeg') {
      warnings.push(`Texture "${label}" (${mime}) was left unchanged; only PNG and JPEG textures can be processed.`);
      continue;
    }

    const slots = listTextureSlots(texture);
    const isColor = slots.length > 0 && slots.every((s) => COLOR_SLOTS.has(s));
    const alpha = usesAlpha(doc, texture);

    // Non-color data (normals, roughness/metalness, occlusion) keeps its format: lossy JPEG artifacts
    // distort those values. Such textures are only resized.
    let targetMime = mime;
    if (isColor && t.format === 'jpeg') targetMime = 'image/jpeg';
    if (isColor && t.format === 'png') targetMime = 'image/png';
    if (!isColor && t.format !== 'original' && targetMime !== mime) targetMime = mime;
    if (alpha && targetMime === 'image/jpeg' && mime === 'image/png') {
      if (t.preserveAlpha) {
        targetMime = 'image/png';
        warnings.push(`Texture "${label}" kept as PNG to preserve alpha transparency.`);
      } else {
        warnings.push(`Texture "${label}" converted to JPEG: alpha was discarded and its material(s) set to OPAQUE.`);
        for (const m of doc.getRoot().listMaterials()) if (m.getBaseColorTexture() === texture) m.setAlphaMode('OPAQUE');
      }
    }

    try {
      const meta = await sharp(image).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      const needsResize = t.maxSize > 0 && Math.max(width, height) > t.maxSize;
      if (!needsResize && targetMime === mime && t.format === 'original') continue;

      let pipeline = sharp(image);
      if (needsResize) pipeline = pipeline.resize({ width: t.maxSize, height: t.maxSize, fit: 'inside', withoutEnlargement: true });
      pipeline =
        targetMime === 'image/jpeg'
          ? pipeline.jpeg({ quality: t.quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
          : pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      const out = new Uint8Array(await pipeline.toBuffer());

      // Same size and format but bigger after re-encoding: keep the original bytes.
      if (!needsResize && targetMime === mime && out.byteLength >= image.byteLength) continue;

      texture.setImage(out).setMimeType(targetMime);
      const uri = texture.getURI();
      if (uri) texture.setURI(uri.replace(/\.[^./\\]+$/, '') + EXT_FOR_MIME[targetMime]);
      changed++;
    } catch (err) {
      warnings.push(`Texture "${label}" could not be processed and was left unchanged (${(err as Error).message}).`);
    }
  }
  steps.push(`Textures: ${changed} of ${textures.length} re-encoded/resized`);
}

// ---------------------------------------------------------------------------------------------
// Validation

interface ValidatorMessage {
  code: string;
  message: string;
  severity: number;
  pointer?: string;
}

async function validationErrors(bytes: Uint8Array): Promise<ValidatorMessage[]> {
  const report = await validator.validateBytes(bytes, { maxIssues: 200, ignoredIssues: ['UNSUPPORTED_EXTENSION'] });
  return (report.issues.messages as ValidatorMessage[]).filter((m) => m.severity === 0);
}

// ---------------------------------------------------------------------------------------------
// Optimization

export async function optimizeModel(req: OptimizeRequest, progress: ProgressFn): Promise<OptimizeResult> {
  const start = performance.now();
  const { inputPath, outputPath, settings } = req;
  const m = settings.mesh;
  const warnings: string[] = [];
  const steps: string[] = [];

  if (path.resolve(inputPath).toLowerCase() === path.resolve(outputPath).toLowerCase())
    throw new Error('The output file cannot be the same as the source model.');

  progress('Reading model…');
  const io = await getIO();
  const { doc, fileSize } = await readModel(inputPath);
  const original = computeStats(doc, fileSize);
  warnings.push(...inputWarnings(doc, original));

  const run = async (label: string, fn: () => Promise<unknown>) => {
    progress(`${label}…`);
    try {
      await fn();
    } catch (err) {
      throw new Error(`${label} failed: ${(err as Error).message}`);
    }
  };
  const triCount = () => computeStats(doc, 0).triangles;

  // Order follows glTF Transform guidance: cleanup → weld → (join) → simplify → textures → vertex
  // layout (reorder/quantize) → compression. meshopt() performs its own reorder + quantize.
  if (m.dedup) await run('Deduplicating resources', () => doc.transform(dedup())).then(() => steps.push('Deduplicate'));
  if (m.prune) await run('Removing unused data', () => doc.transform(prune({ keepSolidTextures: true }))).then(() => steps.push('Prune'));
  if (m.weld) await run('Welding vertices', () => doc.transform(weld())).then(() => steps.push('Weld'));
  if (m.join) await run('Joining compatible meshes', () => doc.transform(join())).then(() => steps.push('Join'));

  if (m.simplify && m.ratio < 1 && original.triangles > 0) {
    if (!m.weld) warnings.push('Weld is disabled: unwelded vertices act as seams and usually limit simplification.');
    const before = triCount();
    await run('Simplifying geometry', () =>
      doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: m.ratio, error: m.error, lockBorder: m.lockBorder })),
    );
    const after = triCount();
    const target = Math.round(before * m.ratio);
    steps.push(`Simplify: ${before.toLocaleString('en-US')} → ${after.toLocaleString('en-US')} triangles (target ${target.toLocaleString('en-US')})`);
    if (after > target * 1.05) {
      warnings.push(
        `Target ratio ${m.ratio.toFixed(2)} not reached: kept ${((after / before) * 100).toFixed(1)}% of triangles because the ` +
          `error tolerance (${m.error}) would be exceeded. Raise the tolerance to simplify further, at the cost of visual accuracy.`,
      );
    }
    if (m.prune) await run('Removing unused data', () => doc.transform(prune({ keepSolidTextures: true })));
  }

  if (settings.texture.enabled) {
    progress('Optimizing textures…');
    await optimizeTextures(doc, settings.texture, warnings, steps);
  }

  if (m.compression === 'meshopt') {
    await run('Applying Meshopt compression', () => doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' })));
    steps.push('Meshopt compression (includes reorder + quantization)');
    warnings.push('Meshopt compression requires the "com.unity.meshopt.decompress" package in Unity (glTFast).');
  } else {
    if (m.reorder) await run('Reordering mesh data', () => doc.transform(reorder({ encoder: MeshoptEncoder, target: 'performance' }))).then(() => steps.push('Reorder'));
    if (m.quantize) await run('Quantizing vertex attributes', () => doc.transform(quantize())).then(() => steps.push('Quantize (KHR_mesh_quantization)'));
  }

  progress('Writing GLB…');
  const glb = await io.writeBinary(doc);

  progress('Validating output…');
  const outErrors = await validationErrors(glb);
  if (outErrors.length > 0) {
    // Errors already present in the source are reported but don't block export.
    const srcBytes = path.extname(inputPath).toLowerCase() === '.glb' ? new Uint8Array(await fs.readFile(inputPath)) : null;
    const srcCodes = new Set(srcBytes ? (await validationErrors(srcBytes)).map((e) => e.code) : []);
    const newErrors = outErrors.filter((e) => !srcCodes.has(e.code));
    if (newErrors.length > 0) {
      const detail = newErrors.slice(0, 5).map((e) => `${e.code}: ${e.message}${e.pointer ? ` (${e.pointer})` : ''}`).join('\n');
      throw new Error(`The optimized model failed glTF validation, so it was not saved:\n${detail}`);
    }
    warnings.push(`Output has ${outErrors.length} validation issue(s) that already existed in the source model.`);
  }
  const reloaded = await io.readBinary(glb); // proves the output can be loaded
  const optimized = computeStats(reloaded, glb.byteLength);

  // Write next to the destination first, then rename, so a failure never leaves a half-written file.
  progress('Saving file…');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(tmpPath, glb);
    await fs.rm(outputPath, { force: true });
    await fs.rename(tmpPath, outputPath);
  } catch (err) {
    await fs.rm(tmpPath, { force: true });
    throw new Error(`Could not save the output file: ${(err as Error).message}`);
  }

  return { outputPath, original, optimized, durationMs: performance.now() - start, warnings, steps };
}
