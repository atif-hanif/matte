(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);

	// Encode text as UTF-8 so Urdu, Arabic, emoji etc. work
	qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

	/* ---------- Elements ---------- */

	const modeBox = $('qrMode'),
		errBox = $('qrErr'),
		statusEl = $('qrStatus'),
		infoEl = $('qrInfo'),
		warnEl = $('qrWarn'),
		preview = $('qrPreview'),
		canvas = $('qrCanvas');
	const fg = $('qrFg'),
		fgHex = $('qrFgHex'),
		bg = $('qrBg'),
		bgHex = $('qrBgHex'),
		optTransparent = $('qrTransparent'),
		optStyle = $('qrStyle'),
		optEcc = $('qrEcc'),
		optSize = $('qrSize'),
		optMargin = $('qrMargin'),
		sizeVal = $('qrSizeVal'),
		marginVal = $('qrMarginVal');
	const logoBtn = $('qrLogoBtn'),
		logoRemove = $('qrLogoRemove'),
		logoInput = $('qrLogoInput'),
		logoName = $('qrLogoName');
	const copyBtn = $('qrCopyBtn'),
		svgBtn = $('qrSvgBtn'),
		pngBtn = $('qrPngBtn'),
		clearBtn = $('qrClearBtn');

	const PREVIEW_PX = 720;

	let mode = 'url',
		current = null, // { qr, n, text }
		logo = null, // { img, dataUrl }
		eccBeforeLogo = null,
		timer = null;

	/* ---------- Content builders ---------- */

	const val = (id) => $(id).value.trim();

	function escWifi(s) {
		return s.replace(/([\\;,:"])/g, '\\$1');
	}

	function escVcard(s) {
		return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
	}

	function phoneDigits(s, keepPlus) {
		const plus = keepPlus && /^\s*\+/.test(s) ? '+' : '';
		return plus + s.replace(/\D/g, '');
	}

	function buildPayload() {
		switch(mode) {
			case 'url': {
				let u = val('qrUrl');
				if(!u) return { empty: 'Type a website link.' };
				if(!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;
				return { text: u, label: u };
			}
			case 'text': {
				const t = $('qrText').value;
				if(!t.trim()) return { empty: 'Type some text.' };
				return { text: t, label: t.length > 40 ? t.slice(0, 40) + '…' : t };
			}
			case 'wifi': {
				const ssid = $('qrSsid').value,
					pass = $('qrWifiPass').value,
					sec = $('qrWifiSec').value;
				if(!ssid.trim()) return { empty: 'Type the Wi-Fi network name.' };
				let t = 'WIFI:T:' + sec + ';S:' + escWifi(ssid) + ';';
				if(sec !== 'nopass') t += 'P:' + escWifi(pass) + ';';
				if($('qrWifiHidden').checked) t += 'H:true;';
				t += ';';
				return { text: t, label: 'Wi-Fi “' + ssid + '”', note: sec !== 'nopass' && !pass ? 'The password is empty. Pick None if the network is open.' : '' };
			}
			case 'email': {
				const to = val('qrEmailTo');
				if(!to) return { empty: 'Type the email address to send to.' };
				const q = [];
				if(val('qrEmailSubj')) q.push('subject=' + encodeURIComponent(val('qrEmailSubj')));
				if($('qrEmailBody').value.trim()) q.push('body=' + encodeURIComponent($('qrEmailBody').value));
				return { text: 'mailto:' + to + (q.length ? '?' + q.join('&') : ''), label: 'Email to ' + to };
			}
			case 'phone': {
				const p = phoneDigits(val('qrPhone'), true);
				if(p.replace('+', '').length < 3) return { empty: 'Type a phone number.' };
				return { text: 'tel:' + p, label: 'Call ' + p };
			}
			case 'sms': {
				const p = phoneDigits(val('qrSmsTo'), true);
				if(p.replace('+', '').length < 3) return { empty: 'Type the phone number to text.' };
				const body = $('qrSmsBody').value;
				return { text: 'SMSTO:' + p + ':' + body, label: 'Text ' + p };
			}
			case 'whatsapp': {
				const p = phoneDigits(val('qrWaTo'), false);
				if(p.length < 7) return { empty: 'Type the WhatsApp number with its country code, e.g. +92 300 1234567.' };
				const body = $('qrWaBody').value.trim();
				return {
					text: 'https://wa.me/' + p + (body ? '?text=' + encodeURIComponent(body) : ''),
					label: 'WhatsApp +' + p,
					note: /^0/.test(p) ? 'Start the number with the country code, without the leading 0 (e.g. 92300… for Pakistan).' : ''
				};
			}
			case 'vcard': {
				const f = val('qrVFirst'),
					l = val('qrVLast');
				if(!f && !l && !val('qrVOrg')) return { empty: 'Type at least a name or company for the contact.' };
				const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:' + escVcard(l) + ';' + escVcard(f) + ';;;', 'FN:' + escVcard((f + ' ' + l).trim() || val('qrVOrg'))];
				if(val('qrVOrg')) lines.push('ORG:' + escVcard(val('qrVOrg')));
				if(val('qrVTitle')) lines.push('TITLE:' + escVcard(val('qrVTitle')));
				if(val('qrVPhone')) lines.push('TEL;TYPE=CELL:' + phoneDigits(val('qrVPhone'), true));
				if(val('qrVEmail')) lines.push('EMAIL:' + val('qrVEmail'));
				if(val('qrVWeb')) lines.push('URL:' + val('qrVWeb'));
				if(val('qrVAddr')) lines.push('ADR:;;' + escVcard(val('qrVAddr')) + ';;;;');
				lines.push('END:VCARD');
				return { text: lines.join('\r\n'), label: 'Contact ' + ((f + ' ' + l).trim() || val('qrVOrg')) };
			}
		}
		return { empty: 'Type your content.' };
	}

	/* ---------- Encoding ---------- */

	function encode(text, ecc) {
		const qr = qrcode(0, ecc);
		qr.addData(text, 'Byte');
		qr.make();
		return qr;
	}

	/* ---------- Geometry shared by canvas and SVG ---------- */

	function isFinder(r, c, n) {
		return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
	}

	function logoBox(n) {
		// square of modules kept clear for the logo, about 22% of the code width
		if(!logo) return null;
		let k = Math.round(n * 0.22);
		if((n - k) % 2) k++;
		const start = (n - k) / 2;
		return { start, end: start + k, k };
	}

	function inLogo(r, c, box) {
		return box && r >= box.start && r < box.end && c >= box.start && c < box.end;
	}

	function opts() {
		return {
			fg: fg.value,
			bg: bg.value,
			transparent: optTransparent.checked,
			style: optStyle.value,
			margin: +optMargin.value
		};
	}

	/* ---------- Canvas ---------- */

	function roundRect(ctx, x, y, w, h, r) {
		r = Math.min(r, w / 2, h / 2);
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	function drawCanvas(cv, px, o) {
		const qr = current.qr,
			n = current.n;
		const ctx = cv.getContext('2d');
		cv.width = cv.height = px;
		ctx.clearRect(0, 0, px, px);
		if(!o.transparent) {
			ctx.fillStyle = o.bg;
			ctx.fillRect(0, 0, px, px);
		}
		const m = px / (n + o.margin * 2),
			off = o.margin * m;
		const box = logoBox(n);
		ctx.fillStyle = o.fg;

		// data modules
		ctx.beginPath();
		for(let r = 0; r < n; r++) {
			for(let c = 0; c < n; c++) {
				if(!qr.isDark(r, c) || isFinder(r, c, n) || inLogo(r, c, box)) continue;
				const x = off + c * m,
					y = off + r * m;
				if(o.style === 'dots') {
					ctx.moveTo(x + m * 0.96, y + m / 2);
					ctx.arc(x + m / 2, y + m / 2, m * 0.46, 0, Math.PI * 2);
				} else if(o.style === 'rounded') {
					roundRect(ctx, x + m * 0.04, y + m * 0.04, m * 0.92, m * 0.92, m * 0.32);
				} else {
					// snap to whole pixels so there are no hairline gaps
					const x0 = Math.floor(x),
						y0 = Math.floor(y);
					ctx.rect(x0, y0, Math.ceil(x + m) - x0, Math.ceil(y + m) - y0);
				}
			}
		}
		ctx.fill();

		// finder "eyes"
		const eyeR = o.style === 'square' ? 0 : o.style === 'rounded' ? 0.28 : 0.5;
		[[0, 0], [0, n - 7], [n - 7, 0]].forEach(([r, c]) => {
			const x = off + c * m,
				y = off + r * m;
			ctx.beginPath();
			roundRect(ctx, x, y, 7 * m, 7 * m, 7 * m * eyeR * 0.5);
			roundRect(ctx, x + m, y + m, 5 * m, 5 * m, 5 * m * eyeR * 0.4);
			ctx.fill('evenodd');
			ctx.beginPath();
			roundRect(ctx, x + 2 * m, y + 2 * m, 3 * m, 3 * m, 3 * m * eyeR * 0.5);
			ctx.fill();
		});

		// logo
		if(box) {
			const lx = off + box.start * m,
				size = box.k * m,
				pad = m * 0.5;
			ctx.fillStyle = o.transparent ? '#ffffff' : o.bg;
			ctx.beginPath();
			roundRect(ctx, lx + pad * 0.3, lx + pad * 0.3, size - pad * 0.6, size - pad * 0.6, m);
			ctx.fill();
			const img = logo.img;
			const inner = size - pad * 2;
			const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
			const w = ratio >= 1 ? inner : inner * ratio,
				h = ratio >= 1 ? inner / ratio : inner;
			ctx.drawImage(img, lx + (size - w) / 2, lx + (size - h) / 2, w, h);
		}
	}

	/* ---------- SVG ---------- */

	function rr(x, y, w, h, r) {
		const f = (v) => +v.toFixed(3);
		r = Math.min(r, w / 2, h / 2);
		if(!r) return 'M' + f(x) + ' ' + f(y) + 'h' + f(w) + 'v' + f(h) + 'h' + f(-w) + 'z';
		return 'M' + f(x + r) + ' ' + f(y) +
			'h' + f(w - 2 * r) + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(r) + ' ' + f(r) +
			'v' + f(h - 2 * r) + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(-r) + ' ' + f(r) +
			'h' + f(2 * r - w) + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(-r) + ' ' + f(-r) +
			'v' + f(2 * r - h) + 'a' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(r) + ' ' + f(-r) + 'z';
	}

	function buildSvg(o) {
		const qr = current.qr,
			n = current.n;
		const total = n + o.margin * 2; // 1 unit = 1 module
		const off = o.margin;
		const box = logoBox(n);
		let d = '';
		for(let r = 0; r < n; r++) {
			for(let c = 0; c < n; c++) {
				if(!qr.isDark(r, c) || isFinder(r, c, n) || inLogo(r, c, box)) continue;
				const x = off + c,
					y = off + r;
				if(o.style === 'dots') {
					d += 'M' + (x + 0.04) + ' ' + (y + 0.5) + 'a0.46 0.46 0 1 0 0.92 0a0.46 0.46 0 1 0 -0.92 0z';
				} else if(o.style === 'rounded') {
					d += rr(x + 0.04, y + 0.04, 0.92, 0.92, 0.32);
				} else {
					d += 'M' + x + ' ' + y + 'h1v1h-1z';
				}
			}
		}
		const eyeR = o.style === 'square' ? 0 : o.style === 'rounded' ? 0.28 : 0.5;
		let eyes = '';
		[[0, 0], [0, n - 7], [n - 7, 0]].forEach(([r, c]) => {
			const x = off + c,
				y = off + r;
			eyes += rr(x, y, 7, 7, 7 * eyeR * 0.5) + rr(x + 1, y + 1, 5, 5, 5 * eyeR * 0.4);
			d += rr(x + 2, y + 2, 3, 3, 3 * eyeR * 0.5);
		});
		let out = '<?xml version="1.0" encoding="UTF-8"?>\n' +
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '" width="' + optSize.value + '" height="' + optSize.value + '" shape-rendering="' + (o.style === 'square' ? 'crispEdges' : 'geometricPrecision') + '">\n';
		if(!o.transparent) out += '<rect width="100%" height="100%" fill="' + o.bg + '"/>\n';
		out += '<path fill="' + o.fg + '" d="' + d + '"/>\n';
		out += '<path fill="' + o.fg + '" fill-rule="evenodd" d="' + eyes + '"/>\n';
		if(box) {
			const lx = off + box.start,
				size = box.k,
				pad = 0.5;
			out += '<path fill="' + (o.transparent ? '#ffffff' : o.bg) + '" d="' + rr(lx + pad * 0.3, lx + pad * 0.3, size - pad * 0.6, size - pad * 0.6, 1) + '"/>\n';
			out += '<image href="' + logo.dataUrl + '" x="' + (lx + pad) + '" y="' + (lx + pad) + '" width="' + (size - pad * 2) + '" height="' + (size - pad * 2) + '" preserveAspectRatio="xMidYMid meet"/>\n';
		}
		return out + '</svg>\n';
	}

	/* ---------- Contrast check ---------- */

	function lum(hex) {
		const v = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255)
			.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
		return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
	}

	function checkColours(note) {
		const msgs = [];
		if(note) msgs.push(note);
		const o = opts();
		if(o.transparent) {
			if(lum(o.fg) > 0.4) msgs.push('A light code on a transparent background only scans when it is placed on a dark surface, and some phones cannot read light-on-dark codes.');
		} else {
			const a = lum(o.fg),
				b = lum(o.bg);
			const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
			if(ratio < 2.5) msgs.push('The code and background colours are too close, so phones may not scan it. Use a darker code colour or a lighter background.');
			else if(a > b) msgs.push('The code is lighter than the background. Some phone cameras cannot read inverted codes, so test it before you print.');
		}
		if(current && current.n > 77) msgs.push('This code is very dense. Shorten the content or print it larger so it scans reliably.');
		warnEl.textContent = msgs.join(' ');
		warnEl.classList.toggle('show', msgs.length > 0);
	}

	/* ---------- Main render ---------- */

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function setEmpty(msg) {
		current = null;
		preview.classList.add('empty');
		infoEl.textContent = '';
		statusEl.textContent = msg;
		copyBtn.disabled = svgBtn.disabled = pngBtn.disabled = true;
		checkColours('');
	}

	function render() {
		clearError();
		sizeVal.textContent = optSize.value + ' px';
		marginVal.textContent = optMargin.value + ' module' + (optMargin.value === '1' ? '' : 's');

		const p = buildPayload();
		if(p.empty) {
			setEmpty(p.empty);
			return;
		}
		let qr;
		try {
			qr = encode(p.text, optEcc.value);
		} catch (e) {
			setEmpty('Too much content for one QR code');
			showError('This is too much content for a QR code. Shorten it' + (optEcc.value !== 'L' ? ', or lower the error correction level' : '') + '.');
			return;
		}
		const n = qr.getModuleCount();
		current = { qr, n, text: p.text };
		drawCanvas(canvas, PREVIEW_PX, opts());
		preview.classList.remove('empty');

		const bytes = new TextEncoder().encode(p.text).length;
		infoEl.textContent = 'Version ' + ((n - 17) / 4) + ' · ' + n + '×' + n + ' · ' + bytes + ' bytes';
		statusEl.textContent = 'QR code ready · ' + p.label;
		copyBtn.disabled = svgBtn.disabled = pngBtn.disabled = false;
		checkColours(p.note || '');
	}

	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(render, 120);
	}

	/* ---------- Output ---------- */

	function fileBase() {
		return 'qr-code-' + mode;
	}

	function pngBlob() {
		const cv = document.createElement('canvas');
		drawCanvas(cv, +optSize.value, opts());
		return new Promise((res) => cv.toBlob(res, 'image/png'));
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

	pngBtn.addEventListener('click', async() => {
		if(!current) return;
		save(await pngBlob(), fileBase() + '.png');
	});

	svgBtn.addEventListener('click', () => {
		if(!current) return;
		save(new Blob([buildSvg(opts())], { type: 'image/svg+xml' }), fileBase() + '.svg');
	});

	copyBtn.addEventListener('click', async() => {
		if(!current) return;
		try {
			if(!window.ClipboardItem || !navigator.clipboard || !navigator.clipboard.write) throw new Error('unsupported');
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
			flashStatus('QR code image copied');
		} catch (e) {
			showError('Your browser does not allow copying images here. Use Download PNG instead.');
		}
	});

	clearBtn.addEventListener('click', () => {
		document.querySelectorAll('.qr-fields[data-type="' + mode + '"] input:not([type=checkbox]), .qr-fields[data-type="' + mode + '"] textarea').forEach((el) => (el.value = ''));
		render();
		const first = document.querySelector('.qr-fields[data-type="' + mode + '"] input, .qr-fields[data-type="' + mode + '"] textarea');
		if(first) first.focus();
	});

	/* ---------- Logo ---------- */

	logoBtn.addEventListener('click', () => logoInput.click());

	logoInput.addEventListener('change', () => {
		const file = logoInput.files[0];
		logoInput.value = '';
		if(!file) return;
		if(!/^image\//.test(file.type)) {
			showError('That file is not an image. Use a PNG, JPG, SVG or WebP logo.');
			return;
		}
		const reader = new FileReader();
		reader.onload = () => {
			const img = new Image();
			img.onload = () => {
				logo = { img, dataUrl: reader.result };
				logoName.textContent = file.name;
				logoRemove.classList.remove('is-hidden');
				logoBtn.lastChild.textContent = ' Change logo';
				if(optEcc.value !== 'H') {
					eccBeforeLogo = optEcc.value;
					optEcc.value = 'H';
				}
				render();
			};
			img.onerror = () => showError('This image could not be opened. Try a PNG or JPG.');
			img.src = reader.result;
		};
		reader.readAsDataURL(file);
	});

	logoRemove.addEventListener('click', () => {
		logo = null;
		logoName.textContent = 'PNG, JPG, SVG or WebP';
		logoRemove.classList.add('is-hidden');
		logoBtn.lastChild.textContent = ' Add logo';
		if(eccBeforeLogo) optEcc.value = eccBeforeLogo;
		eccBeforeLogo = null;
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
		document.querySelectorAll('.qr-fields').forEach((g) => g.classList.toggle('is-hidden', g.dataset.type !== mode));
		render();
		const first = document.querySelector('.qr-fields[data-type="' + mode + '"] input, .qr-fields[data-type="' + mode + '"] textarea');
		if(first && !first.value) first.focus();
	});

	$('qrFields').addEventListener('input', schedule);
	$('qrFields').addEventListener('change', schedule);
	[optTransparent, optStyle, optEcc].forEach((el) => el.addEventListener('change', render));
	[optSize, optMargin].forEach((el) => el.addEventListener('input', render));

	render();
})();
