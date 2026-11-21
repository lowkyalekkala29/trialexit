/**
 * Renders the brand icons (green square + white tick) with Chromium.
 *   rounded (transparent corners): extension toolbar + PWA "any"
 *   full-bleed square:             iOS home screen (iOS rounds it) + PWA "maskable"
 * Run: node scripts/icons-render.cjs
 */
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.join(__dirname, '..', 'extension', 'icons');
const svg = (size, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect x="0" y="0" width="100" height="100" rx="${rounded ? 22 : 0}" fill="#16a34a"/>
  <path d="M${rounded ? 27 : 31} ${rounded ? 52 : 52} L${rounded ? 43 : 45} ${rounded ? 67 : 65} L${rounded ? 74 : 70} ${rounded ? 34 : 37}" fill="none" stroke="#fff" stroke-width="${rounded ? 11 : 9.5}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const jobs = [
    ...[16, 32, 48, 128, 192, 512].map((s) => [`icon-${s}.png`, s, true]),
    ['icon-180.png', 180, false],
    ['icon-maskable-512.png', 512, false],
  ];
  for (const [name, size, rounded] of jobs) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(size, rounded)}</body></html>`);
    await p.screenshot({ path: path.join(OUT, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log('icon', name);
  }
  await b.close();
})();
