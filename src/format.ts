export const fmtInt = (n: number) => n.toLocaleString('en-US');

export function fmtBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** Percentage change from a to b, e.g. -75.2 */
export function pctChange(a: number, b: number): number | null {
  if (a === 0) return b === 0 ? 0 : null;
  return ((b - a) / a) * 100;
}

export function fmtPct(p: number | null): string {
  if (p === null) return '—';
  if (Math.abs(p) < 0.05) return '0%';
  return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
}

export const fmtSeconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return i > 0 ? p.slice(0, i) : p;
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') || !dir.includes('/') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

export function stem(fileName: string): string {
  return fileName.replace(/\.(glb|gltf)$/i, '');
}
