(function () {
'use strict';

	const $ = (id) => document.getElementById(id);

	const stage = $('pjStage');
	const dropMsg = $('pjDropMsg');
	const dropBig = dropMsg.querySelector('.big');
	const dropSmall = dropMsg.querySelector('.small');
	const fileInput = $('pjFileInput');
	const grid = $('pjGrid');
	const toolbar = $('pjToolbar');
	const toolbarStatus = $('pjToolbarStatus');
	const clearBtn = $('pjClearBtn');
	const downloadAllBtn = $('pjDownloadAllBtn');
	const errBox = $('pjErr');
	const qualityEl = $('pjQuality');
	const qualityVal = $('pjQualityVal');
	const bgEl = $('pjBg');

	let items = [];
	let idCounter = 0;
	let converting = false;
	let settingsDirty = false;
	let rerunTimer = 0;

	function showError(msg) { errBox.textContent = msg; errBox.classList.add('show'); }
	function clearError() { errBox.classList.remove('show'); errBox.textContent = ''; }

	function isPng(file) {
		return /^image\/png$/i.test(file.type) || /\.png$/i.test(file.name);
	}

	function formatBytes(n) {
		if (n < 1024) return n + ' B';
		if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
		return (n / 1024 / 1024).toFixed(2) + ' MB';
	}

	function jpgName(name) {
		return (name.replace(/\.[^/.]+$/, '') || 'image') + '.jpg';
	}

	function uniqueName(name, taken) { // two different images can share a file name; keep zip entries unique
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
			dropBig.textContent = 'Drop PNG images here';
			dropSmall.innerHTML = 'or <b>click to browse</b> — select as many as you like';
		} else {
			dropBig.textContent = 'Drop more PNG images here';
			dropSmall.innerHTML = 'or <b>click to add more</b>';
		}
	}

	function currentQuality() {
		const q = parseInt(qualityEl.value, 10);
		return Math.min(100, Math.max(10, isNaN(q) ? 90 : q)) / 100;
	}


	function makeCard(item) {
		const card = document.createElement('div');
		card.className = 'card';
		card.innerHTML =
			'<div class="thumb">' +
				'<img data-img alt="">' +
				'<span class="jp-tag is-hidden" data-tag>JPG</span>' +
				'<div class="veil" data-veil><div class="mini-spinner"></div></div>' +
			'</div>' +
			'<div class="card-foot">' +
				'<div class="card-name" data-name></div>' +
				'<div class="card-foot-row">' +
					'<div class="card-status pending" data-status>Queued</div>' +
					'<button type="button" class="card-dl" data-dl disabled title="Download JPG"><i class="fa-solid fa-download"></i></button>' +
				'</div>' +
				'<div class="jp-size" data-size></div>' +
			'</div>';
		card.querySelector('[data-img]').src = item.originalURL;
		card.querySelector('[data-name]').textContent = item.file.name; // textContent: file names are never parsed as HTML
		card.querySelector('[data-size]').textContent = formatBytes(item.file.size) + ' PNG';
		card.querySelector('[data-dl]').addEventListener('click', () => {
			if (item.jpgBlob) triggerDownload(item.jpgBlob, jpgName(item.file.name));
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
			toolbarStatus.textContent = 'Done — ' + done + ' JPG' + (done === 1 ? '' : 's') + ' ready';
		}
		downloadAllBtn.disabled = done === 0;
	}

	async function convertToJpg(item) {
		const img = await loadImageEl(item.originalURL);
		const w = img.naturalWidth, h = img.naturalHeight;
		if (!w || !h) throw new Error('The image has no pixels.');
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = bgEl.value || '#ffffff'; // JPG has no transparency: see-through areas get this color
		ctx.fillRect(0, 0, w, h);
		ctx.drawImage(img, 0, 0);
		const quality = currentQuality();
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
		canvas.width = canvas.height = 0; // release the pixel memory right away
		if (!blob) throw new Error('The browser could not create a JPG this large.');
		return { blob: blob, w: w, h: h };
	}

	function showResult(item, out) {
		const statusEl = item.cardEl.querySelector('[data-status]');
		statusEl.textContent = 'Done';
		statusEl.className = 'card-status done';
		item.cardEl.querySelector('[data-tag]').classList.remove('is-hidden');
		item.cardEl.querySelector('[data-dl]').disabled = false;

		// show the JPG itself, so you can see what the transparent areas turned into
		if (item.resultURL) URL.revokeObjectURL(item.resultURL);
		item.resultURL = URL.createObjectURL(out.blob);
		item.cardEl.querySelector('[data-img]').src = item.resultURL;

		const change = Math.round((out.blob.size / item.file.size - 1) * 100);
		const sizeEl = item.cardEl.querySelector('[data-size]');
		sizeEl.textContent = out.w + '×' + out.h + ' · ' + formatBytes(item.file.size) + ' → ';
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
				const veilEl = item.cardEl.querySelector('[data-veil]');
				statusEl.textContent = 'Converting…';
				statusEl.className = 'card-status processing';
				veilEl.classList.add('show');
				updateToolbarStatus();
				await new Promise((r) => setTimeout(r, 0)); // let the spinner paint before the heavy work
				try {
					const out = await convertToJpg(item);
					item.jpgBlob = out.blob;
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
				veilEl.classList.remove('show');
				updateToolbarStatus();
			}
			if (!settingsDirty) break; // settings changed while we were busy: go round again with the new ones
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
	function settingsChanged() {
		qualityVal.textContent = qualityEl.value + '%';
		clearTimeout(rerunTimer);
		rerunTimer = setTimeout(reconvertAll, 250);
	}
	qualityEl.addEventListener('input', settingsChanged);
	bgEl.addEventListener('input', settingsChanged);
	$('pjBgWhite').addEventListener('click', () => { bgEl.value = '#ffffff'; settingsChanged(); });
	$('pjBgBlack').addEventListener('click', () => { bgEl.value = '#000000'; settingsChanged(); });

	function addFiles(fileList) {
		const all = Array.from(fileList);
		const pngs = all.filter(isPng);
		const skipped = all.length - pngs.length;
		if (pngs.length === 0) {
			showError('Only PNG files can be converted here. ' + (skipped === 1 ? 'That file was' : 'Those files were') + ' skipped.');
			return;
		}
		if (skipped) showError(skipped + ' file' + (skipped === 1 ? ' was' : 's were') + ' skipped because only PNG files are converted.');
		else clearError();

		stage.classList.add('compact');
		toolbar.classList.add('show');
		pngs.forEach((file) => {
			const item = { id: ++idCounter, file: file, originalURL: URL.createObjectURL(file), resultURL: null, status: 'pending', jpgBlob: null };
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
		if (done.length === 1) { triggerDownload(done[0].jpgBlob, jpgName(done[0].file.name)); return; }
		downloadAllBtn.disabled = true;
		const label = downloadAllBtn.textContent;
		downloadAllBtn.textContent = 'Zipping…';
		try {
			const zip = new JSZip();
			const taken = new Set();
			done.forEach((i) => zip.file(uniqueName(jpgName(i.file.name), taken), i.jpgBlob));
			const content = await zip.generateAsync({ type: 'blob' }); // JPGs are already compressed, so they are just stored
			triggerDownload(content, 'png-to-jpg.zip');
		} catch (e) {
			console.error(e);
			showError('Could not build the zip file: ' + (e && e.message ? e.message : String(e)));
		}
		downloadAllBtn.textContent = label;
		downloadAllBtn.disabled = false;
	});

})();