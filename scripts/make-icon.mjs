// Renders build/icon.png (512px) from an inline SVG. Run once; the PNG is committed.
import fs from 'node:fs/promises';
import sharp from 'sharp';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#f97316"/>
  <g fill="none" stroke="#111318" stroke-width="30" stroke-linejoin="round" stroke-linecap="round">
    <path d="M256 92 404 176v160L256 420 108 336V176z"/>
    <path d="M108 176l148 84 148-84M256 260v160"/>
  </g>
  <g fill="#111318">
    <circle cx="256" cy="260" r="22"/><circle cx="108" cy="176" r="18"/><circle cx="404" cy="176" r="18"/>
    <circle cx="256" cy="92" r="18"/><circle cx="256" cy="420" r="18"/><circle cx="108" cy="336" r="18"/><circle cx="404" cy="336" r="18"/>
  </g>
</svg>`;

await fs.mkdir('build', { recursive: true });
await sharp(Buffer.from(svg)).resize(512, 512).png().toFile('build/icon.png');
console.log('build/icon.png written');
