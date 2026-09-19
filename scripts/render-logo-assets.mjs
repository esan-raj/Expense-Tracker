/**
 * Rasterize `logo/spendwise-wallet-s.svg` into Expo PNG slots.
 * Usage: node scripts/render-logo-assets.mjs
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = join(root, 'logo', 'spendwise-wallet-s.svg');
const brandDir = join(root, 'assets', 'brand');
const outDir = join(root, 'assets', 'images');

const UPPER =
  'M462 190H724C763 190 786 214 786 253V348C786 395 762 426 721 431C708 433 696 431 680 427L535 381C495 368 463 394 463 432V527C463 545 451 552 433 547L351 519C278 496 226 440 226 361C226 269 315 190 410 190Z';
const LOWER =
  'M506 416C506 411 510 408 516 410L677 459C753 482 790 539 790 612V686C790 747 753 789 693 789H295C249 789 225 764 225 721V612C225 567 251 543 287 543C298 543 309 545 323 550L438 588C472 599 506 575 506 539Z';
const EMERALD = '#11B47B';
const TEAL = '#004B4E';
const PLATE = '#FAF9F6';
const WHITE = '#FFFFFF';

const source = readFileSync(sourcePath, 'utf8');
if (!source.includes(UPPER) || !source.includes(LOWER) || !source.includes(PLATE)) {
  throw new Error('logo/spendwise-wallet-s.svg does not match the canonical Wallet S paths.');
}

function markGroup(cut = PLATE, upper = EMERALD, lower = TEAL) {
  return `<g transform="translate(0 10)">
    <path fill="${upper}" d="${UPPER}"/>
    <path fill="${lower}" d="${LOWER}"/>
    <rect x="591" y="517" width="120" height="34" rx="17" fill="${cut}"/>
  </g>`;
}

function svgDocument(size, body, background) {
  const bg = background
    ? `<rect width="${size}" height="${size}" fill="${background}"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  ${bg}
  ${body}
</svg>`;
}

function renderPng(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  return resvg.render().asPng();
}

function writePng(name, svg, size) {
  writeFileSync(join(outDir, name), renderPng(svg, size));
  console.log(`wrote ${name} (${size}x${size})`);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(brandDir, { recursive: true });
copyFileSync(sourcePath, join(brandDir, 'wallet-s.svg'));

writePng('icon.png', svgDocument(1024, markGroup(), PLATE), 1024);
writePng('android-icon-background.png', svgDocument(1024, '', PLATE), 1024);
writePng('android-icon-foreground.png', svgDocument(1024, markGroup()), 1024);
writePng(
  'android-icon-monochrome.png',
  svgDocument(
    1024,
    `<g transform="translate(0 10)">
      <path fill="${WHITE}" d="${UPPER}"/>
      <path fill="${WHITE}" d="${LOWER}"/>
    </g>`
  ),
  1024
);
writePng('splash-icon.png', svgDocument(1024, markGroup()), 1024);
writePng('favicon.png', svgDocument(1024, markGroup(), PLATE), 48);
