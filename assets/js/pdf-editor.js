(function() {
	'use strict';

	const WORKER_SRC = 'assets/vendors/pdf/pdf.worker.min.js';
	const MAX_DPR = 2;
	const HISTORY_LIMIT = 60;
	const HANDLE = 9;
	const THUMB_WIDTH = 110; 
	const MAX_IMAGE_SIDE = 2000; 

	function clamp(v, lo, hi) {
		return v < lo ? lo : (v > hi ? hi : v);
	}

	function displayedSize(r, vw, vh) {
		return(r % 180) ? [vh, vw] : [vw, vh];
	}

	function baseToDisplay(r, vw, vh, x, y) {
		switch(r) {
			case 90:
				return [vh - y, x];
			case 180:
				return [vw - x, vh - y];
			case 270:
				return [y, vw - x];
			default:
				return [x, y];
		}
	}

	function displayToBase(r, vw, vh, X, Y) {
		switch(r) {
			case 90:
				return [Y, vh - X];
			case 180:
				return [vw - X, vh - Y];
			case 270:
				return [vw - Y, X];
			default:
				return [X, Y];
		}
	}

	function canvasMatrix(r, vw, vh, s) {
		const m = r === 90 ? [0, 1, -1, 0, vh, 0] : r === 180 ? [-1, 0, 0, -1, vw, vh] : r === 270 ? [0, -1, 1, 0, 0, vw] : [1, 0, 0, 1, 0, 0];
		return m.map((v) => v * s);
	}

	function objPoint(o, lx, ly) {
		const t = (o.rot || 0) * Math.PI / 180,
			c = Math.cos(t),
			s = Math.sin(t);
		return [o.x + lx * c - ly * s, o.y + lx * s + ly * c];
	}

	function toLocal(o, px, py) {
		const t = -(o.rot || 0) * Math.PI / 180,
			c = Math.cos(t),
			s = Math.sin(t),
			dx = px - o.x,
			dy = py - o.y;
		return [dx * c - dy * s, dx * s + dy * c];
	}

	const LINE_HEIGHT = 1.2;
	const BASELINE = 0.95; 

	function textBaselineY(o, i) {
		return -o.h / 2 + i * LINE_HEIGHT * o.size + BASELINE * o.size;
	}

	function hexRgb(L, hex) {
		const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
		const n = m ? parseInt(m[1], 16) : 0;
		return L.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
	}

	async function drawObjects(L, page, objs, convert, res) {
		const degrees = L.degrees;

		function frame(o) {
			const p0 = convert.apply(null, objPoint(o, -o.w / 2, o.h / 2)),
				p1 = convert.apply(null, objPoint(o, o.w / 2, o.h / 2));
			return {
				x: p0[0],
				y: p0[1],
				angle: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI
			};
		}

		for(const o of objs) {
			if(o.type === 'cover' || o.type === 'highlight') {
				const f = frame(o),
					hl = o.type === 'highlight';
				const opts = {
					x: f.x,
					y: f.y,
					width: o.w,
					height: o.h,
					rotate: degrees(f.angle),
					color: hexRgb(L, o.color),
					opacity: hl ? 0.4 : 1
				};
				if(hl) opts.blendMode = L.BlendMode.Multiply;
				page.drawRectangle(opts);
			} else if(o.type === 'image') {
				const img = await res.image(o),
					f = frame(o);
				page.drawImage(img, {
					x: f.x,
					y: f.y,
					width: o.w,
					height: o.h,
					rotate: degrees(f.angle),
					opacity: o.opacity == null ? 1 : o.opacity
				});
			} else if(o.type === 'draw') {
				const pts = o.points.map((p) => convert(p[0], p[1])),
					color = hexRgb(L, o.color);
				if(pts.length === 1) page.drawCircle({
					x: pts[0][0],
					y: pts[0][1],
					size: o.width / 2,
					color: color
				});
				for(let i = 1; i < pts.length; i++) {
					page.drawLine({
						start: {
							x: pts[i - 1][0],
							y: pts[i - 1][1]
						},
						end: {
							x: pts[i][0],
							y: pts[i][1]
						},
						thickness: o.width,
						color: color,
						lineCap: L.LineCapStyle.Round
					});
				}
			} else if(o.type === 'text') {
				const color = hexRgb(L, o.color),
					f = frame(o),
					opacity = o.opacity == null ? 1 : o.opacity;
				let lines = null;
				try {
					lines = [];
					for(const line of o.text.split('\n')) lines.push(line ? await res.segments(o, line) : []);
				} catch(e) {
					lines = null;
				}
				if(!lines) {
					const img = await res.raster(o);
					page.drawImage(img, {
						x: f.x,
						y: f.y,
						width: o.w,
						height: o.h,
						rotate: degrees(f.angle),
						opacity: opacity
					});
				} else {
					lines.forEach((segs, i) => {
						const by = textBaselineY(o, i);
						let off = 0;
						segs.forEach((s) => {
							const p = convert.apply(null, objPoint(o, -o.w / 2 + off, by));
							page.drawText(s.text, {
								x: p[0],
								y: p[1],
								size: o.size,
								font: s.font,
								color: color,
								rotate: degrees(f.angle),
								opacity: opacity
							});
							off += s.font.widthOfTextAtSize(s.text, o.size);
						});
						if(o.underline && segs.length) {
							const uy = by + 0.14 * o.size,
								a = convert.apply(null, objPoint(o, -o.w / 2, uy)),
								b = convert.apply(null, objPoint(o, -o.w / 2 + off, uy));
							page.drawLine({
								start: {
									x: a[0],
									y: a[1]
								},
								end: {
									x: b[0],
									y: b[1]
								},
								thickness: Math.max(0.5, o.size / 16),
								color: color,
								opacity: opacity
							});
						}
					});
				}
				const url = normalizeUrl(o.link);
				if(url) { 
					const cs = [
						[-1, -1],
						[1, -1],
						[-1, 1],
						[1, 1]
					].map((c) => convert.apply(null, objPoint(o, c[0] * o.w / 2, c[1] * o.h / 2)));
					res.link(page, cs, url);
				}
			}
		}
	}

	const FONT_STACKS = {
		Helvetica: 'Helvetica, Arial, "Liberation Sans", sans-serif',
		Times: '"Times New Roman", Times, "Liberation Serif", serif',
		Courier: '"Courier New", Courier, "Liberation Mono", monospace'
	};

	function fontCss(o) {
		const v = fontVariant(o);
		const stack = v.entry ? '"' + v.entry.name.replace(/"/g, '') + '", ' + CAT_FALLBACK[v.entry.cat] : (FONT_STACKS[o.font] || FONT_STACKS.Helvetica);
		return(v.italic ? 'italic ' : '') + v.weight + ' ' + o.size + 'px ' + stack;
	}

	function pdfFontKey(o) {
		if(o.font === 'Times') return 'TimesRoman' + (o.bold ? 'Bold' : '') + (o.italic ? 'Italic' : '');
		return(o.font === 'Courier' ? 'Courier' : 'Helvetica') + (o.bold ? 'Bold' : '') + (o.italic ? 'Oblique' : '');
	}

	const WINANSI_EXTRA = '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';

	function winAnsiOk(text) {
		for(const ch of text) {
			const c = ch.codePointAt(0);
			if(ch === '\n' || ch === '\r') continue;
			if((c >= 0x20 && c <= 0x7E) || (c >= 0xA0 && c <= 0xFF) || WINANSI_EXTRA.indexOf(ch) !== -1) continue;
			return false;
		}
		return true;
	}

	function layoutText(o, measure) {
		const lines = o.text.split('\n');
		let w = 0;
		for(const l of lines) w = Math.max(w, measure(l || ' '));
		o.w = Math.max(8, w);
		o.h = lines.length * LINE_HEIGHT * o.size;
	}

	function distToSegment(px, py, ax, ay, bx, by) {
		const dx = bx - ax,
			dy = by - ay,
			len2 = dx * dx + dy * dy;
		const t = len2 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
		return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
	}

	function hitObject(o, px, py, tol) {
		if(o.type === 'draw') {
			const r = o.width / 2 + tol;
			if(o.points.length === 1) return Math.hypot(px - o.points[0][0], py - o.points[0][1]) <= r;
			for(let i = 1; i < o.points.length; i++) {
				if(distToSegment(px, py, o.points[i - 1][0], o.points[i - 1][1], o.points[i][0], o.points[i][1]) <= r) return true;
			}
			return false;
		}
		const l = toLocal(o, px, py);
		return Math.abs(l[0]) <= o.w / 2 + tol && Math.abs(l[1]) <= o.h / 2 + tol;
	}

	function objBounds(o) {
		let x0 = Infinity,
			y0 = Infinity,
			x1 = -Infinity,
			y1 = -Infinity;
		for(const p of o.points) {
			x0 = Math.min(x0, p[0]);
			y0 = Math.min(y0, p[1]);
			x1 = Math.max(x1, p[0]);
			y1 = Math.max(y1, p[1]);
		}
		const r = o.width / 2;
		return [x0 - r, y0 - r, x1 + r, y1 + r];
	}

	function normalizeUrl(raw) {
		const s = String(raw || '').trim();
		if(!s || /\s/.test(s)) return '';
		let u = '';
		if(/^(https?:|mailto:|tel:)/i.test(s)) u = s;
		else if(/^[a-z][a-z0-9+.\-]*:(?!\d)/i.test(s)) return '';
		else if(/^[^\s@\/]+@[^\s@\/]+\.[a-z]{2,}$/i.test(s)) u = 'mailto:' + s;
		else if(/^[^\s\/]+\.[^\s\/]{2,}/.test(s) || /^localhost(:\d+)?(\/|$)/i.test(s)) u = 'https://' + s;
		else return '';
		return u.replace(/[^\x21-\x7E]/g, (ch) => encodeURIComponent(ch));
	}

	const GF = new Map();
	if(typeof window !== 'undefined' && Array.isArray(window.GOOGLE_FONTS)) {
		window.GOOGLE_FONTS.forEach((r) => GF.set(r[0], {
			name: r[0],
			cat: r[1],
			reg: r[2] || 400,
			bold: r[3] || 0,
			ri: !!r[4],
			bi: !!r[5]
		}));
	}
	const CAT_FALLBACK = {
		s: 'sans-serif',
		f: 'serif',
		m: 'monospace',
		h: 'cursive',
		d: 'sans-serif'
	};

	function fontEntry(o) {
		return FONT_STACKS[o.font] ? null : (GF.get(o.font) || null);
	}

	function fontVariant(o) {
		const e = fontEntry(o);
		if(!e) return {
			entry: null,
			weight: o.bold ? 700 : 400,
			italic: !!o.italic
		};
		const useBold = !!(o.bold && e.bold);
		return {
			entry: e,
			weight: useBold ? e.bold : e.reg,
			italic: !!(o.italic && (useBold ? e.bi : e.ri))
		};
	}

	function canBold(o) {
		const e = fontEntry(o);
		return !e || !!o.bold || (!!e.bold && (!o.italic || e.bi));
	}

	function canItalic(o) {
		const e = fontEntry(o);
		return !e || !!o.italic || (e.ri && (!o.bold || e.bi));
	}

	function googleVariants(e) {
		const v = [
			[0, e.reg]
		];
		if(e.bold) v.push([0, e.bold]);
		if(e.ri) v.push([1, e.reg]);
		if(e.bi && e.bold) v.push([1, e.bold]);
		return v;
	}

	function googleCssUrl(e, variants) {
		const v = (variants || googleVariants(e)).slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		const fam = encodeURIComponent(e.name).replace(/%20/g, '+');
		let spec = '';
		if(v.some((x) => x[0])) spec = ':ital,wght@' + v.map((x) => x[0] + ',' + x[1]).join(';');
		else if(!(v.length === 1 && v[0][1] === 400)) spec = ':wght@' + Array.from(new Set(v.map((x) => x[1]))).join(';');
		return 'https://fonts.googleapis.com/css2?family=' + fam + spec + '&display=swap';
	}

	function parseUnicodeRange(str) {
		const out = [];
		String(str || '').split(',').forEach((part) => {
			const m = /U\+([0-9A-F?]+)(?:-([0-9A-F]+))?/i.exec(part.trim());
			if(!m) return;
			if(m[1].indexOf('?') !== -1) out.push([parseInt(m[1].replace(/\?/g, '0'), 16), parseInt(m[1].replace(/\?/g, 'F'), 16)]);
			else out.push([parseInt(m[1], 16), parseInt(m[2] || m[1], 16)]);
		});
		return out;
	}

	function inRanges(ranges, cp) {
		if(!ranges.length) return true;
		for(const r of ranges) {
			if(cp >= r[0] && cp <= r[1]) return true;
		}
		return false;
	}

	function parseFontFaces(css) {
		const faces = [],
			re = /@font-face\s*\{([^}]*)\}/g;
		let m;
		while((m = re.exec(css))) {
			const u = /src:[^;]*url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/.exec(m[1]),
				r = /unicode-range:\s*([^;]+);/.exec(m[1]);
			if(u) faces.push({
				url: u[1],
				ranges: r ? parseUnicodeRange(r[1]) : []
			});
		}
		return faces;
	}

	function mergeTextItems(items) {
		const runs = [];
		let cur = null;
		for(const it of items) {
			if(!it || typeof it.str !== 'string' || !it.transform) continue;
			const t = it.transform,
				size = Math.hypot(t[2], t[3]) || it.height || 0,
				len = Math.hypot(t[0], t[1]) || 1;
			if(!size) continue;
			const dx = t[0] / len,
				dy = t[1] / len;
			if(cur && !cur.eol && cur.fontName === it.fontName && Math.abs(cur.size - size) < 0.3 && Math.abs(cur.dx * dy - cur.dy * dx) < 0.01) {
				const rx = t[4] - cur.x,
					ry = t[5] - cur.y;
				const along = rx * cur.dx + ry * cur.dy,
					across = -rx * cur.dy + ry * cur.dx,
					gap = along - cur.width;
				if(Math.abs(across) < 0.4 && gap > -0.5 && gap < 0.9 * size) {
					const sp = gap > 0.22 * size && !/\s$/.test(cur.str) && !/^\s/.test(it.str) ? ' ' : '';
					cur.str += sp + it.str;
					cur.width = along + it.width;
					cur.eol = !!it.hasEOL;
					continue;
				}
			}
			cur = {
				str: it.str,
				x: t[4],
				y: t[5],
				dx: dx,
				dy: dy,
				size: size,
				width: it.width,
				fontName: it.fontName,
				eol: !!it.hasEOL
			};
			runs.push(cur);
		}
		return runs.filter((r) => r.str.trim());
	}

	const FONT_ALIASES = {
		calibri: 'Carlito',
		cambria: 'Caladea',
		segoeui: 'Open Sans',
		tahoma: 'Noto Sans',
		verdana: 'Noto Sans',
		georgia: 'Gelasio',
		garamond: 'EB Garamond',
		palatino: 'Palanquin',
		bookantiqua: 'Gelasio'
	};
	let gfIndex = null;

	function normFontName(s) {
		return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
	}

	function matchFont(raw, hints) {
		hints = hints || {};
		const n = String(raw || '').replace(/^[A-Z]{6}\+/, ''),
			cut = n.search(/[-,]/);
		const base = (cut >= 0 ? n.slice(0, cut) : n).replace(/(PSMT|MT|PS)$/, ''),
			style = cut >= 0 ? n.slice(cut + 1) : '';
		const bold = !!hints.bold || /bold|black|heavy|semibold|demi/i.test(style) || /bold$/i.test(base);
		const italic = !!hints.italic || /italic|oblique/i.test(style);
		const key = normFontName(base).replace(/(bold|italic|oblique|regular)+$/, '');
		let font = null;
		if(/^(arial|helvetica|liberationsans|arimo)/.test(key)) font = 'Helvetica';
		else if(/^(times|liberationserif|tinos)/.test(key)) font = 'Times';
		else if(/^(courier|liberationmono|cousine)/.test(key)) font = 'Courier';
		else if(FONT_ALIASES[key] && GF.has(FONT_ALIASES[key])) font = FONT_ALIASES[key];
		else {
			if(!gfIndex) {
				gfIndex = new Map();
				GF.forEach((e) => gfIndex.set(normFontName(e.name), e.name));
			}
			font = gfIndex.get(key) || null;
		}
		if(!font) font = hints.mono ? 'Courier' : (hints.serif ? 'Times' : 'Helvetica');
		return {
			font: font,
			bold: bold,
			italic: italic
		};
	}

	const $ = (id) => document.getElementById(id);
	const stage = $('peStage');
	const fileInput = $('peFileInput');
	const imageInput = $('peImageInput');
	const workspace = $('peWorkspace');
	const errBox = $('peErr');
	const statusEl = $('peStatus');
	const baseCv = $('peBase');
	const overCv = $('peOver');
	const bctx = baseCv.getContext('2d');
	const octx = overCv.getContext('2d');
	const pageBox = $('pePageBox');
	const canvasWrap = $('peCanvasWrap');
	const pagesEl = $('pePages');
	const undoBtn = $('peUndoBtn');
	const redoBtn = $('peRedoBtn');
	const prevBtn = $('pePrevBtn');
	const nextBtn = $('peNextBtn');
	const pageLabel = $('pePageLabel');
	const zoomLabel = $('peZoomLabel');
	const downloadBtn = $('peDownloadBtn');
	const hintEl = $('peHint');
	const P = {
		sig: $('peSigPanel'),
		rect: $('peRectPanel'),
		draw: $('peDrawPanel'),
		text: $('peTextPanel'),
		layer: $('peLayerPanel')
	};
	const C = { 
		sigPad: $('peSigPad'),
		sigColor: $('peSigColor'),
		rectColor: $('peRectColor'),
		drawColor: $('peDrawColor'),
		drawWidth: $('peDrawWidth'),
		drawWidthVal: $('peDrawWidthVal'),
		textValue: $('peTextValue'),
		size: $('peFontSize'),
		textColor: $('peTextColor'),
		bold: $('peBold'),
		italic: $('peItalic'),
		underline: $('peUnderline'),
		link: $('peLinkUrl'),
		linkNote: $('peLinkNote'),
		textNote: $('peTextNote'),
		layerTitle: $('peLayerTitle'),
		rotateRow: $('peRotateRow'),
		rotation: $('peRotation'),
		rotationVal: $('peRotationVal')
	};
	const measureCtx = document.createElement('canvas').getContext('2d');
	const state = {
		fileName: 'document',
		bytes: null,
		pdf: null,
		src: [],
		pages: [],
		cur: 0,
		tool: 'select',
		selectedId: null,
		nextId: 1,
		zoom: 1,
		dpr: 1,
		history: [],
		hIndex: -1,
		savedIndex: 0,
		drag: null,
		draft: null,
		picking: false,
		busy: false,
		dragPageId: null,
		styles: {
			text: {
				font: 'Helvetica',
				size: 14,
				color: '#111111',
				bold: false,
				italic: false,
				underline: false
			},
			cover: {
				color: '#FFFFFF'
			},
			highlight: {
				color: '#FFE600'
			},
			draw: {
				color: '#E03131',
				width: 3
			}
		},
		renderTask: null,
		renderToken: 0,
		hover: null
	};

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function setStatus(msg, kind) {
		statusEl.textContent = msg || '';
		statusEl.classList.toggle('is-error', kind === 'error');
		statusEl.classList.toggle('is-ok', kind === 'ok');
	}

	function show(el, on) {
		el.classList.toggle('is-hidden', !on);
	}

	function nid() {
		return state.nextId++;
	}

	function curRec() {
		return state.pages[state.cur] || null;
	}

	function getSelected() {
		const rec = curRec();
		return rec ? (rec.objects.find((o) => o.id === state.selectedId) || null) : null;
	}

	function readBuffer(blob) {
		return new Promise((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve(r.result);
			r.onerror = () => reject(new Error('Could not read the file.'));
			r.readAsArrayBuffer(blob);
		});
	}

	function canvasBytes(canvas, type, quality) {
		return new Promise((resolve, reject) => {
			canvas.toBlob((blob) => {
				if(!blob) {
					reject(new Error('Could not turn the picture into data.'));
					return;
				}
				readBuffer(blob).then((buf) => resolve(new Uint8Array(buf)), reject);
			}, type, quality);
		});
	}

	function loadImageEl(src) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('Could not open that picture.'));
			img.src = src;
		});
	}

	function libsOk() {
		return !!(window.pdfjsLib && window.PDFLib);
	}

	const STD_FONTS = [
		['Helvetica', 'Sans-serif (Helvetica)'],
		['Times', 'Serif (Times)'],
		['Courier', 'Monospace (Courier)']
	];

	const CAT_NAMES = {
		all: 'All',
		s: 'Sans',
		f: 'Serif',
		d: 'Display',
		h: 'Handwriting',
		m: 'Mono'
	};

	const cssLoaded = new Map(),
		previewLoaded = new Set();

	function loadFontCss(e) {
		if(!cssLoaded.has(e.name)) {
			cssLoaded.set(e.name, new Promise((resolve) => {
				const l = document.createElement('link');
				l.rel = 'stylesheet';
				l.href = googleCssUrl(e);
				l.onload = () => resolve(true);
				l.onerror = () => resolve(false);
				document.head.appendChild(l);
			}));
		}
		return cssLoaded.get(e.name);
	}

	function relayoutKeep(o) {
		const p = objPoint(o, -o.w / 2, -o.h / 2);
		layoutObj(o);
		const t = (o.rot || 0) * Math.PI / 180,
			c = Math.cos(t),
			s = Math.sin(t),
			lx = -o.w / 2,
			ly = -o.h / 2;
		o.x = p[0] - (lx * c - ly * s);
		o.y = p[1] - (lx * s + ly * c);
	}
	
	async function ensureFont(o) {
		const e = fontEntry(o);
		if(!e) return;
		try {
			await loadFontCss(e);
			await document.fonts.load(fontCss(o), o.text || ' ');
		} catch(x) {
			return;
		}
		state.pages.forEach((rec) => rec.objects.forEach((t) => {
			if(t.type === 'text' && t.font === e.name) relayoutKeep(t);
		}));
		drawOverlay();
	}
	const FP = {
		btn: $('peFontBtn'),
		label: $('peFontName'),
		menu: $('peFontMenu'),
		search: $('peFontSearch'),
		cats: $('peFontCats'),
		list: $('peFontList'),
		cat: 'all',
		rows: [],
		shown: 0,
		io: null
	};
	const FP_CHUNK = 60;

	function setFontLabel(name) {
		const std = STD_FONTS.find((f) => f[0] === name);
		FP.label.textContent = std ? std[1] : name;
		FP.current = name;
	}

	function fpFilter() {
		const q = FP.search.value.trim().toLowerCase(),
			rows = [];
		if(FP.cat === 'all') STD_FONTS.forEach((f) => {
			if(!q || f[1].toLowerCase().indexOf(q) !== -1) rows.push({
				name: f[0],
				label: f[1],
				std: true
			});
		});
		GF.forEach((e) => {
			if(FP.cat !== 'all' && e.cat !== FP.cat) return;
			if(q && e.name.toLowerCase().indexOf(q) === -1) return;
			rows.push({
				name: e.name,
				label: e.name,
				std: false
			});
		});
		FP.rows = rows;
		FP.shown = 0;
		FP.list.textContent = '';
		FP.list.scrollTop = 0;
		if(!rows.length) {
			const li = document.createElement('li');
			li.className = 'pe-fontempty';
			li.textContent = 'No fonts match.';
			FP.list.appendChild(li);
			return;
		}
		fpMore();
	}

	function fpMore() {
		const end = Math.min(FP.rows.length, FP.shown + FP_CHUNK);
		for(let i = FP.shown; i < end; i++) {
			const r = FP.rows[i],
				li = document.createElement('li');
			li.className = 'pe-fontitem' + (r.name === FP.current ? ' is-selected' : '');
			li.setAttribute('role', 'option');
			li.dataset.name = r.name;
			li.textContent = r.label;
			if(r.std) li.style.fontFamily = FONT_STACKS[r.name];
			else {
				li.style.fontFamily = '"pv ' + r.name + '", ' + CAT_FALLBACK[GF.get(r.name).cat];
				if(FP.io) FP.io.observe(li);
			}
			FP.list.appendChild(li);
		}
		FP.shown = end;
	}

	function fpPreview(name) {
		if(previewLoaded.has(name)) return;
		previewLoaded.add(name);
		const e = GF.get(name);
		const url = googleCssUrl(e, [
			[0, e.reg]
		]).replace('&display=swap', '') + '&text=' + encodeURIComponent(name) + '&display=swap';
		fetch(url).then((r) => r.ok ? r.text() : '').then((css) => {
			if(!css) return;
			const st = document.createElement('style');
			st.textContent = css.replace(/font-family:\s*['"][^'"]+['"]/g, 'font-family:"pv ' + name + '"');
			document.head.appendChild(st);
		}).catch(() => { });
	}
	if('IntersectionObserver' in window) {
		FP.io = new IntersectionObserver((entries) => entries.forEach((en) => {
			if(en.isIntersecting) {
				FP.io.unobserve(en.target);
				fpPreview(en.target.dataset.name);
			}
		}), {
			root: FP.list,
			rootMargin: '120px'
		});
	}

	function fpOpen(on) {
		show(FP.menu, on);
		FP.btn.setAttribute('aria-expanded', on ? 'true' : 'false');
		if(on) {
			FP.search.value = '';
			FP.cat = 'all';
			fpCatButtons();
			fpFilter();
			FP.search.focus();
		}
	}

	function fpCatButtons() {
		FP.cats.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.cat === FP.cat));
	}

	function chooseFont(name) {
		const o = getSelected();
		fpOpen(false);
		if(!o || o.type !== 'text') return;
		o.font = name;
		const e = fontEntry(o);
		if(e) {
			if(!e.bold) o.bold = false;
			if(!(o.bold ? e.bi : e.ri)) o.italic = false;
		}
		setStyle('text', {
			font: name,
			bold: o.bold,
			italic: o.italic
		});
		setFontLabel(name);
		syncFontButtons(o);
		relayoutKeep(o);
		drawOverlay();
		pushHistory();
		ensureFont(o);
	}

	(function initFontPicker() {
		FP.cats.textContent = '';
		Object.keys(CAT_NAMES).forEach((k) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'pe-fontcat';
			b.dataset.cat = k;
			b.textContent = CAT_NAMES[k];
			FP.cats.appendChild(b);
		});
		fpCatButtons();
		FP.search.placeholder = 'Search ' + GF.size.toLocaleString('en-US') + ' Google fonts';
		FP.btn.addEventListener('click', () => fpOpen(FP.menu.classList.contains('is-hidden')));
		FP.search.addEventListener('input', fpFilter);
		FP.search.addEventListener('keydown', (e) => {
			if(e.key === 'Escape') {
				e.stopPropagation();
				fpOpen(false);
				FP.btn.focus();
			} else if(e.key === 'Enter' && FP.rows[0]) {
				e.preventDefault();
				chooseFont(FP.rows[0].name);
			}
		});
		FP.cats.addEventListener('click', (e) => {
			const b = e.target.closest('button');
			if(!b) return;
			FP.cat = b.dataset.cat;
			fpCatButtons();
			fpFilter();
		});
		FP.list.addEventListener('click', (e) => {
			const li = e.target.closest('.pe-fontitem');
			if(li) chooseFont(li.dataset.name);
		});
		FP.list.addEventListener('scroll', () => {
			if(FP.shown < FP.rows.length && FP.list.scrollTop + FP.list.clientHeight > FP.list.scrollHeight - 120) fpMore();
		});
		document.addEventListener('pointerdown', (e) => {
			if(!FP.menu.classList.contains('is-hidden') && !e.target.closest('.pe-fontfield')) fpOpen(false);
		});
	})();

	function usedRuns(rec) {
		return new Set(rec.objects.filter((o) => o.srcRun).map((o) => o.srcRun));
	}

	async function loadRuns(info, srcIndex) {
		try {
			const tc = await info.page.getTextContent(),
				vp = info.viewport1;
			info.runStyles = tc.styles || {};
			info.runs = mergeTextItems(tc.items.filter((it) => !(tc.styles && tc.styles[it.fontName] && tc.styles[it.fontName].vertical))).map((r, i) => {
				const sty = info.runStyles[r.fontName] || {};
				const asc = clamp(sty.ascent || 0.9, 0.6, 1.1),
					desc = clamp(Math.abs(sty.descent || 0.22), 0.1, 0.4),
					pad = 1;
				const p0 = vp.convertToViewportPoint(r.x, r.y),
					p1 = vp.convertToViewportPoint(r.x + r.dx * r.width, r.y + r.dy * r.width);
				const rot = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI,
					t = rot * Math.PI / 180,
					c = Math.cos(t),
					s = Math.sin(t);
				const w = r.width + 2 * pad,
					h = (asc + desc) * r.size + 2 * pad,
					lx = r.width / 2,
					ly = (desc - asc) * r.size / 2;
				return {
					key: srcIndex + ':' + i,
					str: r.str.replace(/\s+$/, ''),
					size: r.size,
					fontName: r.fontName,
					rot: rot,
					start: p0,
					box: {
						x: p0[0] + lx * c - ly * s,
						y: p0[1] + lx * s + ly * c,
						w: w,
						h: h,
						rot: rot
					}
				};
			});
		} catch(e) {
			console.error(e);
			info.runs = [];
		}
	}

	async function ensureRuns() {
		const rec = curRec();
		if(!rec) return;
		const info = state.src[rec.src];
		if(!info.runs) {
			setStatus('Reading the page text\u2026');
			if(!info.runsPromise) info.runsPromise = loadRuns(info, rec.src);
			await info.runsPromise;
		}
		if(state.tool !== 'edittext' || curRec() !== rec) return;
		setStatus(info.runs.length ? '' : 'This page has no selectable text (it may be a scan).');
		drawOverlay();
	}

	function runAt(px, py) {
		const rec = curRec();
		if(!rec) return null;
		const info = state.src[rec.src];
		if(!info.runs) return null;
		const used = usedRuns(rec),
			tol = 2 / state.zoom;
		for(let i = info.runs.length - 1; i >= 0; i--) {
			const r = info.runs[i];
			if(!used.has(r.key) && hitObject(r.box, px, py, tol)) return r;
		}
		return null;
	}

	function pagePixel(rec, x, y) {
		const info = state.src[rec.src],
			d = baseToDisplay(rec.extra, info.vw, info.vh, x, y),
			k = state.zoom * state.dpr;
		const px = bctx.getImageData(clamp(Math.round(d[0] * k), 0, baseCv.width - 1), clamp(Math.round(d[1] * k), 0, baseCv.height - 1), 1, 1).data;
		return [px[0], px[1], px[2]];
	}

	function sampleBackground(rec, box) {
		const m = 3,
			xs = [-box.w / 2 - m, 0, box.w / 2 + m],
			ys = [-box.h / 2 - m, 0, box.h / 2 + m],
			pts = [];
		xs.forEach((lx) => ys.forEach((ly) => {
			if(lx !== 0 || ly !== 0) pts.push(pagePixel(rec, ...objPoint(box, lx, ly)));
		}));
		const med = (k) => pts.map((q) => q[k]).sort((a, b) => a - b)[pts.length >> 1];
		return [med(0), med(1), med(2)];
	}

	function sampleInk(rec, box, bg) {
		const info = state.src[rec.src],
			k = state.zoom * state.dpr,
			cs = [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1]
			].map((c) => {
				const b = objPoint(box, c[0] * box.w / 2, c[1] * box.h / 2),
					d = baseToDisplay(rec.extra, info.vw, info.vh, b[0], b[1]);
				return [d[0] * k, d[1] * k];
			});
		const x0 = clamp(Math.floor(Math.min(...cs.map((c) => c[0]))), 0, baseCv.width - 1),
			y0 = clamp(Math.floor(Math.min(...cs.map((c) => c[1]))), 0, baseCv.height - 1);
		const x1 = clamp(Math.ceil(Math.max(...cs.map((c) => c[0]))), x0 + 1, baseCv.width),
			y1 = clamp(Math.ceil(Math.max(...cs.map((c) => c[1]))), y0 + 1, baseCv.height);
		const data = bctx.getImageData(x0, y0, Math.min(x1 - x0, 900), Math.min(y1 - y0, 300)).data;
		let best = 0,
			ink = null;
		for(let i = 0; i < data.length; i += 4) {
			const dist = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
			if(dist > best) {
				best = dist;
				ink = [data[i], data[i + 1], data[i + 2]];
			}
		}
		return best < 60 || !ink ? null : ink;
	}

	const toHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

	function editRun(run) {
		const rec = curRec(),
			info = state.src[rec.src];
		if(state.renderTask) {
			setStatus('The page is still drawing. Try again in a moment.', 'error');
			return;
		}
		let font = null;
		try {
			font = info.page.commonObjs.get(run.fontName);
		} catch(e) { }
		const sty = (info.runStyles || {})[run.fontName] || {},
			family = String(sty.fontFamily || '');
		const m = matchFont((font && (font.name || font.fallbackName)) || '', {
			bold: !!(font && font.bold),
			italic: !!(font && font.italic),
			mono: !!(font && font.isMonospace) || /mono|courier/i.test(family),
			serif: !!(font && font.isSerifFont) || family === 'serif'
		});
		const bg = sampleBackground(rec, run.box),
			ink = sampleInk(rec, run.box, bg);
		const cover = {
			id: nid(),
			type: 'cover',
			x: run.box.x,
			y: run.box.y,
			w: run.box.w,
			h: run.box.h,
			rot: run.box.rot,
			color: toHex(bg),
			srcRun: run.key
		};
		const o = {
			id: nid(),
			type: 'text',
			text: run.str,
			font: m.font,
			size: Math.round(run.size * 10) / 10,
			color: ink ? toHex(ink) : '#111111',
			bold: m.bold,
			italic: m.italic,
			underline: false,
			link: '',
			rot: run.rot,
			opacity: 1,
			x: 0,
			y: 0,
			w: 0,
			h: 0
		};
		const e = fontEntry(o);
		if(e) {
			if(!e.bold) o.bold = false;
			if(!(o.bold ? e.bi : e.ri)) o.italic = false;
		}
		layoutObj(o);
		const lx = -o.w / 2,
			ly = textBaselineY(o, 0),
			t = o.rot * Math.PI / 180,
			c = Math.cos(t),
			s = Math.sin(t);
		o.x = run.start[0] - (lx * c - ly * s);
		o.y = run.start[1] - (lx * s + ly * c);
		rec.objects.push(cover, o);
		state.selectedId = o.id;
		pushHistory();
		setTool('select');
		setStatus('');
		ensureFont(o);
	}

	function cloneObj(o) {
		const c = Object.assign({}, o);
		if(o.points) c.points = o.points.map((p) => p.slice());
		return c;
	}

	function snapshot() {
		return {
			pages: state.pages.map((r) => ({
				id: r.id,
				src: r.src,
				extra: r.extra,
				objects: r.objects.map(cloneObj)
			})),
			cur: state.cur,
			sel: state.selectedId
		};
	}

	function pushHistory() {
		state.history.length = state.hIndex + 1;
		state.history.push(snapshot());
		if(state.history.length > HISTORY_LIMIT) {
			state.history.shift();
			state.savedIndex--;
		}
		state.hIndex = state.history.length - 1;
		updateHistoryButtons();
	}

	function restore(entry) {
		state.pages = entry.pages.map((r) => ({
			id: r.id,
			src: r.src,
			extra: r.extra,
			objects: r.objects.map(cloneObj)
		}));
		state.cur = clamp(entry.cur, 0, state.pages.length - 1);
		state.selectedId = curRec().objects.some((o) => o.id === entry.sel) ? entry.sel : null;
		state.drag = null;
		state.draft = null;
		updateHistoryButtons();
		rebuildSidebar();
		syncPanel();
		renderPage();
	}

	function undo() {
		if(state.hIndex > 0) {
			state.hIndex--;
			restore(state.history[state.hIndex]);
		}
	}

	function redo() {
		if(state.hIndex < state.history.length - 1) {
			state.hIndex++;
			restore(state.history[state.hIndex]);
		}
	}

	function updateHistoryButtons() {
		undoBtn.disabled = state.hIndex <= 0;
		redoBtn.disabled = state.hIndex >= state.history.length - 1;
	}

	function isDirty() {
		return state.pages.length > 0 && state.hIndex !== state.savedIndex;
	}

	function layoutObj(o) { // size of a text box from its text
		measureCtx.font = fontCss(o);
		layoutText(o, (s) => measureCtx.measureText(s).width);
	}

	function fitZoom() {
		const rec = curRec();
		if(!rec) return 1;
		const info = state.src[rec.src];
		const dw = displayedSize(rec.extra, info.vw, info.vh)[0];
		const avail = (canvasWrap.clientWidth || 800) - 36;
		return clamp(avail / dw, 0.3, 3);
	}

	function setZoom(z) {
		state.zoom = clamp(z, 0.25, 4);
		zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
		renderPage();
	}

	async function renderPage() {
		const rec = curRec();
		if(!rec) return;
		const token = ++state.renderToken;
		const info = state.src[rec.src];
		if(state.tool === 'edittext') ensureRuns();
		state.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
		const vp = info.page.getViewport({
			scale: state.zoom * state.dpr,
			rotation: (info.native + rec.extra) % 360
		});
		const w = Math.max(1, Math.round(vp.width)),
			h = Math.max(1, Math.round(vp.height));
		if(state.renderTask) {
			try {
				state.renderTask.cancel();
			} catch(e) { }
			try {
				await state.renderTask.promise;
			} catch(e) { }
			state.renderTask = null;
		}
		if(token !== state.renderToken) return; 
		baseCv.width = overCv.width = w;
		baseCv.height = overCv.height = h;
		const cssW = (w / state.dpr) + 'px',
			cssH = (h / state.dpr) + 'px';
		pageBox.style.width = baseCv.style.width = overCv.style.width = cssW;
		pageBox.style.height = baseCv.style.height = overCv.style.height = cssH;
		bctx.fillStyle = '#FFFFFF';
		bctx.fillRect(0, 0, w, h);
		drawOverlay(); 
		const task = info.page.render({
			canvasContext: bctx,
			viewport: vp
		});
		state.renderTask = task;
		try {
			await task.promise;
		} catch(e) {
			if(e && e.name === 'RenderingCancelledException') return;
			console.error(e);
			showError('Could not draw this page.');
		}
		if(state.renderTask === task) state.renderTask = null;
	}

	function drawObject(ctx, o) {
		ctx.save();
		if(o.type === 'draw') {
			ctx.strokeStyle = ctx.fillStyle = o.color;
			ctx.lineWidth = o.width;
			ctx.lineCap = ctx.lineJoin = 'round';
			if(o.points.length === 1) {
				ctx.beginPath();
				ctx.arc(o.points[0][0], o.points[0][1], o.width / 2, 0, Math.PI * 2);
				ctx.fill();
			} else {
				ctx.beginPath();
				ctx.moveTo(o.points[0][0], o.points[0][1]);
				for(let i = 1; i < o.points.length; i++) ctx.lineTo(o.points[i][0], o.points[i][1]);
				ctx.stroke();
			}
		} else {
			ctx.translate(o.x, o.y);
			ctx.rotate((o.rot || 0) * Math.PI / 180);
			if(o.type === 'cover') {
				ctx.fillStyle = o.color;
				ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
			} else if(o.type === 'highlight') {
				ctx.globalAlpha = 0.4;
				ctx.fillStyle = o.color;
				ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
			} else if(o.type === 'image') {
				ctx.globalAlpha = o.opacity == null ? 1 : o.opacity;
				ctx.drawImage(o.asset.canvas, -o.w / 2, -o.h / 2, o.w, o.h);
			} else if(o.type === 'text') {
				ctx.font = fontCss(o);
				ctx.fillStyle = o.color;
				ctx.textAlign = 'left';
				ctx.textBaseline = 'alphabetic';
				o.text.split('\n').forEach((line, i) => ctx.fillText(line, -o.w / 2, textBaselineY(o, i)));
			}
		}
		ctx.restore();
	}

	function drawSelection(ctx, o) {
		const u = 1 / state.zoom;
		ctx.save();
		ctx.lineWidth = 1.5 * u;
		ctx.strokeStyle = '#FF6224';
		ctx.setLineDash([6 * u, 4 * u]);
		if(o.type === 'draw') {
			const b = objBounds(o);
			ctx.strokeRect(b[0] - 3 * u, b[1] - 3 * u, b[2] - b[0] + 6 * u, b[3] - b[1] + 6 * u);
		} else {
			ctx.translate(o.x, o.y);
			ctx.rotate((o.rot || 0) * Math.PI / 180);
			ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
			ctx.setLineDash([]);
			const hs = HANDLE * u;
			for(const c of[[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
				ctx.fillStyle = '#FFFFFF';
				ctx.fillRect(c[0] * o.w / 2 - hs / 2, c[1] * o.h / 2 - hs / 2, hs, hs);
				ctx.strokeRect(c[0] * o.w / 2 - hs / 2, c[1] * o.h / 2 - hs / 2, hs, hs);
			}
		}
		ctx.restore();
	}

	function drawDraft(ctx, d) {
		if(d.type === 'draw') {
			drawObject(ctx, {
				type: 'draw',
				points: d.points,
				color: d.color,
				width: d.width
			});
		} else {
			const x = Math.min(d.x0, d.x1),
				y = Math.min(d.y0, d.y1),
				w = Math.abs(d.x1 - d.x0),
				h = Math.abs(d.y1 - d.y0);
			drawObject(ctx, {
				type: d.type,
				x: x + w / 2,
				y: y + h / 2,
				w: w,
				h: h,
				rot: 0,
				color: d.color
			});
			ctx.save();
			ctx.strokeStyle = '#FF6224';
			ctx.lineWidth = 1 / state.zoom;
			ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
			ctx.strokeRect(x, y, w, h);
			ctx.restore();
		}
	}

	function drawOverlay() {
		const rec = curRec();
		if(!rec) return;
		const info = state.src[rec.src];
		octx.setTransform(1, 0, 0, 1, 0, 0);
		octx.clearRect(0, 0, overCv.width, overCv.height);
		const m = canvasMatrix(rec.extra, info.vw, info.vh, state.zoom * state.dpr);
		octx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
		rec.objects.forEach((o) => drawObject(octx, o));
		if(state.tool === 'edittext' && info.runs) { 
			const used = usedRuns(rec);
			info.runs.forEach((r) => {
				if(used.has(r.key)) return;
				const b = r.box,
					hot = r === state.hover;
				octx.save();
				octx.translate(b.x, b.y);
				octx.rotate((b.rot || 0) * Math.PI / 180);
				octx.fillStyle = hot ? 'rgba(255,98,36,0.22)' : 'rgba(255,98,36,0.07)';
				octx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
				if(hot) {
					octx.strokeStyle = '#FF6224';
					octx.lineWidth = 1.5 / state.zoom;
					octx.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
				}
				octx.restore();
			});
		}
		if(state.draft) drawDraft(octx, state.draft);
		const sel = getSelected();
		if(sel) drawSelection(octx, sel);
	}

	const thumbCache = new Map();
	let thumbChain = Promise.resolve();

	function thumbKey(rec) {
		return rec.src + ':' + ((state.src[rec.src].native + rec.extra) % 360);
	}

	async function renderThumb(rec, canvas) {
		if(!canvas.isConnected) return; // the strip was rebuilt in the meantime
		const key = thumbKey(rec),
			cached = thumbCache.get(key);
		if(cached) {
			canvas.getContext('2d').drawImage(cached, 0, 0, canvas.width, canvas.height);
			return;
		}
		const info = state.src[rec.src];
		const scale = THUMB_WIDTH / displayedSize(rec.extra, info.vw, info.vh)[0];
		const vp = info.page.getViewport({
			scale: scale,
			rotation: (info.native + rec.extra) % 360
		});
		const c = document.createElement('canvas');
		c.width = Math.max(1, Math.round(vp.width));
		c.height = Math.max(1, Math.round(vp.height));
		const x = c.getContext('2d');
		x.fillStyle = '#FFFFFF';
		x.fillRect(0, 0, c.width, c.height);
		try {
			await info.page.render({
				canvasContext: x,
				viewport: vp
			}).promise;
		} catch(e) {
			return;
		}
		thumbCache.set(key, c);
		if(canvas.isConnected) canvas.getContext('2d').drawImage(c, 0, 0, canvas.width, canvas.height);
	}

	function rebuildSidebar() {
		pagesEl.textContent = '';
		const n = state.pages.length;
		state.pages.forEach((rec, i) => {
			const info = state.src[rec.src];
			const item = document.createElement('div');
			item.className = 'pe-thumb' + (i === state.cur ? ' is-current' : '');
			item.draggable = true;
			item.dataset.id = rec.id;
			const cv = document.createElement('canvas');
			const [dw, dh] = displayedSize(rec.extra, info.vw, info.vh), s = THUMB_WIDTH / dw;
			cv.width = Math.max(1, Math.round(dw * s));
			cv.height = Math.max(1, Math.round(dh * s));
			item.appendChild(cv);
			const bar = document.createElement('div');
			bar.className = 'pe-thumb-bar';
			const num = document.createElement('span');
			num.className = 'pe-thumb-n';
			num.textContent = String(i + 1);
			bar.appendChild(num);
			const btns = document.createElement('span');
			btns.className = 'pe-thumb-btns';
			[
				['left', '\u21BA', 'Rotate left'],
				['right', '\u21BB', 'Rotate right'],
				['up', '\u2191', 'Move up'],
				['down', '\u2193', 'Move down'],
				['del', '\u2715', 'Delete page']
			].forEach((b) => {
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.className = 'pe-icon';
				btn.dataset.act = b[0];
				btn.title = b[2];
				btn.setAttribute('aria-label', b[2]);
				btn.textContent = b[1];
				if((b[0] === 'up' && i === 0) || (b[0] === 'down' && i === n - 1) || (b[0] === 'del' && n === 1)) btn.disabled = true;
				btns.appendChild(btn);
			});
			bar.appendChild(btns);
			item.appendChild(bar);
			pagesEl.appendChild(item);
			thumbChain = thumbChain.then(() => renderThumb(rec, cv)).catch(() => {});
		});
		updatePageNav();
	}

	function updatePageNav() {
		pageLabel.textContent = 'Page ' + (state.cur + 1) + ' of ' + state.pages.length;
		prevBtn.disabled = state.cur <= 0;
		nextBtn.disabled = state.cur >= state.pages.length - 1;
	}

	function goToPage(i) {
		if(i < 0 || i >= state.pages.length) return;
		state.cur = i;
		state.selectedId = null;
		state.draft = null;
		pagesEl.querySelectorAll('.pe-thumb').forEach((el, k) => el.classList.toggle('is-current', k === i));
		updatePageNav();
		syncPanel();
		renderPage();
	}

	function afterPageChange(newCur) {
		state.cur = clamp(newCur, 0, state.pages.length - 1);
		state.selectedId = null;
		pushHistory();
		rebuildSidebar();
		syncPanel();
		renderPage();
	}

	function rotatePage(i, dir) {
		const rec = state.pages[i];
		if(!rec) return;
		rec.extra = (rec.extra + dir * 90 + 360) % 360;
		afterPageChange(i === state.cur ? i : state.cur);
	}

	function deletePage(i) {
		if(state.pages.length <= 1) return;
		state.pages.splice(i, 1);
		afterPageChange(i < state.cur ? state.cur - 1 : (i === state.cur ? Math.min(i, state.pages.length - 1) : state.cur));
	}

	function movePage(from, to) {
		if(to < 0 || to >= state.pages.length || from === to) return;
		const curId = curRec().id;
		const rec = state.pages.splice(from, 1)[0];
		state.pages.splice(to, 0, rec);
		afterPageChange(state.pages.findIndex((r) => r.id === curId));
	}

	pagesEl.addEventListener('click', (e) => {
		const item = e.target.closest('.pe-thumb');
		if(!item) return;
		const i = state.pages.findIndex((r) => String(r.id) === item.dataset.id);
		const btn = e.target.closest('button');
		if(!btn) {
			goToPage(i);
			return;
		}
		if(btn.disabled) return;
		switch(btn.dataset.act) {
			case 'left':
				rotatePage(i, -1);
				break;
			case 'right':
				rotatePage(i, 1);
				break;
			case 'up':
				movePage(i, i - 1);
				break;
			case 'down':
				movePage(i, i + 1);
				break;
			case 'del':
				deletePage(i);
				break;
		}
	});

	pagesEl.addEventListener('dragstart', (e) => {
		const item = e.target.closest('.pe-thumb');
		if(!item) return;
		state.dragPageId = item.dataset.id;
		if(e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			try {
				e.dataTransfer.setData('text/plain', item.dataset.id);
			} catch(x) { }
		}
	});

	pagesEl.addEventListener('dragover', (e) => {
		const item = e.target.closest('.pe-thumb');
		if(!item || state.dragPageId === null) return;
		e.preventDefault();
		pagesEl.querySelectorAll('.is-over').forEach((el) => {
			if(el !== item) el.classList.remove('is-over');
		});
		item.classList.add('is-over');
	});

	pagesEl.addEventListener('drop', (e) => {
		const item = e.target.closest('.pe-thumb');
		if(!item || state.dragPageId === null) return;
		e.preventDefault();
		const from = state.pages.findIndex((r) => String(r.id) === state.dragPageId),
			to = state.pages.findIndex((r) => String(r.id) === item.dataset.id);
		state.dragPageId = null;
		movePage(from, to);
	});

	pagesEl.addEventListener('dragend', () => {
		state.dragPageId = null;
		pagesEl.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));
	});

	const HINTS = {
		select: 'Click something you added to move, resize or edit it. Use the tools above to add text, cover, highlight, draw or sign.',
		text: 'Click on the page where you want to type.',
		edittext: 'Click any text that is already in the PDF. It becomes a text box you can move, edit and restyle. The spot it came from is covered with the page color.',
		cover: 'Drag a box over anything you want to hide. It paints over the PDF with a solid color. Use "Pick from page" to match the paper color.',
		highlight: 'Drag over the text you want to highlight.',
		draw: 'Click and drag on the page to draw.',
		signature: 'Draw your signature in the box, then press "Place on page". You can move and resize it afterwards.'
	};

	function setTool(tool) {
		state.tool = tool;
		state.hover = null;
		if(tool === 'edittext') ensureRuns();
		state.picking = false;
		state.draft = null;
		document.querySelectorAll('#peTools .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
		if(tool !== 'select' && tool !== 'signature') state.selectedId = null;
		syncPanel();
		updateCursor();
		drawOverlay();
	}

	function updateCursor() {
		overCv.classList.toggle('cursor-cross', state.picking || state.tool === 'cover' || state.tool === 'highlight' || state.tool === 'draw');
		overCv.classList.toggle('cursor-text', !state.picking && (state.tool === 'text' || state.tool === 'edittext'));
	}

	function syncPanel() {
		const sel = getSelected(),
			tool = state.tool;
		const rectish = tool === 'cover' || tool === 'highlight' || (sel && (sel.type === 'cover' || sel.type === 'highlight'));
		const drawish = tool === 'draw' || (sel && sel.type === 'draw');
		show(P.sig, tool === 'signature');
		show(P.rect, !!rectish);
		show(P.draw, !!drawish);
		show(P.text, !!(sel && sel.type === 'text'));
		show(P.layer, !!sel);
		show(hintEl, !sel && !rectish && !drawish && tool !== 'signature');
		hintEl.textContent = HINTS[tool] || HINTS.select;
		if(rectish) {
			const type = sel && (sel.type === 'cover' || sel.type === 'highlight') ? sel.type : tool;
			C.rectColor.value = sel && sel.color && (sel.type === 'cover' || sel.type === 'highlight') ? sel.color : state.styles[type].color;
		}
		if(drawish) {
			const src = sel && sel.type === 'draw' ? sel : state.styles.draw;
			C.drawColor.value = src.color;
			C.drawWidth.value = src.width;
			C.drawWidthVal.textContent = src.width;
		}
		if(sel) {
			C.layerTitle.textContent = {
				text: 'Text',
				image: 'Picture',
				cover: 'Cover box',
				highlight: 'Highlight',
				draw: 'Drawing'
			}[sel.type];
			const canRotate = sel.type === 'text' || sel.type === 'image';
			show(C.rotateRow, canRotate);
			if(canRotate) {
				C.rotation.value = Math.round(sel.rot || 0);
				C.rotationVal.textContent = Math.round(sel.rot || 0) + '\u00B0';
			}
			if(sel.type === 'text') {
				C.textValue.value = sel.text;
				setFontLabel(sel.font);
				C.size.value = sel.size;
				C.textColor.value = sel.color;
				C.underline.classList.toggle('is-active', !!sel.underline);
				C.link.value = sel.link || '';
				syncFontButtons(sel);
				updateLinkNote(sel);
				updateTextNote(sel);
			}
		}
	}

	function updateTextNote(o) {
		show(C.textNote, !fontEntry(o) && !winAnsiOk(o.text));
	}

	function updateLinkNote(o) {
		const raw = (o.link || '').trim(),
			url = normalizeUrl(raw);
		show(C.linkNote, !!raw);
		C.linkNote.classList.toggle('is-error', !!raw && !url);
		C.linkNote.textContent = !raw ? '' : (url ? 'Clicking this text in the saved PDF opens ' + url : 'Use a web address, an email address or a phone number (tel:).');
	}

	function syncFontButtons(o) {
		C.bold.classList.toggle('is-active', !!o.bold);
		C.italic.classList.toggle('is-active', !!o.italic);
		C.bold.disabled = !canBold(o);
		C.italic.disabled = !canItalic(o);
	}

	function select(id) {
		state.selectedId = id;
		syncPanel();
		drawOverlay();
	}

	function addObject(o) {
		curRec().objects.push(o);
		state.selectedId = o.id;
		pushHistory();
		syncPanel();
		drawOverlay();
	}

	function edit(fn) {
		const o = getSelected();
		if(!o) return;
		fn(o);
		drawOverlay();
	}

	function setStyle(key, props) {
		Object.assign(state.styles[key], props);
	}

	C.textValue.addEventListener('input', () => edit((o) => {
		if(o.type !== 'text') return;
		o.text = C.textValue.value;
		layoutObj(o);
		updateTextNote(o);
		ensureFont(o);
	}));

	C.size.addEventListener('input', () => edit((o) => {
		if(o.type !== 'text') return;
		o.size = clamp(parseFloat(C.size.value) || o.size, 4, 400);
		setStyle('text', {
			size: o.size
		});
		layoutObj(o);
	}));

	C.textColor.addEventListener('input', () => edit((o) => {
		if(o.type !== 'text') return;
		o.color = C.textColor.value;
		setStyle('text', {
			color: o.color
		});
	}));

	C.bold.addEventListener('click', () => {
		edit((o) => {
			if(o.type !== 'text') return;
			o.bold = !o.bold;
			setStyle('text', {
				bold: o.bold
			});
			syncFontButtons(o);
			layoutObj(o);
			ensureFont(o);
		});
		pushHistory();
	});

	C.italic.addEventListener('click', () => {
		edit((o) => {
			if(o.type !== 'text') return;
			o.italic = !o.italic;
			setStyle('text', {
				italic: o.italic
			});
			syncFontButtons(o);
			layoutObj(o);
			ensureFont(o);
		});
		pushHistory();
	});

	C.underline.addEventListener('click', () => {
		edit((o) => {
			if(o.type !== 'text') return;
			o.underline = !o.underline;
			setStyle('text', {
				underline: o.underline
			});
			C.underline.classList.toggle('is-active', o.underline);
		});
		pushHistory();
	});

	C.link.addEventListener('input', () => edit((o) => {
		if(o.type !== 'text') return;
		o.link = C.link.value;
		updateLinkNote(o);
	}));

	C.rectColor.addEventListener('input', () => {
		const o = getSelected();
		if(o && (o.type === 'cover' || o.type === 'highlight')) {
			o.color = C.rectColor.value;
			setStyle(o.type, {
				color: o.color
			});
			drawOverlay();
		} else if(state.tool === 'cover' || state.tool === 'highlight') setStyle(state.tool, {
			color: C.rectColor.value
		});
	});

	C.drawColor.addEventListener('input', () => {
		setStyle('draw', {
			color: C.drawColor.value
		});
		edit((o) => {
			if(o.type === 'draw') o.color = C.drawColor.value;
		});
	});

	C.drawWidth.addEventListener('input', () => {
		const w = parseInt(C.drawWidth.value, 10) || 3;
		C.drawWidthVal.textContent = w;
		setStyle('draw', {
			width: w
		});
		edit((o) => {
			if(o.type === 'draw') o.width = w;
		});
	});

	C.rotation.addEventListener('input', () => edit((o) => {
		o.rot = parseInt(C.rotation.value, 10) || 0;
		C.rotationVal.textContent = o.rot + '\u00B0';
	}));

	[P.text, P.rect, P.draw, P.layer].forEach((panel) => panel.addEventListener('change', () => pushHistory()));
	$('peDupBtn').addEventListener('click', () => {
		const o = getSelected();
		if(!o) return;
		const c = cloneObj(o);
		c.id = nid();
		if(c.points) c.points = c.points.map((p) => [p[0] + 12, p[1] + 12]);
		else {
			c.x += 12;
			c.y += 12;
		}
		addObject(c);
	});

	$('peDeleteBtn').addEventListener('click', deleteSelected);

	function deleteSelected() {
		const rec = curRec(),
			o = getSelected();
		if(!o) return;
		rec.objects = rec.objects.filter((x) => x.id !== o.id);
		state.selectedId = null;
		pushHistory();
		syncPanel();
		drawOverlay();
	}

	function reorder(dir) {
		const rec = curRec(),
			o = getSelected();
		if(!o) return;
		const i = rec.objects.indexOf(o),
			j = i + dir;
		if(j < 0 || j >= rec.objects.length) return;
		rec.objects.splice(i, 1);
		rec.objects.splice(j, 0, o);
		pushHistory();
		drawOverlay();
	}
	$('peForwardBtn').addEventListener('click', () => reorder(1));
	$('peBackBtn').addEventListener('click', () => reorder(-1));

	function toBase(e) {
		const rec = curRec(),
			info = state.src[rec.src],
			r = overCv.getBoundingClientRect();
		return displayToBase(rec.extra, info.vw, info.vh, (e.clientX - r.left) / state.zoom, (e.clientY - r.top) / state.zoom);
	}

	function hitHandle(o, bx, by) {
		if(o.type === 'draw') return -1;
		const tol = HANDLE / state.zoom,
			l = toLocal(o, bx, by),
			cs = [
				[-1, -1],
				[1, -1],
				[1, 1],
				[-1, 1]
			];
		for(let i = 0; i < 4; i++) {
			if(Math.abs(l[0] - cs[i][0] * o.w / 2) <= tol && Math.abs(l[1] - cs[i][1] * o.h / 2) <= tol) return i;
		}
		return -1;
	}

	function topObjectAt(bx, by) {
		const objs = curRec().objects,
			tol = 3 / state.zoom;
		for(let i = objs.length - 1; i >= 0; i--) {
			if(hitObject(objs[i], bx, by, tol)) return objs[i];
		}
		return null;
	}

	function pickColorAt(e) {
		const r = overCv.getBoundingClientRect(),
			x = Math.floor((e.clientX - r.left) * state.dpr),
			y = Math.floor((e.clientY - r.top) * state.dpr);
		const px = bctx.getImageData(clamp(x, 0, baseCv.width - 1), clamp(y, 0, baseCv.height - 1), 1, 1).data;
		const hex = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
		const o = getSelected(),
			type = o && (o.type === 'cover' || o.type === 'highlight') ? o.type : (state.tool === 'highlight' ? 'highlight' : 'cover');
		setStyle(type, {
			color: hex
		});
		C.rectColor.value = hex;
		if(o && o.type === type) {
			o.color = hex;
			pushHistory();
		}
		state.picking = false;
		updateCursor();
		drawOverlay();
	}

	overCv.addEventListener('pointerdown', (e) => {
		if(!curRec() || state.busy) return;
		if(overCv.setPointerCapture) {
			try {
				overCv.setPointerCapture(e.pointerId);
			} catch(x) { }
		}
		if(state.picking) {
			pickColorAt(e);
			return;
		}
		const p = toBase(e),
			tool = state.tool;
		if(tool === 'edittext') {
			const run = runAt(p[0], p[1]);
			if(run) editRun(run);
			return;
		}
		if(tool === 'text') {
			const st = state.styles.text;
			const o = {
				id: nid(),
				type: 'text',
				text: 'Text',
				font: st.font,
				size: st.size,
				color: st.color,
				bold: st.bold,
				italic: st.italic,
				underline: !!st.underline,
				link: '',
				rot: 0,
				opacity: 1,
				x: 0,
				y: 0,
				w: 0,
				h: 0
			};
			layoutObj(o);
			ensureFont(o);
			o.x = p[0] + o.w / 2;
			o.y = p[1] + o.h / 2;
			curRec().objects.push(o);
			state.selectedId = o.id;
			pushHistory();
			setTool('select');
			C.textValue.focus();
			C.textValue.select();
			return;
		}
		if(tool === 'cover' || tool === 'highlight') {
			state.draft = {
				type: tool,
				x0: p[0],
				y0: p[1],
				x1: p[0],
				y1: p[1],
				color: state.styles[tool].color
			};
			return;
		}
		if(tool === 'draw') {
			state.draft = {
				type: 'draw',
				points: [p],
				color: state.styles.draw.color,
				width: state.styles.draw.width
			};
			drawOverlay();
			return;
		}

		const sel = getSelected();
		if(sel) {
			const h = hitHandle(sel, p[0], p[1]);
			if(h >= 0) {
				const l = toLocal(sel, p[0], p[1]),
					cs = [
						[-1, -1],
						[1, -1],
						[1, 1],
						[-1, 1]
					][h];
				state.drag = {
					mode: 'resize',
					o: sel,
					handle: h,
					d0: Math.max(1, Math.hypot(l[0], l[1])),
					size0: sel.size,
					w0: sel.w,
					h0: sel.h,
					fixed: objPoint(sel, -cs[0] * sel.w / 2, -cs[1] * sel.h / 2),
					changed: false
				};
				return;
			}
		}

		const hit = topObjectAt(p[0], p[1]);
		if(hit) {
			select(hit.id);
			state.drag = {
				mode: 'move',
				o: hit,
				start: p,
				x0: hit.x,
				y0: hit.y,
				pts0: hit.points ? hit.points.map((q) => q.slice()) : null,
				changed: false
			};
		} else if(state.selectedId !== null) {
			select(null);
		}
	});

	overCv.addEventListener('pointermove', (e) => {
		if(!curRec()) return;
		const p = toBase(e),
			d = state.drag;
		if(state.tool === 'edittext') {
			const r = runAt(p[0], p[1]);
			if(r !== state.hover) {
				state.hover = r;
				drawOverlay();
			}
			return;
		}
		if(state.draft) {
			const dr = state.draft;
			if(dr.type === 'draw') {
				const last = dr.points[dr.points.length - 1];
				if(Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.8) dr.points.push(p);
			} else {
				dr.x1 = p[0];
				dr.y1 = p[1];
			}
			drawOverlay();
			return;
		}
		if(d) {
			d.changed = true;
			const o = d.o;
			if(d.mode === 'move') {
				const dx = p[0] - d.start[0],
					dy = p[1] - d.start[1];
				if(d.pts0) o.points = d.pts0.map((q) => [q[0] + dx, q[1] + dy]);
				else {
					o.x = d.x0 + dx;
					o.y = d.y0 + dy;
				}
			} else if(o.type === 'cover' || o.type === 'highlight') {
				o.x = (p[0] + d.fixed[0]) / 2;
				o.y = (p[1] + d.fixed[1]) / 2;
				o.w = Math.max(2, Math.abs(p[0] - d.fixed[0]));
				o.h = Math.max(2, Math.abs(p[1] - d.fixed[1]));
			} else {
				const l = toLocal(o, p[0], p[1]),
					k = clamp(Math.hypot(l[0], l[1]) / d.d0, 0.05, 40);
				if(o.type === 'text') {
					o.size = clamp(Math.round(d.size0 * k * 10) / 10, 4, 400);
					layoutObj(o);
					C.size.value = o.size;
					setStyle('text', {
						size: o.size
					});
				} else {
					o.w = Math.max(4, d.w0 * k);
					o.h = Math.max(4, d.h0 * k);
				}
			}
			drawOverlay();
			return;
		}
		if(state.tool === 'select' && !state.picking) {
			const over = topObjectAt(p[0], p[1]) || (getSelected() && hitHandle(getSelected(), p[0], p[1]) >= 0);
			overCv.classList.toggle('cursor-move', !!over);
		}
	});

	function endPointer() {
		if(state.draft) {
			const dr = state.draft;
			state.draft = null;
			if(dr.type === 'draw') {
				addDrawn({
					id: nid(),
					type: 'draw',
					points: dr.points,
					color: dr.color,
					width: dr.width
				});
			} else {
				const w = Math.abs(dr.x1 - dr.x0),
					h = Math.abs(dr.y1 - dr.y0);
				if(w >= 3 && h >= 3) addDrawn({
					id: nid(),
					type: dr.type,
					x: Math.min(dr.x0, dr.x1) + w / 2,
					y: Math.min(dr.y0, dr.y1) + h / 2,
					w: w,
					h: h,
					rot: 0,
					color: dr.color
				});
			}
			drawOverlay();
		}
		if(state.drag) {
			if(state.drag.changed) pushHistory();
			state.drag = null;
		}
	}

	function addDrawn(o) {
		curRec().objects.push(o);
		pushHistory();
	}

	overCv.addEventListener('pointerup', endPointer);
	overCv.addEventListener('pointercancel', endPointer);
	overCv.addEventListener('dblclick', (e) => {
		if(state.tool !== 'select' || !curRec()) return;
		const p = toBase(e),
			o = topObjectAt(p[0], p[1]);
		if(o && o.type === 'text') {
			select(o.id);
			C.textValue.focus();
			C.textValue.select();
		}
	});

	async function makeAsset(source, isJpeg) { 
		const sw = source.naturalWidth || source.width,
			sh = source.naturalHeight || source.height;
		const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(sw, sh));
		const c = document.createElement('canvas');
		c.width = Math.max(1, Math.round(sw * k));
		c.height = Math.max(1, Math.round(sh * k));
		const x = c.getContext('2d');
		x.imageSmoothingQuality = 'high';
		x.drawImage(source, 0, 0, c.width, c.height);
		const bytes = await canvasBytes(c, isJpeg ? 'image/jpeg' : 'image/png', 0.92);
		return {
			canvas: c,
			bytes: bytes,
			fmt: isJpeg ? 'jpg' : 'png'
		};
	}

	function placeAsset(asset, width) {
		const rec = curRec(),
			info = state.src[rec.src];
		const w = Math.min(width, info.vw * 0.8),
			h = w * asset.canvas.height / asset.canvas.width;
		addObject({
			id: nid(),
			type: 'image',
			asset: asset,
			x: info.vw / 2,
			y: info.vh / 2,
			w: w,
			h: h,
			rot: 0,
			opacity: 1
		});
		setTool('select');
		select(state.selectedId);
	}

	async function addImageFile(file) {
		if(!file || !/^image\//.test(file.type)) {
			showError('That is not a picture file.');
			return;
		}
		try {
			clearError();
			const url = URL.createObjectURL(file);
			const img = await loadImageEl(url);
			URL.revokeObjectURL(url);
			const asset = await makeAsset(img, /jpe?g/i.test(file.type));
			placeAsset(asset, Math.min(240, img.naturalWidth));
		} catch(e) {
			showError('Could not add that picture.');
		}
	}

	const sig = {
		drawing: false,
		last: null,
		box: null
	};

	const sigCtx = C.sigPad.getContext('2d');

	function sigPoint(e) {
		const r = C.sigPad.getBoundingClientRect();
		return [(e.clientX - r.left) * C.sigPad.width / (r.width || C.sigPad.width), (e.clientY - r.top) * C.sigPad.height / (r.height || C.sigPad.height)];
	}

	function sigStroke(a, b) {
		sigCtx.strokeStyle = sigCtx.fillStyle = C.sigColor.value;
		sigCtx.lineWidth = 5;
		sigCtx.lineCap = sigCtx.lineJoin = 'round';
		sigCtx.beginPath();
		sigCtx.moveTo(a[0], a[1]);
		sigCtx.lineTo(b[0], b[1]);
		sigCtx.stroke();
		const m = 4,
			bx = sig.box;
		sig.box = bx ? [Math.min(bx[0], a[0] - m, b[0] - m), Math.min(bx[1], a[1] - m, b[1] - m), Math.max(bx[2], a[0] + m, b[0] + m), Math.max(bx[3], a[1] + m, b[1] + m)] : [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m];
	}

	C.sigPad.addEventListener('pointerdown', (e) => {
		if(C.sigPad.setPointerCapture) {
			try {
				C.sigPad.setPointerCapture(e.pointerId);
			} catch(x) { }
		}
		sig.drawing = true;
		sig.last = sigPoint(e);
		sigStroke(sig.last, sig.last);
	});

	C.sigPad.addEventListener('pointermove', (e) => {
		if(!sig.drawing) return;
		const p = sigPoint(e);
		sigStroke(sig.last, p);
		sig.last = p;
	});

	['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => C.sigPad.addEventListener(t, () => {
		sig.drawing = false;
	}));

	$('peSigClear').addEventListener('click', () => {
		sigCtx.clearRect(0, 0, C.sigPad.width, C.sigPad.height);
		sig.box = null;
	});

	$('peSigPlace').addEventListener('click', async() => {
		if(!sig.box || !curRec()) {
			setStatus('Draw your signature in the box first.', 'error');
			return;
		}
		const b = sig.box.map((v, i) => clamp(Math.round(v), 0, i % 2 ? C.sigPad.height : C.sigPad.width));
		const w = Math.max(1, b[2] - b[0]),
			h = Math.max(1, b[3] - b[1]);
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		c.getContext('2d').drawImage(C.sigPad, b[0], b[1], w, h, 0, 0, w, h);
		try {
			const asset = {
				canvas: c,
				bytes: await canvasBytes(c, 'image/png'),
				fmt: 'png'
			};
			setStatus('');
			placeAsset(asset, 150);
		} catch(e) {
			showError('Could not place the signature.');
		}
	});

	async function exportPdf() {
		if(!state.pages.length || state.busy) return;
		const L = window.PDFLib;
		setBusy(true);
		setStatus('Preparing your PDF\u2026');
		try {
			await new Promise((r) => setTimeout(r, 30)); 
			const doc = await L.PDFDocument.load(state.bytes.slice(0));
			const srcPages = doc.getPages(),
				fonts = new Map(),
				imgs = new Map(),
				faceSets = new Map(),
				faceFonts = new Map();
			let fkReady = false;
			const res = {
				font: async(o) => {
					const k = pdfFontKey(o);
					if(!fonts.has(k)) fonts.set(k, await doc.embedFont(L.StandardFonts[k]));
					return fonts.get(k);
				},
				image: async(o) => {
					if(!imgs.has(o.asset)) imgs.set(o.asset, o.asset.fmt === 'jpg' ? await doc.embedJpg(o.asset.bytes) : await doc.embedPng(o.asset.bytes));
					return imgs.get(o.asset);
				},
				raster: async(o) => {
					await ensureFont(o);
					return doc.embedPng(await rasterizeText(o));
				},

				segments: async(o, line) => {
					if(!fontEntry(o)) {
						const font = await res.font(o);
						font.encodeText(line); 
						return [{
							font: font,
							text: line
						}];
					}
					if(!window.fontkit) throw new Error('fontkit.umd.min.js is missing');
					if(!fkReady) {
						doc.registerFontkit(window.fontkit);
						fkReady = true;
					}
					const v = fontVariant(o),
						url = googleCssUrl(v.entry, [
							[v.italic ? 1 : 0, v.weight]
						]);
					if(!faceSets.has(url)) faceSets.set(url, fetch(url).then((r) => {
						if(!r.ok) throw new Error('font stylesheet');
						return r.text();
					}).then(parseFontFaces));
					const faces = await faceSets.get(url),
						parts = [];
					for(const ch of line) {
						const cp = ch.codePointAt(0),
							idx = faces.findIndex((f) => inRanges(f.ranges, cp));
						if(idx < 0) throw new Error('no font file has this letter');
						if(parts.length && parts[parts.length - 1].idx === idx) parts[parts.length - 1].text += ch;
						else parts.push({
							idx: idx,
							text: ch
						});
					}
					for(const p of parts) {
						const face = faces[p.idx];
						if(!faceFonts.has(face.url)) faceFonts.set(face.url, fetch(face.url).then((r) => {
							if(!r.ok) throw new Error('font file');
							return r.arrayBuffer();
						}).then((b) => doc.embedFont(b, {
							subset: true
						})));
						p.font = await faceFonts.get(face.url);
					}
					return parts;
				},

				link: (page, cs, url) => {
					const xs = cs.map((p) => p[0]),
						ys = cs.map((p) => p[1]),
						ctx = doc.context;
					const annot = ctx.obj({
						Type: 'Annot',
						Subtype: 'Link',
						F: 4,
						Border: [0, 0, 0],
						Rect: [Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)],
						QuadPoints: [cs[0][0], cs[0][1], cs[1][0], cs[1][1], cs[2][0], cs[2][1], cs[3][0], cs[3][1]],
						A: {
							Type: 'Action',
							S: 'URI',
							URI: L.PDFString.of(url)
						}
					});
					page.node.addAnnot(ctx.register(annot));
				}
			};

			for(const rec of state.pages) {
				const info = state.src[rec.src],
					page = srcPages[rec.src];
				await drawObjects(L, page, rec.objects, (x, y) => info.viewport1.convertToPdfPoint(x, y), res);
				page.setRotation(L.degrees((info.native + rec.extra) % 360));
			}

			const keep = state.pages.map((r) => srcPages[r.src]); // new order, deleted pages left out
			for(let i = doc.getPageCount() - 1; i >= 0; i--) doc.removePage(i);
			keep.forEach((p) => doc.addPage(p));
			const out = await doc.save();
			const url = URL.createObjectURL(new Blob([out], {
				type: 'application/pdf'
			}));

			const a = document.createElement('a');
			a.href = url;
			a.download = state.fileName + '-matte.pdf';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(() => URL.revokeObjectURL(url), 4000);
			state.savedIndex = state.hIndex;
			setStatus('Saved ' + state.pages.length + (state.pages.length === 1 ? ' page.' : ' pages.'), 'ok');
		} catch(e) {
			console.error(e);
			setStatus('', '');
			showError(/encrypt/i.test(String(e && e.message)) ? 'This PDF is protected, so it can\u2019t be edited here.' : 'Could not save the PDF: ' + (e && e.message ? e.message : e));
		} finally {
			setBusy(false);
		}
	}

	async function rasterizeText(o) { 
		const k = 4,
			c = document.createElement('canvas');
		c.width = Math.ceil(o.w * k);
		c.height = Math.ceil(o.h * k);
		const x = c.getContext('2d');
		x.scale(k, k);
		x.font = fontCss(o);
		x.fillStyle = o.color;
		x.textAlign = 'left';
		x.textBaseline = 'alphabetic';
		o.text.split('\n').forEach((line, i) => {
			const by = textBaselineY(o, i) + o.h / 2;
			x.fillText(line, 0, by);
			if(o.underline && line) x.fillRect(0, by + 0.14 * o.size - o.size / 32, x.measureText(line).width, Math.max(0.5, o.size / 16));
		});
		return canvasBytes(c, 'image/png');
	}

	function setBusy(b) {
		state.busy = b;
		downloadBtn.disabled = b;
	}

	function showLibsError() {
		showError('The PDF libraries were not found. Put these three files next to your site and reload: ' + 'assets/vendors/pdfjs/pdf.min.js, assets/vendors/pdfjs/pdf.worker.min.js and assets/vendors/pdf-lib/pdf-lib.min.js.');
	}

	async function openFile(file) {
		if(!libsOk()) {
			showLibsError();
			return;
		}
		if(!(/pdf/i.test(file.type) || /\.pdf$/i.test(file.name))) {
			showError('That is not a PDF file.');
			return;
		}
		clearError();
		setBusy(true);
		setStatus('Opening\u2026');
		try {
			const buf = await readBuffer(file);
			const pdf = await window.pdfjsLib.getDocument({
				data: new Uint8Array(buf.slice(0))
			}).promise;
			const src = [];
			for(let n = 1; n <= pdf.numPages; n++) {
				const page = await pdf.getPage(n);
				const native = ((page.rotate % 360) + 360) % 360,
					vp = page.getViewport({
						scale: 1,
						rotation: native
					});
				src.push({
					page: page,
					native: native,
					vw: vp.width,
					vh: vp.height,
					viewport1: vp
				});
				if(pdf.numPages > 20 && n % 10 === 0) setStatus('Reading pages\u2026 ' + n + ' of ' + pdf.numPages);
			}
			state.bytes = buf;
			state.pdf = pdf;
			state.src = src;
			state.fileName = file.name.replace(/\.pdf$/i, '') || 'document';
			state.nextId = 1;
			state.pages = src.map((s, i) => ({
				id: nid(),
				src: i,
				extra: 0,
				objects: []
			}));
			state.cur = 0;
			state.selectedId = null;
			state.draft = null;
			state.drag = null;
			state.history = [];
			state.hIndex = -1;
			thumbCache.clear();
			pushHistory();
			state.savedIndex = 0;
			stage.classList.add('is-hidden');
			workspace.classList.remove('is-hidden');
			setTool('select');
			rebuildSidebar();
			state.zoom = fitZoom();
			setZoom(state.zoom);
			setStatus('');
		} catch(e) {
			console.error(e);
			setStatus('');
			showError(e && e.name === 'PasswordException' ? 'This PDF is password-protected. Remove the password first, then open it here.' : 'Could not open that PDF. It may be damaged.');
		} finally {
			setBusy(false);
		}
	}

	function resetEditor() {
		if(isDirty() && window.confirm && !window.confirm('Discard your changes and open another PDF?')) return;
		if(state.pdf && state.pdf.destroy) {
			try {
				state.pdf.destroy();
			} catch(e) { /* ignore */ }
		}
		state.pages = [];
		state.src = [];
		state.pdf = null;
		state.bytes = null;
		state.history = [];
		state.hIndex = -1;
		state.savedIndex = 0;
		workspace.classList.add('is-hidden');
		stage.classList.remove('is-hidden');
		clearError();
		setStatus('');
	}

	stage.addEventListener('click', () => {
		if(!libsOk()) showLibsError();
		else fileInput.click();
	});

	fileInput.addEventListener('change', (e) => {
		if(e.target.files[0]) openFile(e.target.files[0]);
		fileInput.value = '';
	});

	['dragenter', 'dragover'].forEach((evt) => stage.addEventListener(evt, (e) => {
		e.preventDefault();
		stage.classList.add('drag');
	}));

	['dragleave', 'drop'].forEach((evt) => stage.addEventListener(evt, (e) => {
		e.preventDefault();
		stage.classList.remove('drag');
	}));

	stage.addEventListener('drop', (e) => {
		if(e.dataTransfer && e.dataTransfer.files[0]) openFile(e.dataTransfer.files[0]);
	});

	document.querySelectorAll('#peTools .mode-btn').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

	$('peAddImageBtn').addEventListener('click', () => {
		if(curRec()) imageInput.click();
	});

	imageInput.addEventListener('change', (e) => {
		if(e.target.files[0]) addImageFile(e.target.files[0]);
		imageInput.value = '';
	});

	$('pePickBtn').addEventListener('click', () => {
		state.picking = true;
		updateCursor();
		setStatus('Click the page to pick a color.');
	});

	undoBtn.addEventListener('click', undo);
	redoBtn.addEventListener('click', redo);
	prevBtn.addEventListener('click', () => goToPage(state.cur - 1));
	nextBtn.addEventListener('click', () => goToPage(state.cur + 1));
	$('peZoomOut').addEventListener('click', () => setZoom(state.zoom / 1.2));
	$('peZoomIn').addEventListener('click', () => setZoom(state.zoom * 1.2));
	$('peFitBtn').addEventListener('click', () => setZoom(fitZoom()));
	$('peNewBtn').addEventListener('click', resetEditor);
	downloadBtn.addEventListener('click', exportPdf);

	document.addEventListener('keydown', (e) => {
		if(!curRec()) return;
		const tag = (e.target.tagName || '').toLowerCase();
		if(tag === 'input' || tag === 'textarea' || tag === 'select') return;
		const mod = e.ctrlKey || e.metaKey,
			k = (e.key || '').toLowerCase();
		if(mod && k === 'z') {
			e.preventDefault();
			if(e.shiftKey) redo();
			else undo();
			return;
		}
		if(mod && k === 'y') {
			e.preventDefault();
			redo();
			return;
		}
		if(e.key === 'Delete' || e.key === 'Backspace') {
			if(getSelected()) {
				e.preventDefault();
				deleteSelected();
			}
			return;
		}
		if(e.key === 'Escape') {
			state.picking = false;
			updateCursor();
			if(state.tool !== 'select') setTool('select');
			else select(null);
			return;
		}
		if(e.key === 'PageDown') {
			e.preventDefault();
			goToPage(state.cur + 1);
			return;
		}
		if(e.key === 'PageUp') {
			e.preventDefault();
			goToPage(state.cur - 1);
			return;
		}
		const o = getSelected(),
			step = e.shiftKey ? 10 : 1;
		if(o && /^Arrow/.test(e.key)) { // nudge the selected item
			e.preventDefault();
			const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
				dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
			if(o.points) o.points = o.points.map((q) => [q[0] + dx, q[1] + dy]);
			else {
				o.x += dx;
				o.y += dy;
			}
			drawOverlay();
			pushHistory();
		}
	});

	window.addEventListener('resize', () => {
		if(curRec()) drawOverlay();
	});

	window.addEventListener('beforeunload', (e) => {
		if(isDirty()) {
			e.preventDefault();
			e.returnValue = '';
		}
	});

	if(!libsOk()) showLibsError();
	else window.pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
})();