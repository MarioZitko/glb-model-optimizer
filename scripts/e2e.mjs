// Drives the real Electron app (dev build or packaged exe) end to end and saves screenshots.
// Usage: node scripts/e2e.mjs [--exe path\to\app.exe] [--shots dir]
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { _electron as electron } from 'playwright-core';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const exe = arg('--exe');
const shots = path.resolve(arg('--shots') ?? 'test-fixtures/screenshots');
const FIX = path.resolve('test-fixtures');
const OUT_DIR = path.join(FIX, 'out-e2e', 'földer with spaces');
await fs.rm(path.join(FIX, 'out-e2e'), { recursive: true, force: true });
await fs.mkdir(shots, { recursive: true });
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'mo-e2e-'));

const app = await electron.launch({
  ...(exe ? { executablePath: exe, args: [] } : { args: ['.'] }),
  env: { ...process.env, MODEL_OPTIMIZER_USER_DATA: userData },
});
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));
await page.setViewportSize({ width: 1600, height: 940 }).catch(() => {});
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 980));

const stubDialogs = (file) =>
  app.evaluate(({ dialog }, { file, dir }) => {
    dialog.showOpenDialog = async (_w, opts) => ({ canceled: false, filePaths: [opts.properties.includes('openDirectory') ? dir : file] });
    dialog.showMessageBox = async () => ({ response: 0 });
  }, { file, dir: OUT_DIR });

let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failures++;
};

async function loadAndOptimize(file, shotName, configure) {
  await stubDialogs(file);
  await page.getByText('or click to browse').click();
  await page.getByText(path.basename(file), { exact: true }).waitFor({ timeout: 60000 });
  await page.locator('canvas').first().waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Browse', exact: true }).click();
  if (configure) await configure();
  await page.getByRole('button', { name: 'Optimize Model' }).click();
  await page.getByText(/Saved in|failed|Could not/).first().waitFor({ timeout: 300000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shots, `${shotName}.png`) });
}

// 1. TRELLIS-like model with default (Unity Balanced) preset.
await page.waitForLoadState('domcontentloaded');
await page.screenshot({ path: path.join(shots, '0-empty.png') });
await loadAndOptimize(path.join(FIX, 'trellis-like.glb'), '1-balanced');
check(await page.getByText(/Saved in/).isVisible(), 'balanced optimization saved');
check((await page.locator('canvas').count()) === 2, 'both previews render a canvas');
const outFile = path.join(OUT_DIR, 'trellis-like_optimized.glb');
check(!!(await fs.stat(outFile).catch(() => null)), `output exists: ${outFile}`);

// 2. Wireframe + overwrite existing (dialog stubbed to "Overwrite").
await page.getByRole('button', { name: 'Wireframe' }).click();
await page.getByText('Aggressive', { exact: true }).click();
await page.getByRole('button', { name: 'Optimize Model' }).click();
await page.getByText(/Saved in/).waitFor({ timeout: 120000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: path.join(shots, '2-aggressive-wireframe.png') });
await page.getByRole('button', { name: 'Wireframe' }).click();

// 3. Multi-mesh + textures as JPEG + Meshopt (exercises decoder in the preview).
await loadAndOptimize(path.join(FIX, 'multi-mesh.glb'), '3-multimesh-meshopt', async () => {
  await page.getByText('Cleanup & advanced').click();
  await page.locator('select').filter({ hasText: 'Meshopt' }).selectOption('meshopt');
  await page.getByRole('switch', { name: 'Enable texture optimization' }).click();
  await page.locator('select').filter({ hasText: 'Keep original' }).selectOption('jpeg');
});
check(await page.getByText(/Saved in/).isVisible(), 'multi-mesh + meshopt + jpeg saved');

// 4. Corrupt file shows an error instead of crashing.
await stubDialogs(path.join(FIX, 'corrupt.glb'));
await page.getByText('or click to browse').click();
await page.getByText(/not a valid glTF|Could not read/).waitFor({ timeout: 30000 });
check(true, 'corrupt file reports readable error');
await page.screenshot({ path: path.join(shots, '4-corrupt.png') });

// 5. Cancel a long job on the large model.
await stubDialogs(path.join(FIX, 'large.glb'));
await page.getByText('or click to browse').click();
await page.getByText('large.glb', { exact: true }).waitFor({ timeout: 120000 });
await page.getByRole('button', { name: 'Optimize Model' }).click();
await page.getByRole('button', { name: 'Cancel' }).click();
await page.getByText('Optimization cancelled.').waitFor({ timeout: 30000 });
check(true, 'cancel works');
await page.getByRole('button', { name: 'Optimize Model' }).click();
await page.getByText(/Saved in/).waitFor({ timeout: 300000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: path.join(shots, '5-large.png') });
check(true, 'large model optimized after cancel');

// 6. Settings were persisted.
const saved = JSON.parse(await fs.readFile(path.join(userData, 'settings.json'), 'utf8'));
check(saved.outputDir === OUT_DIR, 'output folder remembered');

const relevant = errors.filter((e) => !/Autofill|DevTools/.test(e));
check(relevant.length === 0, `no renderer errors${relevant.length ? ':\n    ' + relevant.join('\n    ') : ''}`);

await app.close();
await fs.rm(userData, { recursive: true, force: true });
console.log(`\n${failures ? `${failures} check(s) failed` : 'all e2e checks passed'} — screenshots in ${shots}`);
process.exit(failures ? 1 : 0);

