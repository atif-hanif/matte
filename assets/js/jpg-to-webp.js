(function () {
	'use strict';

	const $ = (id) => document.getElementById(id);

	const stage = $('jwStage');
	const dropMsg = $('jwDropMsg');
	const dropBig = dropMsg.querySelector('.big');
	const dropSmall = dropMsg.querySelector('.small');
	const fileInput = $('jwFileInput');
	const grid = $('jwGrid');
	const toolbar = $('jwToolbar');
	const toolbarStatus = $('jwToolbarStatus');
	const clearBtn = $('jwClearBtn');
	const downloadAllBtn = $('jwDownloadAllBtn');
	const errBox = $('jwErr');
	const warnEl = $('jwWarn');
	const qualityEl = $('jwQuality');
	const qualityVal = $('jwQualityVal');

	let items = [];
	let idCounter = 0;
	let converting = false;
	let settingsDirty = false;
	let rerunTimer = 0;

	function webpSupported() {
		try {
			const c = document.createElement('canvas');
			c.width = c.height = 1;
			return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
		} catch (e) {
			return false;
		}
	}

	const SUPPORTED = webpSupported();
	const NO_WEBP = "This browser can't save WebP files from a web page (Safari can't). Chrome and Edge can.";
	if (!SUPPORTED) {
		warnEl.textContent = NO_WEBP;
		warnEl.classList.add('show');
	}

	function showError(msg) { errBox.textContent = msg; errBox.classList.add('show'); }
	function clearError() { errBox.classList.remove('show'); errBox.textContent = ''; }

	function isJpeg(file) {
		return /^image\/jpe?g$/i.test(file.type) || /\.(jpe?g|jfif|pjpeg|pjp)$/i.test(file.name);
	}

	function formatBytes(n) {
		if (n < 1024) return n + ' B';
		if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
		return (n / 1024 / 1024).toFixed(2) + ' MB';
	}

	function webpName(name) {
		return (name.replace(/\.[^/.]+$/, '') || 'image') + '.webp';
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
			img.onerror = () => reject(new Error('This file could not be read as an image.'));
			img.src = src;
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
			dropBig.textContent = 'Drop JPG photos here';
			dropSmall.innerHTML = 'or <b>click to browse</b> — select as many as you like';
		} else {
			dropBig.textContent = 'Drop more JPG photos here';
			dropSmall.innerHTML = 'or <b>click to add more</b>';
		}
	}

	function currentQuality() {
		const q = parseInt(qualityEl.value, 10);
		return Math.min(100, Math.max(10, isNaN(q) ? 80 : q)) / 100;
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

	function addTag(card, text) {
		if (card.querySelector('[data-tag]')) return;
		const t = document.createElement('span');
		t.className = 'jp-tag';
		t.setAttribute('data-tag', '');
		t.textContent = text;
		card.querySelector('.thumb').appendChild(t);
	}

	function makeCard(item) {
		const card = document.createElement('div');
		card.className = 'card';
		card.innerHTML =
			'<div class="thumb">' +
				'<img data-img alt="">' +
			'</div>' +
			'<div class="card-foot">' +
				'<div class="card-name" data-name></div>' +
				'<div class="card-foot-row">' +
					'<div class="card-status pending" data-status>Queued</div>' +
					'<button type="button" class="card-dl" data-dl disabled title="Download WebP"><i class="fa-solid fa-download"></i></button>' +
				'</div>' +
				'<div class="jp-size" data-size></div>' +
			'</div>';
		card.querySelector('[data-img]').src = item.originalURL;
		card.querySelector('[data-name]').textContent = item.file.name; // textContent: file names are never parsed as HTML
		card.querySelector('[data-size]').textContent = formatBytes(item.file.size) + ' JPG';
		card.querySelector('[data-dl]').addEventListener('click', () => {
			if (item.webpBlob) triggerDownload(item.webpBlob, webpName(item.file.name));
		});
		grid.appendChild(card);
		return card;
	}

	function updateToolbarStatus() {
		const total = items.length;
		const done = items.filter((i) => i.status === 'done').length;
		const failed = items.filter((i) => i.status === 'error').length;
		if (converting) {
			toolbarStatus.innerHTML = '<div class="mini-spinner"></div> Converting ' + Math.min(done + failed + 1, total) + ' of ' + total + '…';
		} else if (total === 0) {
			toolbarStatus.textContent = 'Ready';
		} else if (failed) {
			toolbarStatus.textContent = 'Done — ' + done + ' converted, ' + failed + ' failed';
		} else {
			toolbarStatus.textContent = 'Done — ' + done + ' WebP' + (done === 1 ? '' : 's') + ' ready';
		}
		downloadAllBtn.disabled = done === 0;
	}

	async function convertToWebp(item) {
		const img = await loadImageEl(item.originalURL);
		const w = img.naturalWidth, h = img.naturalHeight;
		if (!w || !h) throw new Error('The image has no pixels.');
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		canvas.getContext('2d').drawImage(img, 0, 0);
		const quality = currentQuality();
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
		canvas.width = canvas.height = 0; // release the pixel memory right away
		if (!blob) throw new Error('The browser could not create a WebP this large.');
		if (blob.type !== 'image/webp') throw new Error(NO_WEBP); // an unsupported browser quietly returns a PNG instead
		return { blob: blob, w: w, h: h };
	}

	function showResult(item, out) {
		const statusEl = item.cardEl.querySelector('[data-status]');
		statusEl.textContent = 'Done';
		statusEl.className = 'card-status done';
		addTag(item.cardEl, 'WEBP');
		item.cardEl.querySelector('[data-dl]').disabled = false;

		const change = Math.round((out.blob.size / item.file.size - 1) * 100);
		const sizeEl = item.cardEl.querySelector('[data-size]');
		sizeEl.textContent = out.w + '×' + out.h + ' --- ' + formatBytes(item.file.size) + ' → ';
		const to = document.createElement('span');
		to.className = 'pj-saving' + (change > 0 ? ' is-bigger' : '');
		to.textContent = formatBytes(out.blob.size) + ' (' + (change > 0 ? '+' : '−') + Math.abs(change) + '%)';
		sizeEl.appendChild(to);
	}

	async function processQueue() {
		if (converting) return;
		converting = true;
		for (;;) {
			for (const item of items) {
				if (item.status !== 'pending') continue;
				item.status = 'working';
				const statusEl = item.cardEl.querySelector('[data-status]');
				statusEl.textContent = 'Converting…';
				statusEl.className = 'card-status processing';
				showVeil(item.cardEl);
				updateToolbarStatus();
				await new Promise((r) => setTimeout(r, 0)); // let the spinner paint before the heavy work
				try {
					const out = await convertToWebp(item);
					item.webpBlob = out.blob;
					item.status = 'done';
					showResult(item, out);
				} catch (e) {
					console.error(e);
					item.status = 'error';
					statusEl.textContent = 'Failed';
					statusEl.className = 'card-status error';
					item.cardEl.title = e && e.message ? e.message : String(e);
					item.cardEl.querySelector('[data-size]').textContent = e && e.message ? e.message : 'Conversion failed';
				}
				hideVeil(item.cardEl);
				updateToolbarStatus();
			}
			if (!settingsDirty) break; // the quality changed while we were busy: go round again with the new value
			settingsDirty = false;
			items.forEach((i) => { if (i.status === 'done') i.status = 'pending'; });
		}
		converting = false;
		updateToolbarStatus();
	}

	function reconvertAll() {
		if (!items.length) return;
		if (converting) { settingsDirty = true; return; }
		items.forEach((i) => { if (i.status === 'done') i.status = 'pending'; });
		processQueue();
	}
	qualityEl.addEventListener('input', () => {
		qualityVal.textContent = qualityEl.value + '%';
		clearTimeout(rerunTimer);
		rerunTimer = setTimeout(reconvertAll, 250);
	});

	function addFiles(fileList) {
		if (!SUPPORTED) { showError(NO_WEBP); return; }
		const all = Array.from(fileList);
		const jpgs = all.filter(isJpeg);
		const skipped = all.length - jpgs.length;
		if (jpgs.length === 0) {
			showError('Only JPG / JPEG files can be converted here. ' + (skipped === 1 ? 'That file was' : 'Those files were') + ' skipped.');
			return;
		}
		if (skipped) showError(skipped + ' file' + (skipped === 1 ? ' was' : 's were') + ' skipped because only JPG / JPEG files are converted.');
		else clearError();

		stage.classList.add('compact');
		toolbar.classList.add('show');
		jpgs.forEach((file) => {
			const item = { id: ++idCounter, file: file, originalURL: URL.createObjectURL(file), status: 'pending', webpBlob: null };
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
		items.forEach((i) => URL.revokeObjectURL(i.originalURL));
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
		if (done.length === 1) { triggerDownload(done[0].webpBlob, webpName(done[0].file.name)); return; }
		downloadAllBtn.disabled = true;
		const label = downloadAllBtn.textContent;
		downloadAllBtn.textContent = 'Zipping…';
		try {
			const zip = new JSZip();
			const taken = new Set();
			done.forEach((i) => zip.file(uniqueName(webpName(i.file.name), taken), i.webpBlob));
			const content = await zip.generateAsync({ type: 'blob' }); // WebP is already compressed, so the files are just stored
			triggerDownload(content, 'jpg-to-webp.zip');
		} catch (e) {
			console.error(e);
			showError('Could not build the zip file: ' + (e && e.message ? e.message : String(e)));
		}
		downloadAllBtn.textContent = label;
		downloadAllBtn.disabled = false;
	});

})();