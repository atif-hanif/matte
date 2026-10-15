(function () {
'use strict';

/* =====================================================================
   CONFIG — edit these to match where you host things
===================================================================== */
const CONFIG = {
	// ONNX Runtime Web: only loaded the first time AI inpainting is used.
	// To host it yourself, put ort.wasm.min.js AND the .wasm / .mjs files from
	// onnxruntime-web/dist in one folder and point both entries at it.
	ortScript: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.js',
	ortBase: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/',

	// LaMa inpainting model (Carve/LaMa-ONNX -> lama_fp32.onnx, ~209 MB).
	// Path is relative to this HTML page (same rule as your other vendor files).
	modelUrl: 'assets/vendors/inpaint/lama_fp32.onnx',
	modelSize: 512, // the model is fixed at 512x512

	growFast: 3, // px the painted mask is expanded before a lightweight fill
	growAI: 6, // px the painted mask is expanded before AI inpainting
	maxDimension: 4096, // larger images are scaled down to this on open
	historyLimit: 12
};

// Fonts that need no download. Every Google Font comes from google-fonts-list.js (window.GOOGLE_FONTS).
const SYSTEM_FONTS = [
	{ name: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
	{ name: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
	{ name: 'Georgia', stack: 'Georgia, serif' },
	{ name: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
	{ name: 'Courier New', stack: '"Courier New", Courier, monospace' },
	{ name: 'Impact', stack: 'Impact, "Arial Black", sans-serif' }
];

const MIME = { png: 'image/png', webp: 'image/webp', jpeg: 'image/jpeg' };
const EXT = { png: 'png', webp: 'webp', jpeg: 'jpg' };
const HANDLE = 9; // selection handle size, in screen px

/* ===PURE-START=== (no DOM in this block, so it can be unit-tested) */
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

// Grow a 0/1 mask by r pixels (square window, separable running sums).
function dilateMask(m, w, h, r) {
	if (r <= 0) return m;
	const tmp = new Uint8Array(w * h);
	const out = new Uint8Array(w * h);
	for (let y = 0; y < h; y++) {
		const row = y * w;
		let cnt = 0;
		for (let i = 0; i <= Math.min(r - 1, w - 1); i++) cnt += m[row + i];
		for (let x = 0; x < w; x++) {
			const add = x + r;
			if (add < w) cnt += m[row + add];
			const rem = x - r - 1;
			if (rem >= 0) cnt -= m[row + rem];
			tmp[row + x] = cnt > 0 ? 1 : 0;
		}
	}
	for (let x = 0; x < w; x++) {
		let cnt = 0;
		for (let i = 0; i <= Math.min(r - 1, h - 1); i++) cnt += tmp[i * w + x];
		for (let y = 0; y < h; y++) {
			const add = y + r;
			if (add < h) cnt += tmp[add * w + x];
			const rem = y - r - 1;
			if (rem >= 0) cnt -= tmp[rem * w + x];
			out[y * w + x] = cnt > 0 ? 1 : 0;
		}
	}
	return out;
}

// Soft 0..1 version of a mask (box blur), used to feather AI results into the photo.
function featherMask(m, w, h, r) {
	const a = new Float32Array(w * h);
	for (let i = 0; i < a.length; i++) a[i] = m[i];
	if (r <= 0) return a;
	const tmp = new Float32Array(w * h);
	const win = 2 * r + 1;
	for (let y = 0; y < h; y++) {
		const row = y * w;
		let sum = 0;
		for (let i = -r; i <= r; i++) sum += a[row + clamp(i, 0, w - 1)];
		for (let x = 0; x < w; x++) {
			tmp[row + x] = sum / win;
			sum += a[row + clamp(x + r + 1, 0, w - 1)] - a[row + clamp(x - r, 0, w - 1)];
		}
	}
	for (let x = 0; x < w; x++) {
		let sum = 0;
		for (let i = -r; i <= r; i++) sum += tmp[clamp(i, 0, h - 1) * w + x];
		for (let y = 0; y < h; y++) {
			a[y * w + x] = sum / win;
			sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
		}
	}
	return a;
}

// Estimate sensor/JPEG noise from known pixels near the hole (robust, median-based).
function estimateNoise(px, mask, w, h) {
	const ring = dilateMask(mask, w, h, 6);
	const vals = new Float32Array(w * h);
	let c = 0;
	const lum = (i) => (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 3;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const i = y * w + x;
			if (!ring[i] || mask[i]) continue;
			const l = i - 1, r = i + 1, u = i - w, d = i + w;
			if (mask[l] || mask[r] || mask[u] || mask[d]) continue;
			vals[c++] = Math.abs(lum(i) - (lum(l) + lum(r) + lum(u) + lum(d)) / 4);
		}
	}
	if (c < 20) return 0;
	const arr = vals.subarray(0, c);
	arr.sort();
	const med = arr[c >> 1];
	return clamp(1.4826 * med / Math.sqrt(1.25), 0, 10);
}

// Lightweight fill: push-pull pyramid for a smooth first guess, then diffusion
// (Gauss-Seidel) to relax it, then matching noise so the patch doesn't look plastic.
// px is RGBA (modified in place); mask is 0/1 with 1 = hole. Returns false if it can't run.
function inpaintDiffusion(px, mask, w, h, opts) {
	opts = opts || {};
	const n = w * h;
	let known = 0;
	for (let i = 0; i < n; i++) if (!mask[i]) known++;
	if (known === 0 || known === n) return false;

	const lv0 = { w: w, h: h, P: new Float32Array(n * 4), K: new Uint8Array(n) };
	for (let i = 0; i < n; i++) {
		if (!mask[i]) {
			lv0.K[i] = 1;
			const o = i * 4;
			lv0.P[o] = px[o]; lv0.P[o + 1] = px[o + 1]; lv0.P[o + 2] = px[o + 2]; lv0.P[o + 3] = px[o + 3];
		}
	}

	// push: build coarser levels from the known pixels only
	const levels = [lv0];
	for (;;) {
		const L = levels[levels.length - 1];
		let all = true;
		for (let i = 0; i < L.K.length; i++) { if (!L.K[i]) { all = false; break; } }
		if (all || (L.w === 1 && L.h === 1)) break;
		const nw = Math.max(1, (L.w + 1) >> 1), nh = Math.max(1, (L.h + 1) >> 1);
		const N = { w: nw, h: nh, P: new Float32Array(nw * nh * 4), K: new Uint8Array(nw * nh) };
		for (let y = 0; y < nh; y++) {
			for (let x = 0; x < nw; x++) {
				let s0 = 0, s1 = 0, s2 = 0, s3 = 0, c = 0;
				for (let dy = 0; dy < 2; dy++) {
					const fy = 2 * y + dy;
					if (fy >= L.h) continue;
					for (let dx = 0; dx < 2; dx++) {
						const fx = 2 * x + dx;
						if (fx >= L.w) continue;
						const j = fy * L.w + fx;
						if (L.K[j]) { const o = j * 4; s0 += L.P[o]; s1 += L.P[o + 1]; s2 += L.P[o + 2]; s3 += L.P[o + 3]; c++; }
					}
				}
				if (c) {
					const k = y * nw + x, o = k * 4;
					N.P[o] = s0 / c; N.P[o + 1] = s1 / c; N.P[o + 2] = s2 / c; N.P[o + 3] = s3 / c; N.K[k] = 1;
				}
			}
		}
		levels.push(N);
	}

	// pull: fill holes from the coarser level (bilinear), coarse -> fine
	for (let li = levels.length - 2; li >= 0; li--) {
		const F = levels[li], C = levels[li + 1];
		for (let y = 0; y < F.h; y++) {
			const cy = (y + 0.5) / 2 - 0.5;
			let y0 = Math.floor(cy);
			const fy = cy - y0;
			const y1 = Math.min(C.h - 1, y0 + 1);
			y0 = Math.max(0, y0);
			for (let x = 0; x < F.w; x++) {
				const i = y * F.w + x;
				if (F.K[i]) continue;
				const cx = (x + 0.5) / 2 - 0.5;
				let x0 = Math.floor(cx);
				const fx = cx - x0;
				const x1 = Math.min(C.w - 1, x0 + 1);
				x0 = Math.max(0, x0);
				const a = (y0 * C.w + x0) * 4, b = (y0 * C.w + x1) * 4, c = (y1 * C.w + x0) * 4, d = (y1 * C.w + x1) * 4;
				const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
				for (let k = 0; k < 4; k++) {
					F.P[i * 4 + k] = C.P[a + k] * w00 + C.P[b + k] * w10 + C.P[c + k] * w01 + C.P[d + k] * w11;
				}
			}
		}
	}

	// relax: diffusion over the hole pixels at full resolution
	const P = lv0.P;
	const holes = [];
	for (let i = 0; i < n; i++) if (mask[i]) holes.push(i);
	const iters = opts.iterations || 40;
	for (let it = 0; it < iters; it++) {
		for (let t = 0; t < holes.length; t++) {
			const i = holes[t];
			const x = i % w, y = (i / w) | 0;
			const l = (x > 0 ? i - 1 : i) * 4, r = (x < w - 1 ? i + 1 : i) * 4;
			const u = (y > 0 ? i - w : i) * 4, d = (y < h - 1 ? i + w : i) * 4;
			const o = i * 4;
			P[o] = (P[l] + P[r] + P[u] + P[d]) * 0.25;
			P[o + 1] = (P[l + 1] + P[r + 1] + P[u + 1] + P[d + 1]) * 0.25;
			P[o + 2] = (P[l + 2] + P[r + 2] + P[u + 2] + P[d + 2]) * 0.25;
			P[o + 3] = (P[l + 3] + P[r + 3] + P[u + 3] + P[d + 3]) * 0.25;
		}
	}

	// matching noise (luminance noise, same on R/G/B)
	const sigma = (opts.noise === false) ? 0 : estimateNoise(px, mask, w, h) * 0.9;
	for (let t = 0; t < holes.length; t++) {
		const i = holes[t], o = i * 4;
		let g = 0;
		if (sigma > 0) {
			const u1 = Math.random() || 1e-9, u2 = Math.random();
			g = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * sigma;
		}
		px[o] = clamp(Math.round(P[o] + g), 0, 255);
		px[o + 1] = clamp(Math.round(P[o + 1] + g), 0, 255);
		px[o + 2] = clamp(Math.round(P[o + 2] + g), 0, 255);
		px[o + 3] = clamp(Math.round(P[o + 3]), 0, 255);
	}
	return true;
}

// ---- fonts ----
const GENERIC = { s: 'sans-serif', f: 'serif', d: 'sans-serif', h: 'cursive', m: 'monospace', system: 'sans-serif' };
function cssName(n) { return encodeURIComponent(n).replace(/%20/g, '+'); }
function fontStackFor(f) { return f.stack || ('"' + f.name + '", ' + (GENERIC[f.cat] || 'sans-serif')); }
function weightFor(f, bold) {
	if (!f.google) return bold ? 700 : 400;
	return bold ? (f.boldW || 700) : (f.regW || 400);
}
// Google Fonts CSS2 URL for exactly the faces we use (regular, bold, and their italics, only where they exist).
function familyCssUrl(f) {
	const t = [[0, f.regW]];
	if (f.boldW && f.boldW !== f.regW) t.push([0, f.boldW]);
	if (f.ir) t.push([1, f.regW]);
	if (f.ib && f.boldW) t.push([1, f.boldW]);
	t.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let spec = '';
	if (t.some((x) => x[0] === 1)) spec = ':ital,wght@' + t.map((x) => x[0] + ',' + x[1]).join(';');
	else if (t.length > 1) spec = ':wght@' + t.map((x) => x[1]).join(';');
	return 'https://fonts.googleapis.com/css2?family=' + cssName(f.name) + spec + '&display=swap';
}
// One request for a batch of list previews; `text` makes Google send a tiny font containing only those letters.
function previewCssUrl(names) {
	const chars = Array.from(new Set(names.join('').split(''))).join('');
	return 'https://fonts.googleapis.com/css2?' + names.map((n) => 'family=' + cssName(n)).join('&') +
		'&text=' + encodeURIComponent(chars) + '&display=swap';
}
// Rename the preview faces ("Roboto" -> "mp Roboto") so they can never shadow the real, full font.
function aliasPreviewCss(css) {
	return css.replace(/font-family:\s*(['"]?)([^;'"]+)\1\s*;/g, (m, q, n) => 'font-family: "mp ' + n.trim() + '";');
}
function searchFonts(list, query, cat) {
	const q = (query || '').trim().toLowerCase();
	const arr = (cat && cat !== 'all') ? list.filter((f) => f.cat === cat) : list;
	if (!q) return arr;
	const qs = q.replace(/\s+/g, '');
	const starts = [], inside = [];
	for (const f of arr) {
		const n = f.name.toLowerCase(), ns = n.replace(/\s+/g, '');
		if (n.startsWith(q) || ns.startsWith(qs)) starts.push(f);
		else if (n.indexOf(q) !== -1 || ns.indexOf(qs) !== -1) inside.push(f);
	}
	return starts.concat(inside);
}
/* ===PURE-END=== */

/* =====================================================================
   DOM + state
===================================================================== */
const $ = (id) => document.getElementById(id);

const stage = $('edStage');
const fileInput = $('edFileInput');
const addImageInput = $('edAddImageInput');
const workspace = $('edWorkspace');
const view = $('edCanvas');
const vctx = view.getContext('2d');
const errBox = $('edErr');
const statusEl = $('edStatus');
const progressEl = $('edProgress');
const aiNote = $('edAiNote');
const eraseBtn = $('edEraseBtn');
const undoBtn = $('edUndoBtn');
const redoBtn = $('edRedoBtn');
const brushSizeEl = $('edBrushSize');
const brushValEl = $('edBrushVal');
const paintBtn = $('edPaintBtn');
const unpaintBtn = $('edUnpaintBtn');
const clearMaskBtn = $('edClearMaskBtn');
const layerPanel = $('edLayerPanel');
const textProps = $('edTextProps');
const erasePanel = $('edErasePanel');
const emptyHint = $('edEmptyHint');

const T = { // text property controls
	value: $('edTextValue'), size: $('edFontSize'), color: $('edTextColor'),
	bold: $('edBold'), italic: $('edItalic'), align: $('edAlign'),
	strokeColor: $('edStrokeColor'), strokeWidth: $('edStrokeWidth'), strokeVal: $('edStrokeVal')
};
const L = { // generic layer controls
	title: $('edLayerTitle'), opacity: $('edOpacity'), opacityVal: $('edOpacityVal'),
	rotation: $('edRotation'), rotationVal: $('edRotationVal')
};

const baseCanvas = document.createElement('canvas');
const bctx = baseCanvas.getContext('2d');
const maskCanvas = document.createElement('canvas');
const mctx = maskCanvas.getContext('2d');
const measureCtx = document.createElement('canvas').getContext('2d');

const state = {
	hasImage: false,
	fileName: 'image',
	tool: 'move', // 'move' | 'erase'
	method: 'fast', // 'fast' | 'ai'
	brushSize: 36, // screen px
	brushMode: 'paint', // 'paint' | 'unpaint'
	maskBox: null,
	objects: [],
	selectedId: null,
	nextId: 1,
	history: [],
	hIndex: -1,
	baseSnap: null,
	drag: null,
	painting: false,
	last: null,
	hover: null,
	busy: false
};

let ortSessionPromise = null;
let rafId = 0;

/* ---------- small helpers ---------- */
function showError(msg) { errBox.textContent = msg; errBox.classList.add('show'); }
function clearError() { errBox.classList.remove('show'); errBox.textContent = ''; }

function setStatus(msg, kind) {
	statusEl.textContent = msg || '';
	statusEl.classList.toggle('is-error', kind === 'error');
	statusEl.classList.toggle('is-ok', kind === 'ok');
}
function setProgress(p) {
	if (p === null || p === undefined) { progressEl.classList.add('is-hidden'); return; }
	progressEl.classList.remove('is-hidden');
	progressEl.value = Math.round(p * 100);
}

function loadScript(src) {
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = src;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error('Could not load ' + src));
		document.head.appendChild(s);
	});
}
function loadImageEl(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not load image'));
		img.src = src;
	});
}
function cloneCanvas(c) {
	const n = document.createElement('canvas');
	n.width = c.width; n.height = c.height;
	n.getContext('2d').drawImage(c, 0, 0);
	return n;
}
function nextFrame() { return new Promise((r) => setTimeout(r, 30)); }

/* =====================================================================
   Rendering
===================================================================== */
function requestRender() {
	if (rafId) return;
	rafId = requestAnimationFrame(() => { rafId = 0; render(); });
}
function pxScale() {
	const r = view.getBoundingClientRect();
	return r.width ? view.width / r.width : 1;
}

function fontString(o) {
	const f = fontRecord(o.fontName);
	return (o.italic ? 'italic ' : '') + weightFor(f, o.bold) + ' ' + o.size + 'px ' + fontStackFor(f);
}
function layoutText(o) {
	measureCtx.font = fontString(o);
	const lines = o.text.split('\n');
	const lh = o.size * 1.2;
	let maxW = 0;
	for (const l of lines) maxW = Math.max(maxW, measureCtx.measureText(l || ' ').width);
	const pad = o.strokeWidth + 2;
	o.lines = lines; o.lh = lh; o.pad = pad;
	o.w = Math.max(12, maxW + pad * 2);
	o.h = Math.max(12, lines.length * lh + pad * 2);
}
function drawTextBody(ctx, o) {
	ctx.font = fontString(o);
	ctx.textBaseline = 'middle';
	ctx.textAlign = o.align;
	ctx.lineJoin = 'round';
	ctx.miterLimit = 2;
	const x = o.align === 'left' ? -o.w / 2 + o.pad : (o.align === 'right' ? o.w / 2 - o.pad : 0);
	o.lines.forEach((line, i) => {
		const y = -o.h / 2 + o.pad + o.lh * (i + 0.5);
		if (o.strokeWidth > 0) {
			ctx.lineWidth = o.strokeWidth * 2;
			ctx.strokeStyle = o.strokeColor;
			ctx.strokeText(line, x, y);
		}
		ctx.fillStyle = o.color;
		ctx.fillText(line, x, y);
	});
}
function drawObject(ctx, o) {
	ctx.save();
	ctx.translate(o.x, o.y);
	ctx.rotate(o.rot * Math.PI / 180);
	ctx.globalAlpha = o.opacity;
	if (o.type === 'image') ctx.drawImage(o.img, -o.w / 2, -o.h / 2, o.w, o.h);
	else drawTextBody(ctx, o);
	ctx.restore();
}
function drawScene(ctx) {
	ctx.drawImage(baseCanvas, 0, 0);
	for (const o of state.objects) drawObject(ctx, o);
}
function drawSelection(ctx, o, s) {
	ctx.save();
	ctx.translate(o.x, o.y);
	ctx.rotate(o.rot * Math.PI / 180);
	ctx.lineWidth = 1.5 * s;
	ctx.strokeStyle = '#FF6224';
	ctx.setLineDash([6 * s, 4 * s]);
	ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
	ctx.setLineDash([]);
	const hs = HANDLE * s;
	for (const c of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
		const cx = c[0] * o.w / 2, cy = c[1] * o.h / 2;
		ctx.fillStyle = '#FFFFFF';
		ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
		ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
	}
	ctx.restore();
}
function render() {
	if (!state.hasImage) return;
	vctx.clearRect(0, 0, view.width, view.height);
	drawScene(vctx);
	const s = pxScale();
	if (state.tool === 'erase') {
		vctx.save();
		vctx.globalAlpha = 0.5;
		vctx.drawImage(maskCanvas, 0, 0);
		vctx.restore();
		if (state.hover && !state.busy) {
			vctx.save();
			vctx.lineWidth = 1.5 * s;
			vctx.strokeStyle = '#FFFFFF';
			vctx.beginPath();
			vctx.arc(state.hover.x, state.hover.y, state.brushSize * s / 2, 0, Math.PI * 2);
			vctx.stroke();
			vctx.strokeStyle = '#3B4051';
			vctx.lineWidth = 0.75 * s;
			vctx.stroke();
			vctx.restore();
		}
	} else {
		const sel = getSelected();
		if (sel) drawSelection(vctx, sel, s);
	}
}

/* =====================================================================
   History (undo / redo)
===================================================================== */
function cloneObj(o) { return Object.assign({}, o); }
function pushHistory() {
	state.history.length = state.hIndex + 1;
	state.history.push({
		base: state.baseSnap,
		objects: state.objects.map(cloneObj),
		selectedId: state.selectedId
	});
	if (state.history.length > CONFIG.historyLimit) state.history.shift();
	state.hIndex = state.history.length - 1;
	updateUndoButtons();
}
function commitBase() {
	state.baseSnap = cloneCanvas(baseCanvas);
	pushHistory();
}
function restore(entry) {
	if (entry.base !== state.baseSnap) {
		bctx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
		bctx.drawImage(entry.base, 0, 0);
		state.baseSnap = entry.base;
	}
	state.objects = entry.objects.map(cloneObj);
	state.objects.forEach((o) => { if (o.type === 'text') layoutText(o); });
	state.selectedId = state.objects.some((o) => o.id === entry.selectedId) ? entry.selectedId : null;
	updateUndoButtons();
	syncPanel();
	requestRender();
}
function undo() { if (state.hIndex > 0) { state.hIndex--; restore(state.history[state.hIndex]); } }
function redo() { if (state.hIndex < state.history.length - 1) { state.hIndex++; restore(state.history[state.hIndex]); } }
function updateUndoButtons() {
	undoBtn.disabled = state.hIndex <= 0;
	redoBtn.disabled = state.hIndex >= state.history.length - 1;
}

/* =====================================================================
   Layers (text + image)
===================================================================== */
function getSelected() {
	return state.objects.find((o) => o.id === state.selectedId) || null;
}
function select(id) {
	state.selectedId = id;
	syncPanel();
	requestRender();
}

/* ---------- font catalogue + on-demand loading ---------- */
function buildCatalog() {
	const google = (window.GOOGLE_FONTS || []).map((r) => ({ name: r[0], cat: r[1], regW: r[2], boldW: r[3], ir: !!r[4], ib: !!r[5], google: true }));
	const system = SYSTEM_FONTS.map((x) => ({ name: x.name, cat: 'system', stack: x.stack, google: false }));
	return system.concat(google);
}
const CATALOG = buildCatalog();
const famByName = new Map(CATALOG.map((f) => [f.name, f]));
function fontRecord(name) { return famByName.get(name) || { name: name, cat: 's', google: false }; }

const familyLoads = new Map();
function loadFamily(f) {
	if (familyLoads.has(f.name)) return familyLoads.get(f.name);
	const p = new Promise((resolve, reject) => {
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = familyCssUrl(f);
		link.onload = () => resolve();
		link.onerror = () => { link.remove(); reject(new Error('Could not load ' + f.name)); };
		document.head.appendChild(link);
	});
	familyLoads.set(f.name, p);
	p.catch(() => familyLoads.delete(f.name)); // so it can be retried
	return p;
}
// Resolves true when the font is ready (or needs no download), false if it couldn't be fetched.
async function ensureFont(o) {
	const f = fontRecord(o.fontName);
	if (f.google) {
		try { await loadFamily(f); } catch (e) { return false; }
	}
	if (document.fonts && document.fonts.load) {
		try { await document.fonts.load(fontString(o), o.text || 'A'); } catch (e) { /* use the fallback silently */ }
	}
	return true;
}
let ensureTimer = 0;
function scheduleEnsure(o) { // new characters may need another unicode-range file of the same font
	clearTimeout(ensureTimer);
	ensureTimer = setTimeout(() => { ensureFont(o).then((ok) => { if (ok) { layoutText(o); requestRender(); } }); }, 300);
}

function addText() {
	if (!state.hasImage) return;
	if (state.tool !== 'move') setTool('move');
	const size = Math.max(16, Math.round(baseCanvas.height * 0.06));
	const o = {
		id: state.nextId++, type: 'text', text: 'Your text', fontName: 'Inter', size: size,
		color: '#FFFFFF', bold: true, italic: false, align: 'center',
		strokeColor: '#000000', strokeWidth: Math.round(size * 0.06),
		x: baseCanvas.width / 2, y: baseCanvas.height / 2, rot: 0, opacity: 1
	};
	ensureFont(o).then(() => { layoutText(o); requestRender(); });
	layoutText(o);
	state.objects.push(o);
	select(o.id);
	pushHistory();
	setTimeout(() => { T.value.focus(); T.value.select(); }, 0);
}

async function addImageFile(file) {
	if (!file || !file.type.startsWith('image/')) { showError('That is not an image file.'); return; }
	try {
		const url = URL.createObjectURL(file);
		const img = await loadImageEl(url);
		if (state.tool !== 'move') setTool('move');
		const maxW = baseCanvas.width * 0.4;
		const k = Math.min(1, maxW / img.naturalWidth);
		const o = {
			id: state.nextId++, type: 'image', img: img, name: file.name,
			w: Math.max(8, img.naturalWidth * k), h: Math.max(8, img.naturalHeight * k),
			x: baseCanvas.width / 2, y: baseCanvas.height / 2, rot: 0, opacity: 1
		};
		state.objects.push(o);
		select(o.id);
		pushHistory();
	} catch (e) {
		showError('Could not add that image.');
	}
}

function duplicateSelected() {
	const o = getSelected();
	if (!o) return;
	const c = cloneObj(o);
	c.id = state.nextId++;
	c.x += 24; c.y += 24;
	state.objects.push(c);
	select(c.id);
	pushHistory();
}
function deleteSelected() {
	const o = getSelected();
	if (!o) return;
	state.objects = state.objects.filter((x) => x.id !== o.id);
	state.selectedId = null;
	syncPanel();
	pushHistory();
	requestRender();
}
function reorderSelected(dir) {
	const o = getSelected();
	if (!o) return;
	const i = state.objects.indexOf(o), j = i + dir;
	if (j < 0 || j >= state.objects.length) return;
	state.objects.splice(i, 1);
	state.objects.splice(j, 0, o);
	pushHistory();
	requestRender();
}

/* ---------- geometry for hit-testing ---------- */
function toImagePoint(e) {
	const r = view.getBoundingClientRect();
	return { x: (e.clientX - r.left) * view.width / r.width, y: (e.clientY - r.top) * view.height / r.height };
}
function toLocal(o, p) {
	const dx = p.x - o.x, dy = p.y - o.y, a = -o.rot * Math.PI / 180;
	return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}
function hitObject(p) {
	for (let i = state.objects.length - 1; i >= 0; i--) {
		const o = state.objects[i], l = toLocal(o, p);
		if (Math.abs(l.x) <= o.w / 2 && Math.abs(l.y) <= o.h / 2) return o;
	}
	return null;
}
function hitHandle(o, p) {
	const l = toLocal(o, p), tol = HANDLE * pxScale();
	return Math.abs(Math.abs(l.x) - o.w / 2) <= tol && Math.abs(Math.abs(l.y) - o.h / 2) <= tol;
}

/* =====================================================================
   Painting the erase mask
===================================================================== */
function paintSegment(a, b, first) {
	const lw = state.brushSize * pxScale();
	mctx.save();
	mctx.lineCap = 'round';
	mctx.lineJoin = 'round';
	mctx.lineWidth = lw;
	if (state.brushMode === 'paint') {
		mctx.globalCompositeOperation = 'source-over';
		mctx.strokeStyle = '#FF6224';
		mctx.fillStyle = '#FF6224';
	} else {
		mctx.globalCompositeOperation = 'destination-out';
		mctx.strokeStyle = '#000000';
		mctx.fillStyle = '#000000';
	}
	if (first) { mctx.beginPath(); mctx.arc(a.x, a.y, lw / 2, 0, Math.PI * 2); mctx.fill(); }
	mctx.beginPath();
	mctx.moveTo(a.x, a.y);
	mctx.lineTo(b.x, b.y);
	mctx.stroke();
	mctx.restore();

	if (state.brushMode === 'paint') {
		const r = lw / 2 + 2;
		const x0 = Math.min(a.x, b.x) - r, y0 = Math.min(a.y, b.y) - r, x1 = Math.max(a.x, b.x) + r, y1 = Math.max(a.y, b.y) + r;
		const mb = state.maskBox;
		state.maskBox = mb
			? { x0: Math.min(mb.x0, x0), y0: Math.min(mb.y0, y0), x1: Math.max(mb.x1, x1), y1: Math.max(mb.y1, y1) }
			: { x0: x0, y0: y0, x1: x1, y1: y1 };
		eraseBtn.disabled = state.busy;
	}
}
function clearMask() {
	mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
	state.maskBox = null;
	eraseBtn.disabled = true;
	requestRender();
}

/* =====================================================================
   Pointer interaction
===================================================================== */
view.addEventListener('pointerdown', (e) => {
	if (!state.hasImage || state.busy) return;
	view.setPointerCapture(e.pointerId);
	const p = toImagePoint(e);

	if (state.tool === 'erase') {
		state.painting = true;
		state.last = p;
		paintSegment(p, p, true);
		requestRender();
		return;
	}

	const sel = getSelected();
	if (sel && hitHandle(sel, p)) {
		const l = toLocal(sel, p);
		state.drag = { mode: 'resize', o: sel, d0: Math.max(1, Math.hypot(l.x, l.y)), size0: sel.size, w0: sel.w, h0: sel.h, changed: false };
		return;
	}
	const hit = hitObject(p);
	if (hit) {
		select(hit.id);
		state.drag = { mode: 'move', o: hit, dx: p.x - hit.x, dy: p.y - hit.y, changed: false };
	} else {
		select(null);
	}
});

view.addEventListener('pointermove', (e) => {
	if (!state.hasImage) return;
	const p = toImagePoint(e);

	if (state.tool === 'erase') {
		state.hover = p;
		if (state.painting && !state.busy) {
			paintSegment(state.last, p, false);
			state.last = p;
		}
		requestRender();
		return;
	}

	const d = state.drag;
	if (d) {
		d.changed = true;
		if (d.mode === 'move') {
			d.o.x = p.x - d.dx;
			d.o.y = p.y - d.dy;
		} else {
			const l = toLocal(d.o, p);
			const k = clamp(Math.hypot(l.x, l.y) / d.d0, 0.05, 40);
			if (d.o.type === 'text') {
				d.o.size = clamp(Math.round(d.size0 * k), 6, 1000);
				layoutText(d.o);
				T.size.value = d.o.size;
			} else {
				d.o.w = d.w0 * k;
				d.o.h = d.h0 * k;
			}
		}
		requestRender();
		return;
	}
	const over = hitObject(p);
	view.classList.toggle('cursor-move', !!over);
	view.classList.toggle('cursor-default', !over);
});

function endPointer() {
	if (state.painting) { state.painting = false; state.last = null; }
	if (state.drag) {
		if (state.drag.changed) pushHistory();
		state.drag = null;
	}
}
view.addEventListener('pointerup', endPointer);
view.addEventListener('pointercancel', endPointer);
view.addEventListener('pointerleave', () => { state.hover = null; requestRender(); });
view.addEventListener('dblclick', (e) => {
	if (state.tool !== 'move') return;
	const o = hitObject(toImagePoint(e));
	if (o && o.type === 'text') { select(o.id); T.value.focus(); T.value.select(); }
});

/* =====================================================================
   Erasing — lightweight fill
===================================================================== */
function getMaskRegion(grow) {
	if (!state.maskBox) return null;
	const W = baseCanvas.width, H = baseCanvas.height, mb = state.maskBox;
	const x0 = clamp(Math.floor(mb.x0) - grow - 2, 0, W), y0 = clamp(Math.floor(mb.y0) - grow - 2, 0, H);
	const x1 = clamp(Math.ceil(mb.x1) + grow + 2, 0, W), y1 = clamp(Math.ceil(mb.y1) + grow + 2, 0, H);
	const w = x1 - x0, h = y1 - y0;
	if (w <= 0 || h <= 0) return null;
	const d = mctx.getImageData(x0, y0, w, h).data;
	let m = new Uint8Array(w * h), any = false;
	for (let i = 0; i < m.length; i++) { if (d[i * 4 + 3] > 40) { m[i] = 1; any = true; } }
	if (!any) return null;
	m = dilateMask(m, w, h, grow);
	let tx0 = w, ty0 = h, tx1 = -1, ty1 = -1;
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (m[y * w + x]) {
				if (x < tx0) tx0 = x;
				if (x > tx1) tx1 = x;
				if (y < ty0) ty0 = y;
				if (y > ty1) ty1 = y;
			}
		}
	}
	return { x: x0, y: y0, w: w, h: h, mask: m, bbox: { x: x0 + tx0, y: y0 + ty0, w: tx1 - tx0 + 1, h: ty1 - ty0 + 1 } };
}

function inpaintFast(region) {
	const W = baseCanvas.width, H = baseCanvas.height, b = region.bbox, margin = 24;
	const x0 = Math.max(0, b.x - margin), y0 = Math.max(0, b.y - margin);
	const x1 = Math.min(W, b.x + b.w + margin), y1 = Math.min(H, b.y + b.h + margin);
	const w = x1 - x0, h = y1 - y0;
	const img = bctx.getImageData(x0, y0, w, h);
	const mask = new Uint8Array(w * h);
	for (let y = 0; y < region.h; y++) {
		const yy = region.y + y - y0;
		if (yy < 0 || yy >= h) continue;
		for (let x = 0; x < region.w; x++) {
			if (!region.mask[y * region.w + x]) continue;
			const xx = region.x + x - x0;
			if (xx >= 0 && xx < w) mask[yy * w + xx] = 1;
		}
	}
	const ok = inpaintDiffusion(img.data, mask, w, h, { iterations: 40 });
	if (!ok) throw new Error('There is not enough picture around that area to fill from. Try a smaller area.');
	bctx.putImageData(img, x0, y0);
}

/* =====================================================================
   Erasing — AI inpainting (LaMa via ONNX Runtime Web)
===================================================================== */
async function fetchWithProgress(url, onProgress) {
	let res;
	try { res = await fetch(url); }
	catch (e) { throw new Error('Could not reach the AI model at "' + url + '".'); }
	if (!res.ok) {
		throw new Error('AI model not found (' + res.status + ') at "' + url + '". Put lama_fp32.onnx there (see CONFIG in image-editor.js), or switch to Lightweight.');
	}
	const total = parseInt(res.headers.get('Content-Length'), 10) || 0;
	if (!res.body || !total) {
		const all = new Uint8Array(await res.arrayBuffer());
		onProgress(1);
		return all;
	}
	const reader = res.body.getReader();
	let out = new Uint8Array(total), got = 0;
	for (;;) {
		const part = await reader.read();
		if (part.done) break;
		if (got + part.value.length > out.length) { // e.g. compressed Content-Length: grow
			const bigger = new Uint8Array(Math.max(out.length * 2, got + part.value.length));
			bigger.set(out.subarray(0, got));
			out = bigger;
		}
		out.set(part.value, got);
		got += part.value.length;
		onProgress(Math.min(1, got / total));
	}
	const data = out.subarray(0, got);
	if (data[0] === 0x3C) throw new Error('"' + url + '" returned a web page, not an ONNX model.');
	return data;
}

function getSession() {
	if (!ortSessionPromise) {
		ortSessionPromise = loadSession().catch((e) => { ortSessionPromise = null; throw e; });
	}
	return ortSessionPromise;
}
async function loadSession() {
	setStatus('Loading the AI engine…');
	if (!window.ort) await loadScript(CONFIG.ortScript);
	window.ort.env.wasm.wasmPaths = CONFIG.ortBase;
	setStatus('Downloading the AI model (first time only)…');
	const bytes = await fetchWithProgress(CONFIG.modelUrl, setProgress);
	setProgress(null);
	setStatus('Starting the AI model…');
	await nextFrame();
	const session = await window.ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
	aiNote.textContent = 'AI model ready.';
	return session;
}

async function inpaintAI(region) {
	const S = CONFIG.modelSize, W = baseCanvas.width, H = baseCanvas.height, bb = region.bbox;

	// choose a square window around the marked area (native resolution when it fits in 512)
	let side = Math.max(S, Math.max(bb.w, bb.h) + 80);
	side = Math.min(side, W, H);
	if (Math.max(bb.w, bb.h) > side) {
		throw new Error('The marked area is too large for AI mode. Erase it in smaller parts, or switch to Lightweight.');
	}
	let x0 = Math.round(bb.x + bb.w / 2 - side / 2), y0 = Math.round(bb.y + bb.h / 2 - side / 2);
	x0 = clamp(x0, 0, W - side);
	y0 = clamp(y0, 0, H - side);

	const session = await getSession();
	setStatus('Erasing with AI… this can take a little while on CPU.');
	await nextFrame();

	// image -> CHW float, 0..1
	const c = document.createElement('canvas');
	c.width = S; c.height = S;
	const cc = c.getContext('2d');
	cc.imageSmoothingQuality = 'high';
	cc.drawImage(baseCanvas, x0, y0, side, side, 0, 0, S, S);
	const idata = cc.getImageData(0, 0, S, S).data;
	const SS = S * S;
	const img = new Float32Array(3 * SS);
	for (let i = 0; i < SS; i++) {
		img[i] = idata[i * 4] / 255;
		img[SS + i] = idata[i * 4 + 1] / 255;
		img[2 * SS + i] = idata[i * 4 + 2] / 255;
	}

	// mask -> 1 x 1 x S x S, 1 = erase
	const rc = document.createElement('canvas');
	rc.width = region.w; rc.height = region.h;
	const rctx = rc.getContext('2d');
	const rd = rctx.createImageData(region.w, region.h);
	for (let i = 0; i < region.mask.length; i++) { if (region.mask[i]) rd.data[i * 4 + 3] = 255; }
	rctx.putImageData(rd, 0, 0);
	const mc = document.createElement('canvas');
	mc.width = S; mc.height = S;
	const mcc = mc.getContext('2d');
	mcc.imageSmoothingEnabled = false;
	const k = S / side;
	mcc.drawImage(rc, 0, 0, region.w, region.h, (region.x - x0) * k, (region.y - y0) * k, region.w * k, region.h * k);
	const md = mcc.getImageData(0, 0, S, S).data;
	const mk = new Float32Array(SS);
	for (let i = 0; i < SS; i++) mk[i] = md[i * 4 + 3] > 127 ? 1 : 0;

	const ort = window.ort;
	const out = await session.run({
		image: new ort.Tensor('float32', img, [1, 3, S, S]),
		mask: new ort.Tensor('float32', mk, [1, 1, S, S])
	});
	const od = (out.output || out[Object.keys(out)[0]]).data; // already 0..255

	const res = new ImageData(S, S);
	for (let i = 0; i < SS; i++) {
		res.data[i * 4] = clamp(Math.round(od[i]), 0, 255);
		res.data[i * 4 + 1] = clamp(Math.round(od[SS + i]), 0, 255);
		res.data[i * 4 + 2] = clamp(Math.round(od[2 * SS + i]), 0, 255);
		res.data[i * 4 + 3] = 255;
	}
	const rc2 = document.createElement('canvas');
	rc2.width = S; rc2.height = S;
	rc2.getContext('2d').putImageData(res, 0, 0);
	const patch = document.createElement('canvas');
	patch.width = side; patch.height = side;
	const pctx = patch.getContext('2d');
	pctx.imageSmoothingQuality = 'high';
	pctx.drawImage(rc2, 0, 0, S, S, 0, 0, side, side);
	const pd = pctx.getImageData(0, 0, side, side).data;

	// blend the result back, only inside the (feathered) marked area
	const bd = bctx.getImageData(region.x, region.y, region.w, region.h);
	const alpha = featherMask(region.mask, region.w, region.h, 2);
	for (let y = 0; y < region.h; y++) {
		const py = region.y + y - y0;
		if (py < 0 || py >= side) continue;
		for (let x = 0; x < region.w; x++) {
			const a = alpha[y * region.w + x];
			if (a <= 0) continue;
			const px = region.x + x - x0;
			if (px < 0 || px >= side) continue;
			const s = (py * side + px) * 4, d = (y * region.w + x) * 4;
			bd.data[d] = Math.round(bd.data[d] * (1 - a) + pd[s] * a);
			bd.data[d + 1] = Math.round(bd.data[d + 1] * (1 - a) + pd[s + 1] * a);
			bd.data[d + 2] = Math.round(bd.data[d + 2] * (1 - a) + pd[s + 2] * a);
			if (a > 0.5) bd.data[d + 3] = 255;
		}
	}
	bctx.putImageData(bd, region.x, region.y);
}

/* ---------- run the erase ---------- */
function setBusy(b) {
	state.busy = b;
	eraseBtn.disabled = b || !state.maskBox;
	$('edTools').classList.toggle('is-disabled', b);
	$('edMethod').classList.toggle('is-disabled', b);
	view.classList.toggle('cursor-wait', b);
}
async function eraseMarked() {
	if (state.busy) return;
	const method = state.method;
	const region = getMaskRegion(method === 'ai' ? CONFIG.growAI : CONFIG.growFast);
	if (!region) { setStatus('Paint over the area you want to remove first.', 'error'); return; }
	setBusy(true);
	setStatus(method === 'ai' ? 'Preparing AI…' : 'Filling…');
	await nextFrame();
	try {
		if (method === 'ai') await inpaintAI(region);
		else inpaintFast(region);
		clearMask();
		commitBase();
		setStatus('Done. Paint another area, or add text and images.', 'ok');
	} catch (err) {
		console.error(err);
		setStatus(err && err.message ? err.message : String(err), 'error');
	} finally {
		setProgress(null);
		setBusy(false);
		requestRender();
	}
}

/* =====================================================================
   Panels / tools
===================================================================== */
function setTool(tool) {
	state.tool = tool;
	document.querySelectorAll('#edTools .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
	if (tool === 'erase') state.selectedId = null;
	state.hover = null;
	view.classList.toggle('cursor-brush', tool === 'erase');
	view.classList.toggle('cursor-default', tool !== 'erase');
	view.classList.remove('cursor-move');
	syncPanel();
	requestRender();
}
function setMethod(method) {
	state.method = method;
	document.querySelectorAll('#edMethod .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.method === method));
	aiNote.classList.toggle('is-hidden', method !== 'ai');
	setStatus('');
}

function syncPanel() {
	const sel = getSelected();
	erasePanel.classList.toggle('is-hidden', state.tool !== 'erase');
	layerPanel.classList.toggle('is-hidden', !(sel && state.tool === 'move'));
	textProps.classList.toggle('is-hidden', !(sel && sel.type === 'text'));
	emptyHint.classList.toggle('is-hidden', !(state.tool === 'move' && !sel));
	if (!sel) return;
	L.title.textContent = sel.type === 'text' ? 'Text layer' : 'Image layer';
	L.opacity.value = Math.round(sel.opacity * 100);
	L.opacityVal.textContent = Math.round(sel.opacity * 100) + '%';
	L.rotation.value = Math.round(sel.rot);
	L.rotationVal.textContent = Math.round(sel.rot) + '°';
	if (sel.type === 'text') {
		T.value.value = sel.text;
		setFontButton(sel.fontName);
		closeFontPicker();
		T.size.value = sel.size;
		T.color.value = sel.color;
		T.align.value = sel.align;
		T.strokeColor.value = sel.strokeColor;
		T.strokeWidth.value = sel.strokeWidth;
		T.strokeVal.textContent = sel.strokeWidth;
		T.bold.classList.toggle('is-active', sel.bold);
		T.italic.classList.toggle('is-active', sel.italic);
	}
}

/* ---------- layer property wiring ---------- */
function onText(fn) {
	return () => {
		const o = getSelected();
		if (!o || o.type !== 'text') return;
		fn(o);
		layoutText(o);
		requestRender();
	};
}
T.value.addEventListener('input', onText((o) => { o.text = T.value.value; scheduleEnsure(o); }));

/* =====================================================================
   Font picker — every Google Font, fetched only when it is used
===================================================================== */
const P = {
	btn: $('edFontBtn'), cur: $('edFontCurrent'), pop: $('edFontPop'), search: $('edFontSearch'),
	cats: $('edFontCats'), list: $('edFontList'), count: $('edFontCount'), note: $('edFontNote')
};
const picker = { cat: 'all', query: '', matches: [], rendered: 0, hi: -1, open: false };
const RENDER_STEP = 120; // list rows added at a time (more load as you scroll)
const PREVIEW_BATCH = 24; // font families per preview request
const CAT_LABEL = { s: 'Sans', f: 'Serif', d: 'Display', h: 'Handwriting', m: 'Mono', system: 'System' };
const preview = { asked: new Set(), queue: [], timer: 0, io: null };

P.search.placeholder = 'Search ' + CATALOG.length.toLocaleString() + ' fonts…';

function setFontButton(name) { P.cur.textContent = name || ''; }
function setFontNote(msg) { P.note.textContent = msg || ''; P.note.classList.toggle('is-hidden', !msg); }
function currentFontName() { const o = getSelected(); return o && o.type === 'text' ? o.fontName : ''; }

// each row shows its own name in its own font: tiny subset fonts, requested in batches as rows scroll into view
function previewStack(f) { return '"mp ' + f.name + '", ' + (GENERIC[f.cat] || 'sans-serif'); }
function watchPreview(el, f) {
	const nameEl = el.firstChild;
	if (!f.google) { nameEl.style.fontFamily = fontStackFor(f); return; }
	if (preview.asked.has(f.name)) { nameEl.style.fontFamily = previewStack(f); return; }
	if (!('IntersectionObserver' in window)) return;
	if (!preview.io) preview.io = new IntersectionObserver(onPreviewSeen, { root: P.list, rootMargin: '160px' });
	preview.io.observe(el);
}
function onPreviewSeen(entries) {
	let queued = false;
	for (const en of entries) {
		if (!en.isIntersecting) continue;
		const el = en.target;
		preview.io.unobserve(el);
		const f = famByName.get(el.dataset.name);
		if (!f) continue;
		el.firstChild.style.fontFamily = previewStack(f);
		if (!preview.asked.has(f.name)) { preview.asked.add(f.name); preview.queue.push(f.name); queued = true; }
	}
	if (queued && !preview.timer) preview.timer = setTimeout(flushPreviews, 120);
}
async function flushPreviews() {
	preview.timer = 0;
	while (preview.queue.length) {
		const batch = preview.queue.splice(0, PREVIEW_BATCH);
		try {
			const res = await fetch(previewCssUrl(batch));
			if (!res.ok) continue;
			const style = document.createElement('style');
			style.textContent = aliasPreviewCss(await res.text());
			document.head.appendChild(style);
		} catch (e) { /* previews are optional: the list works without them */ }
	}
}

function renderFontItems(reset) {
	if (reset) {
		if (preview.io) preview.io.disconnect();
		P.list.textContent = '';
		picker.rendered = 0; picker.hi = -1;
		P.list.scrollTop = 0;
	}
	const end = Math.min(picker.matches.length, picker.rendered + RENDER_STEP);
	const cur = currentFontName();
	const frag = document.createDocumentFragment();
	for (let i = picker.rendered; i < end; i++) {
		const f = picker.matches[i];
		const el = document.createElement('div');
		el.className = 'ed-fontitem' + (f.name === cur ? ' is-current' : '');
		el.setAttribute('role', 'option');
		el.dataset.name = f.name;
		const nm = document.createElement('span');
		nm.className = 'ed-fontname';
		nm.textContent = f.name;
		const ct = document.createElement('span');
		ct.className = 'ed-fontcat';
		ct.textContent = CAT_LABEL[f.cat] || '';
		el.appendChild(nm);
		el.appendChild(ct);
		frag.appendChild(el);
	}
	P.list.appendChild(frag);
	for (let i = picker.rendered; i < end; i++) watchPreview(P.list.children[i], picker.matches[i]);
	picker.rendered = end;
	const n = picker.matches.length;
	P.count.textContent = n ? n.toLocaleString() + (n === 1 ? ' font' : ' fonts') : 'No fonts match';
}
function runSearch() {
	picker.matches = searchFonts(CATALOG, picker.query, picker.cat);
	renderFontItems(true);
}
function setHighlight(i) {
	if (!picker.matches.length) return;
	i = clamp(i, 0, picker.matches.length - 1);
	while (picker.rendered <= i) renderFontItems(false);
	const rows = P.list.children;
	if (picker.hi >= 0 && rows[picker.hi]) rows[picker.hi].classList.remove('is-hi');
	picker.hi = i;
	rows[i].classList.add('is-hi');
	if (rows[i].scrollIntoView) rows[i].scrollIntoView({ block: 'nearest' });
}
function openFontPicker() {
	const o = getSelected();
	if (!o || o.type !== 'text') return;
	picker.open = true;
	P.pop.classList.remove('is-hidden');
	P.btn.setAttribute('aria-expanded', 'true');
	picker.query = ''; picker.cat = 'all';
	P.search.value = '';
	P.cats.querySelectorAll('.ed-chip').forEach((c) => c.classList.toggle('is-active', c.dataset.cat === 'all'));
	runSearch();
	const idx = picker.matches.findIndex((f) => f.name === o.fontName);
	if (idx >= 0) { // scroll the current font into view
		while (picker.rendered <= idx) renderFontItems(false);
		const row = P.list.children[idx];
		if (row && row.scrollIntoView) row.scrollIntoView({ block: 'center' });
	}
	P.search.focus();
}
function closeFontPicker() {
	picker.open = false;
	P.pop.classList.add('is-hidden');
	P.btn.setAttribute('aria-expanded', 'false');
}
async function pickFont(name) {
	const o = getSelected();
	closeFontPicker();
	if (!o || o.type !== 'text') return;
	o.fontName = name;
	setFontButton(name);
	setFontNote('');
	layoutText(o);
	requestRender();
	pushHistory();
	const ok = await ensureFont(o);
	layoutText(o);
	requestRender();
	if (!ok) setFontNote('Couldn\u2019t load \u201C' + name + '\u201D. Check your internet connection. A fallback font is shown for now.');
}

P.btn.addEventListener('click', () => { if (picker.open) closeFontPicker(); else openFontPicker(); });
P.search.addEventListener('input', () => { picker.query = P.search.value; runSearch(); });
P.search.addEventListener('change', (e) => e.stopPropagation()); // typing in the search box must not create undo steps
P.search.addEventListener('keydown', (e) => {
	if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(picker.hi + 1); }
	else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(picker.hi - 1); }
	else if (e.key === 'Enter') { e.preventDefault(); const f = picker.matches[picker.hi >= 0 ? picker.hi : 0]; if (f) pickFont(f.name); }
	else if (e.key === 'Escape') { e.preventDefault(); closeFontPicker(); P.btn.focus(); }
});
P.cats.addEventListener('click', (e) => {
	const chip = e.target.closest('.ed-chip');
	if (!chip) return;
	picker.cat = chip.dataset.cat;
	P.cats.querySelectorAll('.ed-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
	runSearch();
});
P.list.addEventListener('click', (e) => { const row = e.target.closest('.ed-fontitem'); if (row) pickFont(row.dataset.name); });
P.list.addEventListener('scroll', () => {
	if (picker.rendered < picker.matches.length && P.list.scrollTop + P.list.clientHeight >= P.list.scrollHeight - 120) renderFontItems(false);
});
document.addEventListener('click', (e) => {
	if (picker.open && !P.pop.contains(e.target) && !P.btn.contains(e.target)) closeFontPicker();
});

T.size.addEventListener('input', onText((o) => { o.size = clamp(parseInt(T.size.value, 10) || o.size, 6, 1000); }));
T.color.addEventListener('input', onText((o) => { o.color = T.color.value; }));
T.align.addEventListener('change', onText((o) => { o.align = T.align.value; }));
T.strokeColor.addEventListener('input', onText((o) => { o.strokeColor = T.strokeColor.value; }));
T.strokeWidth.addEventListener('input', onText((o) => {
	o.strokeWidth = parseInt(T.strokeWidth.value, 10) || 0;
	T.strokeVal.textContent = o.strokeWidth;
}));
T.bold.addEventListener('click', () => {
	onText((o) => { o.bold = !o.bold; T.bold.classList.toggle('is-active', o.bold); })();
	pushHistory();
});
T.italic.addEventListener('click', () => {
	onText((o) => { o.italic = !o.italic; T.italic.classList.toggle('is-active', o.italic); })();
	pushHistory();
});
L.opacity.addEventListener('input', () => {
	const o = getSelected();
	if (!o) return;
	o.opacity = clamp(parseInt(L.opacity.value, 10) / 100, 0, 1);
	L.opacityVal.textContent = L.opacity.value + '%';
	requestRender();
});
L.rotation.addEventListener('input', () => {
	const o = getSelected();
	if (!o) return;
	o.rot = parseInt(L.rotation.value, 10) || 0;
	L.rotationVal.textContent = o.rot + '°';
	requestRender();
});
// one history entry per finished edit (change fires on release / blur)
layerPanel.addEventListener('change', () => pushHistory());

$('edDupBtn').addEventListener('click', duplicateSelected);
$('edForwardBtn').addEventListener('click', () => reorderSelected(1));
$('edBackBtn').addEventListener('click', () => reorderSelected(-1));
$('edDeleteBtn').addEventListener('click', deleteSelected);

/* ---------- toolbar wiring ---------- */
document.querySelectorAll('#edTools .mode-btn').forEach((b) => b.addEventListener('click', () => { if (!state.busy) setTool(b.dataset.tool); }));
document.querySelectorAll('#edMethod .mode-btn').forEach((b) => b.addEventListener('click', () => { if (!state.busy) setMethod(b.dataset.method); }));
$('edAddTextBtn').addEventListener('click', addText);
$('edAddImageBtn').addEventListener('click', () => addImageInput.click());
addImageInput.addEventListener('change', (e) => { if (e.target.files[0]) addImageFile(e.target.files[0]); addImageInput.value = ''; });
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
eraseBtn.addEventListener('click', eraseMarked);
clearMaskBtn.addEventListener('click', clearMask);

brushSizeEl.addEventListener('input', () => {
	state.brushSize = parseInt(brushSizeEl.value, 10);
	brushValEl.textContent = state.brushSize;
	requestRender();
});
function setBrushMode(mode) {
	state.brushMode = mode;
	paintBtn.classList.toggle('is-active', mode === 'paint');
	unpaintBtn.classList.toggle('is-active', mode === 'unpaint');
}
paintBtn.addEventListener('click', () => setBrushMode('paint'));
unpaintBtn.addEventListener('click', () => setBrushMode('unpaint'));

/* ---------- keyboard ---------- */
document.addEventListener('keydown', (e) => {
	if (!state.hasImage) return;
	const tag = (e.target.tagName || '').toLowerCase();
	if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
	const mod = e.ctrlKey || e.metaKey;
	if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
	if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
	if (e.key === 'Delete' || e.key === 'Backspace') { if (getSelected()) { e.preventDefault(); deleteSelected(); } return; }
	if (e.key === 'Escape') select(null);
});
window.addEventListener('resize', requestRender);

/* =====================================================================
   Opening, exporting, resetting
===================================================================== */
async function openImage(file) {
	if (!file || !file.type.startsWith('image/')) { showError("That doesn't look like an image file. Try JPG, PNG, or WEBP."); return; }
	clearError();
	try {
		const url = URL.createObjectURL(file);
		const img = await loadImageEl(url);
		URL.revokeObjectURL(url);
		let w = img.naturalWidth, h = img.naturalHeight, scaled = false;
		const m = Math.max(w, h);
		if (m > CONFIG.maxDimension) {
			const k = CONFIG.maxDimension / m;
			w = Math.round(w * k); h = Math.round(h * k); scaled = true;
		}
		baseCanvas.width = w; baseCanvas.height = h;
		bctx.imageSmoothingQuality = 'high';
		bctx.clearRect(0, 0, w, h);
		bctx.drawImage(img, 0, 0, w, h);
		view.width = w; view.height = h;
		maskCanvas.width = w; maskCanvas.height = h;

		state.hasImage = true;
		state.fileName = file.name.replace(/\.[^/.]+$/, '') || 'image';
		state.objects = [];
		state.selectedId = null;
		state.nextId = 1;
		state.maskBox = null;
		state.history = [];
		state.hIndex = -1;
		state.baseSnap = cloneCanvas(baseCanvas);
		pushHistory();

		stage.classList.add('is-hidden');
		workspace.classList.remove('is-hidden');
		eraseBtn.disabled = true;
		setMethod(state.method);
		setStatus(scaled ? 'Large image scaled down to ' + w + '×' + h + ' to keep editing smooth.' : '');
		setTool('move');
		requestRender();
	} catch (e) {
		showError('Could not open that image.');
	}
}

async function download() {
	if (!state.hasImage) return;
	const fmt = $('edFormat').value;
	const c = document.createElement('canvas');
	c.width = baseCanvas.width; c.height = baseCanvas.height;
	const ctx = c.getContext('2d');
	if (fmt === 'jpeg') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height); }
	drawScene(ctx);
	const quality = fmt === 'png' ? undefined : 0.95;
	c.toBlob((blob) => {
		if (!blob) { showError('Could not create the image file.'); return; }
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = state.fileName + '-edited.' + EXT[fmt];
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}, MIME[fmt], quality);
}

function resetEditor() {
	if (state.busy) return;
	state.hasImage = false;
	state.objects = [];
	state.selectedId = null;
	state.history = [];
	state.hIndex = -1;
	state.baseSnap = null;
	state.maskBox = null;
	workspace.classList.add('is-hidden');
	stage.classList.remove('is-hidden');
	clearError();
}

$('edDownloadBtn').addEventListener('click', download);
$('edNewBtn').addEventListener('click', resetEditor);

stage.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) openImage(e.target.files[0]); fileInput.value = ''; });
['dragenter', 'dragover'].forEach((evt) => stage.addEventListener(evt, (e) => { e.preventDefault(); stage.classList.add('drag'); }));
['dragleave', 'drop'].forEach((evt) => stage.addEventListener(evt, (e) => { e.preventDefault(); stage.classList.remove('drag'); }));
stage.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) openImage(e.dataTransfer.files[0]); });

// web fonts finish loading after first paint: lay text out again once they're ready
if (document.fonts) {
	const relayout = () => {
		state.objects.forEach((o) => { if (o.type === 'text') layoutText(o); });
		requestRender();
	};
	if (document.fonts.ready) document.fonts.ready.then(relayout);
	if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', relayout);
}

})();