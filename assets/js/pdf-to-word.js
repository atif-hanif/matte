(function () {
	'use strict';

	const PATHS = {
		pdfWorker: 'assets/vendors/pdf/pdf.worker.min.js',
		tesseract: 'assets/vendors/tesseract/tesseract.min.js',
		tessWorker: 'assets/vendors/tesseract/worker.min.js',
		tessDir: 'assets/vendors/tesseract'
	};
	const abs = (p) => new URL(p, location.href).href;

	const $ = (id) => document.getElementById(id);
	const stage = $('pwStage'), dropMsg = $('pwDropMsg'), fileInput = $('pwFileInput'), grid = $('pwGrid');
	const toolbar = $('pwToolbar'), toolbarStatus = $('pwToolbarStatus'), clearBtn = $('pwClearBtn'), downloadAllBtn = $('pwDownloadAllBtn');
	const errBox = $('pwErr'), modeBox = $('pwMode'), ocrEl = $('pwOcr'), hintEl = $('pwModeHint');
	const dropBig = dropMsg.querySelector('.big'), dropSmall = dropMsg.querySelector('.small');

	let items = [], idCounter = 0, working = false, mode = 'flow';
	let tessWorker = null, tessPromise = null;

	if (!window.pdfjsLib) { showError('The PDF reader did not load. Check that assets/vendors/pdfjs/pdf.min.js exists.'); }
	else pdfjsLib.GlobalWorkerOptions.workerSrc = PATHS.pdfWorker;

	const HINTS = {
		flow: 'Paragraphs, headings, lists and columns become normal Word text you can edit freely.',
		exact: 'Every line of text sits where it was on the page, so it looks like the PDF but is harder to reflow.'
	};
	hintEl.textContent = HINTS.flow;

	function showError(msg) { errBox.textContent = msg; errBox.classList.add('show'); }
	function clearError() { errBox.classList.remove('show'); errBox.textContent = ''; }
	function formatBytes(n) {
		if (n < 1024) return n + ' B';
		if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
		return (n / 1024 / 1024).toFixed(2) + ' MB';
	}

	function isPdf(f) { return /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name); }
	function outName(item) { return (item.file.name.replace(/\.pdf$/i, '') || 'document') + '.docx'; }
	function uniqueName(name, taken) {
		if (!taken.has(name)) { taken.add(name); return name; }
		const dot = name.lastIndexOf('.'), stem = dot > -1 ? name.slice(0, dot) : name, ext = dot > -1 ? name.slice(dot) : '';
		let n = 2, c;
		do { c = stem + ' (' + n++ + ')' + ext; } while (taken.has(c));
		taken.add(c);
		return c;
	}

	function triggerDownload(blob, filename) {
		const url = URL.createObjectURL(blob), a = document.createElement('a');
		a.href = url; a.download = filename;
		document.body.appendChild(a); a.click(); document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}

	function loadScript(src) {
		return new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src; s.onload = () => resolve(); s.onerror = () => { s.remove(); reject(new Error('Could not load ' + src)); };
			document.head.appendChild(s);
		});
	}

	function refreshDropMsg() {
		dropBig.textContent = items.length ? 'Drop more PDF files here' : 'Drop PDF files here';
		dropSmall.innerHTML = items.length ? 'or <b>click to add more</b>' : 'or <b>click to browse</b> — select as many as you like';
	}

	function showVeil(card) {
		const thumb = card.querySelector('.thumb');
		if (!thumb.querySelector('.veil')) {
			const v = document.createElement('div');
			v.className = 'veil show';
			v.innerHTML = '<div class="mini-spinner"></div>';
			thumb.appendChild(v);
		}
	}

	function hideVeil(card) { 
		const v = card.querySelector('.thumb .veil'); if (v) v.remove(); 
	}

	function addTag(card, text) {
		const thumb = card.querySelector('.thumb');
		const t = document.createElement('span');
		t.className = 'jp-tag';
		t.textContent = text;
		thumb.appendChild(t);
	}

	async function imageToPng(img) {
		const w = img.width, h = img.height;
		const c = document.createElement('canvas');
		c.width = w; c.height = h;
		const ctx = c.getContext('2d');
		if (img.bitmap) ctx.drawImage(img.bitmap, 0, 0);
		else if (img.data) {
			const out = ctx.createImageData(w, h), d = img.data, o = out.data;
			if (img.kind === 3 || d.length === w * h * 4) o.set(d);
			else if (img.kind === 2 || d.length === w * h * 3) {
				for (let i = 0, j = 0; i < w * h; i++) { o[j++] = d[i * 3]; o[j++] = d[i * 3 + 1]; o[j++] = d[i * 3 + 2]; o[j++] = 255; }
			} else if (img.kind === 1) {
				const rb = (w + 7) >> 3;
				for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
					const v = (d[y * rb + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0, j = (y * w + x) * 4;
					o[j] = o[j + 1] = o[j + 2] = v; o[j + 3] = 255;
				}
			} else return null;
			ctx.putImageData(out, 0, 0);
		} else return null;
		const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
		return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
	}

	async function renderCanvas(page, scale) {
		const vp = page.getViewport({ scale });
		const c = document.createElement('canvas');
		c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
		const ctx = c.getContext('2d', { willReadFrequently: true });
		ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
		await page.render({ canvasContext: ctx, viewport: vp }).promise;
		return c;
	}

	async function sampleImage(page) {
		const c = await renderCanvas(page, 1);
		return c.getContext('2d').getImageData(0, 0, c.width, c.height);
	}

	async function getOcr(onStatus) {
		if (tessWorker) return tessWorker;
		if (!tessPromise) {
			tessPromise = (async () => {
				if (!window.Tesseract) await loadScript(PATHS.tesseract);
				const w = await Tesseract.createWorker('eng', 1, {
					workerPath: abs(PATHS.tessWorker), corePath: abs(PATHS.tessDir), langPath: abs(PATHS.tessDir), gzip: true,
					logger: (m) => { if (onStatus.current && m.status) onStatus.current(m); }
				});
				tessWorker = w;
				return w;
			})().catch((e) => { tessPromise = null; throw e; });
		}
		return tessPromise;
	}

	const ocrStatus = { current: null };

	async function ocrPage(page, label) {
		const w = await getOcr(ocrStatus);
		const scale = 2;
		const c = await renderCanvas(page, scale);
		ocrStatus.current = (m) => { if (m.status === 'recognizing text') label('Reading page text ' + Math.round(m.progress * 100) + '%'); };
		const res = await w.recognize(c);
		ocrStatus.current = null;
		const data = res.data || {};
		const lines = (data.lines || []).map((l) => ({ x0: l.bbox.x0, y0: l.bbox.y0, x1: l.bbox.x1, y1: l.bbox.y1, text: l.text }));
		return { lines, scale };
	}

	function makeCard(item) {
		const card = document.createElement('div');
		card.className = 'card';
		card.innerHTML =
			'<div class="thumb pw-thumb"><div class="pw-ph">PDF</div></div>' +
			'<div class="card-foot">' +
				'<div class="card-name"></div>' +
				'<div class="card-foot-row">' +
					'<div class="card-status pending" data-status>Queued</div>' +
					'<button type="button" class="card-dl" data-dl disabled title="Download PDF"><i class="fa-solid fa-download"></i></button>' +
				'</div>' +
				'<div class="card-dims" data-info></div></div>';
			'</div>';
		card.querySelector('.card-name').textContent = item.file.name;
		card.querySelector('[data-info]').textContent = formatBytes(item.file.size);
		card.querySelector('[data-dl]').addEventListener('click', async (e) => {
			if (!item.pages) return;
			const btn = e.currentTarget;
			btn.disabled = true;
			try { triggerDownload(await buildBlob(item), outName(item)); }
			catch (err) { console.error(err); showError('Could not build the Word file: ' + (err && err.message ? err.message : err)); }
			btn.disabled = false;
		});
		grid.appendChild(card);
		return card;
	}

	async function buildBlob(item) {
		const bytes = await MatteP2W.buildDocx(JSZip, item.pages, mode);
		return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
	}

	function setStatus(item, text, cls) {
		const s = item.card.querySelector('[data-status]');
		s.textContent = text; s.className = 'card-status ' + cls;
	}

	function setInfo(item, text) { item.card.querySelector('[data-info]').textContent = text; }

	function updateToolbar() {
		const total = items.length, done = items.filter((i) => i.status === 'done').length, bad = items.filter((i) => i.status === 'error').length;
		if (working) {
			toolbarStatus.innerHTML = '<div class="mini-spinner"></div> Converting ' + Math.min(total, done + bad + 1) + ' of ' + total + '…';
		} else if (total && done + bad === total) {
			toolbarStatus.textContent = bad ? 'Done: ' + done + ' converted, ' + bad + ' failed' : 'Done: ' + done + ' file' + (done === 1 ? '' : 's') + ' ready';
		} else toolbarStatus.textContent = total + ' file' + (total === 1 ? '' : 's') + ' queued';
		downloadAllBtn.disabled = done === 0;
	}

	async function convertItem(item) {
		item.status = 'processing';
		showVeil(item.card);
		setStatus(item, 'Opening…', 'processing');
		updateToolbar();
		let pdf = null;
		try {
			const data = new Uint8Array(await item.file.arrayBuffer());
			pdf = await pdfjsLib.getDocument({ data }).promise;
			const total = pdf.numPages, pages = [];
			let scanned = 0, ocred = 0, pics = 0;
			for (let n = 1; n <= total; n++) {
				const page = await pdf.getPage(n);
				const label = (t) => setStatus(item, 'Page ' + n + '/' + total + ': ' + t, 'processing');
				setStatus(item, 'Page ' + n + '/' + total, 'processing');
				if (n === 1) { // thumbnail
					try {
						const c = await renderCanvas(page, 0.5);
						const img = new Image(); img.src = c.toDataURL('image/jpeg', 0.7);
						const th = item.card.querySelector('.thumb'); th.querySelector('.pw-ph').remove(); th.insertBefore(img, th.firstChild);
					} catch (e) { }
				}
				const pg = await MatteP2W.extractPage(page, {
					imageToPng, sampleImage,
					ocr: ocrEl.checked ? async (p) => { label('loading OCR'); return ocrPage(p, label); } : null
				});
				if (pg.scanned) scanned++;
				if (pg.ocr) ocred++;
				pics += pg.images.length;
				pages.push(pg);
				page.cleanup();
			}
			item.pages = pages;
			item.status = 'done';
			const chars = pages.reduce((n, p) => n + p.lines.reduce((m, l) => m + l.text.length, 0), 0);
			if (scanned && !ocred) { setStatus(item, 'No text found', 'error'); addTag(item.card, 'SCANNED'); setInfo(item, formatBytes(item.file.size) + ' · ' + total + ' pages · turn on OCR to read scans'); }
			else {
				setStatus(item, 'Done', 'done');
				if (ocred) addTag(item.card, 'OCR');
				setInfo(item, formatBytes(item.file.size) + ' · ' + total + ' page' + (total === 1 ? '' : 's') + (pics ? ' · ' + pics + ' picture' + (pics === 1 ? '' : 's') : '') + (chars === 0 ? ' · empty' : ''));
			}
			item.card.querySelector('[data-dl]').disabled = false;
		} catch (e) {
			console.error(e);
			item.status = 'error';
			setStatus(item, (e && e.name === 'PasswordException') ? 'Password protected' : 'Failed', 'error');
			item.card.title = e && e.message ? e.message : String(e);
		} finally {
			hideVeil(item.card);
			if (pdf) { try { pdf.destroy(); } catch (e) { /* ignore */ } }
		}
	}

	async function processQueue() {
		if (working) return;
		working = true;
		updateToolbar();
		for (const item of items) {
			if (item.status !== 'pending') continue;
			await convertItem(item);
			updateToolbar();
		}
		working = false;
		updateToolbar();
	}

	function addFiles(list) {
		const files = Array.from(list).filter(isPdf);
		if (!files.length) { showError("Those don't look like PDF files."); return; }
		clearError();
		stage.classList.add('compact');
		toolbar.classList.add('show');
		files.forEach((file) => {
			const item = { id: ++idCounter, file, status: 'pending', pages: null };
			item.card = makeCard(item);
			items.push(item);
		});
		refreshDropMsg();
		updateToolbar();
		processQueue();
	}

	stage.addEventListener('click', () => fileInput.click());

	fileInput.addEventListener('change', (e) => { 
		if (e.target.files.length) addFiles(e.target.files); fileInput.value = ''; 
	});

	['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => { 
		e.preventDefault(); stage.classList.add('drag'); 
	}));

	['dragleave', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => { 
		e.preventDefault(); stage.classList.remove('drag'); 
	}));
	
	stage.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

	modeBox.addEventListener('click', (e) => {
		const b = e.target.closest('.mode-btn');
		if (!b) return;
		mode = b.dataset.mode;
		modeBox.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
		hintEl.textContent = HINTS[mode];
	});

	clearBtn.addEventListener('click', () => {
		items = []; grid.innerHTML = '';
		stage.classList.remove('compact'); toolbar.classList.remove('show');
		clearError(); refreshDropMsg();
	});

	downloadAllBtn.addEventListener('click', async () => {
		const done = items.filter((i) => i.status === 'done' && i.pages);
		if (!done.length) return;
		downloadAllBtn.disabled = true;
		const label = downloadAllBtn.textContent;
		downloadAllBtn.textContent = 'Zipping…';
		try {
			if (done.length === 1) triggerDownload(await buildBlob(done[0]), outName(done[0]));
			else {
				const zip = new JSZip(), taken = new Set();
				for (const i of done) zip.file(uniqueName(outName(i), taken), await buildBlob(i));
				triggerDownload(await zip.generateAsync({ type: 'blob' }), 'matte-word-files.zip');
			}
		} catch (e) {
			console.error(e);
			showError('Could not build the download: ' + (e && e.message ? e.message : e));
		}
		downloadAllBtn.textContent = label;
		updateToolbar();
	});

	window.addEventListener('beforeunload', () => { if (tessWorker) { try { tessWorker.terminate(); } catch (e) { /* ignore */ } } });
	refreshDropMsg();
})();