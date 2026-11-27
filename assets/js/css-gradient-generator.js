(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);

	/* ---------- Presets ---------- */

	const PRESETS = [
		{ name: 'Matte', type: 'linear', angle: 135, stops: [['#ff6224', 0], ['#ffb347', 100]] },
		{ name: 'Ocean', type: 'linear', angle: 90, stops: [['#2e3192', 0], ['#1bffff', 100]] },
		{ name: 'Sunset', type: 'linear', angle: 45, stops: [['#ff512f', 0], ['#f09819', 50], ['#ffd452', 100]] },
		{ name: 'Purple', type: 'linear', angle: 120, stops: [['#7f00ff', 0], ['#e100ff', 100]] },
		{ name: 'Mint', type: 'linear', angle: 160, stops: [['#00b09b', 0], ['#96c93d', 100]] },
		{ name: 'Night', type: 'linear', angle: 180, stops: [['#0f2027', 0], ['#203a43', 50], ['#2c5364', 100]] },
		{ name: 'Peach', type: 'linear', angle: 90, stops: [['#ffecd2', 0], ['#fcb69f', 100]] },
		{ name: 'Candy', type: 'linear', angle: 45, stops: [['#ff9a9e', 0], ['#fad0c4', 50], ['#fbc2eb', 100]] },
		{ name: 'Glow', type: 'radial', shape: 'circle', pos: 'center', stops: [['#fdfc47', 0], ['#24fe41', 100]] },
		{ name: 'Spotlight', type: 'radial', shape: 'ellipse', pos: 'center top', stops: [['#ffffff', 0], ['#3b4051', 100]] },
		{ name: 'Rainbow', type: 'conic', angle: 0, pos: 'center', stops: [['#ff0000', 0], ['#ffff00', 17], ['#00ff00', 33], ['#00ffff', 50], ['#0000ff', 67], ['#ff00ff', 83], ['#ff0000', 100]] },
		{ name: 'Stripes', type: 'linear', angle: 45, repeat: true, stops: [['#3b4051', 0], ['#3b4051', 10], ['#ff6224', 10], ['#ff6224', 20]] }
	];

	/* ---------- State ---------- */

	let state = {
		type: 'linear',
		angle: 90,
		shape: 'circle',
		pos: 'center',
		repeat: false,
		stops: []
	};
	let selected = null,
		nextId = 1;

	/* ---------- Elements ---------- */

	const modeBox = $('cgMode'),
		angleIn = $('cgAngle'),
		angleNum = $('cgAngleNum'),
		dial = $('cgDial'),
		dialHand = $('cgDialHand'),
		shapeIn = $('cgShape'),
		posBox = $('cgPos'),
		repeatIn = $('cgRepeat'),
		preview = $('cgPreview'),
		track = $('cgTrack'),
		trackFill = $('cgTrackFill'),
		handles = $('cgHandles'),
		colorIn = $('cgColor'),
		hexIn = $('cgHex'),
		alphaIn = $('cgAlpha'),
		alphaVal = $('cgAlphaVal'),
		stopPosIn = $('cgStopPos'),
		codeEl = $('cgCode'),
		fallbackIn = $('cgFallback'),
		selectorIn = $('cgSelector'),
		statusEl = $('cgStatus'),
		infoEl = $('cgInfo'),
		bytesEl = $('cgBytes'),
		errBox = $('cgErr');

	/* ---------- Colour helpers ---------- */

	function hexToRgb(hex) {
		const h = hex.replace('#', '');
		return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
	}

	function rgbToHex(r, g, b) {
		return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
	}

	function colorCss(s) {
		if(s.a >= 1) return s.color;
		const [r, g, b] = hexToRgb(s.color);
		return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + +s.a.toFixed(2) + ')';
	}

	function hsl(h, s, l) {
		s /= 100;
		l /= 100;
		const k = (n) => (n + h / 30) % 12;
		const a = s * Math.min(l, 1 - l);
		const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
		return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
	}

	function parseColor(v) {
		v = v.trim();
		if(!v.startsWith('#')) v = '#' + v;
		if(/^#[0-9a-f]{3}$/i.test(v)) return { color: '#' + v.slice(1).split('').map((c) => c + c).join('').toLowerCase(), a: null };
		if(/^#[0-9a-f]{6}$/i.test(v)) return { color: v.toLowerCase(), a: null };
		if(/^#[0-9a-f]{8}$/i.test(v)) return { color: v.slice(0, 7).toLowerCase(), a: parseInt(v.slice(7), 16) / 255 };
		return null;
	}

	function sorted() {
		return state.stops.slice().sort((a, b) => a.pos - b.pos);
	}

	// colour at a position (0–100) between the stops, used when adding a stop
	function colorAt(stops, p) {
		if(p <= stops[0].pos) return { color: stops[0].color, a: stops[0].a };
		const last = stops[stops.length - 1];
		if(p >= last.pos) return { color: last.color, a: last.a };
		for(let i = 0; i < stops.length - 1; i++) {
			const s1 = stops[i],
				s2 = stops[i + 1];
			if(p >= s1.pos && p <= s2.pos) {
				const t = s2.pos === s1.pos ? 0 : (p - s1.pos) / (s2.pos - s1.pos);
				const c1 = hexToRgb(s1.color),
					c2 = hexToRgb(s2.color);
				return { color: rgbToHex(...c1.map((v, j) => v + (c2[j] - v) * t)), a: s1.a + (s2.a - s1.a) * t };
			}
		}
		return { color: last.color, a: last.a };
	}

	/* ---------- CSS ---------- */

	function gradientCss() {
		const list = sorted().map((s) => colorCss(s) + ' ' + +s.pos.toFixed(1) + '%').join(', ');
		const rep = state.repeat ? 'repeating-' : '';
		const at = state.pos === 'center' ? '' : ' at ' + state.pos;
		if(state.type === 'linear') return rep + 'linear-gradient(' + state.angle + 'deg, ' + list + ')';
		if(state.type === 'radial') return rep + 'radial-gradient(' + state.shape + at + ', ' + list + ')';
		const from = state.angle ? 'from ' + state.angle + 'deg' : '';
		const head = (from + at).trim();
		return rep + 'conic-gradient(' + (head ? head + ', ' : '') + list + ')';
	}

	function fallbackColor() {
		// average of the stop colours, a good solid stand-in
		const s = state.stops;
		const sum = s.reduce((acc, x) => {
			const c = hexToRgb(x.color);
			return [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]];
		}, [0, 0, 0]);
		return rgbToHex(sum[0] / s.length, sum[1] / s.length, sum[2] / s.length);
	}

	function codeText() {
		const lines = [];
		if(fallbackIn.checked) lines.push('background: ' + fallbackColor() + ';');
		lines.push('background: ' + gradientCss() + ';');
		if(selectorIn.checked) return '.gradient {\n' + lines.map((l) => '  ' + l).join('\n') + '\n}';
		return lines.join('\n');
	}

	/* ---------- Render ---------- */

	function render() {
		const g = gradientCss();
		preview.style.background = g;
		trackFill.style.background = 'linear-gradient(90deg, ' + sorted().map((s) => colorCss(s) + ' ' + s.pos + '%').join(', ') + ')';

		const code = codeText();
		codeEl.value = code;
		bytesEl.textContent = code.length + ' characters';
		infoEl.textContent = state.stops.length + ' colours · ' + (state.repeat ? 'repeating ' : '') + state.type +
			(state.type !== 'radial' ? ' · ' + state.angle + '°' : ' · ' + state.shape);

		angleIn.value = angleNum.value = state.angle;
		dialHand.style.transform = 'rotate(' + (state.angle + 180) + 'deg)';
		shapeIn.value = state.shape;
		repeatIn.checked = state.repeat;
		posBox.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.pos === state.pos));
		modeBox.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.type));
		document.querySelectorAll('#cgSettings [data-for]').forEach((el) => el.classList.toggle('is-hidden', !el.dataset.for.split(' ').includes(state.type)));

		renderHandles();
		renderEditor();
	}

	function renderHandles() {
		handles.innerHTML = '';
		state.stops.forEach((s) => {
			const h = document.createElement('button');
			h.type = 'button';
			h.className = 'cg-handle' + (s.id === selected ? ' active' : '');
			h.style.left = s.pos + '%';
			h.style.background = colorCss(s);
			h.dataset.id = s.id;
			h.title = colorCss(s) + ' at ' + s.pos + '%';
			h.setAttribute('aria-label', 'Colour ' + colorCss(s) + ' at ' + s.pos + '%');
			handles.appendChild(h);
		});
	}

	function current() {
		return state.stops.find((s) => s.id === selected) || state.stops[0];
	}

	function renderEditor() {
		const s = current();
		if(!s) return;
		selected = s.id;
		colorIn.value = s.color;
		if(document.activeElement !== hexIn) hexIn.value = s.color.toUpperCase();
		alphaIn.value = Math.round(s.a * 100);
		alphaVal.textContent = Math.round(s.a * 100) + '%';
		if(document.activeElement !== stopPosIn) stopPosIn.value = +s.pos.toFixed(1);
		$('cgDelete').disabled = state.stops.length <= 2;
	}

	function load(p) {
		state.type = p.type;
		state.angle = p.angle != null ? p.angle : state.angle;
		state.shape = p.shape || state.shape;
		state.pos = p.pos || 'center';
		state.repeat = !!p.repeat;
		state.stops = p.stops.map(([color, pos, a]) => ({ id: nextId++, color, pos, a: a == null ? 1 : a }));
		selected = state.stops[0].id;
		render();
	}

	/* ---------- Stops: add, drag, edit ---------- */

	function posFromEvent(e) {
		const r = track.getBoundingClientRect();
		return Math.round(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)));
	}

	track.addEventListener('click', (e) => {
		const p = posFromEvent(e);
		const c = colorAt(sorted(), p);
		const s = { id: nextId++, color: c.color, a: Math.round(c.a * 100) / 100, pos: p };
		state.stops.push(s);
		selected = s.id;
		render();
		statusEl.textContent = 'Colour added at ' + p + '% · pick a new colour for it below';
	});

	let drag = null;
	handles.addEventListener('pointerdown', (e) => {
		const h = e.target.closest('.cg-handle');
		if(!h) return;
		e.preventDefault();
		selected = +h.dataset.id;
		drag = { id: selected, startY: e.clientY };
		h.setPointerCapture(e.pointerId);
		// update the classes only: rebuilding the handles here would drop the pointer capture
		handles.querySelectorAll('.cg-handle').forEach((x) => x.classList.toggle('active', x === h));
		renderEditor();
		h.focus();
	});
	handles.addEventListener('pointermove', (e) => {
		if(!drag) return;
		const s = state.stops.find((x) => x.id === drag.id);
		if(!s) return;
		s.pos = posFromEvent(e);
		const g = gradientCss();
		preview.style.background = g;
		trackFill.style.background = 'linear-gradient(90deg, ' + sorted().map((x) => colorCss(x) + ' ' + x.pos + '%').join(', ') + ')';
		const h = handles.querySelector('[data-id="' + s.id + '"]');
		if(h) h.style.left = s.pos + '%';
		stopPosIn.value = s.pos;
	});
	const endDrag = () => {
		if(!drag) return;
		drag = null;
		render();
	};
	handles.addEventListener('pointerup', endDrag);
	handles.addEventListener('pointercancel', endDrag);

	// keyboard: arrows move the selected stop, Delete removes it
	handles.addEventListener('keydown', (e) => {
		const s = current();
		if(!s) return;
		if(e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			s.pos = Math.max(0, Math.min(100, s.pos + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)));
			render();
			handles.querySelector('[data-id="' + s.id + '"]').focus();
		} else if(e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			removeSelected();
		}
	});

	function removeSelected() {
		if(state.stops.length <= 2) {
			statusEl.textContent = 'A gradient needs at least two colours';
			return;
		}
		state.stops = state.stops.filter((s) => s.id !== selected);
		selected = sorted()[0].id;
		render();
	}

	colorIn.addEventListener('input', () => {
		current().color = colorIn.value;
		hexIn.value = colorIn.value.toUpperCase();
		render();
	});

	hexIn.addEventListener('input', () => {
		const c = parseColor(hexIn.value);
		if(!c) return;
		const s = current();
		s.color = c.color;
		if(c.a != null) s.a = Math.round(c.a * 100) / 100;
		render();
	});
	hexIn.addEventListener('blur', () => (hexIn.value = current().color.toUpperCase()));

	alphaIn.addEventListener('input', () => {
		current().a = +alphaIn.value / 100;
		render();
	});

	stopPosIn.addEventListener('input', () => {
		const v = parseFloat(stopPosIn.value);
		if(isNaN(v)) return;
		current().pos = Math.max(0, Math.min(100, v));
		render();
	});
	stopPosIn.addEventListener('blur', () => renderEditor());

	$('cgDelete').addEventListener('click', removeSelected);

	$('cgReverse').addEventListener('click', () => {
		state.stops.forEach((s) => (s.pos = 100 - s.pos));
		render();
	});

	$('cgEven').addEventListener('click', () => {
		const list = sorted();
		const n = list.length - 1;
		const lo = state.repeat ? list[0].pos : 0,
			hi = state.repeat ? list[n].pos : 100;
		list.forEach((s, i) => (s.pos = Math.round((lo + ((hi - lo) * i) / n) * 10) / 10));
		render();
	});

	/* ---------- Settings ---------- */

	modeBox.addEventListener('click', (e) => {
		const b = e.target.closest('.mode-btn');
		if(!b) return;
		state.type = b.dataset.mode;
		if(state.type === 'conic' && state.angle === 90) state.angle = 0;
		render();
	});

	function setAngle(v) {
		v = Math.round(((+v % 360) + 360) % 360);
		if(isNaN(v)) return;
		state.angle = v;
		render();
	}
	angleIn.addEventListener('input', () => setAngle(angleIn.value));
	angleNum.addEventListener('input', () => angleNum.value !== '' && setAngle(angleNum.value));

	let dialDrag = false;
	function dialAngle(e) {
		const r = dial.getBoundingClientRect();
		const dx = e.clientX - (r.left + r.width / 2),
			dy = e.clientY - (r.top + r.height / 2);
		let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
		a = (a + 360) % 360;
		if(e.shiftKey) a = Math.round(a / 15) * 15; // hold Shift to snap to 15°
		setAngle(a);
	}
	dial.addEventListener('pointerdown', (e) => {
		dialDrag = true;
		dial.setPointerCapture(e.pointerId);
		dialAngle(e);
	});
	dial.addEventListener('pointermove', (e) => dialDrag && dialAngle(e));
	dial.addEventListener('pointerup', () => (dialDrag = false));

	shapeIn.addEventListener('change', () => {
		state.shape = shapeIn.value;
		render();
	});

	posBox.addEventListener('click', (e) => {
		const b = e.target.closest('button');
		if(!b) return;
		state.pos = b.dataset.pos;
		render();
	});

	repeatIn.addEventListener('change', () => {
		state.repeat = repeatIn.checked;
		// a repeating gradient only shows a pattern when its colours end before 100%
		if(state.repeat && Math.max(...state.stops.map((s) => s.pos)) > 50) {
			state.stops.forEach((s) => (s.pos = Math.round(s.pos * 0.25 * 10) / 10));
			statusEl.textContent = 'Colours squeezed into the first 25% so the pattern repeats. Drag them to change the stripe size.';
		}
		render();
	});

	[fallbackIn, selectorIn].forEach((el) => el.addEventListener('change', render));

	/* ---------- Presets & random ---------- */

	const presetsEl = $('cgPresets');
	PRESETS.forEach((p, i) => {
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'cg-preset';
		b.dataset.i = i;
		const tmp = { type: p.type, angle: p.angle || 0, shape: p.shape || 'circle', pos: p.pos || 'center', repeat: !!p.repeat };
		const list = p.stops.map(([c, pos]) => c + ' ' + pos + '%').join(', ');
		const at = tmp.pos === 'center' ? '' : ' at ' + tmp.pos;
		b.style.background = (tmp.repeat ? 'repeating-' : '') + (tmp.type === 'linear' ? 'linear-gradient(' + tmp.angle + 'deg, ' + list + ')' :
			tmp.type === 'radial' ? 'radial-gradient(' + tmp.shape + at + ', ' + list + ')' : 'conic-gradient(from ' + tmp.angle + 'deg' + at + ', ' + list + ')');
		b.innerHTML = '<span></span>';
		b.firstChild.textContent = p.name;
		b.title = 'Use the ' + p.name + ' gradient';
		presetsEl.appendChild(b);
	});
	presetsEl.addEventListener('click', (e) => {
		const b = e.target.closest('.cg-preset');
		if(!b) return;
		load(PRESETS[+b.dataset.i]);
		statusEl.textContent = PRESETS[+b.dataset.i].name + ' preset loaded';
	});

	function rnd(lo, hi) {
		return lo + Math.random() * (hi - lo);
	}

	$('cgRandomBtn').addEventListener('click', () => {
		const h = rnd(0, 360);
		const n = Math.random() < 0.35 ? 3 : 2;
		const stops = [];
		for(let i = 0; i < n; i++) {
			stops.push([hsl((h + i * rnd(25, 70)) % 360, rnd(65, 95), rnd(45, 68)), Math.round((100 * i) / (n - 1))]);
		}
		const r = Math.random();
		load({
			type: r < 0.7 ? 'linear' : r < 0.9 ? 'radial' : 'conic',
			angle: Math.round(rnd(0, 360) / 5) * 5,
			shape: Math.random() < 0.5 ? 'circle' : 'ellipse',
			pos: 'center',
			stops: r >= 0.9 ? stops.concat([[stops[0][0], 100]]).map((s, i, arr) => [s[0], Math.round((100 * i) / (arr.length - 1))]) : stops
		});
		statusEl.textContent = 'Random gradient · press Random again for another';
	});

	/* ---------- Copy ---------- */

	$('cgCopyBtn').addEventListener('click', () => {
		const text = codeEl.value;
		const done = () => {
			statusEl.textContent = 'CSS copied to clipboard';
		};
		if(navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text) && done());
		} else if(fallbackCopy(text)) done();
	});

	function fallbackCopy(text) {
		codeEl.focus();
		codeEl.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch (e) {}
		if(!ok) {
			errBox.textContent = 'Your browser blocked copying. Select the code and press Ctrl+C (Cmd+C on Mac).';
			errBox.classList.add('show');
		}
		return ok;
	}

	/* ---------- PNG ---------- */

	// canvas has no repeating gradients, so repeat the stops by hand across 0–1
	function canvasStops(list) {
		const stops = list.map((s) => ({ t: s.pos / 100, color: s.color, a: s.a }));
		if(!state.repeat) return stops;
		const first = stops[0].t,
			period = stops[stops.length - 1].t - first;
		if(period <= 0) return stops;
		const out = [];
		for(let k = Math.floor(-first / period) - 1; first + k * period <= 1; k++) {
			stops.forEach((s) => out.push({ t: s.t + k * period, color: s.color, a: s.a }));
		}
		// clip to 0–1, adding the exact colour at each edge
		const at = (t) => {
			for(let i = 0; i < out.length - 1; i++) {
				if(t >= out[i].t && t <= out[i + 1].t) {
					const f = out[i + 1].t === out[i].t ? 0 : (t - out[i].t) / (out[i + 1].t - out[i].t);
					const c1 = hexToRgb(out[i].color),
						c2 = hexToRgb(out[i + 1].color);
					return { t, color: rgbToHex(...c1.map((v, j) => v + (c2[j] - v) * f)), a: out[i].a + (out[i + 1].a - out[i].a) * f };
				}
			}
			return { t, color: out[out.length - 1].color, a: out[out.length - 1].a };
		};
		return [at(0)].concat(out.filter((s) => s.t > 0 && s.t < 1), [at(1)]);
	}

	// CSS blends see-through colours in premultiplied space, canvas does not.
	// Add in-between stops where opacity changes so the PNG matches the CSS.
	function premultiplied(stops) {
		const out = [];
		for(let i = 0; i < stops.length; i++) {
			const s1 = stops[i],
				s2 = stops[i + 1];
			out.push(s1);
			if(!s2 || s1.a === s2.a || s2.t <= s1.t) continue;
			const c1 = hexToRgb(s1.color),
				c2 = hexToRgb(s2.color);
			for(let k = 1; k < 16; k++) {
				const f = k / 16;
				const a = s1.a + (s2.a - s1.a) * f;
				const c = a ? c1.map((v, j) => (v * s1.a * (1 - f) + c2[j] * s2.a * f) / a) : c1;
				out.push({ t: s1.t + (s2.t - s1.t) * f, color: rgbToHex(...c), a });
			}
		}
		return out;
	}

	function posXY(w, h) {
		const parts = state.pos.split(' ');
		const x = parts.includes('left') ? 0 : parts.includes('right') ? 1 : 0.5;
		const y = parts.includes('top') ? 0 : parts.includes('bottom') ? 1 : 0.5;
		return [x * w, y * h];
	}

	function drawPng(w, h) {
		const cv = document.createElement('canvas');
		cv.width = w;
		cv.height = h;
		const ctx = cv.getContext('2d');
		const list = sorted();
		let grad;
		if(state.type === 'linear') {
			// same gradient line as CSS: through the centre, long enough to reach the corners
			const a = (state.angle * Math.PI) / 180;
			const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
			const dx = (Math.sin(a) * len) / 2,
				dy = (-Math.cos(a) * len) / 2;
			grad = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
		} else if(state.type === 'radial') {
			const [cx, cy] = posXY(w, h);
			const fx = Math.max(cx, w - cx),
				fy = Math.max(cy, h - cy);
			if(state.shape === 'circle') {
				grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(fx, fy));
			} else {
				// ellipse, farthest-corner: keeps the farthest-side shape and passes through the far corner
				const s = Math.SQRT2;
				const rx = fx * s,
					ry = fy * s;
				ctx.setTransform(1, 0, 0, ry / rx, 0, 0);
				grad = ctx.createRadialGradient(cx, cy * rx / ry, 0, cx, cy * rx / ry, rx);
			}
		} else {
			const [cx, cy] = posXY(w, h);
			grad = ctx.createConicGradient(((state.angle - 90) * Math.PI) / 180, cx, cy);
		}
		premultiplied(canvasStops(list)).forEach((s) => {
			const [r, g, b] = hexToRgb(s.color);
			grad.addColorStop(Math.max(0, Math.min(1, s.t)), 'rgba(' + r + ',' + g + ',' + b + ',' + s.a + ')');
		});
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, w, state.type === 'radial' && state.shape === 'ellipse' ? h * 10 : h);
		return cv;
	}

	$('cgPngBtn').addEventListener('click', () => {
		if(state.type === 'conic' && !CanvasRenderingContext2D.prototype.createConicGradient) {
			errBox.textContent = 'Your browser cannot draw conic gradients as images. Update your browser or use a linear or radial gradient.';
			errBox.classList.add('show');
			return;
		}
		drawPng(1920, 1080).toBlob((blob) => {
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = 'gradient-' + state.type + '.png';
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 1000);
			statusEl.textContent = 'Downloaded a 1920 × 1080 PNG';
		}, 'image/png');
	});

	load(PRESETS[0]);

	// small hook for testing and for other scripts
	window.MatteGradient = { load, css: gradientCss, png: drawPng };
})();
