function loadScript(src) {
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = src;
		s.onload = () => resolve();
		s.onerror = () => reject(new Error('Failed to load ' + src));
		document.head.appendChild(s);
	});
}

function loadImageEl(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not load image'));
		img.src = src;
	});
}

const stage = document.getElementById('rsStage');
const dropMsg = document.getElementById('rsDropMsg');
const dropBig = dropMsg.querySelector('.big');
const dropSmall = dropMsg.querySelector('.small');
const fileInput = document.getElementById('rsFileInput');
const grid = document.getElementById('rsGrid');
const settingsBar = document.getElementById('rsSettings');
const toolbar = document.getElementById('rsToolbar');
const toolbarStatus = document.getElementById('rsToolbarStatus');
const clearBtn = document.getElementById('rsClearBtn');
const downloadAllBtn = document.getElementById('rsDownloadAllBtn');
const processBtn = document.getElementById('rsProcessBtn');
const scaleInput = document.getElementById('rsScale');
const presets = document.getElementById('rsPresets');
const aiToggle = document.getElementById('rsAiToggle');
const errBox = document.getElementById('rsErr');
let items = [];
let idCounter = 0;
let processing = false;
let upscalerReadyPromise = null;
let upscalerInstance = null;

function showError(msg) {
	errBox.textContent = msg;
	errBox.classList.add('show');
}

function clearError() {
	errBox.classList.remove('show');
	errBox.textContent = '';
}

function dlName(name) {
	const dot = name.lastIndexOf('.');
	const stem = dot > -1 ? name.slice(0, dot) : name;
	const ext = dot > -1 ? name.slice(dot) : '.png';
	return stem + '-resized' + ext;
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

function drawScaledHQ(sourceEl, targetW, targetH) {
	let curW = sourceEl.naturalWidth || sourceEl.width;
	let curH = sourceEl.naturalHeight || sourceEl.height;
	let curCanvas = document.createElement('canvas');
	curCanvas.width = curW;
	curCanvas.height = curH;
	let curCtx = curCanvas.getContext('2d');
	curCtx.drawImage(sourceEl, 0, 0, curW, curH);
	while(curW * 0.5 > targetW && curH * 0.5 > targetH) {
		const nextW = Math.round(curW * 0.5);
		const nextH = Math.round(curH * 0.5);
		const nextCanvas = document.createElement('canvas');
		nextCanvas.width = nextW;
		nextCanvas.height = nextH;
		const nextCtx = nextCanvas.getContext('2d');
		nextCtx.imageSmoothingEnabled = true;
		nextCtx.imageSmoothingQuality = 'high';
		nextCtx.drawImage(curCanvas, 0, 0, nextW, nextH);
		curCanvas = nextCanvas;
		curW = nextW;
		curH = nextH;
	}
	const finalCanvas = document.createElement('canvas');
	finalCanvas.width = targetW;
	finalCanvas.height = targetH;
	const finalCtx = finalCanvas.getContext('2d');
	finalCtx.imageSmoothingEnabled = true;
	finalCtx.imageSmoothingQuality = 'high';
	finalCtx.drawImage(curCanvas, 0, 0, targetW, targetH);
	return finalCanvas;
}

presets.addEventListener('click', (e) => {
	const btn = e.target.closest('.preset-btn');
	if(!btn) return;
	scaleInput.value = btn.dataset.scale;
	presets.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b === btn));
});

scaleInput.addEventListener('input', () => {
	presets.querySelectorAll('.preset-btn').forEach(b => b.classList.toggle('active', b.dataset.scale === scaleInput.value));
});

// async function ensureUpscaler() {
// 	if(window.Upscaler) {
// 		if(!upscalerInstance) upscalerInstance = new window.Upscaler();
// 		return;
// 	}
// 	if(!upscalerReadyPromise) {
// 		upscalerReadyPromise = (async() => {
// 			await loadScript('https://unpkg.com/@tensorflow/tfjs@latest/dist/tf.min.js');
// 			await loadScript('https://unpkg.com/upscaler@latest/dist/browser/umd/upscaler.min.js');
// 			upscalerInstance = new window.Upscaler();
// 		})();
// 	}
// 	await upscalerReadyPromise;
// }

async function ensureUpscaler(){
  if (upscalerInstance) return;
  if (!upscalerReadyPromise){
    upscalerReadyPromise = (async () => {
      await loadScript('assets/vendors/tf/tf.min.js');
      await loadScript('assets/vendors/upscaler/upscaler.min.js');
      await loadScript('assets/vendors/upscaler/index.min.js'); // exposes window.DefaultUpscalerJSModel

      upscalerInstance = new window.Upscaler({
        model: {
          ...window.DefaultUpscalerJSModel,
          path: 'assets/vendors/upscaler/models/model.json'
        }
      });
    })();
  }
  await upscalerReadyPromise;
}

function makeCard(item) {
	const card = document.createElement('div');
	card.className = 'card';
	card.innerHTML = `
		<div class="thumb" data-thumb>
			<img data-img src="${item.originalURL}">
			<div class="veil" data-veil style="display:none;"><div class="mini-spinner"></div></div>
		</div>
		<div class="card-foot">
			<div class="card-name">${item.file.name}</div>
			<div class="card-foot-row">
				<div class="card-status pending" data-status>Queued</div>
				<button class="card-dl" data-dl disabled title="Download"><i class="fa-solid fa-download"></i></button>
			</div>
			<div class="card-dims" data-dims>&nbsp;</div>
		</div>`;
	card.querySelector('[data-dl]').addEventListener('click', () => {
		if(!item.resultURL) return;
		const a = document.createElement('a');
		a.href = item.resultURL;
		a.download = dlName(item.file.name);
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	});
	grid.appendChild(card);
	return card;
}

function updateToolbarStatus() {
	const total = items.length;
	const done = items.filter(i => i.status === 'done').length;
	const errored = items.filter(i => i.status === 'error').length;
	if(processing) {
		toolbarStatus.innerHTML = `<div class="mini-spinner"></div> Resizing ${done + errored + 1} of ${total}…`;
	} else if(done + errored === total && total > 0 && (done > 0 || errored > 0)) {
		toolbarStatus.textContent = errored ? `Done — ${done} succeeded, ${errored} failed` : `Done — ${done} image${done===1?'':'s'} ready`;
	} else {
		toolbarStatus.textContent = `${total} photo${total===1?'':'s'} queued — set your scale above and hit Resize`;
	}
	downloadAllBtn.disabled = done === 0;
	processBtn.disabled = processing || total === 0;
}

function addFiles(fileList) {
	const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
	if(files.length === 0) {
		showError("Those don't look like image files. Try JPG, PNG, or WEBP.");
		return;
	}
	clearError();
	stage.classList.add('compact');
	settingsBar.classList.add('show');
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
}

async function resizeOne(item, scalePercent, useAI) {
	const statusEl = item.cardEl.querySelector('[data-status]');
	const dimsEl = item.cardEl.querySelector('[data-dims]');
	const origImg = await loadImageEl(item.originalURL);
	let drawSource = origImg;
	if(useAI && scalePercent > 100) {
		try {
			statusEl.textContent = 'Loading AI model…';
			await ensureUpscaler();
			statusEl.textContent = 'Enhancing with AI…';
			const upscaledSrc = await upscalerInstance.upscale(origImg);
			drawSource = await loadImageEl(upscaledSrc);
		} catch(e) {
			console.warn('AI enhance failed, falling back to a plain resize for this image:', e);
		}
	}
	const targetW = Math.max(1, Math.round(origImg.naturalWidth * scalePercent / 100));
	const targetH = Math.max(1, Math.round(origImg.naturalHeight * scalePercent / 100));
	const canvas = drawScaledHQ(drawSource, targetW, targetH);
	const outType = item.file.type && item.file.type.startsWith('image/') ? item.file.type : 'image/png';
	const quality = (outType === 'image/jpeg' || outType === 'image/webp') ? 0.96 : undefined;
	const blob = await new Promise(resolve => canvas.toBlob(resolve, outType, quality));
	dimsEl.textContent = `${origImg.naturalWidth}×${origImg.naturalHeight} → ${targetW}×${targetH}`;
	return blob;
}

async function processAll() {
	if(processing) return;
	processing = true;
	clearError();
	const scalePercent = Math.min(800, Math.max(10, parseInt(scaleInput.value, 10) || 100));
	const useAI = aiToggle.checked;
	for(const item of items) {
		if(item.status === 'done') continue;
		item.status = 'processing';
		const statusEl = item.cardEl.querySelector('[data-status]');
		const veilEl = item.cardEl.querySelector('[data-veil]');
		statusEl.textContent = 'Resizing…';
		statusEl.className = 'card-status processing';
		veilEl.style.display = 'flex';
		updateToolbarStatus();
		try {
			const blob = await resizeOne(item, scalePercent, useAI);
			item.resultBlob = blob;
			if(item.resultURL) URL.revokeObjectURL(item.resultURL);
			item.resultURL = URL.createObjectURL(blob);
			item.status = 'done';
			item.cardEl.querySelector('[data-img]').src = item.resultURL;
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

processBtn.addEventListener('click', processAll);
clearBtn.addEventListener('click', () => {
	items.forEach(i => {
		URL.revokeObjectURL(i.originalURL);
		if(i.resultURL) URL.revokeObjectURL(i.resultURL);
	});
	items = [];
	grid.innerHTML = '';
	stage.classList.remove('compact');
	settingsBar.classList.remove('show');
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
		const zip = new JSZip();
		done.forEach(i => zip.file(dlName(i.file.name), i.resultBlob));
		const content = await zip.generateAsync({
			type: 'blob'
		});
		const url = URL.createObjectURL(content);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'matte-resized.zip';
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