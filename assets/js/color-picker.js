(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const stage = $('cpStage'),
		fileInput = $('cpFileInput'),
		errBox = $('cpErr'),
		toolbar = $('cpToolbar'),
		statusEl = $('cpStatus'),
		settings = $('cpSettings'),
		countSel = $('cpCount'),
		work = $('cpWork'),
		grid = $('cpImages'),
		allBtn = $('cpAllBtn'),
		previewBox = $('cpPreviewBox'),
		previewCv = $('cpPreview'),
		loupe = $('cpLoupe'),
		rowsEl = $('cpRows'),
		titleEl = $('cpTableTitle'),
		subEl = $('cpTableSub'),
		toast = $('cpToast');

	const SAMPLE_SIDE = 160; // pixels per side used to find the main colors
	const PICK_SIDE = 1600; // resolution kept for the eyedropper
	const ALPHA_MIN = 8; // pixels more transparent than this are ignored
	const MIN_SHARE = 0.005; // colors covering less than 0.5% of an image are left out

	let images = [],
		selId = null,
		uid = 0,
		busy = false;

	// ---------- color maths ----------

	const r2 = (n) => Math.round(n * 100) / 100;

	function hex2(n) {
		return n.toString(16).padStart(2, '0').toUpperCase();
	}

	function toHsl(r, g, b) {
		r /= 255;
		g /= 255;
		b /= 255;
		const max = Math.max(r, g, b),
			min = Math.min(r, g, b),
			l = (max + min) / 2,
			d = max - min;
		let h = 0,
			s = 0;
		if(d) {
			s = d / (1 - Math.abs(2 * l - 1));
			if(max === r) h = ((g - b) / d) % 6;
			else if(max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h *= 60;
			if(h < 0) h += 360;
		}
		return [Math.round(h) % 360, Math.round(s * 100), Math.round(l * 100)];
	}

	function formats(c) {
		const r = c.r,
			g = c.g,
			b = c.b,
			a = r2(c.a / 255);
		const hsl = toHsl(r, g, b);
		const max = Math.max(r, g, b) / 255,
			min = Math.min(r, g, b) / 255;
		const k = 1 - max,
			cmy = (v) => k >= 1 ? 0 : Math.round((1 - v / 255 - k) / (1 - k) * 100);
		const hex = '#' + hex2(r) + hex2(g) + hex2(b) + (a < 1 ? hex2(Math.round(a * 255)) : '');
		return {
			hex: hex,
			rgb: 'rgb(' + r + ', ' + g + ', ' + b + ')',
			rgba: 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')',
			hsl: 'hsl(' + hsl[0] + ', ' + hsl[1] + '%, ' + hsl[2] + '%)',
			hsla: 'hsla(' + hsl[0] + ', ' + hsl[1] + '%, ' + hsl[2] + '%, ' + a + ')',
			hwb: 'hwb(' + hsl[0] + ' ' + Math.round(min * 100) + '% ' + Math.round((1 - max) * 100) + '%' + (a < 1 ? ' / ' + a : '') + ')',
			cmyk: 'cmyk(' + cmy(r) + '%, ' + cmy(g) + '%, ' + cmy(b) + '%, ' + Math.round(k * 100) + '%)'
		};
	}

	const COLS = [
		['hex', 'HEX'],
		['rgb', 'RGB'],
		['rgba', 'RGBA'],
		['hsl', 'HSL'],
		['hsla', 'HSLA'],
		['hwb', 'HWB'],
		['cmyk', 'CMYK']
	];

	function dist2(a, b) {
		const dr = a.r - b.r,
			dg = a.g - b.g,
			db = a.b - b.b,
			da = (a.a - b.a) * 0.5;
		return dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 + da * da; // weighted like the eye sees brightness
	}

	// ---------- finding the main colors ----------

	function rng(seed) { // small repeatable random generator, so the same image always gives the same palette
		return function() {
			seed |= 0;
			seed = seed + 0x6D2B79F5 | 0;
			let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
			t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
			return ((t ^ t >>> 14) >>> 0) / 4294967296;
		};
	}

	function samplePixels(src) {
		const w0 = src.width,
			h0 = src.height,
			k = Math.min(1, SAMPLE_SIDE / Math.max(w0, h0));
		const c = document.createElement('canvas');
		c.width = Math.max(1, Math.round(w0 * k));
		c.height = Math.max(1, Math.round(h0 * k));
		const x = c.getContext('2d', {
			willReadFrequently: true
		});
		x.drawImage(src, 0, 0, c.width, c.height);
		const d = x.getImageData(0, 0, c.width, c.height).data;
		const pts = [];
		for(let i = 0; i < d.length; i += 4) {
			if(d[i + 3] >= ALPHA_MIN) pts.push({
				r: d[i],
				g: d[i + 1],
				b: d[i + 2],
				a: d[i + 3]
			});
		}
		return pts;
	}

	function kmeans(pts, k) {
		const n = pts.length;
		if(!n) return [];
		const rand = rng(n * 31 + k);
		// k-means++ start: spread the first centers out across the colors
		const centers = [Object.assign({}, pts[Math.floor(rand() * n)])];
		const dmin = new Float64Array(n).fill(Infinity);
		while(centers.length < k) {
			const last = centers[centers.length - 1];
			let sum = 0;
			for(let i = 0; i < n; i++) {
				const d = dist2(pts[i], last);
				if(d < dmin[i]) dmin[i] = d;
				sum += dmin[i];
			}
			if(sum === 0) break; // fewer distinct colors than k
			let t = rand() * sum,
				i = 0;
			for(; i < n - 1; i++) {
				t -= dmin[i];
				if(t <= 0) break;
			}
			centers.push(Object.assign({}, pts[i]));
		}
		const kk = centers.length,
			assign = new Int32Array(n);
		for(let it = 0; it < 16; it++) {
			const acc = centers.map(() => ({
				r: 0,
				g: 0,
				b: 0,
				a: 0,
				n: 0
			}));
			let moved = 0;
			for(let i = 0; i < n; i++) {
				const p = pts[i];
				let best = 0,
					bd = Infinity;
				for(let j = 0; j < kk; j++) {
					const d = dist2(p, centers[j]);
					if(d < bd) {
						bd = d;
						best = j;
					}
				}
				if(assign[i] !== best) moved++;
				assign[i] = best;
				const s = acc[best];
				s.r += p.r;
				s.g += p.g;
				s.b += p.b;
				s.a += p.a;
				s.n++;
			}
			for(let j = 0; j < kk; j++) {
				const s = acc[j];
				if(s.n) centers[j] = {
					r: s.r / s.n,
					g: s.g / s.n,
					b: s.b / s.n,
					a: s.a / s.n,
					n: s.n
				};
				else centers[j].n = 0;
			}
			if(it > 0 && moved === 0) break;
		}
		return centers.filter((c) => c.n > 0).map((c) => ({
			r: Math.round(c.r),
			g: Math.round(c.g),
			b: Math.round(c.b),
			a: Math.round(c.a),
			w: c.n / n
		}));
	}

	// joins colors that look the same, adding up their shares
	function mergeClose(list, limit) {
		const out = [];
		list.slice().sort((a, b) => b.w - a.w).forEach((c) => {
			const m = out.find((o) => dist2(o, c) < limit);
			if(m) {
				const t = m.w + c.w;
				if(t > 0) ['r', 'g', 'b', 'a'].forEach((ch) => {
					m[ch] = Math.round((m[ch] * m.w + c[ch] * c.w) / t);
				});
				m.w = t;
			} else out.push(Object.assign({}, c));
		});
		return out.sort((a, b) => b.w - a.w);
	}

	function analyse(item) {
		const k = parseInt(countSel.value, 10) || 10;
		const pal = mergeClose(kmeans(item.pts, k), 40);
		// drop specks (e.g. blurry JPEG edges) that cover almost none of the image
		const main = pal.filter((c) => c.w >= MIN_SHARE);
		item.palette = main.length ? main : pal.slice(0, 1);
	}

	// ---------- loading ----------

	function showErr(t) {
		errBox.textContent = t || '';
		errBox.classList.toggle('show', !!t);
	}

	function isImage(f) {
		return /^image\//.test(f.type) || /\.(jpe?g|jfif|png|webp|gif|bmp|svg|avif|ico|tiff?)$/i.test(f.name);
	}

	function loadImage(url) {
		return new Promise((res, rej) => {
			const img = new Image();
			img.onload = () => res(img);
			img.onerror = () => rej(new Error('decode'));
			img.src = url;
		});
	}

	async function addFiles(list) {
		if(busy) return;
		showErr('');
		const files = Array.from(list || []).filter(isImage);
		if(!files.length) {
			showErr('Please choose picture files (JPG, PNG, WEBP, GIF, BMP or SVG).');
			return;
		}
		busy = true;
		const bad = [];
		for(let i = 0; i < files.length; i++) {
			setStatus('Reading ' + (i + 1) + ' of ' + files.length + '…', true);
			await new Promise((r) => setTimeout(r, 0));
			const f = files[i],
				url = URL.createObjectURL(f);
			try {
				const img = await loadImage(url);
				let w = img.naturalWidth || img.width,
					h = img.naturalHeight || img.height;
				if(!w || !h) {
					w = 600;
					h = 600;
				}
				const k = Math.min(1, PICK_SIDE / Math.max(w, h));
				const big = document.createElement('canvas');
				big.width = Math.max(1, Math.round(w * k));
				big.height = Math.max(1, Math.round(h * k));
				const bx = big.getContext('2d', {
					willReadFrequently: true
				});
				bx.drawImage(img, 0, 0, big.width, big.height);
				const item = {
					id: ++uid,
					name: f.name,
					url: url,
					w: w,
					h: h,
					big: big,
					bigData: null,
					pts: samplePixels(big),
					palette: [],
					picked: []
				};
				analyse(item);
				images.push(item);
			} catch(e) {
				URL.revokeObjectURL(url);
				bad.push(f.name);
			}
		}
		busy = false;
		if(bad.length) showErr('Could not read: ' + bad.join(', ') + '. Your browser may not support that picture format.');
		render();
	}

	// ---------- drawing the page ----------

	function setStatus(t, spin) {
		statusEl.innerHTML = '';
		if(spin) {
			const s = document.createElement('span');
			s.className = 'mini-spinner';
			statusEl.appendChild(s);
		}
		statusEl.appendChild(document.createTextNode(t));
	}

	function selected() {
		return images.find((x) => x.id === selId) || null;
	}

	function currentColors() {
		const sel = selected();
		if(sel) return sel.picked.map((c) => Object.assign({
			picked: true
		}, c)).concat(sel.palette);
		// every image counts equally in the combined view
		const n = images.length || 1;
		const all = [];
		images.forEach((im) => im.palette.forEach((c) => all.push(Object.assign({}, c, {
			w: c.w / n
		}))));
		const merged = mergeClose(all, 120);
		const picked = [];
		images.forEach((im) => im.picked.forEach((c) => {
			if(!picked.some((p) => p.r === c.r && p.g === c.g && p.b === c.b && p.a === c.a)) picked.push(Object.assign({
				picked: true
			}, c));
		}));
		return picked.concat(merged);
	}

	function render() {
		const has = images.length > 0;
		stage.hidden = has;
		work.hidden = !has;
		toolbar.classList.toggle('show', has);
		settings.classList.toggle('show', has);
		if(selId !== null && !selected()) selId = null;
		if(!has) {
			setStatus('Ready');
			return;
		}
		renderGrid();
		renderPreview();
		renderTable();
	}

	function renderGrid() {
		grid.innerHTML = '';
		allBtn.classList.toggle('is-active', selId === null);
		images.forEach((im) => {
			const tile = document.createElement('div');
			tile.className = 'cp-tile' + (im.id === selId ? ' is-active' : '');
			tile.tabIndex = 0;
			tile.title = im.name;
			tile.dataset.id = im.id;

			const ph = document.createElement('div');
			ph.className = 'cp-thumb';
			const img = document.createElement('img');
			img.src = im.url;
			img.alt = im.name;
			ph.appendChild(img);

			const x = document.createElement('button');
			x.type = 'button';
			x.className = 'cp-x';
			x.setAttribute('aria-label', 'Remove ' + im.name);
			x.innerHTML = '<i class="fa-solid fa-xmark"></i>';
			x.dataset.remove = im.id;
			ph.appendChild(x);

			const strip = document.createElement('div');
			strip.className = 'cp-strip';
			im.palette.slice(0, 8).forEach((c) => {
				const s = document.createElement('span');
				s.style.background = 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + r2(c.a / 255) + ')';
				s.style.flexGrow = Math.max(0.15, c.w);
				strip.appendChild(s);
			});

			const nm = document.createElement('div');
			nm.className = 'cp-name';
			nm.textContent = im.name;

			tile.appendChild(ph);
			tile.appendChild(strip);
			tile.appendChild(nm);
			grid.appendChild(tile);
		});
	}

	function renderPreview() {
		const sel = selected();
		previewBox.hidden = !sel;
		loupe.hidden = true;
		if(!sel) return;
		previewCv.width = sel.big.width;
		previewCv.height = sel.big.height;
		previewCv.getContext('2d').drawImage(sel.big, 0, 0);
	}

	function renderTable() {
		const sel = selected(),
			colors = currentColors();
		titleEl.textContent = sel ? sel.name : 'All colors';
		subEl.textContent = colors.length + ' color' + (colors.length === 1 ? '' : 's') +
			(sel ? ' in this image' : ' from ' + images.length + ' image' + (images.length === 1 ? '' : 's'));
		setStatus(images.length + ' image' + (images.length === 1 ? '' : 's') + ' · ' + (sel ? 'showing 1 image' : 'showing all colors'));
		rowsEl.innerHTML = '';
		colors.forEach((c) => {
			const f = formats(c),
				tr = document.createElement('tr');
			const td0 = document.createElement('td');
			td0.className = 'cp-swcell';
			const sw = document.createElement('button');
			sw.type = 'button';
			sw.className = 'cp-sw';
			sw.title = 'Copy ' + f.hex;
			sw.dataset.copy = f.hex;
			const fill = document.createElement('span');
			fill.style.background = f.rgba;
			sw.appendChild(fill);
			const side = document.createElement('div');
			side.className = 'cp-hexbox';
			const hb = document.createElement('button');
			hb.type = 'button';
			hb.className = 'cp-val';
			hb.textContent = f.hex;
			hb.dataset.copy = f.hex;
			hb.title = 'Copy';
			const share = document.createElement('small');
			share.className = 'cp-share' + (c.picked ? ' is-picked' : '');
			share.textContent = c.picked ? 'Picked' : (c.w * 100 < 1 ? '<1%' : Math.round(c.w * 100) + '%') + ' of ' + (sel ? 'image' : 'all');
			side.appendChild(hb);
			side.appendChild(share);
			td0.appendChild(sw);
			td0.appendChild(side);
			tr.appendChild(td0);
			COLS.slice(1).forEach((col) => {
				const td = document.createElement('td'),
					b = document.createElement('button');
				b.type = 'button';
				b.className = 'cp-val';
				b.textContent = f[col[0]];
				b.dataset.copy = f[col[0]];
				b.title = 'Copy';
				td.appendChild(b);
				tr.appendChild(td);
			});
			rowsEl.appendChild(tr);
		});
	}

	// ---------- copying and exporting ----------

	let toastTimer = 0;

	function flash(t) {
		toast.textContent = t;
		toast.classList.add('show');
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => toast.classList.remove('show'), 1400);
	}

	function copy(text) {
		const done = () => flash('Copied ' + (text.length > 40 ? 'to clipboard' : text));
		if(navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
		} else fallbackCopy(text, done);
	}

	function fallbackCopy(text, done) {
		const t = document.createElement('textarea');
		t.value = text;
		t.style.position = 'fixed';
		t.style.opacity = '0';
		document.body.appendChild(t);
		t.select();
		try {
			document.execCommand('copy');
			done();
		} catch(e) {
			flash('Could not copy');
		}
		t.remove();
	}

	rowsEl.addEventListener('click', (e) => {
		const b = e.target.closest('[data-copy]');
		if(b) copy(b.dataset.copy);
	});

	$('cpCopyHex').addEventListener('click', () => {
		const list = currentColors().map((c) => formats(c).hex);
		if(list.length) copy(list.join('\n'));
	});

	$('cpCsvBtn').addEventListener('click', () => {
		const sel = selected();
		const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
		const lines = [['Share', 'HEX', 'RGB', 'RGBA', 'HSL', 'HSLA', 'HWB', 'CMYK'].map(q).join(',')];
		currentColors().forEach((c) => {
			const f = formats(c);
			lines.push([c.picked ? 'Picked' : (Math.round(c.w * 1000) / 10) + '%'].concat(COLS.map((col) => f[col[0]])).map(q).join(','));
		});
		const blob = new Blob([lines.join('\r\n')], {
			type: 'text/csv'
		});
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = (sel ? sel.name.replace(/\.[^.]+$/, '') : 'colors') + '-palette.csv';
		document.body.appendChild(a);
		a.click();
		setTimeout(() => {
			URL.revokeObjectURL(a.href);
			a.remove();
		}, 3000);
	});

	// ---------- choosing images ----------

	function choose(id) {
		selId = selId === id ? null : id;
		render();
	}

	grid.addEventListener('click', (e) => {
		const rm = e.target.closest('[data-remove]');
		if(rm) {
			e.stopPropagation();
			const id = parseInt(rm.dataset.remove, 10),
				i = images.findIndex((x) => x.id === id);
			if(i >= 0) {
				URL.revokeObjectURL(images[i].url);
				images.splice(i, 1);
			}
			render();
			return;
		}
		const tile = e.target.closest('.cp-tile');
		if(tile) choose(parseInt(tile.dataset.id, 10));
	});

	grid.addEventListener('keydown', (e) => {
		const tile = e.target.closest('.cp-tile');
		if(tile && (e.key === 'Enter' || e.key === ' ')) {
			e.preventDefault();
			choose(parseInt(tile.dataset.id, 10));
		}
	});

	allBtn.addEventListener('click', () => {
		selId = null;
		render();
	});

	// ---------- eyedropper on the selected image ----------

	function pixelAt(e) {
		const sel = selected();
		if(!sel) return null;
		const r = previewCv.getBoundingClientRect();
		const x = Math.floor((e.clientX - r.left) / r.width * sel.big.width),
			y = Math.floor((e.clientY - r.top) / r.height * sel.big.height);
		if(x < 0 || y < 0 || x >= sel.big.width || y >= sel.big.height) return null;
		if(!sel.bigData) sel.bigData = sel.big.getContext('2d', {
			willReadFrequently: true
		}).getImageData(0, 0, sel.big.width, sel.big.height).data;
		const i = (y * sel.big.width + x) * 4,
			d = sel.bigData;
		return {
			c: {
				r: d[i],
				g: d[i + 1],
				b: d[i + 2],
				a: d[i + 3]
			},
			x: e.clientX - r.left,
			y: e.clientY - r.top,
			w: r.width
		};
	}

	previewCv.addEventListener('mousemove', (e) => {
		const p = pixelAt(e);
		if(!p) {
			loupe.hidden = true;
			return;
		}
		const f = formats(p.c);
		loupe.hidden = false;
		loupe.querySelector('.sw').style.background = f.rgba;
		loupe.querySelector('.tx').textContent = f.hex;
		const left = p.x + 16 + 120 > p.w ? p.x - 16 - 120 : p.x + 16;
		loupe.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(p.y + 16) + 'px)';
	});

	previewCv.addEventListener('mouseleave', () => {
		loupe.hidden = true;
	});

	previewCv.addEventListener('click', (e) => {
		const sel = selected(),
			p = pixelAt(e);
		if(!sel || !p) return;
		const c = p.c;
		sel.picked = sel.picked.filter((q) => !(q.r === c.r && q.g === c.g && q.b === c.b && q.a === c.a));
		sel.picked.unshift(Object.assign({
			w: 0
		}, c));
		renderTable();
		flash('Added ' + formats(c).hex);
	});

	// ---------- adding files ----------

	stage.addEventListener('click', () => fileInput.click());
	stage.addEventListener('keydown', (e) => {
		if(e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			fileInput.click();
		}
	});
	['dragenter', 'dragover'].forEach((t) => stage.addEventListener(t, (e) => {
		e.preventDefault();
		stage.classList.add('drag');
	}));
	['dragleave', 'drop'].forEach((t) => stage.addEventListener(t, (e) => {
		e.preventDefault();
		stage.classList.remove('drag');
	}));
	stage.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

	work.addEventListener('dragover', (e) => {
		if(e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') !== -1) e.preventDefault();
	});
	work.addEventListener('drop', (e) => {
		if(e.dataTransfer && e.dataTransfer.files.length) {
			e.preventDefault();
			addFiles(e.dataTransfer.files);
		}
	});

	document.addEventListener('paste', (e) => {
		const tag = (e.target.tagName || '').toLowerCase();
		if(tag === 'input' || tag === 'textarea') return;
		const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
		if(files.length) {
			e.preventDefault();
			addFiles(files);
		}
	});

	fileInput.addEventListener('change', () => {
		addFiles(fileInput.files);
		fileInput.value = '';
	});

	$('cpAddBtn').addEventListener('click', () => fileInput.click());

	$('cpClearBtn').addEventListener('click', () => {
		images.forEach((im) => URL.revokeObjectURL(im.url));
		images = [];
		selId = null;
		showErr('');
		render();
	});

	countSel.addEventListener('change', () => {
		images.forEach(analyse);
		render();
	});
})();
