(function (root, factory) {
	if (typeof module === 'object' && module.exports) module.exports = factory();
	else root.MatteP2W = factory();
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const OPS = { save: 10, restore: 11, transform: 12, paintJpeg: 82, paintImage: 85, paintInline: 86 };
	const TWIP = 20;

	const WORD_FONTS = {
		arial: 'Arial', helvetica: 'Arial', liberationsans: 'Arial', arimo: 'Arial', nimbussans: 'Arial',
		times: 'Times New Roman', timesnewroman: 'Times New Roman', liberationserif: 'Times New Roman', tinos: 'Times New Roman', nimbusroman: 'Times New Roman',
		courier: 'Courier New', couriernew: 'Courier New', liberationmono: 'Courier New', cousine: 'Courier New',
		carlito: 'Calibri', calibri: 'Calibri', caladea: 'Cambria', cambria: 'Cambria',
		georgia: 'Georgia', verdana: 'Verdana', tahoma: 'Tahoma', trebuchetms: 'Trebuchet MS', consolas: 'Consolas',
		dejavusans: 'Verdana', dejavuserif: 'Georgia', dejavusansmono: 'Consolas', segoeui: 'Segoe UI', garamond: 'Garamond'
	};

	const GENERIC = { serif: 'Times New Roman', 'sans-serif': 'Arial', monospace: 'Courier New' };

	function wordFont(pdfName, generic) {
		if (pdfName) {
			let n = String(pdfName).replace(/^[A-Z]{6}\+/, '');
			const family = n.split(/[-,]/)[0];
			const key = family.toLowerCase().replace(/[^a-z]/g, '').replace(/(mt|ps|std|pro)$/, '');
			if (WORD_FONTS[key]) return WORD_FONTS[key];
			if (WORD_FONTS[family.toLowerCase().replace(/[^a-z]/g, '')]) return WORD_FONTS[family.toLowerCase().replace(/[^a-z]/g, '')];
			const spaced = family.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
			if (spaced && !/^g_d\d|^f\d+$/i.test(spaced)) return spaced;
		}
		return GENERIC[generic] || 'Calibri';
	}

	const PUA_MAP = { '': '•', '': '▪', '': '➢', '': '✓', '': '❖', '': '○', '': '■', '': '•' };
	function normalizeSymbols(s) {
		return s.replace(/[-]/g, (c) => PUA_MAP[c] || '').replace(/­/g, '');
	}

	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
	const round = Math.round;
	function mul(m1, m2) { // m1 * m2 as PDF matrices [a b c d e f]
		return [
			m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
			m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
			m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
		];
	}

	function apply(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

	function fontInfo(page, fontName, styles) {
		let real = '', bold = false, italic = false;
		try {
			const f = page.commonObjs.get(fontName);
			if (f) { real = f.name || ''; bold = !!f.bold; italic = !!f.italic; }
		} catch (e) { /* font not resolved */ }
		const probe = real || (styles[fontName] && styles[fontName].fontFamily) || '';
		if (/bold|black|heavy|semibold|demi/i.test(real)) bold = true;
		if (/italic|oblique/i.test(real)) italic = true;
		return { real, bold, italic, generic: (styles[fontName] && styles[fontName].fontFamily) || '', probe };
	}

	function sampleColor(img, x0, y0, x1, y1) {
		if (!img) return null;
		x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
		x1 = Math.min(img.width - 1, Math.ceil(x1)); y1 = Math.min(img.height - 1, Math.ceil(y1));
		let best = 999, br = 0, bg = 0, bb = 0;
		for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
			const i = (y * img.width + x) * 4, r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
			const lum = 0.3 * r + 0.59 * g + 0.11 * b;
			if (lum < best) { best = lum; br = r; bg = g; bb = b; }
		}
		if (best === 999 || best > 200) return null;
		const spread = Math.max(br, bg, bb) - Math.min(br, bg, bb);
		if (spread < 40 && best < 70) return null; // plain black
		const h = (n) => ('0' + n.toString(16)).slice(-2);
		return (h(br) + h(bg) + h(bb)).toUpperCase();
	}

	function getObj(page, name) {
		return new Promise((resolve) => {
			let done = false;
			const fin = (v) => { if (!done) { done = true; resolve(v || null); } };
			try {
				const store = name.indexOf('g_') === 0 ? page.commonObjs : page.objs;
				store.get(name, fin);
			} catch (e) { fin(null); }
			setTimeout(() => fin(null), 4000);
		});
	}

	async function extractImages(page, vp, opts) {
		const out = [];
		let ops;
		try { ops = await page.getOperatorList(); } catch (e) { return out; }
		let ctm = [1, 0, 0, 1, 0, 0];
		const stack = [];
		for (let i = 0; i < ops.fnArray.length; i++) {
			const fn = ops.fnArray[i], args = ops.argsArray[i];
			if (fn === OPS.save) stack.push(ctm.slice());
			else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
			else if (fn === OPS.transform) ctm = mul(ctm, args);
			else if (fn === OPS.paintImage || fn === OPS.paintJpeg || fn === OPS.paintInline) {
				const m = mul(vp.transform, ctm);
				const pts = [apply(m, 0, 0), apply(m, 1, 0), apply(m, 0, 1), apply(m, 1, 1)];
				const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
				const box = { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys) };
				if (box.x1 - box.x0 < 6 || box.y1 - box.y0 < 6) continue;
				let img = fn === OPS.paintInline ? args[0] : await getObj(page, args[0]);
				if (!img) continue;
				try {
					const png = await opts.imageToPng(img);
					if (png) out.push({ box, png, w: box.x1 - box.x0, h: box.y1 - box.y0 });
				} catch (e) { /* skip unreadable picture */ }
			}
		}
		return out;
	}

	function itemsToLines(items, sampler, page, styles) {
		const cache = {};
		const info = (fn) => cache[fn] || (cache[fn] = fontInfo(page, fn, styles));
		const pieces = [];
		for (const it of items) {
			const raw = it.str;
			if (!raw || !raw.trim()) { if (raw) pieces.push({ space: true, x: it.x, baseline: it.baseline }); continue; }
			const f = info(it.fontName);
			pieces.push({
				text: normalizeSymbols(raw), x: it.x, x1: it.x + it.width, baseline: it.baseline, size: it.size,
				bold: f.bold, italic: f.italic, font: wordFont(f.real, f.generic),
				color: sampler ? sampler(it) : null
			});
		}
		const real = pieces.filter((p) => !p.space && p.text);
		real.sort((a, b) => a.baseline - b.baseline || a.x - b.x);
		
		const lines = [];
		for (const p of real) {
			let line = null;
			for (let k = lines.length - 1; k >= 0 && k >= lines.length - 6; k--) {
				const l = lines[k];
				if (Math.abs(l.baseline - p.baseline) < Math.max(l.size, p.size) * 0.35) { line = l; break; }
			}
			if (!line) { line = { baseline: p.baseline, size: p.size, parts: [] }; lines.push(line); }
			line.parts.push(p);
			line.size = Math.max(line.size, p.size);
		}

		const split = [];
		for (const l of lines) {
			l.parts.sort((a, b) => a.x - b.x);
			let cur = { baseline: l.baseline, size: 0, parts: [] };
			l.parts.forEach((p, i) => {
				if (i > 0 && p.x - l.parts[i - 1].x1 > Math.max(p.size, l.parts[i - 1].size) * 2.2) { split.push(cur); cur = { baseline: l.baseline, size: 0, parts: [] }; }
				cur.parts.push(p); cur.size = Math.max(cur.size, p.size);
			});
			split.push(cur);
		}

		const result = [];
		for (const l of split) {
			const runs = [];
			let prev = null;
			for (const p of l.parts) {
				let text = p.text;
				if (prev) {
					const gap = p.x - prev.x1;
					const spaceAlready = /\s$/.test(prev.text) || /^\s/.test(text);
					if (gap > p.size * 0.15 && !spaceAlready) text = ' ' + text;
					if (gap > p.size * 2.2 && !spaceAlready) text = '\t' + text.trimStart(); // wide gap = a tab-like jump
				}
				const last = runs[runs.length - 1];
				if (last && last.bold === p.bold && last.italic === p.italic && last.font === p.font && last.color === p.color && Math.abs(last.size - p.size) < 0.4) last.text += text;
				else runs.push({ text, bold: p.bold, italic: p.italic, font: p.font, color: p.color, size: p.size });
				prev = p;
			}
			const x0 = l.parts[0].x, x1 = Math.max.apply(null, l.parts.map((p) => p.x1));
			result.push({
				x0, x1, baseline: l.baseline, size: l.size, top: l.baseline - l.size * 0.8, bottom: l.baseline + l.size * 0.2,
				runs, parts: l.parts,
				text: runs.map((r) => r.text).join('')
			});
		}
		return result;
	}

	function ocrToLines(ocrLines, scale) {
		return ocrLines.map((l) => {
			const x0 = l.x0 / scale, x1 = l.x1 / scale, h = (l.y1 - l.y0) / scale;
			const size = Math.max(6, h * 1.05);
			const baseline = l.y1 / scale - h * 0.22;
			const text = String(l.text || '').replace(/\s+/g, ' ').trim().replace(/^[*¢»«]\s/, '• ');
			if (!text) return null;
			const run = { text, bold: false, italic: false, font: 'Calibri', color: null, size };
			return { x0, x1, baseline, size, top: baseline - size * 0.8, bottom: baseline + size * 0.2, runs: [run], parts: [{ x: x0, x1, text, size }], text };
		}).filter(Boolean);
	}

	async function extractPage(page, opts) {
		opts = opts || {};
		const vp = page.getViewport({ scale: 1 });
		const res = { width: vp.width, height: vp.height, lines: [], images: [], scanned: false, ocr: false };
		let tc = { items: [], styles: {} };
		try { tc = await page.getTextContent(); } catch (e) { /* no text layer */ }
		let ops = null;
		try { ops = await page.getOperatorList(); } catch (e) { /* ignore */ }
		const items = [];
		let chars = 0;
		for (const it of tc.items) {
			if (typeof it.str !== 'string') continue;
			const t = it.transform;
			if (Math.abs(t[1]) > Math.abs(t[0]) * 0.3) continue; 
			const p = apply(vp.transform, t[4], t[5]);
			const size = Math.hypot(t[0], t[1]) || it.height || 10;
			items.push({ str: it.str, fontName: it.fontName, x: p[0], baseline: p[1], size, width: it.width });
			chars += it.str.trim().length;
		}
		let sample = null;
		if (opts.sampleImage) { try { sample = await opts.sampleImage(page); } catch (e) { sample = null; } }
		const sampler = sample ? (it) => sampleColor(sample, it.x, it.baseline - it.size * 0.8, it.x + it.width, it.baseline + it.size * 0.1) : null;
		res.lines = itemsToLines(items, sampler, page, tc.styles || {});
		res.images = await extractImages(page, vp, opts);
		if (chars < 8) {
			res.scanned = true;
			if (opts.ocr) {
				const r = await opts.ocr(page);
				if (r && r.lines && r.lines.length) {
					res.lines = ocrToLines(r.lines, r.scale);

					const med = median(res.lines.map((l) => l.size));
					res.lines.forEach((l) => {
						if (Math.abs(l.size - med) <= med * 0.25) { l.size = med; l.runs.forEach((ru) => { ru.size = med; }); l.top = l.baseline - med * 0.8; l.bottom = l.baseline + med * 0.2; }
					});
					res.ocr = true;
					const pageArea = res.width * res.height;
					res.images = res.images.filter((im) => im.w * im.h < pageArea * 0.8); 
				}
			}
		}
		return res;
	}

	function bounds(lines) {
		return { x0: Math.min.apply(null, lines.map((l) => l.x0)), x1: Math.max.apply(null, lines.map((l) => l.x1)) };
	}

	function findGutter(lines, med) {
		if (lines.length < 4) return null;
		const iv = lines.map((l) => [l.x0, l.x1]).sort((a, b) => a[0] - b[0]);
		let cur = iv[0][1], best = null;
		for (let i = 1; i < iv.length; i++) {
			if (iv[i][0] - cur >= Math.max(med * 1.0, 10) && (!best || iv[i][0] - cur > best.w)) best = { x: (iv[i][0] + cur) / 2, w: iv[i][0] - cur };
			cur = Math.max(cur, iv[i][1]);
		}
		if (!best) return null;
		const left = lines.filter((l) => l.x1 <= best.x), right = lines.filter((l) => l.x0 >= best.x);
		if (left.length < 2 || right.length < 2 || left.length + right.length !== lines.length) return null;
		return { left, right };
	}

	function xyCut(lines, region, med, out) {
		if (lines.length === 0) return;
		if (lines.length > 1) {
			
			const sorted0 = lines.slice().sort((a, b) => a.top - b.top);
			const maxK = Math.min(8, sorted0.length - 4);
			for (let k = 0; k <= maxK; k++) {
				for (const where of (k === 0 ? ['none'] : ['head', 'foot'])) {
					const head = where === 'head' ? sorted0.slice(0, k) : [];
					const foot = where === 'foot' ? sorted0.slice(sorted0.length - k) : [];
					const rest = sorted0.slice(head.length, sorted0.length - foot.length);
					const g = findGutter(rest, med);
					if (!g) continue;
					if (head.length) xyCut(head, region, med, out);
					const lb = bounds(g.left), rb = bounds(g.right);
					xyCut(g.left, { x0: lb.x0, x1: lb.x1 }, med, out);
					xyCut(g.right, { x0: rb.x0, x1: rb.x1 }, med, out);
					if (foot.length) xyCut(foot, region, med, out);
					return;
				}
			}
			
			const sorted = sorted0;
			let maxBottom = sorted[0].bottom, cut = -1, cw = med * 0.45;
			for (let i = 1; i < sorted.length; i++) {
				const g = sorted[i].top - maxBottom;
				if (g > cw) { cw = g; cut = i; }
				maxBottom = Math.max(maxBottom, sorted[i].bottom);
			}
			if (cut > 0) {
				xyCut(sorted.slice(0, cut), region, med, out);
				xyCut(sorted.slice(cut), region, med, out);
				return;
			}
		}
		out.push({ lines: lines.slice().sort((a, b) => a.baseline - b.baseline), region });
	}

	const MARKER = /^\s*(?:([•●○▪■◦·‣➢✓❖*]|[-–—])|\(?(\d{1,3})[.)]|\(?([a-zA-Z])[.)]|\(?([ivxIVX]{1,5})[.)])\s+/;

	function lineAlign(l, region) {
		const w = region.x1 - region.x0 || 1;
		const lg = l.x0 - region.x0, rg = region.x1 - l.x1;
		if (lg > w * 0.08 && Math.abs(lg - rg) < w * 0.05) return 'center';
		if (lg > w * 0.2 && rg < w * 0.03) return 'right';
		return 'left';
	}

	const lineBold = (l) => l.runs.every((r) => r.bold || !r.text.trim());

	function domSize(l) { let b = l.runs[0]; for (const r of l.runs) if (r.text.length > b.text.length) b = r; return b.size; }

	function makeParagraphs(blocks, bodySize) {
		const paras = [];
		for (const blk of blocks) {
			const region = blk.region, w = region.x1 - region.x0 || 1;
			let cur = null;
			const flush = () => { if (cur) { finish(cur, region, w, bodySize); paras.push(cur); cur = null; } };
			for (const l of blk.lines) {
				const marker = MARKER.exec(l.text);
				let brk = !cur;
				if (cur) {
					const prev = cur.lines[cur.lines.length - 1];
					const diff = l.baseline - prev.baseline;
					if (diff > Math.max(prev.size, l.size) * 1.45) brk = true;
					else if (marker && !cur.hangingOnly) brk = true;
					else if (Math.abs(domSize(l) - domSize(prev)) > domSize(prev) * 0.1) brk = true;
					else if (lineBold(l) !== lineBold(prev)) brk = true;
					else if (lineAlign(l, region) !== lineAlign(prev, region) && (lineAlign(l, region) !== 'left' || lineAlign(prev, region) !== 'left')) brk = true;
					else if (cur.lines.length === 1 && l.x0 - prev.x0 > l.size * 0.8 && lineAlign(l, region) === 'left' && lineAlign(prev, region) === 'left' && l.x0 - prev.x0 > 0 && false) brk = true;
					else if (l.x0 - region.x0 > domSize(l) * 1.0 && prev.x0 - region.x0 < domSize(l) * 0.5 && prev.x1 < region.x1 - w * 0.25 && lineAlign(prev, region) === 'left') brk = true;
				}
				if (brk) { flush(); cur = { lines: [], marker: !!marker, region }; }
				cur.lines.push(l);
			}
			flush();
		}
		return paras;
	}

	function finish(p, region, w, bodySize) {
		const first = p.lines[0], second = p.lines[1];
		const sizeP = domSize(first);
		p.top = first.top; p.bottom = p.lines[p.lines.length - 1].bottom; p.rx0 = region.x0; p.rx1 = region.x1;
		p.size = sizeP;
		p.bold = p.lines.every(lineBold);
		
		const al = lineAlign(first, region);
		p.align = al;
		if (al === 'left' && p.lines.length >= 3) {
			const body = p.lines.slice(0, -1);
			if (body.every((l) => region.x1 - l.x1 < w * 0.02)) p.align = 'both';
		}
		
		const leftBase = (second ? second.x0 : first.x0);
		p.leftTw = Math.max(0, round((leftBase - region.x0) * TWIP));
		if (p.leftTw < sizeP * 0.6 * TWIP) p.leftTw = 0;
		p.firstTw = 0;
		if (second) {
			const d = first.x0 - second.x0;
			if (Math.abs(d) > sizeP * 0.5) p.firstTw = round(d * TWIP);
		} else if (p.align === 'left' && first.x0 - region.x0 > sizeP * 0.6) p.leftTw = round((first.x0 - region.x0) * TWIP);
		if (p.align === 'center' || p.align === 'right') { p.leftTw = 0; p.firstTw = 0; }
		
		const m = MARKER.exec(first.text);
		if (m && !second) { /* single-line item */ }
		if (m) {
			let tx = null;
			const k = m[0].length - (m[0].match(/\s+$/) ? m[0].match(/\s+$/)[0].length : 0);
			let acc = 0;
			for (const part of first.parts) {
				if (acc >= k) { tx = part.x; break; }
				acc += part.text.length;
			}
			if (tx === null) tx = first.x0 + sizeP * 1.5;
			const markerWidth = tx - first.x0;
			p.leftTw = round((tx - region.x0) * TWIP);
			p.firstTw = -round(markerWidth * TWIP);
			p.listMarker = true;
		}
		
		const diffs = [];
		for (let i = 1; i < p.lines.length; i++) diffs.push(p.lines[i].baseline - p.lines[i - 1].baseline);
		const lead = diffs.length ? median(diffs) / sizeP : 1.2;
		p.lineRatio = Math.min(1.6, Math.max(1.0, lead));
		p.runs = joinRuns(p.lines);
	}

	function joinRuns(lines) {
		const out = [];
		lines.forEach((l, i) => {
			l.runs.forEach((r, j) => {
				let t = r.text;
				if (j === 0 && i > 0) t = (/[-‐]$/.test(out.length ? out[out.length - 1].text : '') ? '' : ' ') + t.replace(/^\s+/, '');
				const last = out[out.length - 1];
				if (last && last.bold === r.bold && last.italic === r.italic && last.font === r.font && last.color === r.color && Math.abs(last.size - r.size) < 0.4) last.text += t;
				else out.push({ text: t, bold: r.bold, italic: r.italic, font: r.font, color: r.color, size: r.size });
			});
		});
		return out;
	}

	function markHeadings(paras, bodySize) {
		for (const p of paras) {
			const chars = p.runs.reduce((n, r) => n + r.text.length, 0);
			if (p.listMarker) continue;
			if (p.size >= bodySize * 1.25 && chars < 160 && p.lines.length <= 3) p.headCand = true;
			else if (p.bold && p.size >= bodySize * 1.08 && chars < 90 && p.lines.length === 1) p.headCand = true;
		}
	}

	function layoutFlowPage(pg) {
		const lines = pg.lines;
		const res = { width: pg.width, height: pg.height, items: [], margins: null };
		if (!lines.length && !pg.images.length) return res;
		const sizes = [];
		lines.forEach((l) => l.runs.forEach((r) => { for (let i = 0; i < r.text.length; i++) sizes.push(Math.round(r.size * 2) / 2); }));
		const body = median(sizes) || 11;
		pg.bodySize = body;
		const blocks = [];
		if (lines.length) {
			const b = bounds(lines);
			xyCut(lines, { x0: b.x0, x1: b.x1 }, body, blocks);
		}
		const paras = makeParagraphs(blocks, body);
		markHeadings(paras, body);
		
		const imgs = pg.images.slice().sort((a, b) => a.box.y0 - b.box.y0);
		const seq = paras.map((p) => ({ type: 'p', p, top: p.top, rx0: p.rx0, rx1: p.rx1 }));
		for (const im of imgs) {
			const cx = (im.box.x0 + im.box.x1) / 2;
			const node = { type: 'img', im, top: im.box.y0 };
			const match = (n) => n.type === 'p' && cx >= n.rx0 - 6 && cx <= n.rx1 + 6;
			let idx = seq.findIndex((n) => match(n) && n.top > im.box.y0 - 1);
			if (idx < 0) {
				let last = -1;
				seq.forEach((n, i) => { if (match(n)) last = i; });
				idx = last >= 0 ? last + 1 : seq.findIndex((n) => n.top > im.box.y0);
				if (idx < 0) idx = seq.length;
			}
			seq.splice(idx, 0, node);
		}
		res.items = seq;
		
		const xs0 = [], xs1 = [], ys0 = [];
		lines.forEach((l) => { xs0.push(l.x0); xs1.push(l.x1); ys0.push(l.top); });
		pg.images.forEach((im) => { xs0.push(im.box.x0); xs1.push(im.box.x1); ys0.push(im.box.y0); });
		const clamp = (v) => Math.min(144, Math.max(36, v));
		res.margins = { l: clamp(Math.min.apply(null, xs0)), r: clamp(pg.width - Math.max.apply(null, xs1)), t: clamp(Math.min.apply(null, ys0)), b: 48 };
		return res;
	}

	const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

	function runXml(r, bodyDefault) {
		const parts = String(r.text).split('\t');
		let rpr = '<w:rFonts w:ascii="' + esc(r.font) + '" w:hAnsi="' + esc(r.font) + '" w:cs="' + esc(r.font) + '" w:eastAsia="' + esc(r.font) + '"/>';
		if (r.bold) rpr += '<w:b/><w:bCs/>';
		if (r.italic) rpr += '<w:i/><w:iCs/>';
		if (r.color) rpr += '<w:color w:val="' + r.color + '"/>';
		const hs = Math.max(2, round(r.size * 2));
		rpr += '<w:sz w:val="' + hs + '"/><w:szCs w:val="' + hs + '"/>';
		let xml = '';
		parts.forEach((t, i) => {
			if (i > 0) xml += '<w:r><w:rPr>' + rpr + '</w:rPr><w:tab/></w:r>';
			if (t !== '') xml += '<w:r><w:rPr>' + rpr + '</w:rPr><w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
		});
		return xml;
	}

	function drawingXml(rid, id, wPt, hPt, anchor) {
		const cx = round(wPt * 12700), cy = round(hPt * 12700);
		const graphic = '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="Picture ' + id + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>';
		if (!anchor) {
			return '<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Picture ' + id + '"/><wp:cNvGraphicFramePr/>' + graphic + '</wp:inline></w:drawing>';
		}
		return '<w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="' + id + '" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>' + round(anchor.x * 12700) + '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>' + round(anchor.y * 12700) + '</wp:posOffset></wp:positionV><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="' + id + '" name="Picture ' + id + '"/><wp:cNvGraphicFramePr/>' + graphic + '</wp:anchor></w:drawing>';
	}

	function sectXml(pg, m) {
		const pw = round(pg.width * TWIP), ph = round(pg.height * TWIP);
		return '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="' + pw + '" w:h="' + ph + '"/><w:pgMar w:top="' + round(m.t * TWIP) + '" w:right="' + round(m.r * TWIP) + '" w:bottom="' + round(m.b * TWIP) + '" w:left="' + round(m.l * TWIP) + '" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
	}

	const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
		'<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
		'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
		[1, 2, 3].map((n) => '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr></w:style>').join('') +
		'</w:styles>';

	function buildDocx(JSZipCtor, pages, mode, extra) {
		extra = extra || {};
		const media = [];
		const rels = [];
		let nextImg = 1, drawId = 1;
		function addImage(png) {
			const idx = nextImg++;
			media.push({ name: 'image' + idx + '.png', data: png });
			const rid = 'rIdImg' + idx;
			rels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + idx + '.png"/>');
			return rid;
		}
		let body = '';
		if (mode !== 'exact') {
			const sizes = [];
			pages.forEach((pg) => { pg._flow = layoutFlowPage(pg); pg._flow.items.forEach((n) => { if (n.type === 'p' && n.p.headCand) sizes.push(Math.round(n.p.size * 2) / 2); }); });
			const uniq = Array.from(new Set(sizes)).sort((a, b) => b - a);
			pages.forEach((pg) => pg._flow.items.forEach((n) => { if (n.type === 'p' && n.p.headCand) n.p.heading = Math.min(3, uniq.indexOf(Math.round(n.p.size * 2) / 2) + 1); }));
		}
		pages.forEach((pg, pi) => {
			const last = pi === pages.length - 1;
			if (mode === 'exact') body += exactPage(pg, addImage, () => drawId++, last);
			else body += flowPage(pg, addImage, () => drawId++, last);
		});

		if (!pages.length) body = '<w:p/>';

		const lastPg = pages[pages.length - 1];

		const finalSect = lastPg ? (mode === 'exact' ? sectXml(lastPg, { t: 0, r: 0, b: 0, l: 0 }) : sectXml(lastPg, lastPg._flow.margins || { t: 54, r: 54, b: 54, l: 54 })) : '';
		
		const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + finalSect + '</w:body></w:document>';
		
		const zip = new JSZipCtor();
		zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
		zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
		zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' + rels.join('') + '</Relationships>');
		zip.file('word/styles.xml', STYLES);
		zip.file('word/document.xml', doc);
		media.forEach((m) => zip.file('word/media/' + m.name, m.data));
		return zip.generateAsync({ type: extra.type || 'uint8array', compression: 'DEFLATE' });
	}

	function paraXml(p) {
		let ppr = '';
		if (p.heading) ppr += '<w:pStyle w:val="Heading' + p.heading + '"/>';
		ppr += '<w:spacing w:before="0" w:after="' + p.afterTw + '" w:line="' + round(p.lineRatio / 1.2 * 240) + '" w:lineRule="auto"/>';
		if (p.leftTw || p.firstTw) {
			ppr += '<w:ind w:left="' + p.leftTw + '"' + (p.firstTw < 0 ? ' w:hanging="' + (-p.firstTw) + '"' : p.firstTw > 0 ? ' w:firstLine="' + p.firstTw + '"' : '') + '/>';
		}
		if (p.align !== 'left') ppr += '<w:jc w:val="' + p.align + '"/>';
		let runs = p.runs.map((r) => {
			let t = r.text;
			if (p.listMarker) { /* marker then tab */ }
			return runXml(r);
		}).join('');
		if (p.listMarker) {
			runs = '';
			let done = false;
			p.runs.forEach((r) => {
				if (!done) {
					const m = MARKER.exec(r.text);
					if (m) {
						const mk = m[0].replace(/\s+$/, '');
						runs += runXml({ text: mk + '\t' + r.text.slice(m[0].length), bold: r.bold, italic: r.italic, font: r.font, color: r.color, size: r.size });
						done = true; return;
					}
				}
				runs += runXml(r);
			});
		}
		return '<w:p><w:pPr>' + ppr + '</w:pPr>' + runs + '</w:p>';
	}

	function flowPage(pg, addImage, nextId, last) {
		const flow = pg._flow;
		let xml = '';
		const seq = flow.items;
		seq.forEach((n, i) => {
			if (n.type === 'p') {
				const nxt = seq.slice(i + 1).find((x) => x.type === 'p' && x.rx0 === n.p.rx0);
				let gap = 0;
				if (nxt) gap = Math.max(0, (nxt.p.lines[0].baseline - n.p.lines[n.p.lines.length - 1].baseline) - n.p.size * n.p.lineRatio);
				n.p.afterTw = Math.min(480, round(gap * TWIP));
				xml += paraXml(n.p);
			} else {
				const im = n.im;
				const maxW = pg.width - flow.margins.l - flow.margins.r;
				let w = im.w, h = im.h;
				if (w > maxW) { h = h * maxW / w; w = maxW; }
				const cx = (im.box.x0 + im.box.x1) / 2;
				const al = cx < pg.width * 0.4 && im.box.x0 < flow.margins.l + 24 ? 'left' : cx > pg.width * 0.6 && im.box.x1 > pg.width - flow.margins.r - 24 ? 'right' : 'center';
				xml += '<w:p><w:pPr><w:spacing w:before="60" w:after="120"/><w:jc w:val="' + al + '"/></w:pPr><w:r>' + drawingXml(addImage(im.png), nextId(), w, h, null) + '</w:r></w:p>';
			}
		});
		if (!seq.length) xml += '<w:p/>';
		if (!last) xml += '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>' + sectXml(pg, flow.margins) + '</w:pPr></w:p>';
		return xml;
	}

	function exactPage(pg, addImage, nextId, last) {
		let xml = '';
		const sorted = pg.lines.slice().sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
		for (const l of sorted) {
			const wTw = Math.ceil((l.x1 - l.x0) * TWIP * 1.2) + 240;
			const y = Math.max(0, l.baseline - l.size * 0.92);
			const frame = '<w:framePr w:w="' + wTw + '" w:hRule="auto" w:wrap="around" w:vAnchor="page" w:hAnchor="page" w:x="' + round(l.x0 * TWIP) + '" w:y="' + round(y * TWIP) + '"/>';
			const runs = l.runs.map((r) => runXml(r)).join('');
			xml += '<w:p><w:pPr>' + frame + '<w:spacing w:before="0" w:after="0" w:line="' + round(l.size * 1.2 * TWIP) + '" w:lineRule="exact"/></w:pPr>' + runs + '</w:p>';
		}
		
		let anchors = '';
		for (const im of pg.images) anchors += '<w:r>' + drawingXml(addImage(im.png), nextId(), im.w, im.h, { x: im.box.x0, y: im.box.y0 }) + '</w:r>';
		const sect = last ? '' : sectXml(pg, { t: 0, r: 0, b: 0, l: 0 });
		xml += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>' + sect + '</w:pPr>' + anchors + '</w:p>';
		return xml;
	}

	return { extractPage, buildDocx, layoutFlowPage, _internals: { MARKER, wordFont, normalizeSymbols, xyCut } };
});