(function () {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const stage = $('wdStage'), dropMsg = $('wdDropMsg'), fileInput = $('wdFileInput'), grid = $('wdGrid');
	const toolbar = $('wdToolbar'), toolbarStatus = $('wdToolbarStatus'), clearBtn = $('wdClearBtn'), downloadAllBtn = $('wdDownloadAllBtn');
	const errBox = $('wdErr'), modeBox = $('wdMode'), qualityEl = $('wdQuality'), qualityGroup = $('wdQualityGroup'), hintEl = $('wdModeHint');
	function ensureEl(id, cls) { // created here if the page does not already have it
		let el = $(id);
		if (!el) { el = document.createElement('div'); el.id = id; el.className = cls; document.body.appendChild(el); }
		return el;
	}

	const renderHost = ensureEl('wdRenderHost', 'wd-render-host'), printArea = ensureEl('wdPrintArea', 'wd-print-area');
	const dropBig = dropMsg.querySelector('.big'), dropSmall = dropMsg.querySelector('.small');

	let items = [], idCounter = 0, working = false, mode = 'image';

	const HINTS = {
		image: 'Each page is saved as a sharp picture, so it looks the same everywhere. Text in the PDF cannot be selected.',
		text: 'Opens your browser\'s print window: choose "Save as PDF" as the destination. Text stays selectable. Turn off "Headers and footers" there.'
	};

	hintEl.textContent = HINTS.image;

	if (!window.docx || !window.html2canvas || !window.PDFLib || !window.JSZip) {
		showError('A needed library did not load. Check the files in assets/vendors/ (jszip, docx-preview, html2canvas, pdf-lib).');
	}

	function showError(msg) { 
		errBox.textContent = msg; errBox.classList.add('show'); 
	}

	function clearError() { 
		errBox.classList.remove('show'); errBox.textContent = ''; 
	}

	function formatBytes(n) {
		if (n < 1024) return n + ' B';
		if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
		return (n / 1024 / 1024).toFixed(2) + ' MB';
	}

	function isDocx(f) { 
		return /\.docx$/i.test(f.name) || /wordprocessingml\.document$/i.test(f.type); 
	}

	function outName(item) { 
		return (item.file.name.replace(/\.docx$/i, '') || 'document') + '.pdf';
	}

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

	function refreshDropMsg() {
		dropBig.textContent = items.length ? 'Drop more Word files here' : 'Drop Word files here';
		dropSmall.innerHTML = items.length ? 'or <b>click to add more</b>' : 'or <b>click to browse</b> — .docx files, as many as you like';
	}

	const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

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

	async function renderDoc(file, host) {
		host.innerHTML = '';
		const buf = await file.arrayBuffer();
		await docx.renderAsync(buf, host, null, {
			className: 'docx', inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: false,
			renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true, useBase64URL: true
		});

		await Promise.all(Array.from(host.querySelectorAll('img')).map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
		if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* ignore */ } }
		await nextFrame();
		return Array.from(host.querySelectorAll('section.docx'));
	}

	async function toPdfBytes(file, scale, onPage) {
		const pages = await renderDoc(file, renderHost);
		if (!pages.length) throw new Error('This file has no pages to convert.');
		const pdf = await PDFLib.PDFDocument.create();
		for (let i = 0; i < pages.length; i++) {
			onPage(i + 1, pages.length);
			const el = pages[i];
			const w = el.offsetWidth, h = el.offsetHeight;
			const canvas = await html2canvas(el, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false });
			const jpg = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
			const img = await pdf.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
			const page = pdf.addPage([w * 0.75, h * 0.75]); // CSS px -> PDF points
			page.drawImage(img, { x: 0, y: 0, width: w * 0.75, height: h * 0.75 });
			canvas.width = canvas.height = 0; // release memory
		}
		renderHost.innerHTML = '';
		return pdf.save();
	}

	async function thumbnail(file) {
		const pages = await renderDoc(file, renderHost);
		let url = null, count = pages.length;
		if (pages.length) {
			const c = await html2canvas(pages[0], { scale: 0.5, backgroundColor: '#ffffff', useCORS: true, logging: false });
			url = c.toDataURL('image/jpeg', 0.7);
		}
		renderHost.innerHTML = '';
		return { url, count };
	}

	async function printText(file) {
		await renderDoc(file, printArea);
		document.body.classList.add('wd-printing');
		const done = () => {
			document.body.classList.remove('wd-printing');
			printArea.innerHTML = '';
			window.removeEventListener('afterprint', done);
		};
		window.addEventListener('afterprint', done);
		window.print();
	}

	function makeCard(item) {
		const card = document.createElement('div');
		card.className = 'card';
		card.innerHTML =
			'<div class="thumb wd-thumb">' +
				'<div class="wd-ph">DOCX</div>' +
			'</div>' +
			'<div class="card-foot">' +
				'<div class="card-name"></div>' +
				'<div class="card-foot-row">' +
					'<div class="card-status pending" data-status>Queued</div>' +
					'<button type="button" class="card-dl" data-dl disabled title="Download PDF"><i class="fa-solid fa-download"></i></button>' +
				'</div>' +
				'<div class="card-dims" data-info></div>' +
			'</div>';
		card.querySelector('.card-name').textContent = item.file.name;
		card.querySelector('[data-info]').textContent = formatBytes(item.file.size);
		card.querySelector('[data-dl]').addEventListener('click', (e) => convertOne(item, e.currentTarget));
		grid.appendChild(card);
		return card;
	}

	function setStatus(item, text, cls) {
		const s = item.card.querySelector('[data-status]');
		s.textContent = text; s.className = 'card-status ' + cls;
	}

	function updateToolbar() {
		const total = items.length, ready = items.filter((i) => i.status === 'ready').length, bad = items.filter((i) => i.status === 'error').length;
		if (working) toolbarStatus.innerHTML = '<div class="mini-spinner"></div> Working…';
		else if (total && ready + bad === total) toolbarStatus.textContent = bad ? ready + ' ready, ' + bad + ' failed' : ready + ' file' + (ready === 1 ? '' : 's') + ' ready';
		else toolbarStatus.textContent = total + ' file' + (total === 1 ? '' : 's') + ' queued';
		downloadAllBtn.disabled = working || mode === 'text' || ready === 0;
	}

	async function convertOne(item, btn) {
		if (working) return;
		working = true; clearError();
		if (btn) btn.disabled = true;
		showVeil(item.card); updateToolbar();
		try {
			if (mode === 'text') { setStatus(item, 'Printing…', 'processing'); await printText(item.file); }
			else {
				const bytes = await toPdfBytes(item.file, parseFloat(qualityEl.value) || 2, (n, t) => setStatus(item, 'Page ' + n + '/' + t, 'processing'));
				triggerDownload(new Blob([bytes], { type: 'application/pdf' }), outName(item));
			}
			setStatus(item, 'Ready', 'done');
		} catch (e) {
			console.error(e);
			showError('Could not convert ' + item.file.name + ': ' + (e && e.message ? e.message : e));
			setStatus(item, 'Failed', 'error');
		}
		hideVeil(item.card);
		working = false;
		if (btn) btn.disabled = false;
		updateToolbar();
	}

	async function prepare(item) {
		showVeil(item.card);
		setStatus(item, 'Reading…', 'processing');
		try {
			const t = await thumbnail(item.file);
			if (t.url) {
				const img = new Image(); img.src = t.url;
				const th = item.card.querySelector('.thumb'); th.querySelector('.wd-ph').remove(); th.insertBefore(img, th.firstChild);
			}
			item.status = 'ready';
			setStatus(item, 'Ready', 'done');
			item.card.querySelector('[data-info]').textContent = formatBytes(item.file.size) + ' · ' + t.count + ' page' + (t.count === 1 ? '' : 's');
			item.card.querySelector('[data-dl]').disabled = false;
		} catch (e) {
			console.error(e);
			item.status = 'error';
			setStatus(item, 'Failed', 'error');
			item.card.title = e && e.message ? e.message : String(e);
		}
		hideVeil(item.card);
	}

	async function processQueue() {
		if (working) return;
		working = true; updateToolbar();
		for (const item of items) if (item.status === 'pending') await prepare(item);
		working = false; updateToolbar();
	}

	function addFiles(list) {
		const all = Array.from(list);
		const files = all.filter(isDocx);
		if (!files.length) { showError(all.some((f) => /\.doc$/i.test(f.name)) ? 'Old .doc files are not supported. Open it in Word and save it as .docx first.' : "Those don't look like .docx files."); return; }
		clearError();
		stage.classList.add('compact'); toolbar.classList.add('show');
		files.forEach((file) => {
			const item = { id: ++idCounter, file, status: 'pending' };
			item.card = makeCard(item);
			items.push(item);
		});
		refreshDropMsg(); updateToolbar(); processQueue();
	}

	stage.addEventListener('click', () => fileInput.click());
	fileInput.addEventListener('change', (e) => { if (e.target.files.length) addFiles(e.target.files); fileInput.value = ''; });
	['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.add('drag'); }));
	['dragleave', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => { e.preventDefault(); stage.classList.remove('drag'); }));
	stage.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

	modeBox.addEventListener('click', (e) => {
		const b = e.target.closest('.mode-btn');
		if (!b) return;
		mode = b.dataset.mode;
		modeBox.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
		hintEl.textContent = HINTS[mode];
		qualityGroup.classList.toggle('is-hidden', mode === 'text');
		downloadAllBtn.title = mode === 'text' ? 'Use the arrow on each file in this mode' : '';
		updateToolbar();
	});

	clearBtn.addEventListener('click', () => {
		if (working) return;
		items = []; grid.innerHTML = '';
		stage.classList.remove('compact'); toolbar.classList.remove('show');
		clearError(); refreshDropMsg();
	});

	downloadAllBtn.addEventListener('click', async () => {
		const ready = items.filter((i) => i.status === 'ready');
		if (!ready.length || working) return;
		working = true; clearError(); updateToolbar();
		const label = downloadAllBtn.textContent;
		downloadAllBtn.textContent = 'Converting…';
		try {
			const scale = parseFloat(qualityEl.value) || 2;
			const zip = new JSZip(), taken = new Set();
			for (const it of ready) {
				showVeil(it.card);
				try {
					const bytes = await toPdfBytes(it.file, scale, (n, t) => setStatus(it, 'Page ' + n + '/' + t, 'processing'));
					zip.file(uniqueName(outName(it), taken), bytes);
					setStatus(it, 'Ready', 'done');
				} catch (e) { console.error(e); setStatus(it, 'Failed', 'error'); showError('Could not convert ' + it.file.name + ': ' + (e && e.message ? e.message : e)); }
				hideVeil(it.card);
			}
			if (Object.keys(zip.files).length === 1 && ready.length === 1) triggerDownload(new Blob([await zip.files[Object.keys(zip.files)[0]].async('uint8array')], { type: 'application/pdf' }), Object.keys(zip.files)[0]);
			else if (Object.keys(zip.files).length) triggerDownload(await zip.generateAsync({ type: 'blob' }), 'matte-pdf-files.zip');
		} catch (e) {
			console.error(e);
			showError('Could not build the download: ' + (e && e.message ? e.message : e));
		}
		downloadAllBtn.textContent = label;
		working = false; updateToolbar();
	});

	refreshDropMsg();
})();