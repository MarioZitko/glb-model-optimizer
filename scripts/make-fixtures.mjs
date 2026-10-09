// Generates synthetic test models in test-fixtures/ (TRELLIS-like unwelded meshes, multi-mesh,
// alpha, broken geometry, corrupt files, missing resources, unicode paths, large models).
import fs from 'node:fs/promises';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const OUT = path.resolve('test-fixtures');
const io = new NodeIO();

/** UV sphere, expanded to non-indexed triangles like TRELLIS/trimesh exports (every vertex unique). */
function sphere(seg, rings, radius = 1, noise = 0) {
  const p = [], n = [], uv = [];
  const vert = (i, j) => {
    const u = i / seg, v = j / rings;
    const th = u * Math.PI * 2, ph = v * Math.PI;
    const r = radius * (1 + noise * Math.sin(th * 7) * Math.sin(ph * 5));
    const nx = Math.sin(ph) * Math.cos(th), ny = Math.cos(ph), nz = Math.sin(ph) * Math.sin(th);
    return { pos: [nx * r, ny * r, nz * r], nor: [nx, ny, nz], uv: [u, v] };
  };
  const push = (v) => { p.push(...v.pos); n.push(...v.nor); uv.push(...v.uv); };
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < seg; i++) {
      const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1);
      push(a); push(c); push(b);
      push(a); push(d); push(c);
    }
  return { p: new Float32Array(p), n: new Float32Array(n), uv: new Float32Array(uv) };
}

function addPrim(doc, buffer, geo, material, indices) {
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(geo.p).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(geo.n).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(geo.uv).setBuffer(buffer))
    .setMaterial(material);
  if (indices) prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer));
  return prim;
}

async function noiseTexture(size, channels = 3) {
  const raw = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * channels;
      raw[o] = (x * 255) / size; raw[o + 1] = (y * 255) / size; raw[o + 2] = ((x ^ y) & 255);
      if (channels === 4) raw[o + 3] = ((x >> 5) + (y >> 5)) % 2 ? 255 : 40;
    }
  return new Uint8Array(await sharp(raw, { raw: { width: size, height: size, channels } }).png().toBuffer());
}

async function normalTexture(size) {
  const raw = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { raw[i * 3] = 128 + 20 * Math.sin(i / 50); raw[i * 3 + 1] = 128; raw[i * 3 + 2] = 255; }
  return new Uint8Array(await sharp(raw, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer());
}

async function trellisLike(name, seg, rings, texSize) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const base = doc.createTexture('baseColor').setImage(await noiseTexture(texSize)).setMimeType('image/png');
  const normal = doc.createTexture('normal').setImage(await normalTexture(Math.min(texSize, 1024))).setMimeType('image/png');
  const mat = doc.createMaterial('material_0').setBaseColorTexture(base).setNormalTexture(normal).setRoughnessFactor(0.8);
  const mesh = doc.createMesh('geometry_0').addPrimitive(addPrim(doc, buffer, sphere(seg, rings, 1, 0.05), mat));
  doc.createScene('Scene').addChild(doc.createNode('world').addChild(doc.createNode('geometry_0').setMesh(mesh)));
  await io.write(path.join(OUT, name), doc);
}

async function multiMesh() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const tex = doc.createTexture('shared').setImage(await noiseTexture(512)).setMimeType('image/png');
  const root = doc.createNode('root');
  for (let k = 0; k < 3; k++) {
    const mat = doc.createMaterial(`mat_${k}`).setBaseColorFactor([k === 0 ? 1 : 0.3, k === 1 ? 1 : 0.3, k === 2 ? 1 : 0.3, 1]);
    if (k === 0) mat.setBaseColorTexture(tex);
    const mesh = doc.createMesh(`part_${k}`).addPrimitive(addPrim(doc, buffer, sphere(48 + k * 16, 24 + k * 8, 0.5), mat));
    root.addChild(doc.createNode(`part_${k}`).setMesh(mesh).setTranslation([k * 1.2 - 1.2, 0, 0]));
  }
  // Duplicate material + texture to exercise dedup.
  const dupTex = doc.createTexture('shared_copy').setImage(tex.getImage()).setMimeType('image/png');
  const dupMat = doc.createMaterial('mat_0_copy').setBaseColorTexture(dupTex);
  const extra = doc.createMesh('part_dup').addPrimitive(addPrim(doc, buffer, sphere(32, 16, 0.3), dupMat));
  root.addChild(doc.createNode('part_dup').setMesh(extra).setTranslation([0, 1, 0]));
  // Unused resources to exercise prune.
  doc.createMaterial('unused_material');
  doc.createScene('Scene').addChild(root);
  await io.write(path.join(OUT, 'multi-mesh.glb'), doc);
}

async function alpha() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const tex = doc.createTexture('leaf').setImage(await noiseTexture(1024, 4)).setMimeType('image/png');
  const mat = doc.createMaterial('leaf').setBaseColorTexture(tex).setAlphaMode('BLEND').setDoubleSided(true);
  const mesh = doc.createMesh('leaf').addPrimitive(addPrim(doc, buffer, sphere(64, 32, 1), mat));
  doc.createScene().addChild(doc.createNode('leaf').setMesh(mesh));
  await io.write(path.join(OUT, 'alpha.glb'), doc);
}

async function broken() {
  // Degenerate triangles, zero-area slivers and unreferenced vertices.
  const doc = new Document();
  const buffer = doc.createBuffer();
  const geo = sphere(40, 20, 1);
  const vCount = geo.p.length / 3;
  const idx = [];
  for (let i = 0; i < vCount; i += 3) idx.push(i, i + 1, i + 2);
  for (let i = 0; i < 200; i++) idx.push(i, i, i + 1); // degenerate
  const mat = doc.createMaterial('m');
  const prim = addPrim(doc, buffer, { p: geo.p, n: geo.n, uv: geo.uv }, mat, new Uint32Array(idx));
  doc.createScene().addChild(doc.createNode('broken').setMesh(doc.createMesh('broken').addPrimitive(prim)));
  await io.write(path.join(OUT, 'broken-geometry.glb'), doc);
}

async function missingResource() {
  const doc = new Document();
  const buffer = doc.createBuffer().setURI('missing.bin');
  const mesh = doc.createMesh('m').addPrimitive(addPrim(doc, buffer, sphere(16, 8), doc.createMaterial('m')));
  doc.createScene().addChild(doc.createNode('n').setMesh(mesh));
  await io.write(path.join(OUT, 'missing-resource.gltf'), doc);
  await fs.rm(path.join(OUT, 'missing.bin'));
}

async function externalGltf() {
  const doc = new Document();
  const buffer = doc.createBuffer().setURI('external.bin');
  const tex = doc.createTexture('t').setImage(await noiseTexture(256)).setMimeType('image/png').setURI('external_tex.png');
  const mesh = doc.createMesh('m').addPrimitive(addPrim(doc, buffer, sphere(64, 32), doc.createMaterial('m').setBaseColorTexture(tex)));
  doc.createScene().addChild(doc.createNode('n').setMesh(mesh));
  await io.write(path.join(OUT, 'external.gltf'), doc);
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(path.join(OUT, 'tëst šđ folder'), { recursive: true });
await trellisLike('trellis-like.glb', 256, 128, 2048); // ~65k triangles, 2K texture
await trellisLike('tëst šđ folder/ünïcode model.glb', 64, 32, 256);
await trellisLike('large.glb', 1024, 512, 4096); // ~1M triangles
await multiMesh();
await alpha();
await broken();
await missingResource();
await externalGltf();
await fs.writeFile(path.join(OUT, 'corrupt.glb'), Buffer.from('glTF\x02\x00\x00\x00garbage-not-a-real-model'));
for (const f of await fs.readdir(OUT, { recursive: true })) {
  const st = await fs.stat(path.join(OUT, f));
  if (st.isFile()) console.log(`${f.padEnd(40)} ${(st.size / 1048576).toFixed(2)} MB`);
}
