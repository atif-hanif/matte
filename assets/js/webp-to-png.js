(function () {
	'use strict';

	const $ = (id) => document.getElementById(id);

	const stage = $('wpStage');
	const dropMsg = $('wpDropMsg');
	const dropBig = dropMsg.querySelector('.big');
	const dropSmall = dropMsg.querySelector('.small');
	const fileInput = $('wpFileInput');
	const grid = $('wpGrid');
	const toolbar = $('wpToolbar');
	const toolbarStatus = $('wpToolbarStatus');
	const clearBtn = $('wpClearBtn');
	const downloadAllBtn = $('wpDownloadAllBtn');
	const errBox = $('wpErr');

	let items = [];
	let idCounter = 0;
	let converting = false;

	function showError(msg) { errBox.textContent = msg; errBox.classList.add('show'); }
	function clearError() { errBox.classList.remove('show'); errBox.textContent = ''; }

	function isWebp(file) {
		return /^image\/webp$/i.test(file.type) || /\.webp$/i.test(file.name);
	}

	function formatBytes(n) {
		if (n < 1024) return n + ' B';
		if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
		return (n / 1024 / 1024).toFixed(2) + ' MB';
	}

	function pngName(name) {
		return (name.replace(/\.[^/.]+$/, '') || 'image') + '.png';
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
			img.onerror = () => reject(new Error('This browser could not open this file as a WebP image.'));
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
			dropBig.textContent = 'Drop WebP images here';
			dropSmall.innerHTML = 'or <b>click to browse</b> — select as many as you like';
		} else {
			dropBig.textContent = 'Drop more WebP images here';
			dropSmall.innerHTML = 'or <b>click to add more</b>';
		}
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
		const max = 256, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
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
			'<div class="thumb wp-checker">' +
				'<img data-img alt="">' +
			'</div>' +
			'<div class="card-foot">' +
				'<div class="card-name" data-name></div>' +
				'<div class="card-foot-row">' +
					'<div class="card-status pending" data-status>Queued</div>' +
					'<button type="button" class="card-dl" data-dl disabled title="Download PNG"><i class="fa-solid fa-download"></i></button>' +
				'</div>' +
				'<div class="jp-size" data-size></div>' +
			'</div>';
		card.querySelector('[data-img]').src = item.originalURL;
		card.querySelector('[data-name]').textContent = item.file.name; // textContent: file names are never parsed as HTML
		card.querySelector('[data-size]').textContent = formatBytes(item.file.size) + ' WebP';
		card.querySelector('[data-dl]').addEventListener('click', () => {
			if (item.pngBlob) triggerDownload(item.pngBlob, pngName(item.file.name));
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
			toolbarStatus.textContent = 'Done — ' + done + ' PNG' + (done === 1 ? '' : 's') + ' ready';
		}
		downloadAllBtn.disabled = done === 0;
	}

	async function convertToPng(item) {
		const img = await loadImageEl(item.originalURL);
		const w = img.naturalWidth, h = img.naturalHeight;
		if (!w || !h) throw new Error('The image has no pixels.');
		const alpha = hasTransparency(img);
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		canvas.getContext('2d').drawImage(img, 0, 0); // no background fill: PNG keeps transparent pixels. An animated WebP draws its first frame
		const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
		canvas.width = canvas.height = 0; // release the pixel memory right away
		if (!blob) throw new Error('The browser could not create a PNG this large.');
		return { blob: blob, w: w, h: h, alpha: alpha };
	}

	function showResult(item, out) {
		const statusEl = item.cardEl.querySelector('[data-status]');
		statusEl.textContent = 'Done';
		statusEl.className = 'card-status done';
		addTag(item.cardEl, 'PNG');
		item.cardEl.querySelector('[data-dl]').disabled = false;

		const change = Math.round((out.blob.size / item.file.size - 1) * 100);
		const sizeEl = item.cardEl.querySelector('[data-size]');
		sizeEl.textContent = out.w + '×' + out.h + ' --- ' + formatBytes(item.file.size) + ' → ';
		const to = document.createElement('span');
		to.className = 'pj-saving' + (change > 0 ? ' is-bigger' : '');
		to.textContent = formatBytes(out.blob.size) + ' (' + (change > 0 ? '+' : '−') + Math.abs(change) + '%)';
		sizeEl.appendChild(to);
		if (out.alpha) {
			const note = document.createElement('span');
			note.className = 'wp-note';
			note.textContent = 'Transparency kept';
			sizeEl.appendChild(note);
		}
		if (item.animated) {
			const note = document.createElement('span');
			note.className = 'wp-note is-warn';
			note.textContent = 'Animated WebP: only the first frame is saved.';
			sizeEl.appendChild(note);
		}
	}

	async function processQueue() {
		if (converting) return;
		converting = true;
		for (const item of items) {
			if (item.status !== 'pending') continue;
			item.status = 'working';
			const statusEl = item.cardEl.querySelector('[data-status]');
			statusEl.textContent = 'Converting…';
			statusEl.className = 'card-status processing';
			showVeil(item.cardEl);
			updateToolbarStatus();
			await new Promise((r) => setTimeout(r, 0));
			try {
				item.animated = isAnimatedWebp(await readHead(item.file));
				const out = await convertToPng(item);
				item.pngBlob = out.blob;
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
		converting = false;
		updateToolbarStatus();
	}

	function addFiles(fileList) {
		const all = Array.from(fileList);
		const webps = all.filter(isWebp);
		const skipped = all.length - webps.length;
		if (webps.length === 0) {
			showError('Only WebP files can be converted here. ' + (skipped === 1 ? 'That file was' : 'Those files were') + ' skipped.');
			return;
		}
		if (skipped) showError(skipped + ' file' + (skipped === 1 ? ' was' : 's were') + ' skipped because only WebP files are converted.');
		else clearError();

		stage.classList.add('compact');
		toolbar.classList.add('show');
		webps.forEach((file) => {
			const item = { id: ++idCounter, file: file, originalURL: URL.createObjectURL(file), status: 'pending', pngBlob: null, animated: false };
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
		if (done.length === 1) { triggerDownload(done[0].pngBlob, pngName(done[0].file.name)); return; }
		downloadAllBtn.disabled = true;
		const label = downloadAllBtn.textContent;
		downloadAllBtn.textContent = 'Zipping…';
		try {
			const zip = new JSZip();
			const taken = new Set();
			done.forEach((i) => zip.file(uniqueName(pngName(i.file.name), taken), i.pngBlob));
			const content = await zip.generateAsync({ type: 'blob' }); // PNGs are already compressed, so they are just stored
			triggerDownload(content, 'webp-to-png.zip');
		} catch (e) {
			console.error(e);
			showError('Could not build the zip file: ' + (e && e.message ? e.message : String(e)));
		}
		downloadAllBtn.textContent = label;
		downloadAllBtn.disabled = false;
	});

})();