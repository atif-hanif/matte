(function() {
	'use strict';

	const MAX_DPR = 2;
	const HISTORY_LIMIT = 60;
	const HANDLE = 9;
	const THUMB_WIDTH = 110; 
	const MAX_IMAGE_SIDE = 2000; 

	function clamp(v, lo, hi) {
		return v < lo ? lo : (v > hi ? hi : v);
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

	const SHAPES = new Set(['rect', 'ellipse', 'line']);

	function alignK(o) {
		return o.align === 'center' ? 0.5 : (o.align === 'right' ? 1 : 0);
	}

	function shapePaint(L, o, opts, opacity) {
		const fill = !o.noFill,
			stroke = o.sw > 0;
		if(!fill && !stroke) return false;
		if(fill) {
			opts.color = hexRgb(L, o.fill);
			opts.opacity = opacity;
		}
		if(stroke) {
			opts.borderColor = hexRgb(L, o.stroke);
			opts.borderWidth = o.sw;
			opts.borderOpacity = opacity;
			if(o.dash) opts.borderDashArray = [o.sw * 3, o.sw * 2];
		}
		return true;
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
			const opacity = o.opacity == null ? 1 : o.opacity;
			if(o.type === 'highlight') {
				const f = frame(o);
				page.drawRectangle({
					x: f.x,
					y: f.y,
					width: o.w,
					height: o.h,
					rotate: degrees(f.angle),
					color: hexRgb(L, o.color),
					opacity: 0.4,
					blendMode: L.BlendMode.Multiply
				});
			} else if(o.type === 'rect') {
				const f = frame(o),
					opts = {
						x: f.x,
						y: f.y,
						width: o.w,
						height: o.h,
						rotate: degrees(f.angle)
					};
				if(shapePaint(L, o, opts, opacity)) page.drawRectangle(opts);
			} else if(o.type === 'ellipse') {
				const f = frame(o),
					c = convert(o.x, o.y),
					opts = {
						x: c[0],
						y: c[1],
						xScale: o.w / 2,
						yScale: o.h / 2,
						rotate: degrees(f.angle)
					};
				if(shapePaint(L, o, opts, opacity)) page.drawEllipse(opts);
			} else if(o.type === 'line') {
				const a = convert.apply(null, objPoint(o, -o.w / 2, 0)),
					b = convert.apply(null, objPoint(o, o.w / 2, 0));
				const opts = {
					start: {
						x: a[0],
						y: a[1]
					},
					end: {
						x: b[0],
						y: b[1]
					},
					thickness: o.sw,
					color: hexRgb(L, o.stroke),
					opacity: opacity,
					lineCap: L.LineCapStyle.Round
				};
				if(o.dash) opts.dashArray = [o.sw * 3, o.sw * 2];
				page.drawLine(opts);
			} else if(o.type === 'image') {
				const img = await res.image(o),
					f = frame(o);
				page.drawImage(img, {
					x: f.x,
					y: f.y,
					width: o.w,
					height: o.h,
					rotate: degrees(f.angle),
					opacity: opacity
				});
			} else if(o.type === 'draw') {
				const pts = o.points.map((p) => convert(p[0], p[1])),
					color = hexRgb(L, o.color);
				if(pts.length === 1) page.drawCircle({
					x: pts[0][0],
					y: pts[0][1],
					size: o.width / 2,
					color: color,
					opacity: opacity
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
						opacity: opacity,
						lineCap: L.LineCapStyle.Round
					});
				}
			} else if(o.type === 'text') {
				const color = hexRgb(L, o.color),
					f = frame(o),
					k = alignK(o);
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
						const lw = segs.reduce((s, g) => s + g.font.widthOfTextAtSize(g.text, o.size), 0);
						const x0 = -o.w / 2 + (o.w - lw) * k;
						let off = 0;
						segs.forEach((s) => {
							const p = convert.apply(null, objPoint(o, x0 + off, by));
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
								a = convert.apply(null, objPoint(o, x0, uy)),
								b = convert.apply(null, objPoint(o, x0 + off, uy));
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

	const $ = (id) => document.getElementById(id);
	const setupEl = $('pcSetup');
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
	const nameInput = $('pcFileName');
	const P = {
		sig: $('peSigPanel'),
		rect: $('peRectPanel'),
		shape: $('pcShapePanel'),
		draw: $('peDrawPanel'),
		text: $('peTextPanel'),
		layer: $('peLayerPanel'),
		page: $('pcPagePanel')
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
		alignBtns: Array.from(document.querySelectorAll('#pcAlign button')),
		link: $('peLinkUrl'),
		linkNote: $('peLinkNote'),
		textNote: $('peTextNote'),
		layerTitle: $('peLayerTitle'),
		rotateRow: $('peRotateRow'),
		rotation: $('peRotation'),
		rotationVal: $('peRotationVal'),
		opacityRow: $('pcOpacityRow'),
		opacity: $('pcOpacity'),
		opacityVal: $('pcOpacityVal'),
		shapeTitle: $('pcShapeTitle'),
		shapeFillRow: $('pcShapeFillRow'),
		shapeFill: $('pcShapeFill'),
		shapeNoFill: $('pcShapeNoFill'),
		shapeStrokeLabel: $('pcShapeStrokeLabel'),
		shapeStroke: $('pcShapeStroke'),
		shapeWidth: $('pcShapeWidth'),
		shapeWidthVal: $('pcShapeWidthVal'),
		shapeDash: $('pcShapeDash'),
		pageSize: $('pcPageSize'),
		pageOrient: Array.from(document.querySelectorAll('#pcPageOrient .mode-btn')),
		pageCustom: $('pcPageCustom'),
		pageW: $('pcPageW'),
		pageH: $('pcPageH'),
		pageBg: $('pcPageBg'),
		pageAll: $('pcPageAll')
	};
	const S = { // the "new document" screen
		name: $('pcSetupName'),
		size: $('pcSetupSize'),
		orient: Array.from(document.querySelectorAll('#pcSetupOrient .mode-btn')),
		custom: $('pcSetupCustom'),
		w: $('pcSetupW'),
		h: $('pcSetupH'),
		bg: $('pcSetupBg'),
		count: $('pcSetupCount'),
		create: $('pcCreateBtn')
	};
	const measureCtx = document.createElement('canvas').getContext('2d');

	const MM = 72 / 25.4;
	const PAGE_SIZES = { // portrait, in PDF points
		a4: [595.28, 841.89],
		a3: [841.89, 1190.55],
		a5: [419.53, 595.28],
		letter: [612, 792],
		legal: [612, 1008],
		tabloid: [792, 1224]
	};
	const MIN_PAGE = 72,
		MAX_PAGE = 14400;

	function sizeKey(w, h) {
		const a = Math.min(w, h),
			b = Math.max(w, h);
		for(const k in PAGE_SIZES) {
			if(Math.abs(PAGE_SIZES[k][0] - a) < 1 && Math.abs(PAGE_SIZES[k][1] - b) < 1) return k;
		}
		return 'custom';
	}

	const state = {
		fileName: 'document',
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
		guides: null,
		busy: false,
		dragPageId: null,
		styles: {
			text: {
				font: 'Helvetica',
				size: 18,
				color: '#111111',
				bold: false,
				italic: false,
				underline: false
			},
			highlight: {
				color: '#FFE600'
			},
			draw: {
				color: '#E03131',
				width: 3
			},
			rect: {
				fill: '#FFE3D6',
				noFill: false,
				stroke: '#FF6224',
				sw: 2,
				dash: false
			},
			ellipse: {
				fill: '#DDF4FF',
				noFill: false,
				stroke: '#0A58CA',
				sw: 2,
				dash: false
			},
			line: {
				stroke: '#3B4051',
				sw: 3,
				dash: false
			}
		}
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
		return !!window.PDFLib;
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

	function relayoutKeep(o) { // re-measure a text box, keeping its aligned edge in place
		const k = alignK(o),
			p = objPoint(o, -o.w / 2 + o.w * k, -o.h / 2);
		layoutObj(o);
		const t = (o.rot || 0) * Math.PI / 180,
			c = Math.cos(t),
			s = Math.sin(t),
			lx = -o.w / 2 + o.w * alignK(o),
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


	function cloneObj(o) {
		const c = Object.assign({}, o);
		if(o.points) c.points = o.points.map((p) => p.slice());
		return c;
	}

	function clonePage(r) {
		return {
			id: r.id,
			w: r.w,
			h: r.h,
			bg: r.bg,
			objects: r.objects.map(cloneObj)
		};
	}

	function snapshot() {
		return {
			pages: state.pages.map(clonePage),
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
		const oldRec = curRec();
		state.pages = entry.pages.map(clonePage);
		state.cur = clamp(entry.cur, 0, state.pages.length - 1);
		state.selectedId = curRec().objects.some((o) => o.id === entry.sel) ? entry.sel : null;
		state.drag = null;
		state.draft = null;
		updateHistoryButtons();
		rebuildSidebar();
		syncPanel();
		const rec = curRec();
		if(oldRec && (oldRec.w !== rec.w || oldRec.h !== rec.h)) setZoom(fitZoom());
		else renderPage();
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
		const avail = (canvasWrap.clientWidth || 800) - 36;
		return clamp(avail / rec.w, 0.3, 3);
	}

	function setZoom(z) {
		state.zoom = clamp(z, 0.25, 4);
		zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
		renderPage();
	}

	function renderPage() {
		const rec = curRec();
		if(!rec) return;
		state.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
		const w = Math.max(1, Math.round(rec.w * state.zoom * state.dpr)),
			h = Math.max(1, Math.round(rec.h * state.zoom * state.dpr));
		baseCv.width = overCv.width = w;
		baseCv.height = overCv.height = h;
		const cssW = (w / state.dpr) + 'px',
			cssH = (h / state.dpr) + 'px';
		pageBox.style.width = baseCv.style.width = overCv.style.width = cssW;
		pageBox.style.height = baseCv.style.height = overCv.style.height = cssH;
		bctx.fillStyle = rec.bg;
		bctx.fillRect(0, 0, w, h);
		drawOverlay();
	}

	function dashFor(o) {
		return o.dash && o.sw > 0 ? [o.sw * 3, o.sw * 2] : [];
	}

	function drawObject(ctx, o) {
		ctx.save();
		const op = o.opacity == null ? 1 : o.opacity;
		if(o.type === 'draw') {
			ctx.globalAlpha = op;
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
			if(o.type === 'highlight') {
				ctx.globalAlpha = 0.4;
				ctx.globalCompositeOperation = 'multiply';
				ctx.fillStyle = o.color;
				ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
			} else if(o.type === 'rect' || o.type === 'ellipse') {
				ctx.globalAlpha = op;
				ctx.beginPath();
				if(o.type === 'rect') ctx.rect(-o.w / 2, -o.h / 2, o.w, o.h);
				else ctx.ellipse(0, 0, o.w / 2, o.h / 2, 0, 0, Math.PI * 2);
				if(!o.noFill) {
					ctx.fillStyle = o.fill;
					ctx.fill();
				}
				if(o.sw > 0) {
					ctx.strokeStyle = o.stroke;
					ctx.lineWidth = o.sw;
					ctx.setLineDash(dashFor(o));
					ctx.stroke();
				}
			} else if(o.type === 'line') {
				ctx.globalAlpha = op;
				ctx.strokeStyle = o.stroke;
				ctx.lineWidth = o.sw;
				ctx.lineCap = 'round';
				ctx.setLineDash(dashFor(o));
				ctx.beginPath();
				ctx.moveTo(-o.w / 2, 0);
				ctx.lineTo(o.w / 2, 0);
				ctx.stroke();
			} else if(o.type === 'image') {
				ctx.globalAlpha = op;
				ctx.drawImage(o.asset.canvas, -o.w / 2, -o.h / 2, o.w, o.h);
			} else if(o.type === 'text') {
				ctx.globalAlpha = op;
				ctx.font = fontCss(o);
				ctx.fillStyle = o.color;
				ctx.textAlign = 'left';
				ctx.textBaseline = 'alphabetic';
				const k = alignK(o);
				o.text.split('\n').forEach((line, i) => {
					const lw = ctx.measureText(line).width,
						x = -o.w / 2 + (o.w - lw) * k,
						by = textBaselineY(o, i);
					ctx.fillText(line, x, by);
					if(o.underline && line) ctx.fillRect(x, by + 0.14 * o.size - o.size / 32, lw, Math.max(0.5, o.size / 16));
				});
			}
		}
		ctx.restore();
	}

	function drawSelection(ctx, o) {
		const u = 1 / state.zoom,
			hs = HANDLE * u;
		ctx.save();
		ctx.lineWidth = 1.5 * u;
		ctx.strokeStyle = '#FF6224';
		ctx.setLineDash([6 * u, 4 * u]);
		const handle = (x, y) => {
			ctx.fillStyle = '#FFFFFF';
			ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs);
			ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs);
		};
		if(o.type === 'draw') {
			const b = objBounds(o);
			ctx.strokeRect(b[0] - 3 * u, b[1] - 3 * u, b[2] - b[0] + 6 * u, b[3] - b[1] + 6 * u);
		} else if(o.type === 'line') {
			ctx.translate(o.x, o.y);
			ctx.rotate((o.rot || 0) * Math.PI / 180);
			const t = o.sw / 2 + 4 * u;
			ctx.strokeRect(-o.w / 2, -t, o.w, t * 2);
			ctx.setLineDash([]);
			handle(-o.w / 2, 0);
			handle(o.w / 2, 0);
		} else {
			ctx.translate(o.x, o.y);
			ctx.rotate((o.rot || 0) * Math.PI / 180);
			ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
			ctx.setLineDash([]);
			for(const c of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) handle(c[0] * o.w / 2, c[1] * o.h / 2);
		}
		ctx.restore();
	}

	function lineGeom(a, b) {
		const dx = b[0] - a[0],
			dy = b[1] - a[1];
		return {
			x: (a[0] + b[0]) / 2,
			y: (a[1] + b[1]) / 2,
			w: Math.max(1, Math.hypot(dx, dy)),
			rot: Math.atan2(dy, dx) * 180 / Math.PI
		};
	}

	function draftObject(d) {
		if(d.type === 'line') {
			const st = state.styles.line;
			return Object.assign({
				type: 'line',
				stroke: st.stroke,
				sw: st.sw,
				h: Math.max(st.sw, 1),
				dash: st.dash,
				opacity: 1
			}, lineGeom([d.x0, d.y0], [d.x1, d.y1]));
		}
		const w = Math.abs(d.x1 - d.x0),
			h = Math.abs(d.y1 - d.y0);
		const o = {
			type: d.type,
			x: Math.min(d.x0, d.x1) + w / 2,
			y: Math.min(d.y0, d.y1) + h / 2,
			w: w,
			h: h,
			rot: 0,
			opacity: 1
		};
		if(d.type === 'highlight') o.color = state.styles.highlight.color;
		else Object.assign(o, state.styles[d.type]);
		return o;
	}

	function drawDraft(ctx, d) {
		if(d.type === 'draw') {
			drawObject(ctx, {
				type: 'draw',
				points: d.points,
				color: d.color,
				width: d.width
			});
			return;
		}
		drawObject(ctx, draftObject(d));
		if(d.type !== 'line') {
			ctx.save();
			ctx.strokeStyle = '#FF6224';
			ctx.lineWidth = 1 / state.zoom;
			ctx.setLineDash([4 / state.zoom, 3 / state.zoom]);
			ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
			ctx.restore();
		}
	}

	function drawGuides(ctx, rec) {
		const g = state.guides;
		if(!g || (!g.v && !g.h)) return;
		ctx.save();
		ctx.strokeStyle = '#FF6224';
		ctx.lineWidth = 1 / state.zoom;
		ctx.setLineDash([5 / state.zoom, 4 / state.zoom]);
		ctx.beginPath();
		if(g.v) {
			ctx.moveTo(rec.w / 2, 0);
			ctx.lineTo(rec.w / 2, rec.h);
		}
		if(g.h) {
			ctx.moveTo(0, rec.h / 2);
			ctx.lineTo(rec.w, rec.h / 2);
		}
		ctx.stroke();
		ctx.restore();
	}

	function drawOverlay() {
		const rec = curRec();
		if(!rec) return;
		octx.setTransform(1, 0, 0, 1, 0, 0);
		octx.clearRect(0, 0, overCv.width, overCv.height);
		const s = state.zoom * state.dpr;
		octx.setTransform(s, 0, 0, s, 0, 0);
		rec.objects.forEach((o) => drawObject(octx, o));
		if(state.draft) drawDraft(octx, state.draft);
		drawGuides(octx, rec);
		const sel = getSelected();
		if(sel) drawSelection(octx, sel);
		scheduleThumb();
	}

	// ---- page strip ----

	function renderThumb(rec, canvas) {
		const x = canvas.getContext('2d'),
			s = canvas.width / rec.w;
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.clearRect(0, 0, canvas.width, canvas.height);
		x.fillStyle = rec.bg;
		x.fillRect(0, 0, canvas.width, canvas.height);
		x.setTransform(s, 0, 0, s, 0, 0);
		rec.objects.forEach((o) => drawObject(x, o));
	}

	let thumbTimer = 0;

	function scheduleThumb() {
		clearTimeout(thumbTimer);
		thumbTimer = setTimeout(() => {
			const rec = curRec();
			if(!rec) return;
			const cv = pagesEl.querySelector('.pe-thumb[data-id="' + rec.id + '"] canvas');
			if(cv) renderThumb(rec, cv);
		}, 150);
	}

	function rebuildSidebar() {
		pagesEl.textContent = '';
		const n = state.pages.length;
		state.pages.forEach((rec, i) => {
			const item = document.createElement('div');
			item.className = 'pe-thumb' + (i === state.cur ? ' is-current' : '');
			item.draggable = true;
			item.dataset.id = rec.id;
			const cv = document.createElement('canvas');
			cv.width = THUMB_WIDTH * 2;
			cv.height = Math.max(1, Math.round(THUMB_WIDTH * 2 * rec.h / rec.w));
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
				['up', '↑', 'Move up'],
				['down', '↓', 'Move down'],
				['dup', '⧉', 'Duplicate page'],
				['del', '✕', 'Delete page']
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
			renderThumb(rec, cv);
		});
		const add = document.createElement('button');
		add.type = 'button';
		add.className = 'pc-addpage';
		add.innerHTML = '<i class="fa-solid fa-plus me-2"></i>Add page';
		pagesEl.appendChild(add);
		updatePageNav();
	}

	function updatePageNav() {
		pageLabel.textContent = 'Page ' + (state.cur + 1) + ' of ' + state.pages.length;
		prevBtn.disabled = state.cur <= 0;
		nextBtn.disabled = state.cur >= state.pages.length - 1;
	}

	function goToPage(i) {
		if(i < 0 || i >= state.pages.length) return;
		const old = curRec();
		state.cur = i;
		state.selectedId = null;
		state.draft = null;
		pagesEl.querySelectorAll('.pe-thumb').forEach((el, k) => el.classList.toggle('is-current', k === i));
		updatePageNav();
		syncPanel();
		const rec = curRec();
		if(old && (old.w !== rec.w || old.h !== rec.h)) setZoom(fitZoom());
		else renderPage();
	}

	function afterPageChange(newCur) {
		const old = curRec();
		state.cur = clamp(newCur, 0, state.pages.length - 1);
		state.selectedId = null;
		pushHistory();
		rebuildSidebar();
		syncPanel();
		const rec = curRec();
		if(old && (old.w !== rec.w || old.h !== rec.h)) setZoom(fitZoom());
		else renderPage();
		pagesEl.querySelector('.pe-thumb.is-current') && pagesEl.querySelector('.pe-thumb.is-current').scrollIntoView({
			block: 'nearest'
		});
	}

	function addPage() {
		const ref = curRec();
		state.pages.splice(state.cur + 1, 0, {
			id: nid(),
			w: ref.w,
			h: ref.h,
			bg: ref.bg,
			objects: []
		});
		afterPageChange(state.cur + 1);
	}

	function duplicatePage(i) {
		const src = state.pages[i];
		if(!src) return;
		const copy = clonePage(src);
		copy.id = nid();
		copy.objects.forEach((o) => {
			o.id = nid();
		});
		state.pages.splice(i + 1, 0, copy);
		afterPageChange(i + 1);
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
		if(e.target.closest('.pc-addpage')) {
			addPage();
			return;
		}
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
			case 'up':
				movePage(i, i - 1);
				break;
			case 'down':
				movePage(i, i + 1);
				break;
			case 'dup':
				duplicatePage(i);
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

	// ---- page settings ----

	function syncPagePanel() {
		const rec = curRec();
		if(!rec) return;
		const key = sizeKey(rec.w, rec.h);
		C.pageSize.value = key;
		C.pageOrient.forEach((b) => b.classList.toggle('active', (b.dataset.orient === 'landscape') === (rec.w > rec.h)));
		show(C.pageCustom, key === 'custom');
		C.pageW.value = Math.round(rec.w / MM * 10) / 10;
		C.pageH.value = Math.round(rec.h / MM * 10) / 10;
		C.pageBg.value = rec.bg;
	}

	function setPageSize(w, h) {
		const rec = curRec();
		rec.w = clamp(w, MIN_PAGE, MAX_PAGE);
		rec.h = clamp(h, MIN_PAGE, MAX_PAGE);
		pushHistory();
		rebuildSidebar();
		syncPagePanel();
		setZoom(fitZoom());
	}

	C.pageSize.addEventListener('change', () => {
		const rec = curRec(),
			k = C.pageSize.value;
		if(k === 'custom') {
			show(C.pageCustom, true);
			return;
		}
		const s = PAGE_SIZES[k],
			land = rec.w > rec.h;
		setPageSize(land ? s[1] : s[0], land ? s[0] : s[1]);
	});

	C.pageOrient.forEach((b) => b.addEventListener('click', () => {
		const rec = curRec(),
			land = b.dataset.orient === 'landscape';
		if(rec.w !== rec.h && land !== (rec.w > rec.h)) setPageSize(rec.h, rec.w);
	}));

	[C.pageW, C.pageH].forEach((inp) => inp.addEventListener('change', () => {
		const w = parseFloat(C.pageW.value),
			h = parseFloat(C.pageH.value);
		if(!(w > 0) || !(h > 0)) {
			syncPagePanel();
			return;
		}
		setPageSize(w * MM, h * MM);
	}));

	C.pageBg.addEventListener('input', () => {
		const rec = curRec();
		rec.bg = C.pageBg.value;
		renderPage();
	});
	C.pageBg.addEventListener('change', () => pushHistory());

	C.pageAll.addEventListener('click', () => {
		const ref = curRec();
		state.pages.forEach((r) => {
			r.w = ref.w;
			r.h = ref.h;
			r.bg = ref.bg;
		});
		pushHistory();
		rebuildSidebar();
		setStatus('Size and background applied to all ' + state.pages.length + ' pages.', 'ok');
	});

	// ---- tools and side panel ----

	const HINTS = {
		select: 'Click anything on the page to move, resize or edit it. Pick a tool above to add text, shapes, lines, drawings, pictures or a signature.',
		text: 'Click on the page where you want to type.',
		rect: 'Drag on the page to draw a rectangle. Hold Shift for a square.',
		ellipse: 'Drag on the page to draw an ellipse. Hold Shift for a circle.',
		line: 'Drag on the page to draw a line. Hold Shift to keep it straight.',
		highlight: 'Drag over the area you want to highlight.',
		draw: 'Click and drag on the page to draw freehand.',
		signature: 'Draw your signature in the box, then press "Place on page". You can move and resize it afterwards.'
	};

	function setTool(tool) {
		state.tool = tool;
		state.draft = null;
		document.querySelectorAll('#peTools .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
		if(tool !== 'select' && tool !== 'signature') state.selectedId = null;
		syncPanel();
		updateCursor();
		drawOverlay();
	}

	function updateCursor() {
		const t = state.tool;
		overCv.classList.toggle('cursor-cross', t === 'rect' || t === 'ellipse' || t === 'line' || t === 'highlight' || t === 'draw');
		overCv.classList.toggle('cursor-text', t === 'text');
	}

	const TYPE_NAMES = {
		text: 'Text',
		image: 'Picture',
		rect: 'Rectangle',
		ellipse: 'Ellipse',
		line: 'Line',
		highlight: 'Highlight',
		draw: 'Drawing'
	};

	function syncPanel() {
		const sel = getSelected(),
			tool = state.tool;
		const shapeT = sel ? (SHAPES.has(sel.type) ? sel.type : null) : (SHAPES.has(tool) ? tool : null);
		const hl = sel ? sel.type === 'highlight' : tool === 'highlight';
		const drawish = sel ? sel.type === 'draw' : tool === 'draw';
		show(P.sig, tool === 'signature');
		show(P.rect, hl);
		show(P.shape, !!shapeT);
		show(P.draw, drawish);
		show(P.text, !!(sel && sel.type === 'text'));
		show(P.layer, !!sel);
		show(P.page, !sel && tool === 'select');
		show(hintEl, !sel && !hl && !drawish && !shapeT && tool !== 'signature');
		hintEl.textContent = HINTS[tool] || HINTS.select;
		if(hl) C.rectColor.value = sel ? sel.color : state.styles.highlight.color;
		if(shapeT) {
			const src = sel || state.styles[shapeT],
				isLine = shapeT === 'line';
			C.shapeTitle.textContent = TYPE_NAMES[shapeT];
			show(C.shapeFillRow, !isLine);
			if(!isLine) {
				C.shapeFill.value = src.fill;
				C.shapeNoFill.checked = !!src.noFill;
			}
			C.shapeStrokeLabel.textContent = isLine ? 'Color' : 'Border';
			C.shapeStroke.value = src.stroke;
			C.shapeWidth.min = isLine ? 1 : 0;
			C.shapeWidth.value = src.sw;
			C.shapeWidthVal.textContent = src.sw;
			C.shapeDash.checked = !!src.dash;
		}
		if(drawish) {
			const src = sel || state.styles.draw;
			C.drawColor.value = src.color;
			C.drawWidth.value = src.width;
			C.drawWidthVal.textContent = src.width;
		}
		if(sel) {
			C.layerTitle.textContent = SHAPES.has(sel.type) || sel.type === 'text' ? 'Arrange' : TYPE_NAMES[sel.type];
			const canRotate = sel.type !== 'draw';
			show(C.rotateRow, canRotate);
			if(canRotate) {
				C.rotation.value = Math.round(sel.rot || 0);
				C.rotationVal.textContent = Math.round(sel.rot || 0) + '°';
			}
			const canFade = sel.type !== 'highlight';
			show(C.opacityRow, canFade);
			if(canFade) {
				const v = Math.round((sel.opacity == null ? 1 : sel.opacity) * 100);
				C.opacity.value = v;
				C.opacityVal.textContent = v + '%';
			}
			if(sel.type === 'text') {
				C.textValue.value = sel.text;
				setFontLabel(sel.font);
				C.size.value = sel.size;
				C.textColor.value = sel.color;
				C.underline.classList.toggle('is-active', !!sel.underline);
				C.link.value = sel.link || '';
				syncFontButtons(sel);
				syncAlign(sel);
				updateLinkNote(sel);
				updateTextNote(sel);
			}
		} else if(tool === 'select') {
			syncPagePanel();
		}
	}

	function syncAlign(o) {
		const a = o.align || 'left';
		C.alignBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.align === a));
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
		relayoutKeep(o);
		updateTextNote(o);
		ensureFont(o);
	}));

	C.size.addEventListener('input', () => edit((o) => {
		if(o.type !== 'text') return;
		o.size = clamp(parseFloat(C.size.value) || o.size, 4, 400);
		setStyle('text', {
			size: o.size
		});
		relayoutKeep(o);
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
			relayoutKeep(o);
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
			relayoutKeep(o);
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

	C.alignBtns.forEach((b) => b.addEventListener('click', () => {
		edit((o) => {
			if(o.type !== 'text') return;
			o.align = b.dataset.align;
			syncAlign(o);
		});
		pushHistory();
	}));

	C.link.addEventListener('input', () => edit((o) => {
		if(o.type !== 'text') return;
		o.link = C.link.value;
		updateLinkNote(o);
	}));

	C.rectColor.addEventListener('input', () => {
		setStyle('highlight', {
			color: C.rectColor.value
		});
		edit((o) => {
			if(o.type === 'highlight') o.color = C.rectColor.value;
		});
	});

	function shapeEdit(props) {
		const o = getSelected();
		const t = o ? (SHAPES.has(o.type) ? o.type : null) : (SHAPES.has(state.tool) ? state.tool : null);
		if(!t) return;
		const st = Object.assign({}, props);
		if(t === 'line') {
			delete st.fill;
			delete st.noFill;
		}
		setStyle(t, st);
		if(o) {
			Object.assign(o, st);
			if(t === 'line') o.h = Math.max(o.sw, 1);
			drawOverlay();
		}
	}

	C.shapeFill.addEventListener('input', () => {
		C.shapeNoFill.checked = false;
		shapeEdit({
			fill: C.shapeFill.value,
			noFill: false
		});
	});
	C.shapeNoFill.addEventListener('change', () => shapeEdit({
		noFill: C.shapeNoFill.checked
	}));
	C.shapeStroke.addEventListener('input', () => shapeEdit({
		stroke: C.shapeStroke.value
	}));
	C.shapeWidth.addEventListener('input', () => {
		const w = parseInt(C.shapeWidth.value, 10) || 0;
		C.shapeWidthVal.textContent = w;
		shapeEdit({
			sw: w
		});
	});
	C.shapeDash.addEventListener('change', () => shapeEdit({
		dash: C.shapeDash.checked
	}));

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
		C.rotationVal.textContent = o.rot + '°';
	}));

	C.opacity.addEventListener('input', () => edit((o) => {
		const v = clamp(parseInt(C.opacity.value, 10) || 0, 5, 100);
		o.opacity = v / 100;
		C.opacityVal.textContent = v + '%';
	}));

	[P.text, P.rect, P.shape, P.draw, P.layer].forEach((panel) => panel.addEventListener('change', () => {
		if(getSelected()) pushHistory();
	}));

	function duplicateSelected() {
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
	}
	$('peDupBtn').addEventListener('click', duplicateSelected);

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

	function centerSelected(axis) {
		const rec = curRec(),
			o = getSelected();
		if(!o) return;
		if(o.points) {
			const b = objBounds(o),
				dx = axis === 'x' ? rec.w / 2 - (b[0] + b[2]) / 2 : 0,
				dy = axis === 'y' ? rec.h / 2 - (b[1] + b[3]) / 2 : 0;
			o.points = o.points.map((q) => [q[0] + dx, q[1] + dy]);
		} else if(axis === 'x') o.x = rec.w / 2;
		else o.y = rec.h / 2;
		pushHistory();
		drawOverlay();
	}
	$('pcCenterX').addEventListener('click', () => centerSelected('x'));
	$('pcCenterY').addEventListener('click', () => centerSelected('y'));

	// ---- pointer handling on the page ----

	function toBase(e) {
		const r = overCv.getBoundingClientRect();
		return [(e.clientX - r.left) / state.zoom, (e.clientY - r.top) / state.zoom];
	}

	const CORNERS = [
		[-1, -1],
		[1, -1],
		[1, 1],
		[-1, 1]
	];

	function hitHandle(o, bx, by) {
		if(o.type === 'draw') return -1;
		const tol = HANDLE / state.zoom,
			l = toLocal(o, bx, by);
		if(o.type === 'line') { // the two ends: 0 = start, 2 = end
			if(Math.abs(l[0] + o.w / 2) <= tol && Math.abs(l[1]) <= tol) return 0;
			if(Math.abs(l[0] - o.w / 2) <= tol && Math.abs(l[1]) <= tol) return 2;
			return -1;
		}
		for(let i = 0; i < 4; i++) {
			if(Math.abs(l[0] - CORNERS[i][0] * o.w / 2) <= tol && Math.abs(l[1] - CORNERS[i][1] * o.h / 2) <= tol) return i;
		}
		return -1;
	}

	function hitObj(o, px, py, tol) {
		if(o.type === 'line') {
			const a = objPoint(o, -o.w / 2, 0),
				b = objPoint(o, o.w / 2, 0);
			return distToSegment(px, py, a[0], a[1], b[0], b[1]) <= o.sw / 2 + tol + 2 / state.zoom;
		}
		return hitObject(o, px, py, tol);
	}

	function topObjectAt(bx, by) {
		const objs = curRec().objects,
			tol = 3 / state.zoom;
		for(let i = objs.length - 1; i >= 0; i--) {
			if(hitObj(objs[i], bx, by, tol)) return objs[i];
		}
		return null;
	}

	function snapAngle(a, b) {
		const dx = b[0] - a[0],
			dy = b[1] - a[1],
			len = Math.hypot(dx, dy),
			t = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
		return [a[0] + Math.cos(t) * len, a[1] + Math.sin(t) * len];
	}

	overCv.addEventListener('pointerdown', (e) => {
		if(!curRec() || state.busy) return;
		if(overCv.setPointerCapture) {
			try {
				overCv.setPointerCapture(e.pointerId);
			} catch(x) { }
		}
		const p = toBase(e),
			tool = state.tool;
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
				align: 'left',
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
			o.x = p[0] + o.w / 2 - o.w * alignK(o); // the click marks the aligned edge
			o.y = p[1] + o.h / 2;
			curRec().objects.push(o);
			state.selectedId = o.id;
			pushHistory();
			setTool('select');
			C.textValue.focus();
			C.textValue.select();
			return;
		}
		if(tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'highlight') {
			state.draft = {
				type: tool,
				x0: p[0],
				y0: p[1],
				x1: p[0],
				y1: p[1]
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
					cs = CORNERS[h];
				state.drag = {
					mode: 'resize',
					o: sel,
					handle: h,
					d0: Math.max(1, Math.hypot(l[0], l[1])),
					size0: sel.size,
					w0: sel.w,
					h0: sel.h,
					fixed: sel.type === 'line' ? objPoint(sel, -cs[0] * sel.w / 2, 0) : objPoint(sel, -cs[0] * sel.w / 2, -cs[1] * sel.h / 2),
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
		const rec = curRec();
		if(!rec) return;
		let p = toBase(e);
		const d = state.drag;
		if(state.draft) {
			const dr = state.draft;
			if(dr.type === 'draw') {
				const last = dr.points[dr.points.length - 1];
				if(Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.8) dr.points.push(p);
			} else {
				if(e.shiftKey) {
					if(dr.type === 'line') p = snapAngle([dr.x0, dr.y0], p);
					else if(dr.type !== 'highlight') {
						const dx = p[0] - dr.x0,
							dy = p[1] - dr.y0,
							m = Math.max(Math.abs(dx), Math.abs(dy));
						p = [dr.x0 + (dx < 0 ? -m : m), dr.y0 + (dy < 0 ? -m : m)];
					}
				}
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
					let nx = d.x0 + dx,
						ny = d.y0 + dy;
					const tol = 5 / state.zoom;
					state.guides = {
						v: false,
						h: false
					};
					if(!e.altKey && Math.abs(nx - rec.w / 2) < tol) {
						nx = rec.w / 2;
						state.guides.v = true;
					}
					if(!e.altKey && Math.abs(ny - rec.h / 2) < tol) {
						ny = rec.h / 2;
						state.guides.h = true;
					}
					o.x = nx;
					o.y = ny;
				}
			} else if(o.type === 'line') {
				if(e.shiftKey) p = snapAngle(d.fixed, p);
				const g = d.handle === 0 ? lineGeom(p, d.fixed) : lineGeom(d.fixed, p);
				Object.assign(o, g);
				C.rotation.value = Math.round(o.rot);
				C.rotationVal.textContent = Math.round(o.rot) + '°';
			} else if(o.type === 'rect' || o.type === 'ellipse' || o.type === 'highlight') {
				const t = -(o.rot || 0) * Math.PI / 180,
					c = Math.cos(t),
					s = Math.sin(t),
					vx = p[0] - d.fixed[0],
					vy = p[1] - d.fixed[1];
				const lxs = vx * c - vy * s,
					lys = vx * s + vy * c;
				let lw = Math.abs(lxs),
					lh = Math.abs(lys);
				if(e.shiftKey && o.type !== 'highlight') lw = lh = Math.max(lw, lh);
				o.w = Math.max(2, lw);
				o.h = Math.max(2, lh);
				// keep the opposite corner where it was
				const t2 = (o.rot || 0) * Math.PI / 180,
					c2 = Math.cos(t2),
					s2 = Math.sin(t2),
					hx = (lxs < 0 ? -1 : 1) * o.w / 2,
					hy = (lys < 0 ? -1 : 1) * o.h / 2;
				o.x = d.fixed[0] + hx * c2 - hy * s2;
				o.y = d.fixed[1] + hx * s2 + hy * c2;
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
		if(state.tool === 'select') {
			const sel = getSelected();
			const over = topObjectAt(p[0], p[1]) || (sel && hitHandle(sel, p[0], p[1]) >= 0);
			overCv.classList.toggle('cursor-move', !!over);
		}
	});

	function endPointer() {
		if(state.draft) {
			const dr = state.draft;
			state.draft = null;
			if(dr.type === 'draw') {
				curRec().objects.push({
					id: nid(),
					type: 'draw',
					points: dr.points,
					color: dr.color,
					width: dr.width,
					opacity: 1
				});
				pushHistory();
			} else {
				const o = draftObject(dr);
				const big = dr.type === 'line' ? o.w >= 3 : (o.w >= 3 && o.h >= 3);
				if(big) {
					o.id = nid();
					if(dr.type === 'highlight') {
						curRec().objects.push(o);
						pushHistory();
					} else {
						addObject(o);
						setTool('select');
						select(o.id);
					}
				}
			}
			drawOverlay();
		}
		if(state.drag) {
			if(state.drag.changed) pushHistory();
			state.drag = null;
			if(state.guides) {
				state.guides = null;
				drawOverlay();
			}
		}
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

	// ---- pictures and signature ----

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
		const rec = curRec();
		const w = Math.min(width, rec.w * 0.8),
			h = Math.min(w * asset.canvas.height / asset.canvas.width, rec.h * 0.8),
			ww = h * asset.canvas.width / asset.canvas.height;
		addObject({
			id: nid(),
			type: 'image',
			asset: asset,
			x: rec.w / 2,
			y: rec.h / 2,
			w: ww,
			h: h,
			rot: 0,
			opacity: 1
		});
		setTool('select');
		select(state.selectedId);
	}

	async function addImageFile(file) {
		if(!curRec()) return;
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
			placeAsset(asset, Math.min(300, img.naturalWidth));
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

	// ---- saving ----

	function cleanName(s) {
		return String(s || '').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '').trim() || 'document';
	}

	async function exportPdf() {
		if(!state.pages.length || state.busy) return;
		const L = window.PDFLib;
		setBusy(true);
		clearError();
		setStatus('Preparing your PDF…');
		try {
			await new Promise((r) => setTimeout(r, 30));
			state.fileName = cleanName(nameInput.value);
			const doc = await L.PDFDocument.create();
			doc.setTitle(state.fileName);
			doc.setCreator('Matte PDF Creator');
			doc.setProducer('Matte Tools');
			const fonts = new Map(),
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
				const page = doc.addPage([rec.w, rec.h]);
				if(!/^#?f{6}$/i.test(rec.bg)) page.drawRectangle({
					x: 0,
					y: 0,
					width: rec.w,
					height: rec.h,
					color: hexRgb(L, rec.bg)
				});
				await drawObjects(L, page, rec.objects, (x, y) => [x, rec.h - y], res);
			}

			const out = await doc.save();
			const url = URL.createObjectURL(new Blob([out], {
				type: 'application/pdf'
			}));
			const a = document.createElement('a');
			a.href = url;
			a.download = state.fileName + '.pdf';
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(() => URL.revokeObjectURL(url), 4000);
			state.savedIndex = state.hIndex;
			setStatus('Saved ' + state.pages.length + (state.pages.length === 1 ? ' page.' : ' pages.'), 'ok');
		} catch(e) {
			console.error(e);
			setStatus('', '');
			showError('Could not save the PDF: ' + (e && e.message ? e.message : e));
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
		const ak = alignK(o);
		o.text.split('\n').forEach((line, i) => {
			const by = textBaselineY(o, i) + o.h / 2,
				lw = x.measureText(line).width,
				lx = (o.w - lw) * ak;
			x.fillText(line, lx, by);
			if(o.underline && line) x.fillRect(lx, by + 0.14 * o.size - o.size / 32, lw, Math.max(0.5, o.size / 16));
		});
		return canvasBytes(c, 'image/png');
	}

	function setBusy(b) {
		state.busy = b;
		downloadBtn.disabled = b;
	}

	function showLibsError() {
		showError('The PDF library was not found. Make sure assets/vendors/pdf/pdf-lib.min.js is on your site, then reload.');
	}

	// ---- new document screen ----

	function setupOrient() {
		const a = S.orient.find((b) => b.classList.contains('active'));
		return a ? a.dataset.orient : 'portrait';
	}

	S.size.addEventListener('change', () => show(S.custom, S.size.value === 'custom'));
	S.orient.forEach((b) => b.addEventListener('click', () => {
		S.orient.forEach((x) => x.classList.toggle('active', x === b));
		if(S.size.value === 'custom' && ((b.dataset.orient === 'landscape') !== (parseFloat(S.w.value) > parseFloat(S.h.value)))) {
			const t = S.w.value;
			S.w.value = S.h.value;
			S.h.value = t;
		}
	}));

	function createDocument() {
		if(!libsOk()) {
			showLibsError();
			return;
		}
		clearError();
		let w, h;
		if(S.size.value === 'custom') {
			w = parseFloat(S.w.value) * MM;
			h = parseFloat(S.h.value) * MM;
			if(!(w > 0) || !(h > 0)) {
				showError('Enter a page width and height in millimetres.');
				return;
			}
		} else {
			const s = PAGE_SIZES[S.size.value] || PAGE_SIZES.a4,
				land = setupOrient() === 'landscape';
			w = land ? s[1] : s[0];
			h = land ? s[0] : s[1];
		}
		w = clamp(w, MIN_PAGE, MAX_PAGE);
		h = clamp(h, MIN_PAGE, MAX_PAGE);
		const n = clamp(parseInt(S.count.value, 10) || 1, 1, 200);
		state.fileName = cleanName(S.name.value);
		nameInput.value = state.fileName;
		state.nextId = 1;
		state.pages = [];
		for(let i = 0; i < n; i++) state.pages.push({
			id: nid(),
			w: w,
			h: h,
			bg: S.bg.value || '#FFFFFF',
			objects: []
		});
		state.cur = 0;
		state.selectedId = null;
		state.draft = null;
		state.drag = null;
		state.history = [];
		state.hIndex = -1;
		pushHistory();
		state.savedIndex = 0;
		setupEl.classList.add('is-hidden');
		workspace.classList.remove('is-hidden');
		setTool('select');
		rebuildSidebar();
		state.zoom = fitZoom();
		setZoom(state.zoom);
		setStatus('');
	}

	function resetEditor() {
		if(isDirty() && window.confirm && !window.confirm('Discard this document and start a new one?')) return;
		state.pages = [];
		state.history = [];
		state.hIndex = -1;
		state.savedIndex = 0;
		workspace.classList.add('is-hidden');
		setupEl.classList.remove('is-hidden');
		clearError();
		setStatus('');
	}

	S.create.addEventListener('click', createDocument);
	S.name.addEventListener('keydown', (e) => {
		if(e.key === 'Enter') createDocument();
	});

	document.querySelectorAll('#peTools .mode-btn').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

	$('peAddImageBtn').addEventListener('click', () => {
		if(curRec()) imageInput.click();
	});

	imageInput.addEventListener('change', (e) => {
		if(e.target.files[0]) addImageFile(e.target.files[0]);
		imageInput.value = '';
	});

	// drop or paste a picture straight onto the page
	['dragenter', 'dragover'].forEach((evt) => canvasWrap.addEventListener(evt, (e) => {
		if(e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1) e.preventDefault();
	}));
	canvasWrap.addEventListener('drop', (e) => {
		const f = e.dataTransfer && e.dataTransfer.files[0];
		if(f) {
			e.preventDefault();
			addImageFile(f);
		}
	});
	document.addEventListener('paste', (e) => {
		if(!curRec()) return;
		const tag = (e.target.tagName || '').toLowerCase();
		if(tag === 'input' || tag === 'textarea') return;
		const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
		const it = items.find((x) => x.kind === 'file' && /^image\//.test(x.type));
		if(it) {
			e.preventDefault();
			addImageFile(it.getAsFile());
		}
	});

	nameInput.addEventListener('change', () => {
		nameInput.value = cleanName(nameInput.value);
		state.fileName = nameInput.value;
	});

	undoBtn.addEventListener('click', undo);
	redoBtn.addEventListener('click', redo);
	prevBtn.addEventListener('click', () => goToPage(state.cur - 1));
	nextBtn.addEventListener('click', () => goToPage(state.cur + 1));
	$('peZoomOut').addEventListener('click', () => setZoom(state.zoom / 1.2));
	$('peZoomIn').addEventListener('click', () => setZoom(state.zoom * 1.2));
	$('peFitBtn').addEventListener('click', () => setZoom(fitZoom()));
	$('pcAddPageBtn').addEventListener('click', addPage);
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
		if(mod && k === 'd') {
			e.preventDefault();
			duplicateSelected();
			return;
		}
		if(mod && k === 's') {
			e.preventDefault();
			exportPdf();
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
})();
