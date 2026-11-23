(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const SVG_NS = 'http://www.w3.org/2000/svg';

	/* ---------- Formats ---------- */

	// Weighted mod-10 check digit used by EAN, UPC and ITF-14
	function gs1Check(digits) {
		let sum = 0;
		for(let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += +digits[i] * w;
		return String((10 - (sum % 10)) % 10);
	}

	function gs1(name, len) {
		return {
			hint: name + ' uses ' + len + ' digits. Type ' + (len - 1) + ' and the last (check) digit is added for you.',
			sample: { 13: '590123412345', 12: '01234567890', 8: '9638507', 14: '1540014128876' }[len],
			prep(v) {
				const d = v.replace(/[\s-]/g, '');
				if(!/^\d+$/.test(d)) return { error: name + ' can only contain digits.' };
				if(d.length === len - 1) {
					const c = gs1Check(d);
					return { value: d + c, note: 'Check digit ' + c + ' added → ' + d + c, ok: true };
				}
				if(d.length === len) {
					const want = gs1Check(d.slice(0, -1));
					if(d.slice(-1) !== want) return { error: 'The check digit is wrong. The last digit should be ' + want + ' (' + d.slice(0, -1) + want + ').' };
					return { value: d, note: 'Check digit is correct', ok: true };
				}
				return { error: name + ' needs ' + (len - 1) + ' or ' + len + ' digits. This has ' + d.length + '.' };
			}
		};
	}

	const FORMATS = {
		EAN13: gs1('EAN-13', 13),
		UPC: gs1('UPC-A', 12),
		EAN8: gs1('EAN-8', 8),
		ITF14: gs1('ITF-14', 14),
		UPCE: {
			hint: 'UPC-E is a short UPC for small packs. Type 6 digits, or 8 digits starting with 0 or 1.',
			sample: '01245714',
			prep(v) {
				const d = v.replace(/[\s-]/g, '');
				if(!/^\d+$/.test(d)) return { error: 'UPC-E can only contain digits.' };
				if(d.length !== 6 && d.length !== 8) return { error: 'UPC-E needs 6 or 8 digits. This has ' + d.length + '.' };
				if(d.length === 8 && !/^[01]/.test(d)) return { error: 'An 8-digit UPC-E must start with 0 or 1.' };
				return { value: d };
			}
		},
		CODE128: {
			hint: 'Code 128 holds any letters, numbers and symbols. It is the usual choice for shipping and stock labels.',
			sample: 'MATTE-2026-0001',
			prep(v) {
				if(/[^\x00-\x7F]/.test(v)) return { error: 'Code 128 only supports English letters, numbers and standard symbols. Remove accented letters or other scripts.' };
				if(v.length > 80) return { error: 'This is too long for a barcode. Keep it under 80 characters or use a QR code.' };
				return { value: v };
			}
		},
		CODE39: {
			hint: 'Code 39 holds capital letters A–Z, numbers, spaces and - . $ / + %. Small letters are made capital.',
			sample: 'MATTE-123',
			prep(v) {
				const u = v.toUpperCase();
				const bad = u.replace(/[A-Z0-9 \-.$\/+%]/g, '');
				if(bad) return { error: 'Code 39 cannot contain ' + [...new Set(bad)].join(' ') + '. Use A–Z, 0–9, spaces and - . $ / + %.' };
				if(u.length > 43) return { error: 'Code 39 gets very wide. Keep it under 43 characters or use Code 128.' };
				return { value: u, note: u !== v ? 'Changed to capitals: ' + u : '' };
			}
		},
		CODE93: {
			hint: 'Code 93 holds capital letters A–Z, numbers, spaces and - . $ / + %, and is more compact than Code 39.',
			sample: 'MATTE93',
			prep(v) {
				const u = v.toUpperCase();
				const bad = u.replace(/[A-Z0-9 \-.$\/+%]/g, '');
				if(bad) return { error: 'Code 93 cannot contain ' + [...new Set(bad)].join(' ') + '. Use A–Z, 0–9, spaces and - . $ / + %.' };
				return { value: u, note: u !== v ? 'Changed to capitals: ' + u : '' };
			}
		},
		ITF: {
			hint: 'ITF (Interleaved 2 of 5) holds an even number of digits.',
			sample: '12345678',
			prep(v) {
				const d = v.replace(/\s/g, '');
				if(!/^\d+$/.test(d)) return { error: 'ITF can only contain digits.' };
				if(d.length % 2) return { error: 'ITF needs an even number of digits. Add a 0 at the start: 0' + d };
				return { value: d };
			}
		},
		codabar: {
			hint: 'Codabar holds numbers and - $ : / . +, and can start and end with A, B, C or D.',
			sample: 'A40156B',
			prep(v) {
				const u = v.toUpperCase().replace(/\s/g, '');
				if(!/^[A-D]?[0-9\-$:\/.+]+[A-D]?$/.test(u)) return { error: 'Codabar allows digits and - $ : / . +, with an optional A, B, C or D at the start and end.' };
				return { value: u };
			}
		},
		MSI: {
			hint: 'MSI Plessey holds digits only and is mostly used for shelf labels.',
			sample: '1234567',
			prep(v) {
				const d = v.replace(/\s/g, '');
				if(!/^\d+$/.test(d)) return { error: 'MSI can only contain digits.' };
				return { value: d };
			}
		},
		pharmacode: {
			hint: 'Pharmacode is a number from 3 to 131070, used on medicine packaging.',
			sample: '1234',
			prep(v) {
				const d = v.replace(/\s/g, '');
				if(!/^\d+$/.test(d) || +d < 3 || +d > 131070) return { error: 'Pharmacode must be a whole number from 3 to 131070.' };
				return { value: String(+d) };
			}
		}
	};

	/* ---------- Elements ---------- */

	const modeBox = $('bcMode'),
		optFormat = $('bcFormat'),
		hintEl = $('bcHint'),
		valueIn = $('bcValue'),
		textIn = $('bcText'),
		checkEl = $('bcCheck'),
		batchIn = $('bcBatch');
	const optWidth = $('bcWidth'),
		optHeight = $('bcHeight'),
		optFont = $('bcFont'),
		optMargin = $('bcMargin'),
		optTextPos = $('bcTextPos'),
		optScale = $('bcScale'),
		fg = $('bcFg'),
		fgHex = $('bcFgHex'),
		bg = $('bcBg'),
		bgHex = $('bcBgHex'),
		optTransparent = $('bcTransparent');
	const errBox = $('bcErr'),
		statusEl = $('bcStatus'),
		infoEl = $('bcInfo'),
		warnEl = $('bcWarn'),
		preview = $('bcPreview'),
		svgEl = $('bcSvg'),
		gridEl = $('bcGrid');
	const copyBtn = $('bcCopyBtn'),
		svgBtn = $('bcSvgBtn'),
		pngBtn = $('bcPngBtn'),
		pngLabel = $('bcPngLabel'),
		clearBtn = $('bcClearBtn');

	let mode = 'single',
		single = null, // { value }
		batch = [], // [{ value, svg }]
		timer = null;

	/* ---------- Drawing ---------- */

	function options(text) {
		const o = {
			format: optFormat.value,
			width: +optWidth.value,
			height: +optHeight.value,
			fontSize: +optFont.value,
			margin: +optMargin.value,
			displayValue: optTextPos.value !== 'none',
			textPosition: optTextPos.value === 'top' ? 'top' : 'bottom',
			textMargin: 4,
			font: 'monospace',
			lineColor: fg.value,
			background: optTransparent.checked ? 'rgba(0,0,0,0)' : bg.value
		};
		if(text) o.text = text;
		return o;
	}

	function draw(svg, value, text) {
		let ok = true;
		const o = options(text);
		o.valid = (v) => (ok = v);
		try {
			JsBarcode(svg, value, o);
		} catch (e) {
			ok = false;
		}
		return ok;
	}

	function svgString(svg) {
		const clone = svg.cloneNode(true);
		clone.setAttribute('xmlns', SVG_NS);
		return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
	}

	function svgToPng(svg) {
		const w = parseFloat(svg.getAttribute('width')),
			h = parseFloat(svg.getAttribute('height')),
			scale = +optScale.value;
		const url = URL.createObjectURL(new Blob([svgString(svg)], { type: 'image/svg+xml' }));
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				const cv = document.createElement('canvas');
				cv.width = Math.round(w * scale);
				cv.height = Math.round(h * scale);
				const ctx = cv.getContext('2d');
				ctx.imageSmoothingEnabled = false;
				ctx.drawImage(img, 0, 0, cv.width, cv.height);
				URL.revokeObjectURL(url);
				cv.toBlob(resolve, 'image/png');
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error('render'));
			};
			img.src = url;
		});
	}

	/* ---------- Colour check ---------- */

	function lum(hex) {
		const v = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255)
			.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
		return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
	}

	function checkWarnings() {
		const msgs = [];
		if(optTransparent.checked) {
			if(lum(fg.value) > 0.3) msgs.push('Light bars on a transparent background only scan on a dark surface, and most scanners need dark bars on a light background.');
		} else {
			const a = lum(fg.value),
				b = lum(bg.value);
			const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
			if(a > b) msgs.push('The bars are lighter than the background. Barcode scanners need dark bars on a light background.');
			else if(ratio < 4) msgs.push('The bar and background colours are too close. Use dark bars (black or dark blue) on a white or light background.');
			if(/^#?(ff0000|e[0-9a-f]0000)$/i.test(fg.value)) msgs.push('Red bars do not show up for the red laser in most scanners.');
		}
		if(+optWidth.value === 1 && +optScale.value === 1) msgs.push('Thin bars at 1× may blur when printed. Choose a higher PNG scale or use SVG for print.');
		if(+optMargin.value < 8 && !optTransparent.checked) msgs.push('Leave a margin of at least 10 px so scanners can find the start and end of the barcode.');
		warnEl.textContent = msgs.join(' ');
		warnEl.classList.toggle('show', msgs.length > 0);
	}

	/* ---------- Render ---------- */

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function updateLabels() {
		$('bcWidthVal').textContent = optWidth.value;
		$('bcHeightVal').textContent = optHeight.value + ' px';
		$('bcFontVal').textContent = optFont.value + ' px';
		$('bcMarginVal').textContent = optMargin.value + ' px';
		hintEl.textContent = FORMATS[optFormat.value].hint;
	}

	function setButtons(on) {
		copyBtn.disabled = mode === 'batch' || !on;
		svgBtn.disabled = pngBtn.disabled = !on;
	}

	function renderSingle() {
		const fmt = FORMATS[optFormat.value];
		const raw = valueIn.value.trim();
		checkEl.className = 'bc-sub';
		checkEl.textContent = '';
		single = null;
		if(!raw) {
			preview.classList.add('empty');
			infoEl.textContent = '';
			statusEl.textContent = 'Type a value to make a barcode';
			setButtons(false);
			return;
		}
		const r = fmt.prep(raw);
		if(r.error) {
			preview.classList.add('empty');
			checkEl.classList.add('bad');
			checkEl.textContent = r.error;
			infoEl.textContent = '';
			statusEl.textContent = 'This value does not fit the ' + optFormat.selectedOptions[0].textContent.replace(/ \(.*\)$/, '') + ' format';
			setButtons(false);
			return;
		}
		if(!draw(svgEl, r.value, textIn.value.trim())) {
			preview.classList.add('empty');
			checkEl.classList.add('bad');
			checkEl.textContent = 'This value cannot be drawn in this format.';
			setButtons(false);
			return;
		}
		if(r.note) {
			checkEl.textContent = r.note;
			if(r.ok) checkEl.classList.add('ok');
		}
		single = { value: r.value };
		preview.classList.remove('empty');
		const w = parseFloat(svgEl.getAttribute('width')),
			h = parseFloat(svgEl.getAttribute('height')),
			s = +optScale.value;
		infoEl.textContent = 'PNG ' + Math.round(w * s) + ' × ' + Math.round(h * s) + ' px';
		statusEl.textContent = 'Barcode ready · ' + r.value;
		setButtons(true);
	}

	function renderBatch() {
		const lines = batchIn.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
		gridEl.innerHTML = '';
		batch = [];
		if(!lines.length) {
			preview.classList.add('empty');
			infoEl.textContent = '';
			statusEl.textContent = 'Type or paste values, one per line';
			setButtons(false);
			return;
		}
		const fmt = FORMATS[optFormat.value];
		const list = lines.slice(0, 500);
		let bad = 0;
		const frag = document.createDocumentFragment();
		list.forEach((raw) => {
			const item = document.createElement('div');
			item.className = 'bc-item';
			const r = fmt.prep(raw);
			let svg = null;
			if(!r.error) {
				svg = document.createElementNS(SVG_NS, 'svg');
				if(!draw(svg, r.value)) {
					r.error = 'Cannot be drawn in this format.';
					svg = null;
				}
			}
			const label = document.createElement('div');
			label.className = 'bc-item-val';
			label.textContent = raw;
			if(svg) {
				item.appendChild(svg);
				batch.push({ value: r.value, svg });
			} else {
				bad++;
				item.classList.add('bad');
				const e = document.createElement('div');
				e.className = 'bc-item-err';
				e.textContent = r.error;
				item.appendChild(label);
				item.appendChild(e);
			}
			frag.appendChild(item);
		});
		gridEl.appendChild(frag);
		preview.classList.toggle('empty', false);
		infoEl.textContent = batch.length + ' ready' + (bad ? ' · ' + bad + ' with errors' : '');
		statusEl.textContent = batch.length + ' barcode' + (batch.length === 1 ? '' : 's') + ' ready' +
			(bad ? ' · fix or remove the ' + bad + ' marked in red' : '') +
			(lines.length > 500 ? ' · only the first 500 lines are used' : '');
		setButtons(batch.length > 0);
	}

	function render() {
		clearError();
		updateLabels();
		if(mode === 'single') renderSingle();
		else renderBatch();
		checkWarnings();
	}

	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(render, mode === 'batch' ? 250 : 100);
	}

	/* ---------- Files ---------- */

	function safeName(v) {
		return v.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'barcode';
	}

	function save(blob, name) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	function flashStatus(msg) {
		const prev = statusEl.textContent;
		statusEl.textContent = msg;
		setTimeout(() => (statusEl.textContent = prev), 1600);
	}

	async function zipAll(kind) {
		if(typeof JSZip === 'undefined') {
			showError('The ZIP library did not load. Refresh the page and try again.');
			return;
		}
		const zip = new JSZip();
		const used = {};
		const total = batch.length;
		for(let i = 0; i < total; i++) {
			const b = batch[i];
			let name = safeName(b.value);
			used[name] = (used[name] || 0) + 1;
			if(used[name] > 1) name += '-' + used[name];
			if(kind === 'svg') zip.file(name + '.svg', svgString(b.svg));
			else zip.file(name + '.png', await svgToPng(b.svg));
			if(i % 20 === 0) statusEl.textContent = 'Preparing ' + (i + 1) + ' of ' + total + '…';
		}
		const blob = await zip.generateAsync({ type: 'blob' });
		save(blob, 'barcodes-' + optFormat.value.toLowerCase() + '-' + kind + '.zip');
		statusEl.textContent = 'Downloaded ' + total + ' barcodes as a ZIP file';
	}

	pngBtn.addEventListener('click', async() => {
		try {
			if(mode === 'batch') {
				if(batch.length) await zipAll('png');
			} else if(single) {
				save(await svgToPng(svgEl), 'barcode-' + safeName(single.value) + '.png');
			}
		} catch (e) {
			showError('The PNG could not be made in this browser. Try SVG instead.');
		}
	});

	svgBtn.addEventListener('click', async() => {
		if(mode === 'batch') {
			if(batch.length) await zipAll('svg');
		} else if(single) {
			save(new Blob([svgString(svgEl)], { type: 'image/svg+xml' }), 'barcode-' + safeName(single.value) + '.svg');
		}
	});

	copyBtn.addEventListener('click', async() => {
		if(!single) return;
		try {
			if(!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('unsupported');
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': svgToPng(svgEl) })]);
			flashStatus('Barcode image copied');
		} catch (e) {
			showError('Your browser does not allow copying images here. Use Download PNG instead.');
		}
	});

	clearBtn.addEventListener('click', () => {
		if(mode === 'single') {
			valueIn.value = '';
			textIn.value = '';
			valueIn.focus();
		} else {
			batchIn.value = '';
			batchIn.focus();
		}
		render();
	});

	/* ---------- Colours ---------- */

	function pairColour(picker, hex) {
		picker.addEventListener('input', () => {
			hex.value = picker.value;
			schedule();
		});
		hex.addEventListener('input', () => {
			let v = hex.value.trim();
			if(!v.startsWith('#')) v = '#' + v;
			if(/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map((c) => c + c).join('');
			if(/^#[0-9a-f]{6}$/i.test(v)) {
				picker.value = v.toLowerCase();
				schedule();
			}
		});
		hex.addEventListener('blur', () => (hex.value = picker.value));
	}
	pairColour(fg, fgHex);
	pairColour(bg, bgHex);

	/* ---------- Events ---------- */

	modeBox.addEventListener('click', (e) => {
		const btn = e.target.closest('.mode-btn');
		if(!btn || btn.dataset.mode === mode) return;
		modeBox.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
		mode = btn.dataset.mode;
		document.querySelectorAll('#bcFields [data-for]').forEach((g) => g.classList.toggle('is-hidden', g.dataset.for !== mode));
		$('bcSingle').classList.toggle('is-hidden', mode !== 'single');
		gridEl.classList.toggle('is-hidden', mode !== 'batch');
		preview.classList.toggle('batch', mode === 'batch');
		pngLabel.textContent = mode === 'batch' ? 'Download ZIP' : 'Download PNG';
		svgBtn.lastChild.textContent = mode === 'batch' ? ' SVG ZIP' : ' SVG';
		$('bcPlaceholder').textContent = mode === 'batch' ? 'Your barcodes appear here' : 'Your barcode appears here';
		render();
		(mode === 'batch' ? batchIn : valueIn).focus();
	});

	optFormat.addEventListener('change', () => {
		// Swap in a sample when the current value does not suit the new format
		const fmt = FORMATS[optFormat.value];
		if(mode === 'single' && (!valueIn.value.trim() || fmt.prep(valueIn.value.trim()).error)) valueIn.value = fmt.sample;
		render();
	});

	[valueIn, textIn, batchIn].forEach((el) => el.addEventListener('input', schedule));
	[optWidth, optHeight, optFont, optMargin].forEach((el) => el.addEventListener('input', schedule));
	[optTextPos, optScale, optTransparent].forEach((el) => el.addEventListener('change', render));

	render();
})();
