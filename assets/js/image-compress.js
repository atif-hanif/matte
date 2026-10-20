(function () {
	'use strict';

	const LIBS = {
		pako: 'assets/vendors/pako/pako.min.js',
		upng: 'assets/vendors/upng/UPNG.js'
	};

	const $ = (id) => document.getElementById(id);

	const stage = $('cmStage');
	const dropMsg = $('cmDropMsg');
	const dropBig = dropMsg.querySelector('.big');
	const dropSmall = dropMsg.querySelector('.small');
	const fileInput = $('cmFileInput');
	const grid = $('cmGrid');
	const toolbar = $('cmToolbar');
	const toolbarStatus = $('cmToolbarStatus');
	const clearBtn = $('cmClearBtn');
	const downloadAllBtn = $('cmDownloadAllBtn');
	const errBox = $('cmErr');
	const formatEl = $('cmFormat');
	const qualityEl = $('cmQuality');
	const qualityVal = $('cmQualityVal');
	const maxEl = $('cmMax');
	const colorsEl = $('cmColors');

	const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
	const LABEL = { jpeg: 'JPG', png: 'PNG', webp: 'WEBP' };

	let items = [];
	let idCounter = 0;
	let working = false;
	let settingsDirty = false;
	let rerunTimer = 0;
	let upngPromise = null;
	let libsFailed = false;

	function webpEncodeSupported() {
		try {
			const c = document.createElement('canvas');
			c.width = c.height = 1;
			return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
		} catch (e) {
			return false;
		}
	}

	const WEBP_OK = webpEncodeSupported();
	if (!WEBP_OK) {
		const opt = formatEl.querySelector('option[value="webp"]');
		opt.disabled = true;
		opt.textContent = 'WebP (not supported in this browser)';
	}

	function showError(msg) { 
		errBox.textContent = msg; errBox.classList.add('show'); 
	}

	function clearError() { 
		errBox.classList.remove('show'); errBox.textContent = ''; 
	}

	function typeOf(file) {
		if (/^image\/jpe?g$/i.test(file.type) || /\.(jpe?g|jfif|pjpeg|pjp)$/i.test(file.name)) return 'jpeg';
		if (/^image\/png$/i.test(file.type) || /\.png$/i.test(file.name)) return 'png';
		if (/^image\/webp$/i.test(file.type) || /\.webp$/i.test(file.name)) return 'webp';
		return null;
	}

	function formatBytes(n) {
		if (n < 1024) return n + ' B';
		if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
		return (n / 1024 / 1024).toFixed(2) + ' MB';
	}

	function pct(from, to) {
		const ch = Math.round((to / from - 1) * 100);
		return ch === 0 ? '0%' : (ch > 0 ? '+' : '−') + Math.abs(ch) + '%';
	}

	function outName(item) {
		const r = item.result;
		if (r.kept) return item.file.name;
		return (item.file.name.replace(/\.[^/.]+$/, '') || 'image') + '-compressed.' + EXT[r.outType];
	}

	function uniqueName(name, taken) { 
		if (!taken.has(name)) { taken.add(name); return name; }
		const dot = name.lastIndexOf('.');
		const stem = dot > -1 ? name.slice(0, dot) : name, ext = dot > -1 ? name.slice(dot) : '';
		let n = 2, candidate;
		do { candidate = stem + ' (' + n++ + ')' + ext; } while (taken.has(candidate));
		taken.add(candidate);
		return candidate;
	}

	function loadImageEl(src) {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error('This browser could not open this file as an image.'));
			img.src = src;
		});
	}

	function loadScript(src) {
		return new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			s.onload = () => resolve();
			s.onerror = () => { s.remove(); reject(new Error('Could not load ' + src)); };
			document.head.appendChild(s);
		});
	}

	function triggerDownload(blob, filename) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}

	function refreshDropMsg() {
		if (items.length === 0) {
			dropBig.textContent = 'Drop images here';
			dropSmall.innerHTML = 'or <b>click to browse</b> — select as many as you like';
		} else {
			dropBig.textContent = 'Drop more images here';
			dropSmall.innerHTML = 'or <b>click to add more</b>';
		}
	}

	function getOpts() {
		const q = parseInt(qualityEl.value, 10);
		return {
			format: formatEl.value,
			quality: Math.min(100, Math.max(10, isNaN(q) ? 75 : q)) / 100,
			maxDim: parseInt(maxEl.value, 10) || 0,
			colors: parseInt(colorsEl.value, 10) || 0
		};
	}

	function readHead(file) {
		return new Promise((resolve) => {
			try {
				const r = new FileReader();
				r.onload = () => resolve(new Uint8Array(r.result));
				r.onerror = () => resolve(new Uint8Array(0));
				r.readAsArrayBuffer(file.slice(0, 32));
			} catch (e) { resolve(new Uint8Array(0)); }
		});
	}

	function isAnimatedWebp(bytes) {
		if (bytes.length < 21) return false;
		const tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
		if (tag(0) !== 'RIFF' || tag(8) !== 'WEBP' || tag(12) !== 'VP8X') return false;
		return (bytes[20] & 0x02) !== 0;
	}

	function hasTransparency(img) {
		const s = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
		const w = Math.max(1, Math.round(img.naturalWidth * s)), h = Math.max(1, Math.round(img.naturalHeight * s));
		const c = document.createElement('canvas');
		c.width = w;
		c.height = h;
		const ctx = c.getContext('2d');
		ctx.drawImage(img, 0, 0, w, h);
		const d = ctx.getImageData(0, 0, w, h).data;
		for (let i = 3; i < d.length; i += 4) { if (d[i] < 250) return true; }
		return false;
	}

	function showVeil(card) {
		if (card.querySelector('[data-veil]')) return;
		const v = document.createElement('div');
		v.className = 'veil show';
		v.setAttribute('data-veil', '');
		v.innerHTML = '<div class="mini-spinner"></div>';
		card.querySelector('.thumb').appendChild(v);
	}

	function hideVeil(card) {
		const v = card.querySelector('[data-veil]');
		if (v) v.remove();
	}

	function setTag(card, text) {
		let t = card.querySelector('[data-tag]');
		if (!t) {
			t = document.createElement('span');
			t.className = 'jp-tag';
			t.setAttribute('data-tag', '');
			card.querySelector('.thumb').appendChild(t);
		}
		t.textContent = text;
	}

	function ensureUpng() {
		if (window.UPNG && window.pako) return Promise.resolve(true);
		if (libsFailed) return Promise.resolve(false);
		if (!upngPromise) {
			upngPromise = loadScript(LIBS.pako)
				.then(() => loadScript(LIBS.upng))
				.then(() => !!(window.UPNG && window.pako))
				.catch(() => false)
				.then((ok) => { if (!ok) { libsFailed = true; upngPromise = null; } return ok; });
		}
		return upngPromise;
	}

	async function encodePng(canvas, w, h, colors) {
		if (colors > 0 && (await ensureUpng())) {
			const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data;
			const buf = window.UPNG.encode([rgba.buffer], w, h, colors);
			return { blob: new Blob([buf], { type: 'image/png' }), note: null };
		}
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
		return { blob: blob, note: colors > 0 ? 'nocolors' : null };
	}

	function drawScaled(src, sw, sh, tw, th, fill) {
		let cur = src, cw = sw, ch = sh;
		while (cw * 0.5 > tw && ch * 0.5 > th) {
			const nw = Math.round(cw * 0.5), nh = Math.round(ch * 0.5);
			const c = document.createElement('canvas');
			c.width = nw;
			c.height = nh;
			const x = c.getContext('2d');
			x.imageSmoothingEnabled = true;
			x.imageSmoothingQuality = 'high';
			x.drawImage(cur, 0, 0, nw, nh);
			if (cur !== src) cur.width = cur.height = 0;
			cur = c; cw = nw; ch = nh;
		}
		const out = document.createElement('canvas');
		out.width = tw;
		out.height = th;
		const ox = out.getContext('2d');
		ox.imageSmoothingEnabled = true;
		ox.imageSmoothingQuality = 'high';
		if (fill) { ox.fillStyle = fill; ox.fillRect(0, 0, tw, th); }
		ox.drawImage(cur, 0, 0, tw, th);
		if (cur !== src) cur.width = cur.height = 0;
		return out;
	}

	async function compressOne(item, opts) {
		const img = await loadImageEl(item.originalURL);
		const w = img.naturalWidth, h = img.naturalHeight;
		if (!w || !h) throw new Error('The image has no pixels.');
		const inType = item.type;
		const outType = opts.format === 'original' ? inType : opts.format;
		const keep = (reason) => ({ blob: item.file, outType: inType, w: w, h: h, ow: w, oh: h, kept: reason, notes: [] });

		if (outType === inType && item.animated) return keep('animated');
		if (outType === 'webp' && !WEBP_OK) return keep('nowebp');

		const longest = Math.max(w, h);
		const k = opts.maxDim && longest > opts.maxDim ? opts.maxDim / longest : 1; 
		const tw = Math.max(1, Math.round(w * k)), th = Math.max(1, Math.round(h * k));
		const notes = [];
		if (outType === 'jpeg' && inType !== 'jpeg' && hasTransparency(img)) notes.push('Transparent areas were filled with white (JPG can\u2019t be transparent).');
		if (item.animated) notes.push('Animated WebP: only the first frame is saved.');

		const canvas = drawScaled(img, w, h, tw, th, outType === 'jpeg' ? '#ffffff' : null);
		let blob;
		if (outType === 'png') {
			const enc = await encodePng(canvas, tw, th, opts.colors);
			blob = enc.blob;
			if (enc.note === 'nocolors') notes.push('Color reduction needs a small library that could not be loaded (check your internet connection), so this PNG was saved without it.');
		} else {
			blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/' + outType, opts.quality));
			if (blob && blob.type !== 'image/' + outType) throw new Error("This browser can't save " + LABEL[outType] + ' files from a web page.');
		}
		canvas.width = canvas.height = 0; 
		if (!blob) throw new Error('The browser could not create the compressed file (the image may be too large).');

		if (outType === inType && tw === w && th === h && blob.size >= item.file.size) {
			const r = keep('larger');
			r.notes = notes.filter((n) => /could not be loaded/.test(n)); 
			return r;
		}
		return { blob: blob, outType: outType, w: tw, h: th, ow: w, oh: h, kept: null, notes: notes };
	}

	function makeCard(item) {
		const card = document.createElement('div');
		card.className = 'card';
		card.innerHTML =
			'<div class="thumb cm-checker">' +
				'<img data-img alt="">' +
			'</div>' +
			'<div class="card-foot">' +
				'<div class="card-name" data-name></div>' +
				'<div class="card-foot-row">' +
					'<div class="card-status pending" data-status>Queued</div>' +
					'<button type="button" class="card-dl" data-dl disabled title="Download"><i class="fa-solid fa-download"></i></button>' +
				'</div>' +
				'<div class="jp-size" data-size></div>' +
			'</div>';
		card.querySelector('[data-img]').src = item.originalURL;
		card.querySelector('[data-name]').textContent = item.file.name;
		card.querySelector('[data-size]').textContent = formatBytes(item.file.size) + ' ' + LABEL[item.type];
		card.querySelector('[data-dl]').addEventListener('click', () => {
			if (item.result) triggerDownload(item.result.blob, outName(item));
		});
		grid.appendChild(card);
		return card;
	}

	const KEPT_TEXT = {
		larger: 'Already well compressed: the original is kept.',
		animated: 'Animated WebP: kept as it is.',
		nowebp: 'This browser can\u2019t re-compress WebP: kept as it is.'
	};

	function addNote(sizeEl, text, warn) {
		const n = document.createElement('span');
		n.className = 'cm-note' + (warn ? ' is-warn' : '');
		n.textContent = text;
		sizeEl.appendChild(n);
	}

	function showResult(item, r) {
		const card = item.cardEl;
		item.result = r;
		const statusEl = card.querySelector('[data-status]');
		statusEl.textContent = 'Done';
		statusEl.className = 'card-status done';
		setTag(card, LABEL[r.outType]);
		card.querySelector('[data-dl]').disabled = false;

		if (item.resultURL) { URL.revokeObjectURL(item.resultURL); item.resultURL = null; }
		if (r.kept) {
			card.querySelector('[data-img]').src = item.originalURL;
		} else {
			item.resultURL = URL.createObjectURL(r.blob);
			card.querySelector('[data-img]').src = item.resultURL;
		}

		const sizeEl = card.querySelector('[data-size]');
		sizeEl.textContent = r.w + '\u00D7' + r.h + ' \u00B7 ' + formatBytes(item.file.size) + ' \u2192 ';
		const to = document.createElement('span');
		if (r.kept) {
			to.className = 'cm-same';
			to.textContent = 'unchanged';
		} else {
			const smaller = r.blob.size < item.file.size;
			to.className = 'pj-saving' + (smaller ? '' : ' is-bigger');
			to.textContent = formatBytes(r.blob.size) + ' (' + pct(item.file.size, r.blob.size) + ')';
		}
		sizeEl.appendChild(to);
		if (r.kept) addNote(sizeEl, KEPT_TEXT[r.kept], false);
		if (r.w !== r.ow || r.h !== r.oh) addNote(sizeEl, 'Resized from ' + r.ow + '\u00D7' + r.oh, false);
		r.notes.forEach((t) => addNote(sizeEl, t, /could not be loaded/.test(t)));
	}

	function updateToolbarStatus() {
		const total = items.length;
		const done = items.filter((i) => i.status === 'done');
		const failed = items.filter((i) => i.status === 'error').length;
		toolbarStatus.textContent = '';
		if (working) {
			const sp = document.createElement('div');
			sp.className = 'mini-spinner';
			toolbarStatus.appendChild(sp);
			toolbarStatus.appendChild(document.createTextNode(' Compressing ' + Math.min(done.length + failed + 1, total) + ' of ' + total + '\u2026'));
		} else if (total === 0) {
			toolbarStatus.textContent = 'Ready';
		} else {
			const before = done.reduce((a, i) => a + i.file.size, 0);
			const after = done.reduce((a, i) => a + i.result.blob.size, 0);
			toolbarStatus.appendChild(document.createTextNode('Done \u2014 ' + done.length + ' image' + (done.length === 1 ? '' : 's') + (failed ? ', ' + failed + ' failed' : '')));
			if (done.length) {
				toolbarStatus.appendChild(document.createTextNode(': ' + formatBytes(before) + ' \u2192 ' + formatBytes(after) + ' '));
				const s = document.createElement('span');
				s.className = 'cm-saved';
				s.textContent = '(' + pct(before, after) + ')';
				toolbarStatus.appendChild(s);
			}
		}
		downloadAllBtn.disabled = done.length === 0;
	}

	async function processQueue() {
		if (working) return;
		working = true;
		for (;;) {
			for (const item of items) {
				if (item.status !== 'pending') continue;
				item.status = 'working';
				const statusEl = item.cardEl.querySelector('[data-status]');
				statusEl.textContent = 'Compressing\u2026';
				statusEl.className = 'card-status processing';
				showVeil(item.cardEl);
				updateToolbarStatus();
				await new Promise((r) => setTimeout(r, 0));
				try {
					if (item.animated === undefined) item.animated = item.type === 'webp' ? isAnimatedWebp(await readHead(item.file)) : false;
					const r = await compressOne(item, getOpts());
					item.status = 'done';
					showResult(item, r);
				} catch (e) {
					console.error(e);
					item.status = 'error';
					item.result = null;
					statusEl.textContent = 'Failed';
					statusEl.className = 'card-status error';
					item.cardEl.title = e && e.message ? e.message : String(e);
					item.cardEl.querySelector('[data-size]').textContent = e && e.message ? e.message : 'Compression failed';
				}
				hideVeil(item.cardEl);
				updateToolbarStatus();
			}
			if (!settingsDirty) break;
			settingsDirty = false;
			items.forEach((i) => { if (i.status === 'done') i.status = 'pending'; });
		}
		working = false;
		updateToolbarStatus();
	}

	function reprocessAll() {
		if (!items.length) return;
		if (working) { settingsDirty = true; return; }
		items.forEach((i) => { if (i.status === 'done') i.status = 'pending'; });
		processQueue();
	}
	function settingsChanged() {
		qualityVal.textContent = qualityEl.value + '%';
		libsFailed = false;
		clearTimeout(rerunTimer);
		rerunTimer = setTimeout(reprocessAll, 300);
	}
	[formatEl, qualityEl, maxEl, colorsEl].forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', settingsChanged));

	function addFiles(fileList) {
		const all = Array.from(fileList);
		const ok = all.filter((f) => typeOf(f));
		const skipped = all.length - ok.length;
		if (ok.length === 0) {
			showError('Only JPG, PNG and WebP images can be compressed here. ' + (skipped === 1 ? 'That file was' : 'Those files were') + ' skipped.');
			return;
		}
		if (skipped) showError(skipped + ' file' + (skipped === 1 ? ' was' : 's were') + ' skipped because only JPG, PNG and WebP images are compressed.');
		else clearError();

		libsFailed = false;
		stage.classList.add('compact');
		toolbar.classList.add('show');
		ok.forEach((file) => {
			const item = { id: ++idCounter, file: file, type: typeOf(file), originalURL: URL.createObjectURL(file), resultURL: null, status: 'pending', result: null, animated: undefined };
			item.cardEl = makeCard(item);
			items.push(item);
		});
		refreshDropMsg();
		updateToolbarStatus();
		processQueue();
	}

	stage.addEventListener('click', () => fileInput.click());
	fileInput.addEventListener('change', (e) => { if (e.target.files.length) addFiles(e.target.files); fileInput.value = ''; });
	['dragenter', 'dragover'].forEach((evt) => stage.addEventListener(evt, (e) => { e.preventDefault(); stage.classList.add('drag'); }));
	['dragleave', 'drop'].forEach((evt) => stage.addEventListener(evt, (e) => { e.preventDefault(); stage.classList.remove('drag'); }));
	stage.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

	clearBtn.addEventListener('click', () => {
		clearTimeout(rerunTimer);
		items.forEach((i) => { URL.revokeObjectURL(i.originalURL); if (i.resultURL) URL.revokeObjectURL(i.resultURL); });
		items = [];
		grid.innerHTML = '';
		stage.classList.remove('compact');
		toolbar.classList.remove('show');
		clearError();
		refreshDropMsg();
		updateToolbarStatus();
	});

	downloadAllBtn.addEventListener('click', async () => {
		const done = items.filter((i) => i.status === 'done');
		if (!done.length) return;
		if (done.length === 1) { triggerDownload(done[0].result.blob, outName(done[0])); return; }
		downloadAllBtn.disabled = true;
		const label = downloadAllBtn.textContent;
		downloadAllBtn.textContent = 'Zipping\u2026';
		try {
			const zip = new JSZip();
			const taken = new Set();
			done.forEach((i) => zip.file(uniqueName(outName(i), taken), i.result.blob));
			const content = await zip.generateAsync({ type: 'blob' });
			triggerDownload(content, 'compressed-images.zip');
		} catch (e) {
			console.error(e);
			showError('Could not build the zip file: ' + (e && e.message ? e.message : String(e)));
		}
		downloadAllBtn.textContent = label;
		downloadAllBtn.disabled = false;
	});

})();