#!/usr/bin/env node
/**
 * Copies the images the docs share with the README from their single source
 * (.github/assets, gui/public/pets) into public/media/, which is gitignored.
 * Runs before `dev` and `build`, so the docs and the README can never show
 * different screenshots.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DOCS, '..');
const OUT = path.join(DOCS, 'public', 'media');

const copies = [
	['.github/assets/info-image.png', 'info-image.png'],
	['.github/assets/og-image.png', 'og-image.png'],
	['.github/assets/demo.gif', 'demo.gif'],
	['gui/public/pets/agent-switch/states.png', 'pet-states.png'],
];
for (const f of fs.readdirSync(path.join(ROOT, '.github/assets/screenshots'))) {
	if (f.endsWith('.png')) copies.push([`.github/assets/screenshots/${f}`, `screenshots/${f}`]);
}

fs.rmSync(OUT, { recursive: true, force: true });
for (const [from, to] of copies) {
	const dst = path.join(OUT, to);
	fs.mkdirSync(path.dirname(dst), { recursive: true });
	fs.copyFileSync(path.join(ROOT, from), dst);
}
console.log(`synced ${copies.length} shared images into public/media/`);
