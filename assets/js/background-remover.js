import {
	removeBackground
}
from "https://esm.sh/@imgly/background-removal@1.6.0";
const EXT = {
	png: 'png',
	webp: 'webp',
	jpeg: 'jpg'
};
const MIME = {
	png: 'image/png',
	webp: 'image/webp',
	jpeg: 'image/jpeg'
};
async function convertBlob(pngBlob, format) {
	if(format === 'png') return pngBlob;
	const bitmap = await createImageBitmap(pngBlob);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext('2d');
	if(format === 'jpeg') {
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
	}
	ctx.drawImage(bitmap, 0, 0);
	const quality = format === 'jpeg' ? 0.96 : undefined;
	return new Promise(resolve => canvas.toBlob(resolve, MIME[format], quality));
}
const stage = document.getElementById('bgStage');
const dropMsg = document.getElementById('bgDropMsg');
const dropBig = dropMsg.querySelector('.big');
const dropSmall = dropMsg.querySelector('.small');
const fileInput = document.getElementById('bgFileInput');
const grid = document.getElementById('bgGrid');
const toolbar = document.getElementById('bgToolbar');
const toolbarStatus = document.getElementById('bgToolbarStatus');
const clearBtn = document.getElementById('bgClearBtn');
const downloadAllBtn = document.getElementById('bgDownloadAllBtn');
const formatSelect = document.getElementById('bgFormatSelect');
const errBox = document.getElementById('bgErr');
let items = [];
let idCounter = 0;
let processing = false;

function showError(msg) {
	errBox.textContent = msg;
	errBox.classList.add('show');
}

function clearError() {
	errBox.classList.remove('show');
	errBox.textContent = '';
}

function baseName(name, format) {
	return name.replace(/\.[^/.]+$/, '') + '-matte.' + EXT[format];
}

function refreshDropMsg() {
	if(items.length === 0) {
		dropBig.textContent = 'Drop photos here';
		dropSmall.innerHTML = 'or <b>click to browse</b> — select as many as you like, JPG/PNG/WEBP';
	} else {
		dropBig.textContent = 'Drop more photos here';
		dropSmall.innerHTML = 'or <b>click to add more</b>';
	}
}

function makeCard(item) {
	const card = document.createElement('div');
	card.className = 'card';
	card.innerHTML = `
		<div class="thumb" data-thumb> <img data-img src="${item.originalURL}">
			<div class="veil" data-veil style="display:none;">
				<div class="mini-spinner"></div>
			</div>
		</div>
		<div class="card-foot">
			<div class="card-name">${item.file.name}</div>
			<div class="card-foot-row">
				<div class="card-status pending" data-status>Queued</div>
				<button class="card-dl" data-dl disabled title="Download"><i class="fa-solid fa-download"></i></button>
			</div>
		</div>`;
	card.querySelector('[data-dl]').addEventListener('click', async(e) => {
		if(!item.resultBlob) return;
		const btn = e.currentTarget;
		const format = formatSelect.value;
		btn.disabled = true;
		try {
			const outBlob = await convertBlob(item.resultBlob, format);
			const url = URL.createObjectURL(outBlob);
			const a = document.createElement('a');
			a.href = url;
			a.download = baseName(item.file.name, format);
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch(err) {
			console.error(err);
			showError('Could not convert that image: ' + ((err && err.message) ? err.message : String(err)));
		}
		btn.disabled = false;
	});
	grid.appendChild(card);
	return card;
}

function updateToolbarStatus() {
	const total = items.length;
	const done = items.filter(i => i.status === 'done').length;
	const errored = items.filter(i => i.status === 'error').length;
	if(processing) {
		toolbarStatus.innerHTML = `
		<div class="mini-spinner"></div> Processing ${done + errored + 1} of ${total}…`;
	} else if(done + errored === total && total > 0) {
		toolbarStatus.textContent = errored ? `Done — ${done} succeeded, ${errored} failed` : `Done — ${done} image${done===1?'':'s'} ready`;
	} else {
		toolbarStatus.textContent = `${total} photo${total===1?'':'s'} queued`;
	}
	downloadAllBtn.disabled = done === 0;
}

function addFiles(fileList) {
	const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
	if(files.length === 0) {
		showError("Those don't look like image files. Try JPG, PNG, or WEBP.");
		return;
	}
	clearError();
	stage.classList.add('compact');
	toolbar.classList.add('show');
	files.forEach(file => {
		const item = {
			id: ++idCounter,
			file,
			originalURL: URL.createObjectURL(file),
			resultURL: null,
			status: 'pending'
		};
		item.cardEl = makeCard(item);
		items.push(item);
	});
	refreshDropMsg();
	updateToolbarStatus();
	processQueue();
}

async function processQueue() {
	if(processing) return;
	processing = true;
	for(const item of items) {
		if(item.status !== 'pending') continue;
		item.status = 'processing';
		const statusEl = item.cardEl.querySelector('[data-status]');
		const veilEl = item.cardEl.querySelector('[data-veil]');
		statusEl.textContent = 'Processing…';
		statusEl.className = 'card-status processing';
		veilEl.style.display = 'flex';
		updateToolbarStatus();
		try {
			const blob = await removeBackground(item.file, {
				proxyToWorker: false
			});
			item.resultBlob = blob;
			item.resultURL = URL.createObjectURL(blob);
			item.status = 'done';
			const thumbEl = item.cardEl.querySelector('[data-thumb]');
			const imgEl = item.cardEl.querySelector('[data-img]');
			thumbEl.classList.add('checker');
			imgEl.src = item.resultURL;
			veilEl.style.display = 'none';
			statusEl.textContent = 'Done';
			statusEl.className = 'card-status done';
			item.cardEl.querySelector('[data-dl]').disabled = false;
		} catch(e) {
			console.error(e);
			item.status = 'error';
			veilEl.style.display = 'none';
			statusEl.textContent = 'Failed';
			statusEl.className = 'card-status error';
			item.cardEl.title = (e && e.message) ? e.message : String(e);
		}
		updateToolbarStatus();
	}
	processing = false;
	updateToolbarStatus();
}

stage.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
	if(e.target.files.length) addFiles(e.target.files);
	fileInput.value = '';
});

['dragenter', 'dragover'].forEach(evt => stage.addEventListener(evt, e => {
	e.preventDefault();
	stage.classList.add('drag');
}));

['dragleave', 'drop'].forEach(evt => stage.addEventListener(evt, e => {
	e.preventDefault();
	stage.classList.remove('drag');
}));

stage.addEventListener('drop', e => {
	if(e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

clearBtn.addEventListener('click', () => {
	items.forEach(i => {
		URL.revokeObjectURL(i.originalURL);
		if(i.resultURL) URL.revokeObjectURL(i.resultURL);
	});
	items = [];
	grid.innerHTML = '';
	stage.classList.remove('compact');
	toolbar.classList.remove('show');
	clearError();
	refreshDropMsg();
});

downloadAllBtn.addEventListener('click', async() => {
	const done = items.filter(i => i.status === 'done');
	if(done.length === 0) return;
	downloadAllBtn.disabled = true;
	const originalLabel = downloadAllBtn.textContent;
	downloadAllBtn.textContent = 'Zipping…';
	try {
		const format = formatSelect.value;
		const zip = new JSZip();
		for(const i of done) {
			const outBlob = await convertBlob(i.resultBlob, format);
			zip.file(baseName(i.file.name, format), outBlob);
		}
		const content = await zip.generateAsync({
			type: 'blob'
		});
		const url = URL.createObjectURL(content);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'matte-results.zip';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	} catch(e) {
		console.error(e);
		showError('Could not build the zip file: ' + ((e && e.message) ? e.message : String(e)));
	}
	downloadAllBtn.textContent = originalLabel;
	downloadAllBtn.disabled = false;
});