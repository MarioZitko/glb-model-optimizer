// End-to-end checks of the optimization engine (the same bundle the worker uses) on generated fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { analyzeModel, optimizeModel } = require('../dist-electron/engine.cjs');

const FIX = path.resolve('test-fixtures');
const OUT = path.join(FIX, 'out');
const TMP = path.join(FIX, 'tmp');
await fs.mkdir(OUT, { recursive: true });

const base = {
  mesh: { simplify: true, ratio: 0.5, error: 0.01, lockBorder: false, prune: true, dedup: true, weld: true, join: false, reorder: true, quantize: false, compression: 'none' },
  texture: { enabled: false, format: 'original', quality: 85, maxSize: 0, preserveAlpha: true },
};
const settings = (mesh = {}, texture = {}) => ({ mesh: { ...base.mesh, ...mesh }, texture: { ...base.texture, ...texture } });
const hash = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');

let passed = 0, failed = 0;
async function test(name, fn) {
  const t0 = performance.now();
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name} (${((performance.now() - t0) / 1000).toFixed(2)}s)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err.message.split('\n').join('\n       ')}`);
  }
}
const opt = (input, out, s) => optimizeModel({ inputPath: path.join(FIX, input), outputPath: path.join(OUT, out), settings: s }, () => {});

await test('analyze reports real counts for TRELLIS-like model', async () => {
  const r = await analyzeModel(path.join(FIX, 'trellis-like.glb'), TMP);
  assert.equal(r.stats.triangles, 256 * 128 * 2);
  assert.equal(r.stats.vertices, 256 * 128 * 6); // unwelded
  assert.equal(r.stats.meshes, 1);
  assert.equal(r.stats.textures, 2);
});

await test('balanced: weld + simplify roughly halves triangles, source untouched', async () => {
  const before = await hash(path.join(FIX, 'trellis-like.glb'));
  const r = await opt('trellis-like.glb', 'balanced.glb', settings());
  assert.equal(await hash(path.join(FIX, 'trellis-like.glb')), before, 'source modified');
  assert.ok(r.optimized.triangles < r.original.triangles * 0.6, `triangles ${r.optimized.triangles}`);
  assert.ok(r.optimized.vertices < r.original.vertices / 3, 'weld did not reduce vertices');
  assert.ok(r.optimized.fileSize < r.original.fileSize, 'file not smaller');
  const again = await analyzeModel(r.outputPath, TMP);
  assert.equal(again.stats.triangles, r.optimized.triangles, 'reported stats differ from file');
});

await test('ratio setting changes result (0.25 < 0.5)', async () => {
  const a = await opt('trellis-like.glb', 'r50.glb', settings({ error: 0.1 }));
  const b = await opt('trellis-like.glb', 'r25.glb', settings({ ratio: 0.25, error: 0.1 }));
  assert.ok(b.optimized.triangles < a.optimized.triangles * 0.7, `${b.optimized.triangles} vs ${a.optimized.triangles}`);
});

await test('tiny error tolerance limits simplification and warns', async () => {
  const r = await opt('trellis-like.glb', 'strict.glb', settings({ ratio: 0.05, error: 0.00001 }));
  assert.ok(r.warnings.some((w) => w.includes('not reached')), r.warnings.join(' | '));
});

await test('simplify disabled keeps triangle count', async () => {
  const r = await opt('trellis-like.glb', 'nosimplify.glb', settings({ simplify: false }));
  assert.equal(r.optimized.triangles, r.original.triangles);
});

await test('multi-mesh: hierarchy kept, dedup + prune remove duplicates', async () => {
  const r = await opt('multi-mesh.glb', 'multi.glb', settings());
  assert.equal(r.optimized.meshes, 4);
  assert.ok(r.optimized.materials < r.original.materials, `materials ${r.original.materials} -> ${r.optimized.materials}`);
  assert.equal(r.optimized.textures, 1);
});

await test('join merges compatible meshes', async () => {
  const r = await opt('multi-mesh.glb', 'joined.glb', settings({ join: true, simplify: false }));
  assert.ok(r.optimized.drawCalls <= r.original.drawCalls, `${r.original.drawCalls} -> ${r.optimized.drawCalls}`);
});

await test('quantize adds KHR_mesh_quantization and shrinks file', async () => {
  const a = await opt('trellis-like.glb', 'q0.glb', settings({ simplify: false }));
  const b = await opt('trellis-like.glb', 'q1.glb', settings({ simplify: false, quantize: true }));
  assert.ok(b.optimized.extensions.includes('KHR_mesh_quantization'));
  assert.ok(b.optimized.fileSize < a.optimized.fileSize);
});

await test('meshopt compression adds EXT_meshopt_compression and output reloads', async () => {
  const r = await opt('trellis-like.glb', 'meshopt.glb', settings({ compression: 'meshopt' }));
  assert.ok(r.optimized.extensions.includes('EXT_meshopt_compression'));
  const again = await analyzeModel(r.outputPath, TMP);
  assert.equal(again.stats.triangles, r.optimized.triangles);
});

await test('textures: JPEG + 1024 resize on color, normal map stays PNG', async () => {
  const r = await opt('trellis-like.glb', 'tex.glb', settings({ simplify: false }, { enabled: true, format: 'jpeg', quality: 80, maxSize: 1024 }));
  assert.ok(r.optimized.textureBytes < r.original.textureBytes / 2, `${r.original.textureBytes} -> ${r.optimized.textureBytes}`);
  const { NodeIO } = require('@gltf-transform/core');
  const sharp = require('sharp');
  const doc = await new NodeIO().read(r.outputPath);
  const [base, normal] = doc.getRoot().listTextures();
  assert.equal(base.getMimeType(), 'image/jpeg');
  assert.equal(normal.getMimeType(), 'image/png');
  assert.equal((await sharp(base.getImage()).metadata()).width, 1024);
});

await test('alpha texture stays PNG when preserving alpha', async () => {
  const r = await opt('alpha.glb', 'alpha.glb', settings({}, { enabled: true, format: 'jpeg', maxSize: 512 }));
  assert.ok(r.warnings.some((w) => w.includes('preserve alpha')));
  const { NodeIO } = require('@gltf-transform/core');
  const doc = await new NodeIO().read(r.outputPath);
  assert.equal(doc.getRoot().listTextures()[0].getMimeType(), 'image/png');
  assert.equal(doc.getRoot().listMaterials()[0].getAlphaMode(), 'BLEND');
});

await test('broken geometry is handled', async () => {
  const r = await opt('broken-geometry.glb', 'broken.glb', settings());
  assert.ok(r.optimized.triangles > 0);
});

await test('corrupt file gives readable error', async () => {
  await assert.rejects(analyzeModel(path.join(FIX, 'corrupt.glb'), TMP), /not a valid|Could not read/);
});

await test('missing external resource gives readable error', async () => {
  await assert.rejects(analyzeModel(path.join(FIX, 'missing-resource.gltf'), TMP), /missing/i);
});

await test('.gltf with external resources: analyze makes GLB preview, optimize works', async () => {
  const a = await analyzeModel(path.join(FIX, 'external.gltf'), TMP);
  assert.ok(a.previewPath.endsWith('.glb'));
  const r = await opt('external.gltf', 'external-opt.glb', settings());
  assert.ok(r.optimized.triangles < r.original.triangles);
});

await test('unicode + spaces in paths', async () => {
  const r = await optimizeModel(
    { inputPath: path.join(FIX, 'tëst šđ folder', 'ünïcode model.glb'), outputPath: path.join(OUT, 'ü ñ out', 'résultat šđ.glb'), settings: settings() },
    () => {},
  );
  await fs.access(r.outputPath);
});

await test('refuses to overwrite the source', async () => {
  await assert.rejects(opt('trellis-like.glb', '../trellis-like.glb', settings()), /cannot be the same/);
});

await test('large model (~1M triangles) completes', async () => {
  const r = await opt('large.glb', 'large-opt.glb', settings());
  console.log(`       ${r.original.triangles} -> ${r.optimized.triangles} tris, ${(r.original.fileSize / 1048576).toFixed(1)} -> ${(r.optimized.fileSize / 1048576).toFixed(1)} MB`);
  assert.ok(r.optimized.triangles < r.original.triangles * 0.6);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
