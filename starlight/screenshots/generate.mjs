#!/usr/bin/env node
// Dependency-free SVG screenshot generator for the agent-switch docs.
//
// Produces terminal + GUI-mock SVGs into ../public/screenshots/. Everything is
// FAKE and anonymized: emails use the reserved `.example` TLD, profile names are
// generic, and no real tokens / paths / accounts appear. Regenerate with:
//   node generate.mjs          (or: task docs:screenshots)
//
// The images are committed, so the docs build never runs this — it is a
// dev-time tool with zero runtime/CI dependencies.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'screenshots');
mkdirSync(OUT, { recursive: true });

// ---------- palette ----------
const C = {
	fg: '#d4d4d4', dim: '#7d7d85', accent: '#ff7a50', green: '#4ec9b0',
	yellow: '#dcb67a', red: '#e06c75', blue: '#6fb7e6', white: '#f5f5f5',
	termBg: '#1b1b1d', termHead: '#2a2a2e', border: '#3a3a40',
	uiBg: '#161618', uiPanel: '#1f1f23', uiPanel2: '#26262b', uiText: '#e6e6ea',
	uiDim: '#8a8a93', track: '#33333a',
};
const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const CW = 8.4;   // monospace char advance at 14px
const LH = 24;    // terminal line height

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- generic svg primitives ----------
const rect = (x, y, w, h, { r = 0, fill = 'none', stroke = 'none', sw = 1 } = {}) =>
	`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="${fill}"${stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}/>`;
const circle = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const text = (x, y, s, { size = 14, fill = C.fg, weight = 400, family = SANS, anchor = 'start', mono = false } = {}) =>
	`<text x="${x}" y="${y}" font-family="${mono ? MONO : family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" xml:space="preserve">${esc(s)}</text>`;

// window chrome (traffic lights + optional title)
const chrome = (w, headH, title, { headFill = C.termHead } = {}) => {
	let s = rect(0, 0, w, headH, { fill: headFill });
	s += circle(20, headH / 2, 6, '#ff5f57') + circle(40, headH / 2, 6, '#febc2e') + circle(60, headH / 2, 6, '#28c840');
	if (title) s += text(w / 2, headH / 2 + 5, title, { size: 13, fill: C.dim, anchor: 'middle' });
	return s;
};

const svg = (w, h, body, { bg = C.termBg } = {}) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">` +
	rect(0, 0, w, h, { r: 12, fill: bg, stroke: C.border, sw: 1 }) +
	`<clipPath id="clip"><rect x="0" y="0" width="${w}" height="${h}" rx="12" ry="12"/></clipPath>` +
	`<g clip-path="url(#clip)">${body}</g></svg>\n`;

// ---------- terminal renderer ----------
// lines: array of segment-arrays; each segment {t, c?}. A plain string = one fg segment.
function terminal(name, title, lines) {
	const cols = Math.max(...lines.map((ln) => (typeof ln === 'string' ? ln.length : ln.reduce((n, s) => n + s.t.length, 0))), title.length + 4);
	const padX = 18, headH = 34, padTop = 16, padBot = 16;
	const w = Math.ceil(padX * 2 + cols * CW);
	const h = headH + padTop + lines.length * LH + padBot;
	let body = chrome(w, headH, title);
	lines.forEach((ln, i) => {
		const segs = typeof ln === 'string' ? [{ t: ln }] : ln;
		const y = headH + padTop + i * LH + 14;
		let col = 0;
		for (const s of segs) {
			if (s.t.length) body += text(padX + col * CW, y, s.t, { fill: s.c || C.fg, mono: true, size: 14, weight: s.b ? 600 : 400 });
			col += s.t.length;
		}
	});
	writeFileSync(join(OUT, `${name}.svg`), svg(w, h, body));
	return `${name}.svg (${w}x${h})`;
}

// a monospace usage/context bar string helper: returns segments
const bar = (pct, color, width = 10) => {
	const filled = Math.round((pct / 100) * width);
	return [
		{ t: '█'.repeat(filled), c: color },
		{ t: '░'.repeat(width - filled), c: C.track },
		{ t: ` ${pct}%`, c: C.dim },
	];
};

// ---------- GUI mock renderer ----------
function usageBar(x, y, w, pct, color, label) {
	const fw = Math.round((pct / 100) * w);
	return rect(x, y, w, 8, { r: 4, fill: C.track }) +
		rect(x, y, fw, 8, { r: 4, fill: color }) +
		text(x + w + 10, y + 8, label, { size: 12, fill: C.uiDim });
}
const badge = (x, y, label, color, fill) =>
	rect(x, y - 12, label.length * 7 + 16, 20, { r: 10, fill: fill || 'none', stroke: color, sw: 1 }) +
	text(x + 8, y + 3, label, { size: 11, fill: color, weight: 600 });

function tab(x, y, label, active) {
	const w = label.length * 8 + 28;
	let s = rect(x, y, w, 30, { r: 8, fill: active ? C.uiPanel2 : 'none', stroke: active ? C.accent : 'none', sw: 1 });
	s += text(x + w / 2, y + 20, label, { size: 13, fill: active ? C.white : C.uiDim, weight: active ? 600 : 400, anchor: 'middle' });
	return { s, w };
}

function profileCard(x, y, w, { name, email, pct, color, label, active, live }) {
	let s = rect(x, y, w, 66, { r: 10, fill: C.uiPanel2, stroke: active ? C.accent : C.border, sw: active ? 1.5 : 1 });
	s += circle(x + 22, y + 24, 5, active ? C.accent : C.uiDim);
	s += text(x + 40, y + 22, name, { size: 15, fill: C.uiText, weight: 600 });
	if (active) s += badge(x + 40 + name.length * 9 + 14, y + 22, 'active', C.accent);
	if (live) s += badge(x + 40 + name.length * 9 + 14 + (active ? 66 : 0), y + 22, 'live', C.green);
	s += text(x + 40, y + 42, email, { size: 12.5, fill: C.uiDim, mono: true });
    s += usageBar(x + 40, y + 52, w - 130, pct, color, `${pct}%`);
	return s;
}

// ---------- fixtures (ALL FAKE / anonymized) ----------
const prompt = (cmd) => [{ t: '$ ', c: C.green }, { t: cmd, c: C.white }];

const results = [];

// 1. asw — the everyday profile list
results.push(terminal('asw-list', 'zsh — agent-switch', [
	prompt('asw'),
	[{ t: '* ', c: C.accent }, { t: 'work        ', c: C.white }, { t: 'you@company.example', c: C.dim }],
	[{ t: '  privat      ', c: C.fg }, { t: 'you@personal.example', c: C.dim }],
	[{ t: '  event4u     ', c: C.fg }, { t: 'dev@event4u.example', c: C.dim }],
	[{ t: '', c: C.fg }],
	[{ t: '$ ', c: C.green }, { t: 'asw privat', c: C.white }],
	[{ t: '✓ ', c: C.green }, { t: 'claude → ', c: C.fg }, { t: 'privat', c: C.accent }, { t: ' (you@personal.example)', c: C.dim }],
]));

// 2. list --provider grouped: the multi-provider model
results.push(terminal('list-multiprovider', 'agent-switch list', [
	prompt('agent-switch list'),
	[{ t: 'claude', c: C.accent, b: true }],
	[{ t: '  * work        ', c: C.white }, { t: 'you@company.example', c: C.dim }, { t: '   2 live', c: C.green }],
	[{ t: '    privat      ', c: C.fg }, { t: 'you@personal.example', c: C.dim }],
	[{ t: 'codex', c: C.accent, b: true }],
	[{ t: '  * work        ', c: C.white }, { t: 'you@company.example', c: C.dim }],
	[{ t: 'antigravity', c: C.accent, b: true }],
	[{ t: '    personal    ', c: C.fg }, { t: 'you@personal.example', c: C.dim }],
]));

// 3. status — identity + usage + context
results.push(terminal('status', 'agent-switch status', [
	prompt('agent-switch status'),
	[{ t: 'profile   ', c: C.dim }, { t: 'work', c: C.white }, { t: '  (you@company.example)', c: C.dim }],
	[{ t: 'plan      ', c: C.dim }, { t: 'Max 20x', c: C.fg }],
	[{ t: 'usage     ', c: C.dim }, ...bar(46, C.green)],
	[{ t: 'week      ', c: C.dim }, ...bar(71, C.yellow)],
	[{ t: 'context   ', c: C.dim }, ...bar(80, C.accent), { t: '  (live session)', c: C.dim }],
]));

// 4. sessions — recent + live with context %
results.push(terminal('sessions', 'agent-switch sessions', [
	prompt('agent-switch sessions work'),
	[{ t: 'ID        SESSION                      CONTEXT', c: C.dim }],
	[{ t: 'a1b2c3    ', c: C.blue }, { t: 'refactor auth module        ', c: C.fg }, ...bar(80, C.accent, 8)],
	[{ t: 'd4e5f6    ', c: C.blue }, { t: 'docs: starlight site        ', c: C.fg }, ...bar(34, C.green, 8)],
	[{ t: '9f8e7d    ', c: C.blue }, { t: 'fix flaky e2e test          ', c: C.fg }, ...bar(12, C.green, 8)],
	[{ t: '● a1b2c3  ', c: C.green }, { t: 'live now', c: C.green }],
]));

// 5. doctor — self-check
results.push(terminal('doctor', 'agent-switch doctor', [
	prompt('agent-switch doctor'),
	[{ t: '✓ ', c: C.green }, { t: 'shell integration active (zsh)', c: C.fg }],
	[{ t: '✓ ', c: C.green }, { t: 'claude  — binary found, 2 profiles', c: C.fg }],
	[{ t: '✓ ', c: C.green }, { t: 'codex   — binary found, 1 profile', c: C.fg }],
	[{ t: '⚠ ', c: C.yellow }, { t: 'antigravity — agy not on PATH (optional)', c: C.dim }],
	[{ t: '✓ ', c: C.green }, { t: 'daemon running · last poll 12s ago', c: C.fg }],
	[{ t: 'All critical checks passed.', c: C.white }],
]));

// ---------- GUI mocks ----------
function guiMain() {
	const w = 760, headH = 40;
	let b = chrome(w, headH, 'agent-switch', { headFill: C.uiPanel });
	// tab row
	let tx = 20; const ty = headH + 16;
	for (const [label, active] of [['Claude', true], ['Codex', false], ['Antigravity', false]]) {
		const t = tab(tx, ty, label, active); b += t.s; tx += t.w + 10;
	}
	b += text(w - 20, ty + 20, 'Max 20x', { size: 12, fill: C.uiDim, anchor: 'end' });
	// profile cards
	const cy = ty + 50;
	b += profileCard(20, cy, w - 40, { name: 'work', email: 'you@company.example', pct: 46, color: C.green, active: true, live: true });
	b += profileCard(20, cy + 78, w - 40, { name: 'privat', email: 'you@personal.example', pct: 18, color: C.green });
	b += profileCard(20, cy + 156, w - 40, { name: 'event4u', email: 'dev@event4u.example', pct: 63, color: C.yellow });
	const h = cy + 156 + 66 + 20;
	writeFileSync(join(OUT, 'gui-main.svg'), svg(w, h, b, { bg: C.uiBg }));
	return `gui-main.svg (${w}x${h})`;
}

function guiSessions() {
	const w = 760, headH = 40;
	let b = chrome(w, headH, 'agent-switch — sessions', { headFill: C.uiPanel });
	b += text(20, headH + 30, 'Sessions · work', { size: 15, fill: C.uiText, weight: 600 });
	const rows = [
		{ title: 'refactor auth module', when: '2m ago', pct: 80, color: C.accent, live: true },
		{ title: 'docs: starlight site', when: '1h ago', pct: 34, color: C.green },
		{ title: 'fix flaky e2e test', when: 'yesterday', pct: 12, color: C.green },
	];
	let y = headH + 48;
	for (const r of rows) {
		b += rect(20, y, w - 40, 60, { r: 10, fill: C.uiPanel2, stroke: C.border, sw: 1 });
		if (r.live) b += circle(38, y + 24, 5, C.green);
		b += text(r.live ? 52 : 20 + 16, y + 24, r.title, { size: 14, fill: C.uiText, weight: 600 });
		b += text(20 + 16, y + 44, r.when, { size: 12, fill: C.uiDim });
		b += usageBar(w - 40 - 190, y + 26, 120, r.pct, r.color, `${r.pct}% context`);
		y += 68;
	}
	b += text(20, y + 12, 'takeover · preview · compact · handoff', { size: 12, fill: C.uiDim, mono: true });
	const h = y + 32;
	writeFileSync(join(OUT, 'gui-sessions.svg'), svg(w, h, b, { bg: C.uiBg }));
	return `gui-sessions.svg (${w}x${h})`;
}

results.push(guiMain());
results.push(guiSessions());

console.log('Generated ' + results.length + ' screenshots into public/screenshots/:');
for (const r of results) console.log('  ' + r);
