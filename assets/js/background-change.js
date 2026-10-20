import {
	removeBackground
}
from "https://esm.sh/@imgly/background-removal@1.6.0";
const MIME = {
	png: 'image/png',
	webp: 'image/webp',
	jpeg: 'image/jpeg'
};
const EXT = {
	png: 'png',
	webp: 'webp',
	jpeg: 'jpg'
};

function loadImageEl(src) {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not load image'));
		img.src = src;
	});
}

const stage = document.getElementById('cbStage');
const dropMsg = document.getElementById('cbDropMsg');
const dropBig = dropMsg.querySelector('.big');
const dropSmall = dropMsg.querySelector('.small');
const fileInput = document.getElementById('cbFileInput');
const grid = document.getElementById('cbGrid');
const settingsBar = document.getElementById('cbSettings');
const toolbar = document.getElementById('cbToolbar');
const toolbarStatus = document.getElementById('cbToolbarStatus');
const selectAllBtn = document.getElementById('cbSelectAllBtn');
const clearBtn = document.getElementById('cbClearBtn');
const downloadAllBtn = document.getElementById('cbDownloadAllBtn');
const applyBtn = document.getElementById('cbApplyBtn');
const formatSelect = document.getElementById('cbFormatSelect');
const errBox = document.getElementById('cbErr');
const modeBtns = document.querySelectorAll('.mode-btn');
const colorControls = document.getElementById('colorControls');
const gradientControls = document.getElementById('gradientControls');
const imageControls = document.getElementById('imageControls');
const colorInput = document.getElementById('cbColorInput');
const gradType = document.getElementById('cbGradType');
const gradAngleWrap = document.getElementById('cbGradAngleWrap');
const gradAngle = document.getElementById('cbGradAngle');
const gradAngleNum = document.getElementById('cbGradAngleNum');
const gradFrom = document.getElementById('cbGradFrom');
const gradTo = document.getElementById('cbGradTo');
const gradPreview = document.getElementById('cbGradPreview');
const bgFileInput = document.getElementById('cbBgFileInput');
const bgThumb = document.getElementById('cbBgThumb');
const bgLabel = document.getElementById('cbBgLabel');

let items = [];
let idCounter = 0;
let removing = false;
let applying = false;
let mode = 'color';
let bgImageEl = null;
let gradient = {
	type: 'linear',
	from: '#FF6224',
	to: '#3B4051',
	angle: 135
};

function showError(msg) {
	errBox.textContent = msg;
	errBox.classList.add('show');
}

function clearError() {
	errBox.classList.remove('show');
	errBox.textContent = '';
}

function baseName(name, format) {
	return name.replace(/\.[^/.]+$/, '') + '-newbg.' + EXT[format];
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

const groups = {
	color: colorControls,
	gradient: gradientControls,
	image: imageControls
};

modeBtns.forEach(btn => {
	btn.addEventListener('click', () => {
		modeBtns.forEach(b => b.classList.toggle('active', b === btn));
		mode = btn.dataset.mode;
		Object.entries(groups).forEach(([key, el]) => {
			el.style.display = key === mode ? 'flex' : 'none';
		});
	});
});

function gradientCSS(g) {
	if(g.type === 'radial') return `radial-gradient(circle farthest-corner at center, ${g.from}, ${g.to})`;
	if(g.type === 'conic') return `conic-gradient(from ${g.angle}deg at center, ${g.from}, ${g.to})`;
	return `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})`;
}

function syncGradientUI() {
	gradPreview.style.background = gradientCSS(gradient);
	gradAngleWrap.classList.toggle('disabled', gradient.type === 'radial');
}

gradType.addEventListener('change', () => {
	gradient.type = gradType.value;
	syncGradientUI();
});

gradAngle.addEventListener('input', () => {
	gradient.angle = parseInt(gradAngle.value, 10);
	gradAngleNum.value = gradient.angle;
	syncGradientUI();
});

gradAngleNum.addEventListener('input', () => {
	let v = parseInt(gradAngleNum.value, 10);
	if(isNaN(v)) return;
	v = Math.min(360, Math.max(0, v));
	gradient.angle = v;
	gradAngle.value = v;
	syncGradientUI();
});

gradAngleNum.addEventListener('change', () => {
	gradAngleNum.value = gradient.angle;
});

gradFrom.addEventListener('input', () => {
	gradient.from = gradFrom.value;
	syncGradientUI();
});

gradTo.addEventListener('input', () => {
	gradient.to = gradTo.value;
	syncGradientUI();
});

syncGradientUI();
bgFileInput.addEventListener('change', async(e) => {
	const file = e.target.files[0];
	if(!file) return;
	try {
		const url = URL.createObjectURL(file);
		bgImageEl = await loadImageEl(url);
		bgThumb.src = url;
		bgThumb.style.display = 'inline-block';
		bgLabel.textContent = file.name;
	} catch(err) {
		showError('Could not load that background image.');
	}
});

function setSelected(item, val) {
	item.selected = val;
	item.checkEl.checked = val;
	item.cardEl.classList.toggle('selected', val);
}

selectAllBtn.addEventListener('click', () => {
	const ready = items.filter(i => i.cutoutImg);
	if(!ready.length) return;
	const allSelected = ready.every(i => i.selected);
	ready.forEach(i => setSelected(i, !allSelected));
	updateToolbarStatus();
});

function makeCard(item) {
	const card = document.createElement('div');
	card.className = 'card';
	card.innerHTML = `
    <div class="thumb" data-thumb>
      	<label class="card-check" title="Select this photo"><input type="checkbox" data-check disabled></label>
      	<img data-img src="${item.originalURL}">
      	<div class="veil" data-veil style="display:none;"><div class="mini-spinner"></div></div>
    </div>
    <div class="card-foot">
		<div class="card-name">${item.file.name}</div>
		<div class="card-foot-row">
			<div class="card-status pending" data-status>Queued</div>
			<button class="card-dl" data-dl disabled title="Download"><i class="fa-solid fa-download"></i></button>
		</div>
	</div>`;
	item.checkEl = card.querySelector('[data-check]');
	item.checkEl.addEventListener('change', () => {
		setSelected(item, item.checkEl.checked);
		updateToolbarStatus();
	});
	card.querySelector('[data-dl]').addEventListener('click', () => {
		if(!item.resultURL) return;
		const a = document.createElement('a');
		a.href = item.resultURL;
		a.download = baseName(item.file.name, item.resultFormat);
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	});
	grid.appendChild(card);
	return card;
}

function updateToolbarStatus() {
	const total = items.length;
	const cut = items.filter(i => i.cutoutImg).length;
	const done = items.filter(i => i.resultBlob).length;
	const selected = items.filter(i => i.selected && i.cutoutImg).length;
	if(removing) {
		toolbarStatus.innerHTML = `<div class="mini-spinner"></div> Removing backgrounds — ${cut} of ${total} ready…`;
	} else if(selected === 0) {
		toolbarStatus.textContent = cut ? `0 of ${total} selected — tick the photos you want to change` : `${total} photo${total===1?'':'s'}`;
	} else {
		toolbarStatus.textContent = `${selected} of ${total} selected` + (done ? ` · ${done} with new background` : '');
	}
	selectAllBtn.disabled = cut === 0;
	const ready = items.filter(i => i.cutoutImg);
	selectAllBtn.textContent = (ready.length && ready.every(i => i.selected)) ? 'Select none' : 'Select all';
	downloadAllBtn.disabled = done === 0;
	if(!applying) {
		applyBtn.textContent = selected ? `Apply to selected (${selected})` : 'Apply to selected';
		applyBtn.disabled = selected === 0;
	}
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
			selected: false
		};
		item.cardEl = makeCard(item);
		items.push(item);
	});
	refreshDropMsg();
	updateToolbarStatus();
	removeBackgrounds();
}

async function removeBackgrounds() {
	if(removing) return;
	removing = true;
	for(const item of items) {
		if(item.cutoutImg || item.failed) continue;
		const statusEl = item.cardEl.querySelector('[data-status]');
		const veilEl = item.cardEl.querySelector('[data-veil]');
		const thumbEl = item.cardEl.querySelector('[data-thumb]');
		const imgEl = item.cardEl.querySelector('[data-img]');
		statusEl.textContent = 'Removing bg…';
		statusEl.className = 'card-status processing';
		veilEl.style.display = 'flex';
		updateToolbarStatus();
		try {
			const blob = await removeBackground(item.file, {
				proxyToWorker: false
			});
			item.cutoutURL = URL.createObjectURL(blob);
			item.cutoutImg = await loadImageEl(item.cutoutURL);
			thumbEl.classList.add('checker');
			imgEl.src = item.cutoutURL;
			item.checkEl.disabled = false;
			statusEl.textContent = 'Bg removed';
			statusEl.className = 'card-status done';
		} catch(e) {
			console.error(e);
			item.failed = true;
			statusEl.textContent = 'Failed';
			statusEl.className = 'card-status error';
			item.cardEl.title = (e && e.message) ? e.message : String(e);
		}
		veilEl.style.display = 'none';
		updateToolbarStatus();
	}
	removing = false;
	updateToolbarStatus();
}

function gradientCoords(w, h, angleDeg) {
	const a = (angleDeg - 90) * Math.PI / 180;
	const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
	const dx = Math.cos(a) * len / 2,
		dy = Math.sin(a) * len / 2;
	return [w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy];
}

function buildGradient(ctx, w, h, g) {
	let grad;
	if(g.type === 'radial') {
		const r = Math.hypot(w, h) / 2;
		grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
	} else if(g.type === 'conic' && typeof ctx.createConicGradient === 'function') {
		grad = ctx.createConicGradient((g.angle - 90) * Math.PI / 180, w / 2, h / 2);
	} else {
		const [x0, y0, x1, y1] = gradientCoords(w, h, g.angle);
		grad = ctx.createLinearGradient(x0, y0, x1, y1);
	}
	grad.addColorStop(0, g.from);
	grad.addColorStop(1, g.to);
	return grad;
}

function composite(cutout, opts) {
	const w = cutout.naturalWidth,
		h = cutout.naturalHeight;
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	if(opts.mode === 'image' && opts.bgImg) {
		const scale = Math.max(w / opts.bgImg.naturalWidth, h / opts.bgImg.naturalHeight);
		const dw = opts.bgImg.naturalWidth * scale,
			dh = opts.bgImg.naturalHeight * scale;
		ctx.drawImage(opts.bgImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
	} else if(opts.mode === 'gradient') {
		ctx.fillStyle = buildGradient(ctx, w, h, opts.gradient);
		ctx.fillRect(0, 0, w, h);
	} else {
		ctx.fillStyle = opts.color;
		ctx.fillRect(0, 0, w, h);
	}
	ctx.drawImage(cutout, 0, 0);
	const quality = (opts.format === 'jpeg' || opts.format === 'webp') ? 0.96 : undefined;
	return new Promise(resolve => canvas.toBlob(resolve, MIME[opts.format], quality));
}

applyBtn.addEventListener('click', async() => {
	const targets = items.filter(i => i.selected && i.cutoutImg);
	if(targets.length === 0) {
		showError('Tick the checkbox on the photos you want to change first.');
		return;
	}
	if(mode === 'image' && !bgImageEl) {
		showError('Choose a background image first, or switch to Solid color / Gradient.');
		return;
	}
	clearError();
	const opts = {
		mode,
		color: colorInput.value,
			gradient: {...gradient
			},
			bgImg: bgImageEl,
			format: formatSelect.value
	};
	applying = true;
	applyBtn.disabled = true;
	applyBtn.textContent = 'Applying…';
	for(const item of targets) {
		const statusEl = item.cardEl.querySelector('[data-status]');
		statusEl.textContent = 'Applying…';
		statusEl.className = 'card-status processing';
		try {
			const blob = await composite(item.cutoutImg, opts);
			if(item.resultURL) URL.revokeObjectURL(item.resultURL);
			item.resultBlob = blob;
			item.resultFormat = opts.format;
			item.resultURL = URL.createObjectURL(blob);
			item.cardEl.querySelector('[data-thumb]').classList.remove('checker');
			item.cardEl.querySelector('[data-img]').src = item.resultURL;
			item.cardEl.querySelector('[data-dl]').disabled = false;
			statusEl.textContent = 'Applied';
			statusEl.className = 'card-status done';
		} catch(e) {
			console.error(e);
			statusEl.textContent = 'Failed';
			statusEl.className = 'card-status error';
		}
	}
	applying = false;
	updateToolbarStatus();
});

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
		if(i.cutoutURL) URL.revokeObjectURL(i.cutoutURL);
		if(i.resultURL) URL.revokeObjectURL(i.resultURL);
	});
	items = [];
	grid.innerHTML = '';
	stage.classList.remove('compact');
	settingsBar.classList.remove('show');
	toolbar.classList.remove('show');
	clearError();
	refreshDropMsg();
	updateToolbarStatus();
});


downloadAllBtn.addEventListener('click', async() => {
	const done = items.filter(i => i.resultBlob);
	if(done.length === 0) return;
	downloadAllBtn.disabled = true;
	const originalLabel = downloadAllBtn.textContent;
	downloadAllBtn.textContent = 'Zipping…';
	try {
		const zip = new JSZip();
		done.forEach(i => zip.file(baseName(i.file.name, i.resultFormat), i.resultBlob));
		const content = await zip.generateAsync({
			type: 'blob'
		});
		const url = URL.createObjectURL(content);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'matte-new-backgrounds.zip';
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