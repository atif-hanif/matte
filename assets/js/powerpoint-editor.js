(function() {
	'use strict';
	const $ = (id) => document.getElementById(id);
	const PX = 9525; // EMU per pixel (96 dpi)
	const SVGNS = 'http://www.w3.org/2000/svg';
	
	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
	const uid = () => 'e' + Math.random().toString(36).slice(2, 9);
	const num = (v, d) => {
		const n = parseFloat(v);
		return isNaN(n) ? d : n;
	};

	function showError(m) {
		const e = $('peErr');
		e.textContent = m;
		e.classList.add('show');
	}

	function clearError() {
		$('peErr').classList.remove('show');
	}

	function setStatus(m, dirty) {
		const s = $('peStatus');
		s.textContent = m;
		s.classList.toggle('is-dirty', !!dirty);
	}

	function toHex(c) {
		const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c || '');
		if(!m) return /^#[0-9a-f]{6}$/i.test(c || '') ? c.toUpperCase() : '#000000';
		return '#' + [m[1], m[2], m[3]].map((v) => ('0' + (+v).toString(16)).slice(-2)).join('').toUpperCase();
	}
	const emu = (px) => Math.round(px * PX);

	function dataUrlToBytes(u) {
		const b = atob(u.slice(u.indexOf(',') + 1)),
			a = new Uint8Array(b.length);
		for(let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
		return a;
	}

	function loadImage(src) {
		return new Promise((res, rej) => {
			const i = new Image();
			i.onload = () => res(i);
			i.onerror = () => rej(new Error('The picture could not be read.'));
			i.src = src;
		});
	}

	function readFile(file, as) {
		return new Promise((res, rej) => {
			const r = new FileReader();
			r.onload = () => res(r.result);
			r.onerror = () => rej(new Error('The file could not be read.'));
			as === 'buffer' ? r.readAsArrayBuffer(file) : r.readAsDataURL(file);
		});
	}
	
	const fontIndex = {};
	(window.GOOGLE_FONTS || []).forEach((f) => {
		fontIndex[f[0].toLowerCase()] = f;
	});
	const fontLoaded = {};

	function loadFont(name) {
		const f = fontIndex[String(name || '').toLowerCase()];
		if(!f || fontLoaded[f[0]]) return;
		fontLoaded[f[0]] = 1;
		const w = [f[2]].concat(f[3] ? [f[3]] : []).sort((a, b) => a - b);
		const l = document.createElement('link');
		l.rel = 'stylesheet';
		l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f[0]).replace(/%20/g, '+') + ':wght@' + w.join(';') + '&display=swap';
		document.head.appendChild(l);
	}

	function loadFontsIn(html) {
		const re = /font-family:\s*&quot;?([^;"&,]+)|font-family:\s*"?([^;",]+)/gi;
		let m;
		while((m = re.exec(html))) loadFont((m[1] || m[2]).trim().replace(/^["']|["']$/g, ''));
	}
	
	let deck = newDeck();
	let cur = 0,
		selId = null,
		editing = false,
		zoomMode = 'fit',
		zoom = 1;
	let dirty = false,
		fileName = 'presentation';
	let undoStack = [],
		redoStack = [],
		clipboard = null;

	function newDeck() {
		return {
			w: 1280,
			h: 720,
			slides: [{
				bg: '#FFFFFF',
				els: []
			}],
			media: {}
		};
	}

	const slide = () => deck.slides[cur];
	const findEl = (id) => slide().els.find((e) => e.id === id);
	const selEl = () => (selId ? findEl(selId) : null);
	const snap = () => JSON.stringify({
		w: deck.w,
		h: deck.h,
		slides: deck.slides
	});

	function resetHistory() {
		undoStack = [snap()];
		redoStack = [];
	}

	function commit() {
		const s = snap();
		if(undoStack[undoStack.length - 1] === s) return;
		undoStack.push(s);
		if(undoStack.length > 80) undoStack.shift();
		redoStack = [];
		setDirty();
	}

	function setDirty() {
		dirty = true;
		setStatus('Unsaved changes', true);
	}

	function restore(s) {
		const o = JSON.parse(s);
		deck.w = o.w;
		deck.h = o.h;
		deck.slides = o.slides;
		cur = clamp(cur, 0, deck.slides.length - 1);
		if(!selEl()) {
			selId = null;
			editing = false;
		}
		renderAll();
	}

	function undo() {
		if(undoStack.length < 2) return;
		redoStack.push(undoStack.pop());
		restore(undoStack[undoStack.length - 1]);
		setDirty();
	}

	function redo() {
		if(!redoStack.length) return;
		const s = redoStack.pop();
		undoStack.push(s);
		restore(s);
		setDirty();
	}

	function geomPath(g, w, h) {
		const f = (n) => Math.round(n * 100) / 100;
		switch(g) {
			case 'roundRect':
				{
					const r = Math.min(w, h) / 6;
					return 'M' + f(r) + ' 0H' + f(w - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(w) + ' ' + f(r) + 'V' + f(h - r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(w - r) + ' ' + f(h) + 'H' + f(r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 0 ' + f(h - r) + 'V' + f(r) + 'A' + f(r) + ' ' + f(r) + ' 0 0 1 ' + f(r) + ' 0Z';
				}
			case 'ellipse':
				return 'M0 ' + f(h / 2) + 'A' + f(w / 2) + ' ' + f(h / 2) + ' 0 1 1 ' + f(w) + ' ' + f(h / 2) + 'A' + f(w / 2) + ' ' + f(h / 2) + ' 0 1 1 0 ' + f(h / 2) + 'Z';
			case 'triangle':
				return 'M' + f(w / 2) + ' 0L' + f(w) + ' ' + f(h) + 'L0 ' + f(h) + 'Z';
			case 'diamond':
				return 'M' + f(w / 2) + ' 0L' + f(w) + ' ' + f(h / 2) + 'L' + f(w / 2) + ' ' + f(h) + 'L0 ' + f(h / 2) + 'Z';
			case 'rightArrow':
				return 'M0 ' + f(h * 0.25) + 'H' + f(w * 0.6) + 'V0L' + f(w) + ' ' + f(h / 2) + 'L' + f(w * 0.6) + ' ' + f(h) + 'V' + f(h * 0.75) + 'H0Z';
			case 'line':
				return 'M0 0L' + f(w) + ' ' + f(h);
			default:
				return 'M0 0H' + f(w) + 'V' + f(h) + 'H0Z';
		}
	}

	function hasText(html) {
		const d = document.createElement('div');
		d.innerHTML = html || '';
		return d.textContent.replace(/​/g, '').trim() !== '';
	}

	function flipCss(el) {
		return(el.flipH || el.flipV) ? 'scale(' + (el.flipH ? -1 : 1) + ',' + (el.flipV ? -1 : 1) + ')' : '';
	}

	function drawGeom(node, el) {
		const need = el.geom !== 'rect' || el.fill || (el.line && el.lineW > 0);
		const old = node.querySelector('svg.pe-geom');
		if(old) old.remove();
		if(!need) return;
		const svg = document.createElementNS(SVGNS, 'svg');
		svg.setAttribute('class', 'pe-geom');
		svg.setAttribute('width', el.w);
		svg.setAttribute('height', el.h);
		svg.setAttribute('viewBox', '0 0 ' + el.w + ' ' + el.h);
		const p = document.createElementNS(SVGNS, 'path');
		p.setAttribute('d', geomPath(el.geom, el.w, el.h));
		p.setAttribute('fill', el.geom === 'line' ? 'none' : (el.fill || 'none'));
		if(el.line && el.lineW > 0) {
			p.setAttribute('stroke', el.line);
			p.setAttribute('stroke-width', el.lineW * 4 / 3);
			p.setAttribute('stroke-linejoin', 'round');
		}
		svg.appendChild(p);
		const fl = flipCss(el);
		if(fl) {
			svg.style.transform = fl;
			svg.style.transformOrigin = '50% 50%';
		}
		node.insertBefore(svg, node.firstChild);
	}

	function buildEl(el, opts) {
		const n = document.createElement('div');
		n.className = 'pe-el' + (el.locked ? ' is-locked' : '');
		n.dataset.id = el.id;
		n.dataset.kind = el.kind;
		placeEl(n, el);
		if(el.kind === 'pic') {
			const im = document.createElement('img');
			im.className = 'pe-img';
			im.alt = '';
			im.draggable = false;
			im.src = deck.media[el.media] || '';
			const fl = flipCss(el);
			if(fl) im.style.transform = fl;
			n.appendChild(im);
		} else if(el.kind === 'tbl') {
			const t = document.createElement('div');
			t.className = 'pe-tblwrap';
			t.innerHTML = '<table>' + el.html + '</table>';
			n.appendChild(t);
		} else {
			n.style.fontSize = (el.fs || 18) + 'pt';
			n.dataset.anchor = el.anchor || 't';
			drawGeom(n, el);
			const t = document.createElement('div');
			t.className = 'pe-text';
			const pad = el.pad || [9.6, 4.8, 9.6, 4.8];
			t.style.padding = pad[1] + 'px ' + pad[2] + 'px ' + pad[3] + 'px ' + pad[0] + 'px';
			const b = document.createElement('div');
			b.className = 'pe-body';
			b.innerHTML = el.html || '<p><br></p>';
			t.appendChild(b);
			if(!opts.static && el.ph) {
				const ph = document.createElement('div');
				ph.className = 'pe-ph';
				ph.textContent = el.ph;
				const am = /text-align:\s*(left|center|right|justify)/.exec(el.html || '');
				if(am) ph.style.textAlign = am[1];
				ph.style.left = pad[0] + 'px';
				ph.style.right = pad[2] + 'px';
				ph.hidden = hasText(el.html);
				n.appendChild(ph);
			}
			n.appendChild(t);
		}
		return n;
	}

	function placeEl(n, el) {
		n.style.left = el.x + 'px';
		n.style.top = el.y + 'px';
		n.style.width = el.w + 'px';
		n.style.height = el.h + 'px';
		n.style.transform = el.rot ? 'rotate(' + el.rot + 'deg)' : '';
	}

	function fillSlideNode(node, sl, opts) {
		node.style.width = deck.w + 'px';
		node.style.height = deck.h + 'px';
		node.style.background = sl.bg || '#FFFFFF';
		sl.els.forEach((el) => node.appendChild(buildEl(el, opts)));
	}

	const slideNode = $('peSlide'),
		wrapNode = $('peSlideWrap'),
		stageNode = $('peStage');
	const selBox = document.createElement('div');
	selBox.className = 'pe-sel';
	['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((k) => {
		const h = document.createElement('div');
		h.className = 'pe-h';
		h.dataset.h = k;
		selBox.appendChild(h);
	});

	selBox.insertAdjacentHTML('beforeend', '<div class="pe-stem"></div><div class="pe-rot" title="Rotate"></div>');

	function fitZoom() {
		const aw = stageNode.clientWidth - 40,
			ah = stageNode.clientHeight - 40;
		zoom = clamp(Math.min(aw / deck.w, ah / deck.h), 0.1, 2);
	}

	function renderStage() {
		fitZoom();
		wrapNode.style.width = Math.round(deck.w * zoom) + 'px';
		wrapNode.style.height = Math.round(deck.h * zoom) + 'px';
		slideNode.innerHTML = '';
		slideNode.className = 'pe-slide';
		slideNode.style.transform = 'scale(' + zoom + ')';
		slideNode.style.setProperty('--z', zoom);
		fillSlideNode(slideNode, slide(), {
			static: false
		});
		slideNode.appendChild(selBox);
		updateSel();
	}

	const domOf = (id) => slideNode.querySelector('.pe-el[data-id="' + id + '"]');

	function renderAll() {
		renderStage();
		renderThumbs();
		updateToolbar();
		$('peCount').textContent = 'Slide ' + (cur + 1) + ' of ' + deck.slides.length;
	}

	function syncTableHeight(el) {
		const n = domOf(el.id);
		const t = n && n.querySelector('table');
		if(t) {
			el.h = Math.round(t.offsetHeight);
			n.style.height = el.h + 'px';
		}
	}

	function updateSel() {
		const el = selEl();
		if(!el || !domOf(el.id)) {
			selBox.classList.remove('is-visible');
			return;
		}
		if(el.kind === 'tbl') syncTableHeight(el);
		selBox.classList.add('is-visible');
		selBox.classList.toggle('is-editing', editing);
		selBox.style.left = el.x + 'px';
		selBox.style.top = el.y + 'px';
		selBox.style.width = el.w + 'px';
		selBox.style.height = el.h + 'px';
		selBox.style.transform = el.rot ? 'rotate(' + el.rot + 'deg)' : '';
		selBox.dataset.kind = el.kind;
	}

	function select(id) {
		if(id === selId) return;
		if(editing) endEdit();
		selId = id;
		if(document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
		updateSel();
		updateToolbar();
	}

	function updateNode(el) { 
		const n = domOf(el.id);
		if(!n) return;
		placeEl(n, el);
		if(el.kind === 'sp') drawGeom(n, el);
		if(el.kind === 'tbl') {
			const t = n.querySelector('table');
			if(t) t.style.width = el.w + 'px';
		}
	}

	function setTableWidth(el, nw) {
		const m = el.html.match(/<col[^>]*>/g) || [];
		const old = m.map((c) => num((/width:\s*([\d.]+)px/.exec(c) || [])[1], 0));
		const sum = old.reduce((a, b) => a + b, 0);
		let i = 0;
		el.html = el.html.replace(/(<col[^>]*?)width:\s*[\d.]+px/g, (all, pre) => pre + 'width:' + (sum ? Math.round(old[i++] * nw / sum * 100) / 100 : nw / m.length) + 'px');
		el.w = nw;
		const n = domOf(el.id);
		if(n) n.querySelectorAll('col').forEach((c, k) => {
			c.style.width = (sum ? old[k] * nw / sum : nw / m.length) + 'px';
		});
	}

	let op = null;
	slideNode.addEventListener('mousedown', (e) => {
		const n = e.target.closest('.pe-el');
		if(!(editing && n && n.dataset.id === selId)) e.preventDefault();
	});

	slideNode.addEventListener('dragstart', (e) => e.preventDefault());
	slideNode.addEventListener('pointerdown', (e) => {
		if(e.pointerType === 'mouse' && e.button !== 0) return;
		const el = selEl();
		const hd = e.target.closest('.pe-h'),
			rt = e.target.closest('.pe-rot');
		if((hd || rt) && el) {
			e.preventDefault();
			const r = domOf(el.id).getBoundingClientRect();
			op = {
				type: hd ? 'resize' : 'rotate',
				id: el.id,
				h: hd ? hd.dataset.h : '',
				x0: e.clientX,
				y0: e.clientY,
				o: {
					x: el.x,
					y: el.y,
					w: el.w,
					h: el.h,
					rot: el.rot || 0
				},
				cx: r.left + r.width / 2,
				cy: r.top + r.height / 2,
				moved: false
			};
			return;
		}
		const node = e.target.closest('.pe-el');
		if(editing && node && node.dataset.id === selId) return; // the caret goes where the pointer is
		if(!node) {
			if(editing) endEdit();
			selId = null;
			updateSel();
			updateToolbar();
			return;
		}
		e.preventDefault();
		const id = node.dataset.id,
			was = id === selId;
		select(id);
		const t = findEl(id);
		op = {
			type: 'move',
			id,
			x0: e.clientX,
			y0: e.clientY,
			ox: t.x,
			oy: t.y,
			moved: false,
			was,
			cx: e.clientX,
			cy: e.clientY
		};
	});

	document.addEventListener('pointermove', (e) => {
		if(!op) return;
		const el = findEl(op.id);
		if(!el) {
			op = null;
			return;
		}
		const dx = (e.clientX - op.x0) / zoom,
			dy = (e.clientY - op.y0) / zoom;
		if(!op.moved) {
			if(Math.hypot(dx, dy) * zoom < 3) return;
			op.moved = true;
			document.body.classList.add('pe-dragging');
		}
		if(op.type === 'move') {
			el.x = Math.round(op.ox + dx);
			el.y = Math.round(op.oy + dy);
			updateNode(el);
		} else if(op.type === 'resize') {
			const a = op.o.rot * Math.PI / 180,
				cos = Math.cos(a),
				sin = Math.sin(a);
			const lx = dx * cos + dy * sin,
				ly = -dx * sin + dy * cos; // pointer movement along the element's own axes
			const sx = op.h.indexOf('e') > -1 ? 1 : (op.h.indexOf('w') > -1 ? -1 : 0);
			const sy = op.h.indexOf('s') > -1 ? 1 : (op.h.indexOf('n') > -1 ? -1 : 0);
			const o = op.o,
				minH = el.geom === 'line' ? 0 : 12;
			let dW = sx * lx * (sx ? 1 : 0),
				dH = sy * ly * (sy ? 1 : 0);
			if(sx && sy && (el.kind === 'pic' || e.shiftKey) && o.h > 0) {
				const k = Math.max((o.w + dW) / o.w, (o.h + dH) / o.h);
				dW = (k - 1) * o.w;
				dH = (k - 1) * o.h;
			}
			dW = Math.max(dW, 12 - o.w);
			dH = Math.max(dH, minH - o.h);
			if(el.kind === 'tbl') dH = 0; // a table is as tall as its rows
			const ox = sx * dW / 2,
				oy = sy * dH / 2;
			const ncx = o.x + o.w / 2 + ox * cos - oy * sin,
				ncy = o.y + o.h / 2 + ox * sin + oy * cos;
			const nw = o.w + dW,
				nh = o.h + dH;
			if(el.kind === 'tbl') setTableWidth(el, nw);
			else el.w = nw;
			el.h = nh;
			el.x = Math.round(ncx - nw / 2);
			el.y = Math.round(ncy - nh / 2);
			el.w = Math.round(el.w);
			el.h = Math.round(el.h);
			updateNode(el);
		} else if(op.type === 'rotate') {
			let a = Math.atan2(e.clientY - op.cy, e.clientX - op.cx) * 180 / Math.PI + 90;
			if(e.shiftKey) a = Math.round(a / 15) * 15;
			a = ((a % 360) + 360) % 360;
			el.rot = Math.round(a * 10) / 10;
			if(el.rot === 360) el.rot = 0;
			updateNode(el);
		}
		updateSel();
	});

	function endPointer(e) {
		if(!op) return;
		const o = op;
		op = null;
		document.body.classList.remove('pe-dragging');
		if(o.moved) {
			commit();
			updateToolbar();
			return;
		}
		if(o.type === 'move' && o.was && e && e.type === 'pointerup') startEdit(o.cx, o.cy); // a click on the selected box starts typing
	}

	document.addEventListener('pointerup', endPointer);
	document.addEventListener('pointercancel', () => {
		if(op && op.moved) commit();
		op = null;
		document.body.classList.remove('pe-dragging');
	});

	slideNode.addEventListener('dblclick', (e) => {
		const n = e.target.closest('.pe-el');
		if(n && !editing) {
			select(n.dataset.id);
			startEdit(e.clientX, e.clientY);
		}
	});

	function caretAt(x, y) {
		if(x == null) return null;
		if(document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
		if(document.caretPositionFromPoint) {
			const p = document.caretPositionFromPoint(x, y);
			if(!p) return null;
			const r = document.createRange();
			r.setStart(p.offsetNode, p.offset);
			r.collapse(true);
			return r;
		}
		return null;
	}

	function editTargets(node) {
		return node.querySelector('table') ? Array.from(node.querySelectorAll('td')) : [node.querySelector('.pe-body')];
	}

	function startEdit(x, y) {
		const el = selEl();
		if(!el || el.locked || el.kind === 'pic') return;
		const node = domOf(el.id);
		if(!node) return;
		editing = true;
		node.classList.add('is-editing');
		slideNode.classList.add('is-editing');
		const ts = editTargets(node);
		ts.forEach((t) => {
			t.contentEditable = 'true';
		});
		let r = caretAt(x, y);
		if(!(r && node.contains(r.startContainer))) {
			r = document.createRange();
			r.selectNodeContents(ts[0]);
			r.collapse(false);
		}
		const first = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement);
		const host = first && first.closest('[contenteditable=true]');
		(host || ts[0]).focus();
		const s = window.getSelection();
		s.removeAllRanges();
		s.addRange(r);
		updateSel();
		updateToolbar();
	}

	function syncEl(el) {
		const n = domOf(el.id);
		if(!n) return;
		if(el.kind === 'sp') {
			const b = n.querySelector('.pe-body');
			el.html = b.innerHTML;
			const ph = n.querySelector('.pe-ph');
			if(ph) ph.hidden = hasText(el.html);
		} else if(el.kind === 'tbl') {
			const t = n.querySelector('table');
			el.html = t.innerHTML.replace(/\scontenteditable="[^"]*"/g, '');
			el.h = Math.round(t.offsetHeight);
		}
		loadFontsIn(el.html || '');
	}

	function endEdit() {
		if(!editing) return;
		const el = selEl();
		const node = el && domOf(el.id);
		editing = false;
		if(node) {
			syncEl(el);
			editTargets(node).forEach((t) => {
				t.contentEditable = 'false';
				t.removeAttribute('contenteditable');
			});
			node.classList.remove('is-editing');
		}
		slideNode.classList.remove('is-editing');
		if(document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
		window.getSelection().removeAllRanges();
		clearTimeout(commitTimer);
		commit();
		updateSel();
		updateToolbar();
		queueThumb();
	}

	let commitTimer = 0;
	slideNode.addEventListener('input', () => {
		if(!editing) return;
		const el = selEl();
		if(!el) return;
		syncEl(el);
		updateSel();
		clearTimeout(commitTimer);
		commitTimer = setTimeout(() => {
			commit();
			queueThumb();
		}, 700);
	});

	slideNode.addEventListener('paste', (e) => {
		if(!editing) return;
		e.preventDefault();
		const t = (e.clipboardData || window.clipboardData).getData('text/plain');
		document.execCommand('insertText', false, t);
	});

	function removeSel() {
		const el = selEl();
		if(!el) return;
		if(editing) endEdit();
		slide().els = slide().els.filter((e) => e.id !== el.id);
		selId = null;
		renderStage();
		commit();
		queueThumb();
		updateToolbar();
	}

	function cloneEl(el, off) {
		const c = JSON.parse(JSON.stringify(el));
		c.id = uid();
		c.x += off;
		c.y += off;
		c.locked = false;
		return c;
	}

	function duplicateSel() {
		const el = selEl();
		if(!el) return;
		if(editing) endEdit();
		const c = cloneEl(el, 24);
		slide().els.push(c);
		selId = c.id;
		renderStage();
		commit();
		queueThumb();
		updateToolbar();
	}

	function reorderSel(front) {
		const el = selEl();
		if(!el) return;
		if(editing) endEdit();
		const a = slide().els;
		a.splice(a.indexOf(el), 1);
		if(front) a.push(el);
		else a.splice(a.findIndex((x) => !x.locked) < 0 ? 0 : a.findIndex((x) => !x.locked), 0, el);
		renderStage();
		commit();
		queueThumb();
	}

	function nudge(dx, dy) {
		const el = selEl();
		if(!el || el.locked) return;
		el.x += dx;
		el.y += dy;
		updateNode(el);
		updateSel();
		clearTimeout(commitTimer);
		commitTimer = setTimeout(() => {
			commit();
			queueThumb();
		}, 400);
	}

	let savedRange = null,
		lastSize = 18;
	document.addEventListener('selectionchange', () => {
		const s = window.getSelection();
		if(editing && s.rangeCount && slideNode.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
		if(editing) requestAnimationFrame(updateToolbar);
	});

	function restoreSel() {
		const el = selEl(),
			node = el && domOf(el.id);
		if(!node || !savedRange || !node.contains(savedRange.startContainer)) return;
		const host = (savedRange.startContainer.nodeType === 1 ? savedRange.startContainer : savedRange.startContainer.parentElement).closest('[contenteditable=true]');
		if(host) host.focus();
		const s = window.getSelection();
		s.removeAllRanges();
		s.addRange(savedRange);
	}

	function fixSizes(node) { 
		node.querySelectorAll('font[size="7"]').forEach((f) => {
			const sp = document.createElement('span');
			sp.style.fontSize = lastSize + 'pt';
			while(f.firstChild) sp.appendChild(f.firstChild);
			f.replaceWith(sp);
		});
		node.querySelectorAll('span').forEach((sp) => {
			if(sp.style.fontSize === 'xxx-large') sp.style.fontSize = lastSize + 'pt';
		});
		node.querySelectorAll('span[style=""]').forEach((sp) => sp.removeAttribute('style'));
	}

	function runFormat(fn) {
		const el = selEl();
		if(!el || el.kind === 'pic') return;
		document.execCommand('styleWithCSS', false, true);
		const node = domOf(el.id);
		if(editing) {
			restoreSel();
			fn();
			fixSizes(node);
			syncEl(el);
			updateSel();
			clearTimeout(commitTimer);
			commitTimer = setTimeout(() => {
				commit();
				queueThumb();
			}, 500);
		} else { 
			const s = window.getSelection();
			editTargets(node).forEach((t) => {
				t.contentEditable = 'true';
				t.focus();
				const r = document.createRange();
				r.selectNodeContents(t);
				s.removeAllRanges();
				s.addRange(r);
				fn();
				fixSizes(t);
				t.contentEditable = 'false';
				t.removeAttribute('contenteditable');
			});
			if(document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
			s.removeAllRanges();
			syncEl(el);
			commit();
			queueThumb();
		}
		updateToolbar();
	}

	const exec = (c, v) => document.execCommand(c, false, v === undefined ? null : v);

	function probe() {
		const el = selEl();
		if(!el || el.kind === 'pic') return null;
		const node = domOf(el.id);
		if(!node) return null;
		let at = null;
		const s = window.getSelection();
		if(editing && s.rangeCount && node.contains(s.anchorNode)) at = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement;
		if(!at) at = node.querySelector('.pe-body span, td span, .pe-body, td');
		return at ? getComputedStyle(at) : null;
	}

	function updateToolbar() {
		$('peFormat').querySelector('[data-act=undo]').disabled = undoStack.length < 2;
		$('peFormat').querySelector('[data-act=redo]').disabled = !redoStack.length;
		const el = selEl();
		$('peTableBar').classList.toggle('is-hidden', !(el && el.kind === 'tbl'));
		const cs = probe();
		if(cs) {
			const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
			fontPick.setCurrent(fam);
			const pt = Math.round(parseFloat(cs.fontSize) * 0.75);
			const sz = $('peSize');
			if(!Array.from(sz.options).some((o) => +o.value === pt)) {
				const o = document.createElement('option');
				o.textContent = pt;
				const after = Array.from(sz.options).find((x) => +x.value > pt);
				sz.insertBefore(o, after || null);
			}
			sz.value = String(pt);
			$('peColor').value = toHex(cs.color);
		}
		const st = (c) => {
			try {
				return editing && document.queryCommandState(c);
			} catch(e) {
				return false;
			}
		};
		const on = (sel, v) => $('peFormat').querySelector(sel).classList.toggle('is-active', !!v);
		on('[data-cmd=bold]', editing ? st('bold') : (cs && parseInt(cs.fontWeight, 10) >= 600));
		on('[data-cmd=italic]', editing ? st('italic') : (cs && cs.fontStyle === 'italic'));
		on('[data-cmd=underline]', editing ? st('underline') : (cs && /underline/.test(cs.textDecorationLine)));
		if(el && el.kind === 'sp') {
			$('peAnchor').value = el.anchor || 't';
			if(el.fill) $('peFill').value = el.fill;
			if(el.line) $('peLine').value = el.line;
			$('peLineW').value = String(el.lineW || 0);
		}
		$('peBg').value = slide().bg || '#FFFFFF';
	}

	function refreshNode(el) {
		const old = domOf(el.id);
		if(!old) return;
		old.replaceWith(buildEl(el, {
			static: false
		}));
		updateSel();
		queueThumb();
	}

	let softTimer = 0;

	function commitSoon() {
		clearTimeout(softTimer);
		softTimer = setTimeout(commit, 500);
	}

	document.querySelectorAll('#peFormat [data-cmd], #peFormat [data-act], #peInsert [data-act], #peTableBar [data-tbl]').forEach((b) => {
		b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text selection
	});

	$('peFormat').addEventListener('click', (e) => {
		const b = e.target.closest('button');
		if(!b) return;
		if(b.dataset.cmd) runFormat(() => exec(b.dataset.cmd));
		else if(b.dataset.act === 'undo') undo();
		else if(b.dataset.act === 'redo') redo();
	});

	const fontPick = FontPicker.create({
		btn: $('peFontBtn'),
		cur: $('peFontCur'),
		pop: $('peFontPop'),
		search: $('peFontSearch'),
		cats: $('peFontCats'),
		list: $('peFontList'),
		count: $('peFontCount'),
		onPick: (n) => {
			loadFont(n);
			runFormat(() => exec('fontName', n));
		}
	});

	$('peSize').addEventListener('change', () => {
		lastSize = +$('peSize').value;
		runFormat(() => exec('fontSize', '7'));
	});

	$('peColor').addEventListener('input', () => runFormat(() => exec('foreColor', $('peColor').value)));

	$('peAnchor').addEventListener('change', () => {
		const el = selEl();
		if(!el || el.kind !== 'sp') return;
		el.anchor = $('peAnchor').value;
		const n = domOf(el.id);
		if(n) n.dataset.anchor = el.anchor;
		commit();
		queueThumb();
	});

	function shapeProp(fn) {
		const el = selEl();
		if(!el || el.kind !== 'sp') {
			showError('Select a shape or text box first.');
			return;
		}
		clearError();
		fn(el);
		if(!editing) refreshNode(el);
		else drawGeom(domOf(el.id), el);
		commitSoon();
		updateToolbar();
	}

	$('peFill').addEventListener('input', () => shapeProp((el) => {
		el.fill = $('peFill').value;
	}));

	$('peNoFill').addEventListener('click', () => shapeProp((el) => {
		el.fill = null;
	}));

	$('peLine').addEventListener('input', () => shapeProp((el) => {
		el.line = $('peLine').value;
		if(!el.lineW) el.lineW = +$('peLineW').value || 2;
	}));

	$('peLineW').addEventListener('change', () => shapeProp((el) => {
		el.lineW = +$('peLineW').value;
		if(el.lineW && !el.line) el.line = $('peLine').value;
	}));

	$('peBg').addEventListener('input', () => {
		slide().bg = $('peBg').value;
		slideNode.style.background = slide().bg;
		commitSoon();
		queueThumb();
	});

	function tableCtx() {
		const el = selEl();
		if(!el || el.kind !== 'tbl') return null;
		const node = domOf(el.id),
			t = node.querySelector('table');
		let cell = null;
		const s = window.getSelection();
		if(editing && s.rangeCount && node.contains(s.anchorNode)) cell = (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement).closest('td');
		if(!cell && savedRange && node.contains(savedRange.startContainer)) cell = (savedRange.startContainer.nodeType === 1 ? savedRange.startContainer : savedRange.startContainer.parentElement).closest('td');
		return {
			el, node, t, cell
		};
	}

	const TBL_CELL = '<td><p><br></p></td>';

	function equalCols(el, t) {
		const n = t.rows[0].cells.length;
		let cg = t.querySelector('colgroup');
		if(!cg) {
			cg = document.createElement('colgroup');
			t.insertBefore(cg, t.firstChild);
		}
		cg.innerHTML = '';
		for(let i = 0; i < n; i++) {
			const c = document.createElement('col');
			c.style.width = (el.w / n) + 'px';
			cg.appendChild(c);
		}
	}

	$('peTableBar').addEventListener('click', (e) => {
		const b = e.target.closest('button');
		if(!b) return;
		const c = tableCtx();
		if(!c) return;
		if(c.t.querySelector('td[colspan], td[rowspan]')) {
			showError('This table has merged cells, so rows and columns cannot be added or removed here.');
			return;
		}
		clearError();
		const rows = Array.from(c.t.rows);
		const ri = c.cell ? c.cell.parentElement.rowIndex : rows.length - 1;
		const ci = c.cell ? c.cell.cellIndex : rows[0].cells.length - 1;
		const kind = b.dataset.tbl;
		if(kind === 'rowAfter') {
			const tr = document.createElement('tr');
			tr.style.height = (rows[ri].offsetHeight || 48) + 'px';
			tr.innerHTML = TBL_CELL.repeat(rows[0].cells.length);
			Array.from(rows[ri].cells).forEach((src, i) => {
				if(src.style.backgroundColor) tr.cells[i].style.backgroundColor = src.style.backgroundColor;
			});
			rows[ri].after(tr);
		} else if(kind === 'rowDel') {
			if(rows.length < 2) return;
			rows[ri].remove();
		} else if(kind === 'colAfter') {
			rows.forEach((r) => {
				const td = document.createElement('td');
				td.innerHTML = '<p><br></p>';
				const src = r.cells[ci];
				if(src && src.style.backgroundColor) td.style.backgroundColor = src.style.backgroundColor;
				r.cells[ci].after(td);
			});
			equalCols(c.el, c.t);
		} else if(kind === 'colDel') {
			if(rows[0].cells.length < 2) return;
			rows.forEach((r) => r.cells[ci].remove());
			equalCols(c.el, c.t);
		}
		if(editing) c.node.querySelectorAll('td').forEach((td) => {
			td.contentEditable = 'true';
		});
		syncEl(c.el);
		updateSel();
		commit();
		queueThumb();
	});

	$('peCellFill').addEventListener('input', () => {
		const c = tableCtx();
		if(!c) return;
		const cells = c.cell ? [c.cell] : Array.from(c.t.querySelectorAll('td'));
		cells.forEach((td) => {
			td.style.backgroundColor = $('peCellFill').value;
		});
		syncEl(c.el);
		commitSoon();
		queueThumb();
	});

	function mkSp(x, y, w, h, o) {
		return Object.assign({
			id: uid(),
			kind: 'sp',
			x,
			y,
			w,
			h,
			rot: 0,
			geom: 'rect',
			fill: null,
			line: null,
			lineW: 0,
			html: '<p><br></p>',
			anchor: 't',
			fs: 18,
			ph: '',
			pad: [9.6, 4.8, 9.6, 4.8]
		}, o || {});
	}

	const phTitle = (x, y, w, h, fs, al) => mkSp(x, y, w, h, {
		html: '<p style="text-align:' + al + '"><br></p>',
		anchor: 'ctr',
		fs,
		ph: 'Click to add title'
	});

	const phBody = (x, y, w, h, fs) => mkSp(x, y, w, h, {
		html: '<ul><li><br></li></ul>',
		fs,
		ph: 'Click to add text'
	});

	function layoutEls(name) {
		switch(name) {
			case 'title':
				return [phTitle(96, 190, 1088, 170, 54, 'center'), mkSp(192, 380, 896, 110, {
					html: '<p style="text-align:center"><br></p>',
					fs: 26,
					ph: 'Click to add subtitle'
				})];
			case 'title-only':
				return [phTitle(92, 40, 1096, 110, 40, 'left')];
			case 'two':
				return [phTitle(92, 40, 1096, 110, 40, 'left'), phBody(92, 180, 536, 470, 26), phBody(652, 180, 536, 470, 26)];
			case 'blank':
				return [];
			default:
				return [phTitle(92, 40, 1096, 110, 40, 'left'), phBody(92, 180, 1096, 470, 28)];
		}
	}

	function addSlideAfter(layout) {
		if(editing) endEdit();
		deck.slides.splice(cur + 1, 0, {
			bg: '#FFFFFF',
			els: layoutEls(layout)
		});
		cur++;
		selId = null;
		renderAll();
		commit();
	}

	function addElement(el) {
		if(editing) endEdit();
		slide().els.push(el);
		selId = el.id;
		renderStage();
		updateToolbar();
		commit();
		queueThumb();
	}

	function addTextBox() {
		const el = mkSp(Math.round(deck.w / 2 - 240), Math.round(deck.h / 2 - 35), 480, 70, {
			ph: 'Type here'
		});
		addElement(el);
		startEdit(null, null);
	}

	function tableHtml(rows, cols, w, rh) {
		let h = '<colgroup>' + '<col style="width:' + (w / cols) + 'px">'.repeat(cols) + '</colgroup><tbody>';
		for(let r = 0; r < rows; r++) {
			h += '<tr style="height:' + rh + 'px">';
			for(let c = 0; c < cols; c++) h += '<td style="' + (r === 0 ? 'background-color:#3B4051;color:#FFFFFF;font-weight:700' : 'background-color:' + (r % 2 ? '#F7F5F0' : '#FFFFFF')) + '"><p><br></p></td>';
			h += '</tr>';
		}
		return h + '</tbody>';
	}

	function addTable() {
		const w = Math.min(760, deck.w - 160),
			rh = 52;
		addElement({
			id: uid(),
			kind: 'tbl',
			x: Math.round((deck.w - w) / 2),
			y: 200,
			w,
			h: rh * 3,
			rot: 0,
			html: tableHtml(3, 3, w, rh)
		});
		startEdit(null, null);
	}

	function addShape(g) {
		if(!g) return;
		const line = g === 'line';
		addElement(mkSp(Math.round(deck.w / 2 - 140), Math.round(deck.h / 2 - (line ? 0 : 90)), 280, line ? 0 : 180, {
			geom: g,
			fill: line ? null : '#FF6224',
			line: '#3B4051',
			lineW: line ? 4 : 2,
			anchor: 'ctr',
			html: '<p style="text-align:center"><br></p>'
		}));
	}

	async function addPicture(file) {
		try {
			const url = await readFile(file);
			const im = await loadImage(url);
			const k = Math.min(1, deck.w * 0.6 / im.naturalWidth, deck.h * 0.6 / im.naturalHeight);
			const w = Math.round(im.naturalWidth * k),
				h = Math.round(im.naturalHeight * k);
			const mid = 'm' + Math.random().toString(36).slice(2, 9);
			deck.media[mid] = url;
			addElement({
				id: uid(),
				kind: 'pic',
				x: Math.round((deck.w - w) / 2),
				y: Math.round((deck.h - h) / 2),
				w,
				h,
				rot: 0,
				media: mid
			});
		} catch(e) {
			showError(e.message);
		}
	}

	const thumbsNode = $('peThumbs');

	function thumbSize() {
		const col = getComputedStyle(thumbsNode).flexDirection === 'column';
		const tw = col ? Math.max(80, thumbsNode.clientWidth - 24) : 170;
		const s = (tw - 4) / deck.w;
		return {
			tw, th: Math.round(deck.h * s + 4), s
		};
	}

	function thumbView(sl, s) {
		const v = document.createElement('div');
		v.className = 'pe-thumb-view';
		v.style.width = deck.w + 'px';
		v.style.height = deck.h + 'px';
		v.style.transform = 'scale(' + s + ')';
		fillSlideNode(v, sl, {
			static: true
		});
		return v;
	}

	function renderThumbs() {
		thumbsNode.innerHTML = '';
		const z = thumbSize();
		deck.slides.forEach((sl, i) => {
			const t = document.createElement('div');
			t.className = 'pe-thumb' + (i === cur ? ' is-current' : '');
			t.dataset.i = i;
			t.style.width = z.tw + 'px';
			t.style.height = z.th + 'px';
			t.innerHTML = '<span class="pe-thumb-n">' + (i + 1) + '</span>';
			t.appendChild(thumbView(sl, z.s));
			thumbsNode.appendChild(t);
		});
		const c = thumbsNode.querySelector('.is-current');
		if(c && c.scrollIntoView) c.scrollIntoView({
			block: 'nearest'
		});
	}

	let thumbTimer = 0;

	function queueThumb() {
		clearTimeout(thumbTimer);
		thumbTimer = setTimeout(() => {
			const t = thumbsNode.querySelector('.pe-thumb[data-i="' + cur + '"]');
			if(!t) return;
			const old = t.querySelector('.pe-thumb-view');
			const v = thumbView(slide(), thumbSize().s);
			if(old) old.replaceWith(v);
			else t.appendChild(v);
		}, 250);
	}

	function goTo(i) {
		i = clamp(i, 0, deck.slides.length - 1);
		if(editing) endEdit();
		cur = i;
		selId = null;
		renderStage();
		thumbsNode.querySelectorAll('.pe-thumb').forEach((t) => t.classList.toggle('is-current', +t.dataset.i === cur));
		const c = thumbsNode.querySelector('.is-current');
		if(c && c.scrollIntoView) c.scrollIntoView({
			block: 'nearest'
		});
		updateToolbar();
		$('peCount').textContent = 'Slide ' + (cur + 1) + ' of ' + deck.slides.length;
	}

	function moveSlide(from, to) { 
		if(from === to) return;
		const s = deck.slides.splice(from, 1)[0];
		deck.slides.splice(to, 0, s);
		cur = to;
		renderAll();
		commit();
	}

	let tdrag = null;
	thumbsNode.addEventListener('pointerdown', (e) => {
		const t = e.target.closest('.pe-thumb');
		if(!t || (e.pointerType === 'mouse' && e.button !== 0)) return;
		tdrag = {
			i: +t.dataset.i,
			x: e.clientX,
			y: e.clientY,
			on: false,
			over: null
		};
	});

	document.addEventListener('pointermove', (e) => {
		if(!tdrag) return;
		if(!tdrag.on) {
			if(Math.hypot(e.clientX - tdrag.x, e.clientY - tdrag.y) < 6) return;
			tdrag.on = true;
			document.body.classList.add('pe-dragging');
		}
		const ts = Array.from(thumbsNode.querySelectorAll('.pe-thumb'));
		ts.forEach((t) => t.classList.remove('is-over'));
		let target = ts.length; // after the last slide by default
		for(let k = 0; k < ts.length; k++) {
			const r = ts[k].getBoundingClientRect();
			if(e.clientY < r.top + r.height / 2) {
				target = k;
				break;
			}
		}
		tdrag.over = target;
		if(target < ts.length) ts[target].classList.add('is-over');
	});

	document.addEventListener('pointerup', () => {
		if(!tdrag) return;
		const d = tdrag;
		tdrag = null;
		document.body.classList.remove('pe-dragging');
		thumbsNode.querySelectorAll('.pe-thumb').forEach((t) => t.classList.remove('is-over'));
		if(!d.on) {
			goTo(d.i);
			return;
		}
		let to = d.over == null ? d.i : d.over;
		if(to > d.i) to--;
		moveSlide(d.i, clamp(to, 0, deck.slides.length - 1));
	});

	function duplicateSlide() {
		if(editing) endEdit();
		const c = JSON.parse(JSON.stringify(slide()));
		c.els.forEach((e) => {
			e.id = uid();
		});
		deck.slides.splice(cur + 1, 0, c);
		cur++;
		selId = null;
		renderAll();
		commit();
	}

	function deleteSlide() {
		if(deck.slides.length < 2) {
			showError('A presentation needs at least one slide.');
			return;
		}
		clearError();
		if(editing) endEdit();
		deck.slides.splice(cur, 1);
		cur = Math.min(cur, deck.slides.length - 1);
		selId = null;
		renderAll();
		commit();
	}

	const presNode = $('pePresent'),
		presSlide = $('pePresentSlide');
	let presIdx = 0,
		hintTimer = 0;

	function drawPresent() {
		const k = Math.min(window.innerWidth / deck.w, window.innerHeight / deck.h);
		presSlide.style.width = Math.round(deck.w * k) + 'px';
		presSlide.style.height = Math.round(deck.h * k) + 'px';
		presSlide.innerHTML = '';
		const v = document.createElement('div');
		v.className = 'pe-slideview';
		v.style.transform = 'scale(' + k + ')';
		fillSlideNode(v, deck.slides[presIdx], {
			static: true
		});
		presSlide.appendChild(v);
	}

	function startShow() {
		if(editing) endEdit();
		presIdx = cur;
		presNode.classList.remove('is-hidden');
		const h = presNode.querySelector('.pe-present-hint');
		h.classList.remove('is-faded');
		clearTimeout(hintTimer);
		hintTimer = setTimeout(() => h.classList.add('is-faded'), 2500);
		drawPresent();
		if(presNode.requestFullscreen) presNode.requestFullscreen().catch(() => {});
	}

	function stopShow() {
		if(presNode.classList.contains('is-hidden')) return;
		presNode.classList.add('is-hidden');
		if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
		goTo(presIdx);
	}

	function stepShow(d) {
		const n = presIdx + d;
		if(n < 0) return;
		if(n >= deck.slides.length) {
			stopShow();
			return;
		}
		presIdx = n;
		drawPresent();
	}
	presNode.addEventListener('click', (e) => {
		const mid = window.innerWidth / 2;
		stepShow(e.clientX < mid * 0.5 ? -1 : 1);
	});

	document.addEventListener('fullscreenchange', () => {
		if(!document.fullscreenElement) stopShow();
	});

	window.addEventListener('resize', () => {
		if(!presNode.classList.contains('is-hidden')) drawPresent();
		else {
			renderStage();
			renderThumbs();
		}
	});

	const kids = (n, name) => (n ? Array.from(n.children).filter((c) => !name || c.localName === name) : []);
	const kid = (n, name) => kids(n, name)[0] || null;
	const at = (n, a, d) => (n && n.hasAttribute(a) ? n.getAttribute(a) : d);

	function path(n) {
		for(let i = 1; i < arguments.length && n; i++) n = kid(n, arguments[i]);
		return n;
	}
	const rid = (n) => n.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
	const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

	function resolvePath(base, target) {
		if(target.charAt(0) === '/') return target.slice(1);
		const parts = base.split('/').slice(0, -1).concat(target.split('/'));
		const out = [];
		parts.forEach((p) => {
			if(p === '..') out.pop();
			else if(p && p !== '.') out.push(p);
		});
		return out.join('/');
	}

	const PRESET = {
		black: '000000',
		white: 'FFFFFF',
		red: 'FF0000',
		green: '00FF00',
		blue: '0000FF',
		yellow: 'FFFF00',
		gray: '808080',
		grey: '808080'
	};

	function rgb2hsl(r, g, b) {
		r /= 255;
		g /= 255;
		b /= 255;
		const mx = Math.max(r, g, b),
			mn = Math.min(r, g, b),
			l = (mx + mn) / 2;
		let h = 0,
			s = 0;
		if(mx !== mn) {
			const d = mx - mn;
			s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
			h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
			h /= 6;
		}
		return [h, s, l];
	}

	function hsl2rgb(h, s, l) {
		if(s === 0) {
			const v = Math.round(l * 255);
			return [v, v, v];
		}
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
			p = 2 * l - q;
		const f = (t) => {
			if(t < 0) t += 1;
			if(t > 1) t -= 1;
			return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
		};
		return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map((v) => Math.round(v * 255));
	}
	
	const hex2 = (v) => ('0' + clamp(Math.round(v), 0, 255).toString(16)).slice(-2);

	function mix(hex, to, k) {
		const a = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16)),
			b = [1, 3, 5].map((i) => parseInt(to.substr(i, 2), 16));
		return '#' + a.map((v, i) => hex2(v + (b[i] - v) * k)).join('').toUpperCase();
	}

	function colorOf(fillNode, ctx, phClr) {
		const c = kids(fillNode)[0];
		if(!c) return null;
		let hex = null;
		const n = c.localName;
		if(n === 'srgbClr') hex = at(c, 'val', '000000');
		else if(n === 'sysClr') hex = at(c, 'lastClr', at(c, 'val') === 'window' ? 'FFFFFF' : '000000');
		else if(n === 'prstClr') hex = PRESET[at(c, 'val', 'black')] || '000000';
		else if(n === 'schemeClr') {
			const v = at(c, 'val', 'tx1');
			if(v === 'phClr') {
				if(!phClr) return null;
				hex = phClr.replace('#', '');
			} else hex = ctx.theme[ctx.clrMap[v] || v] || '000000';
		}
		if(!hex) return null;
		hex = '#' + hex.replace('#', '').toUpperCase();
		kids(c).forEach((m) => {
			const v = num(at(m, 'val'), 100000) / 100000;
			const nm = m.localName;
			if(nm === 'lumMod' || nm === 'lumOff') {
				const a = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16)),
					hs = rgb2hsl(a[0], a[1], a[2]);
				if(nm === 'lumMod') hs[2] = clamp(hs[2] * v, 0, 1);
				else hs[2] = clamp(hs[2] + v, 0, 1);
				hex = '#' + hsl2rgb(hs[0], hs[1], hs[2]).map(hex2).join('').toUpperCase();
			} else if(nm === 'tint') hex = mix(hex, '#FFFFFF', 1 - v);
			else if(nm === 'shade') hex = mix(hex, '#000000', 1 - v);
		});
		return hex;
	}

	function fillOf(spPr, ctx, phClr) { 
		if(!spPr) return undefined;
		if(kid(spPr, 'noFill')) return 'none';
		const s = kid(spPr, 'solidFill');
		if(s) return colorOf(s, ctx, phClr);
		const g = kid(spPr, 'gradFill');
		if(g) {
			const gs = path(g, 'gsLst', 'gs');
			if(gs) return colorOf(gs, ctx, phClr);
		}
		return undefined;
	}

	function readRPr(n, ctx) {
		const o = {};
		if(!n) return o;
		if(n.hasAttribute('sz')) o.sz = num(n.getAttribute('sz'), 1800) / 100;
		if(n.hasAttribute('b')) o.b = n.getAttribute('b') === '1' || n.getAttribute('b') === 'true';
		if(n.hasAttribute('i')) o.i = n.getAttribute('i') === '1' || n.getAttribute('i') === 'true';
		if(n.hasAttribute('u')) o.u = n.getAttribute('u') !== 'none';
		const sf = kid(n, 'solidFill');
		if(sf) {
			const c = colorOf(sf, ctx);
			if(c) o.color = c;
		}
		const lt = kid(n, 'latin');
		if(lt && lt.getAttribute('typeface')) {
			let f = lt.getAttribute('typeface');
			if(f === '+mj-lt') f = ctx.fonts.major;
			else if(f === '+mn-lt') f = ctx.fonts.minor;
			if(f && f.charAt(0) !== '+') o.font = f;
		}
		return o;
	}

	function readLvl(pPr, ctx) {
		const o = {};
		if(!pPr) return o;
		if(pPr.hasAttribute('algn')) o.algn = pPr.getAttribute('algn');
		if(kid(pPr, 'buNone')) o.bullet = 'none';
		else if(kid(pPr, 'buChar')) o.bullet = 'bullet';
		else if(kid(pPr, 'buAutoNum')) o.bullet = 'num';
		return Object.assign(readRPr(kid(pPr, 'defRPr'), ctx), o);
	}

	const fromNode = (node, ctx) => (lvl) => (node ? readLvl(kid(node, 'lvl' + (lvl + 1) + 'pPr'), ctx) : {});
	const firstOf = (list, key) => {
		for(let i = 0; i < list.length; i++)
			if(list[i][key] !== undefined) return list[i][key];
		return undefined;
	};

	function paragraphsToHtml(tx, chain, ctx, base) {
		if(!tx) return '<p><br></p>';
		const scale = base && base.scale ? base.scale : 1;
		const ps = kids(tx, 'p');
		let html = '',
			open = null; 
		const closeList = () => {
			if(open) {
				html += '</' + open + '>';
				open = null;
			}
		};
		ps.forEach((p) => {
			const pPr = kid(p, 'pPr');
			const lvl = clamp(num(at(pPr, 'lvl', 0), 0), 0, 8);
			const props = [readLvl(pPr, ctx)].concat(chain.map((f) => f(lvl)));
			if(base) props.push(base);
			const algn = firstOf(props, 'algn');
			let bullet = firstOf(props, 'bullet');
			const runs = kids(p).filter((c) => c.localName === 'r' || c.localName === 'br' || c.localName === 'fld');
			const style = (rp) => {
				const lst = [readRPr(rp, ctx)].concat(props);
				const sz = (firstOf(lst, 'sz') || 18) * scale;
				let s = 'font-size:' + (Math.round(sz * 10) / 10) + 'pt;font-family:' + JSON.stringify(firstOf(lst, 'font') || ctx.fonts.minor || 'Calibri').replace(/"/g, '&quot;') + ';color:' + (firstOf(lst, 'color') || '#000000');
				if(firstOf(lst, 'b')) s += ';font-weight:700';
				if(firstOf(lst, 'i')) s += ';font-style:italic';
				if(firstOf(lst, 'u')) s += ';text-decoration:underline';
				return s;
			};
			let inner = '';
			runs.forEach((r) => {
				if(r.localName === 'br') {
					inner += '<br>';
					return;
				}
				const t = kid(r, 't');
				const txt = t ? t.textContent : '';
				if(txt === '') return;
				inner += '<span style="' + style(kid(r, 'rPr')) + '">' + esc(txt) + '</span>';
			});
			if(!inner) inner = '<span style="' + style(kid(p, 'endParaRPr')) + '"><br></span>';
			const al = algn ? ({
				l: 'left',
				ctr: 'center',
				r: 'right',
				just: 'justify'
			}[algn] || '') : '';
			const as = al ? 'text-align:' + al : '';
			if(bullet === 'bullet' || bullet === 'num') {
				const tag = bullet === 'num' ? 'ol' : 'ul';
				if(open !== tag) {
					closeList();
					html += '<' + tag + '>';
					open = tag;
				}
				html += '<li' + (as || lvl ? ' style="' + as + (lvl ? (as ? ';' : '') + 'margin-left:' + (lvl * 0.9) + 'em' : '') + '"' : '') + '>' + inner + '</li>';
			} else {
				closeList();
				html += '<p' + (as ? ' style="' + as + '"' : '') + '>' + inner + '</p>';
			}
		});
		closeList();
		return html || '<p><br></p>';
	}
	
	function xfrmOf(spPr, tag) {
		const x = spPr && kid(spPr, tag || 'xfrm');
		if(!x) return null;
		const off = kid(x, 'off'),
			ext = kid(x, 'ext');
		if(!off || !ext) return null;
		return {
			x: num(at(off, 'x'), 0),
			y: num(at(off, 'y'), 0),
			cx: num(at(ext, 'cx'), 0),
			cy: num(at(ext, 'cy'), 0),
			rot: num(at(x, 'rot'), 0) / 60000,
			flipH: at(x, 'flipH') === '1',
			flipV: at(x, 'flipV') === '1',
			node: x
		};
	}

	const phOf = (sp) => path(sp, 'nvSpPr', 'nvPr', 'ph') || path(sp, 'nvPicPr', 'nvPr', 'ph');

	function findPh(tree, ph) {
		if(!tree || !ph) return null;
		const idx = at(ph, 'idx'),
			type = at(ph, 'type', 'body');
		const norm = (t) => (t === 'ctrTitle' ? 'title' : (t === 'subTitle' || t === 'obj' ? 'body' : t));
		let best = null;
		kids(tree, 'sp').forEach((sp) => {
			const p = phOf(sp);
			if(!p) return;
			if(idx && at(p, 'idx') === idx && !best) best = sp;
		});
		if(best) return best;
		kids(tree, 'sp').forEach((sp) => {
			const p = phOf(sp);
			if(p && !best && norm(at(p, 'type', 'body')) === norm(type)) best = sp;
		});
		return best;
	}

	const GEOMS = {
		rect: 1,
		roundRect: 1,
		ellipse: 1,
		triangle: 1,
		diamond: 1,
		rightArrow: 1,
		line: 1
	};
	async function mediaData(ctx, zipPath, crop) {
		const f = ctx.zip.file(zipPath);
		if(!f) return null;
		const ext = zipPath.split('.').pop().toLowerCase();
		const mime = {
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			bmp: 'image/bmp',
			webp: 'image/webp',
			svg: 'image/svg+xml'
		}[ext];
		if(!mime) return null;
		let url = 'data:' + mime + ';base64,' + await f.async('base64');
		if(crop && (crop.l || crop.t || crop.r || crop.b)) {
			try {
				const im = await loadImage(url);
				const sx = im.naturalWidth * crop.l,
					sy = im.naturalHeight * crop.t;
				const sw = Math.max(1, im.naturalWidth * (1 - crop.l - crop.r)),
					sh = Math.max(1, im.naturalHeight * (1 - crop.t - crop.b));
				const cv = document.createElement('canvas');
				cv.width = Math.round(sw);
				cv.height = Math.round(sh);
				cv.getContext('2d').drawImage(im, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
				url = cv.toDataURL(mime === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92);
			} catch(e) { /* keep the uncropped picture */ }
		}
		return url;
	}

	const mediaCache = {};

	function addMedia(url) {
		const id = 'm' + Math.random().toString(36).slice(2, 9);
		deck.media[id] = url;
		return id;
	}

	function place(M, g) {
		return {
			x: (M.sx * g.x + M.tx) / PX,
			y: (M.sy * g.y + M.ty) / PX,
			w: M.sx * g.cx / PX,
			h: M.sy * g.cy / PX
		};
	}

	async function parseTree(tree, ctx, M, out, opts) {
		for(const n of kids(tree)) {
			const nm = n.localName;
			try {
				if(nm === 'sp' || nm === 'cxnSp') await parseSp(n, ctx, M, out, opts);
				else if(nm === 'pic') await parsePic(n, ctx, M, out, opts);
				else if(nm === 'graphicFrame') await parseFrame(n, ctx, M, out, opts);
				else if(nm === 'grpSp') {
					const gx = xfrmOf(kid(n, 'grpSpPr'));
					const x = gx && kid(gx.node, 'chOff'),
						e = gx && kid(gx.node, 'chExt');
					let M2 = M;
					if(gx && x && e && num(at(e, 'cx'), 0) && num(at(e, 'cy'), 0)) {
						const gsx = gx.cx / num(at(e, 'cx'), 1),
							gsy = gx.cy / num(at(e, 'cy'), 1);
						M2 = {
							sx: M.sx * gsx,
							sy: M.sy * gsy,
							tx: M.sx * (gx.x - num(at(x, 'x'), 0) * gsx) + M.tx,
							ty: M.sy * (gx.y - num(at(x, 'y'), 0) * gsy) + M.ty
						};
					}
					await parseTree(n, ctx, M2, out, opts);
				}
			} catch(e) {
				ctx.skipped.push('an object');
			}
		}
	}

	async function parseSp(sp, ctx, M, out, opts) {
		const ph = phOf(sp);
		const phType = ph ? at(ph, 'type', 'body') : null;
		if(ph && opts.skipPh) return;
		if(ph && (phType === 'sldNum' || phType === 'dt' || phType === 'ftr' || phType === 'hdr')) return;
		const spPr = kid(sp, 'spPr');
		const lay = ph && !opts.skipPh ? findPh(ctx.layoutTree, ph) : null;
		const mas = ph ? findPh(ctx.masterTree, ph) : null;
		let g = xfrmOf(spPr) || (lay && xfrmOf(kid(lay, 'spPr'))) || (mas && xfrmOf(kid(mas, 'spPr')));
		if(!g) return;
		const isLine = sp.localName === 'cxnSp';
		const geomNode = spPr && kid(spPr, 'prstGeom');
		let geom = geomNode ? at(geomNode, 'prst', 'rect') : 'rect';
		if(isLine || geom === 'straightConnector1' || geom === 'line') geom = 'line';
		if(!GEOMS[geom] && geom !== 'line') geom = geom;
		const p = place(M, g);
		const style = kid(sp, 'style');
		let fill = fillOf(spPr, ctx);
		if(fill === undefined && !ph && style) {
			const fr = kid(style, 'fillRef');
			if(fr && at(fr, 'idx', '0') !== '0') fill = colorOf(fr, ctx);
		}
		if(fill === undefined && ph) {
			const lf = lay && fillOf(kid(lay, 'spPr'), ctx);
			if(lf) fill = lf;
		}
		if(fill === 'none' || fill === undefined) fill = null;
		let line = null,
			lineW = 0;
		const ln = spPr && kid(spPr, 'ln');
		if(ln) {
			if(kid(ln, 'noFill')) lineW = 0;
			else {
				const sf = kid(ln, 'solidFill');
				line = sf ? colorOf(sf, ctx) : null;
				lineW = ln.hasAttribute('w') ? num(ln.getAttribute('w'), 12700) / 12700 : 1;
				if(!line && style) {
					const lr = kid(style, 'lnRef');
					line = lr ? colorOf(lr, ctx) : null;
				}
			}
		} else if(style && !ph) {
			const lr = kid(style, 'lnRef');
			if(lr && at(lr, 'idx', '0') !== '0') {
				line = colorOf(lr, ctx);
				lineW = 1;
			}
		}
		if(!line) lineW = 0;
		if(geom === 'line' && !line) {
			line = '#000000';
			lineW = lineW || 1;
		}
		
		const tx = kid(sp, 'txBody');
		const bodyPr = tx && kid(tx, 'bodyPr');
		const lbp = lay && path(lay, 'txBody', 'bodyPr'),
			mbp = mas && path(mas, 'txBody', 'bodyPr');
		const bp = (a, d) => at(bodyPr, a, at(lbp, a, at(mbp, a, d)));
		const anchorRaw = bp('anchor', 't');
		const anchor = anchorRaw === 'ctr' ? 'ctr' : (anchorRaw === 'b' ? 'b' : 't');
		const pad = [num(bp('lIns', 91440), 91440), num(bp('tIns', 45720), 45720), num(bp('rIns', 91440), 91440), num(bp('bIns', 45720), 45720)].map((v) => Math.round(v / PX * 10) / 10);
		const fr = style && kid(style, 'fontRef');
		const fontRefClr = fr ? colorOf(fr, ctx) : null;
		const tstyle = !ph ? ctx.tx.other : (phType === 'title' || phType === 'ctrTitle' ? ctx.tx.title : (phType === 'dt' || phType === 'ftr' || phType === 'sldNum' ? ctx.tx.other : ctx.tx.body));
		const chain = [fromNode(tx && kid(tx, 'lstStyle'), ctx), fromNode(lay && path(lay, 'txBody', 'lstStyle'), ctx), fromNode(mas && path(mas, 'txBody', 'lstStyle'), ctx)];
		if(fontRefClr && !ph) chain.push(() => ({
			color: fontRefClr
		}));
		chain.push(fromNode(tstyle, ctx), fromNode(ctx.tx.def, ctx));
		const na = bodyPr && path(bodyPr, 'normAutofit');
		const scale = na && na.hasAttribute('fontScale') ? num(na.getAttribute('fontScale'), 100000) / 100000 : 1;
		const html = paragraphsToHtml(tx, chain, ctx, {
			scale
		});
		const sz0 = firstOf(chain.map((f) => f(0)), 'sz') || 18;
		const empty = !hasText(html);
		if(empty && !fill && !line && !ph && geom !== 'line') return;
		out.push({
			id: uid(),
			kind: 'sp',
			x: Math.round(p.x),
			y: Math.round(p.y),
			w: Math.round(p.w),
			h: Math.round(p.h),
			rot: g.rot,
			flipH: g.flipH,
			flipV: g.flipV,
			geom,
			fill,
			line,
			lineW: Math.round(lineW * 100) / 100,
			html,
			anchor,
			fs: Math.round(sz0 * scale),
			pad,
			ph: empty && ph ? (phType === 'title' || phType === 'ctrTitle' ? 'Click to add title' : 'Click to add text') : '',
			locked: !!opts.locked
		});
	}

	async function parsePic(pic, ctx, M, out, opts) {
		const spPr = kid(pic, 'spPr');
		const g = xfrmOf(spPr);
		if(!g) return;
		const bf = kid(pic, 'blipFill'),
			blip = bf && kid(bf, 'blip');
		const id = blip && blip.getAttributeNS(REL_NS, 'embed');
		if(!id || !ctx.rels[id]) {
			ctx.skipped.push('a picture');
			return;
		}
		const sr = bf && kid(bf, 'srcRect');
		const crop = sr ? {
			l: num(at(sr, 'l'), 0) / 100000,
			t: num(at(sr, 't'), 0) / 100000,
			r: num(at(sr, 'r'), 0) / 100000,
			b: num(at(sr, 'b'), 0) / 100000
		} : null;
		const key = ctx.rels[id] + (crop ? JSON.stringify(crop) : '');
		let mid = mediaCache[key];
		if(!mid) {
			const url = await mediaData(ctx, ctx.rels[id], crop);
			if(!url) {
				ctx.skipped.push('a picture in a format the browser cannot show');
				return;
			}
			mid = mediaCache[key] = addMedia(url);
		}
		const p = place(M, g);
		out.push({
			id: uid(),
			kind: 'pic',
			x: Math.round(p.x),
			y: Math.round(p.y),
			w: Math.round(p.w),
			h: Math.round(p.h),
			rot: g.rot,
			flipH: g.flipH,
			flipV: g.flipV,
			media: mid,
			locked: !!opts.locked
		});
	}

	async function parseFrame(gf, ctx, M, out, opts) {
		const gd = path(gf, 'graphic', 'graphicData');
		const tbl = gd && kid(gd, 'tbl');
		if(!tbl) {
			ctx.skipped.push('a chart, diagram or embedded object');
			return;
		}
		const g = xfrmOf(gf, 'xfrm');
		if(!g) return;
		const p = place(M, g);
		const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => num(at(c, 'w'), 914400) * M.sx / PX);
		const tp = kid(tbl, 'tblPr');
		const head = at(tp, 'firstRow') === '1',
			band = at(tp, 'bandRow') === '1';
		const acc = ctx.theme.accent1 ? '#' + ctx.theme.accent1 : '#4472C4';
		const trs = kids(tbl, 'tr');
		let html = '<colgroup>' + cols.map((w) => '<col style="width:' + Math.round(w * 100) / 100 + 'px">').join('') + '</colgroup><tbody>';
		let tot = 0;
		trs.forEach((tr, ri) => {
			const rh = num(at(tr, 'h'), 370840) * M.sy / PX;
			tot += rh;
			html += '<tr style="height:' + Math.round(rh * 100) / 100 + 'px">';
			kids(tr, 'tc').forEach((tc) => {
				if(at(tc, 'hMerge') === '1' || at(tc, 'vMerge') === '1') return;
				const tcPr = kid(tc, 'tcPr');
				let bg = tcPr ? fillOf(tcPr, ctx) : undefined,
					color = null,
					bold = false;
				if(bg === 'none') bg = null;
				if(bg === undefined) {
					if(head && ri === 0) {
						bg = acc;
						color = '#FFFFFF';
						bold = true;
					} else if(band) bg = mix(acc, '#FFFFFF', ri % 2 ? 0.78 : 0.9);
					else bg = null;
				}
				const chain = [fromNode(kid(tc, 'txBody') && kid(kid(tc, 'txBody'), 'lstStyle'), ctx), fromNode(ctx.tx.other, ctx), fromNode(ctx.tx.def, ctx)];
				const cell = paragraphsToHtml(kid(tc, 'txBody'), chain, ctx, color ? {
					color, b: bold
				} : null);
				const gs = num(at(tc, 'gridSpan'), 1),
					rs = num(at(tc, 'rowSpan'), 1);
				html += '<td' + (gs > 1 ? ' colspan="' + gs + '"' : '') + (rs > 1 ? ' rowspan="' + rs + '"' : '') + (bg ? ' style="background-color:' + bg + '"' : '') + '>' + cell + '</td>';
			});
			html += '</tr>';
		});
		html += '</tbody>';
		out.push({
			id: uid(),
			kind: 'tbl',
			x: Math.round(p.x),
			y: Math.round(p.y),
			w: Math.round(p.w),
			h: Math.round(tot),
			rot: 0,
			html,
			locked: !!opts.locked
		});
	}

	async function openPptx(file) {
		if(typeof JSZip === 'undefined') throw new Error('The JSZip library is missing.');
		const zip = await JSZip.loadAsync(await readFile(file, 'buffer'));
		const text = async(p) => {
			const f = zip.file(p);
			return f ? f.async('string') : null;
		};
		const xml = async(p) => {
			const s = await text(p);
			return s ? new DOMParser().parseFromString(s, 'application/xml') : null;
		};
		const relsOf = async(p) => {
			const d = await xml(p.replace(/([^/]+)$/, '_rels/$1.rels'));
			const o = {},
				ty = {};
			if(d) kids(d.documentElement, 'Relationship').forEach((r) => {
				o[r.getAttribute('Id')] = resolvePath(p, r.getAttribute('Target'));
				ty[r.getAttribute('Id')] = r.getAttribute('Type');
			});
			return {
				map: o,
				type: ty
			};
		};
		const presDoc = await xml('ppt/presentation.xml');
		if(!presDoc) throw new Error('This does not look like a PowerPoint (.pptx) file. Older .ppt files are not supported: open them in PowerPoint and save as .pptx first.');
		const pres = presDoc.documentElement;
		const sz = kid(pres, 'sldSz');
		const W = num(at(sz, 'cx'), 12192000),
			H = num(at(sz, 'cy'), 6858000);
		const prel = await relsOf('ppt/presentation.xml');
		const ids = kids(kid(pres, 'sldIdLst'), 'sldId').map((s) => prel.map[rid(s)]).filter(Boolean);
		if(!ids.length) throw new Error('This presentation has no slides.');
		const mid0 = kid(pres, 'sldMasterIdLst') && kid(kid(pres, 'sldMasterIdLst'), 'sldMasterId');
		const masterPath = mid0 ? prel.map[rid(mid0)] : null;
		const masterDoc = masterPath ? await xml(masterPath) : null;
		const mrel = masterPath ? await relsOf(masterPath) : {
			map: {},
			type: {}
		};
		const themePath = Object.keys(mrel.map).map((k) => mrel.map[k]).find((p) => /theme\/theme\d*\.xml$/.test(p));
		const themeDoc = themePath ? await xml(themePath) : null;
		const theme = {},
			fonts = {
				major: 'Calibri',
				minor: 'Calibri'
			};
		if(themeDoc) {
			const cs = path(themeDoc.documentElement, 'themeElements', 'clrScheme');
			kids(cs).forEach((c) => {
				const v = kid(c);
				if(v) theme[c.localName] = at(v, 'lastClr', at(v, 'val', '000000'));
			});
			const fs = path(themeDoc.documentElement, 'themeElements', 'fontScheme');
			const mj = fs && path(fs, 'majorFont', 'latin'),
				mn = fs && path(fs, 'minorFont', 'latin');
			if(mj) fonts.major = at(mj, 'typeface', 'Calibri');
			if(mn) fonts.minor = at(mn, 'typeface', 'Calibri');
		}
		const clrMap = {
			bg1: 'lt1',
			tx1: 'dk1',
			bg2: 'lt2',
			tx2: 'dk2'
		};
		const cm = masterDoc && kid(masterDoc.documentElement, 'clrMap');
		if(cm) Array.from(cm.attributes).forEach((a) => {
			clrMap[a.name] = a.value;
		});
		const txs = masterDoc && kid(masterDoc.documentElement, 'txStyles');
		const tx = {
			title: txs && kid(txs, 'titleStyle'),
			body: txs && kid(txs, 'bodyStyle'),
			other: txs && kid(txs, 'otherStyle'),
			def: kid(pres, 'defaultTextStyle')
		};
		const masterTree = masterDoc && path(masterDoc.documentElement, 'cSld', 'spTree');
		const base = {
			theme, fonts, clrMap, tx, zip, masterTree, skipped: []
		};
		const bgOf = (root) => {
			const bg = path(root, 'cSld', 'bg');
			if(!bg) return null;
			const bp = kid(bg, 'bgPr');
			if(bp) {
				const f = fillOf(bp, base);
				return f && f !== 'none' ? f : null;
			}
			const br = kid(bg, 'bgRef');
			return br ? colorOf(br, base) : null;
		};
		const masterBg = masterDoc ? bgOf(masterDoc.documentElement) : null;
		const slides = [];
		deck = {
			w: Math.round(W / PX),
			h: Math.round(H / PX),
			slides,
			media: {}
		};
		for(const k in mediaCache) delete mediaCache[k];
		const M0 = {
			sx: 1,
			sy: 1,
			tx: 0,
			ty: 0
		};
		for(const sp of ids) {
			const sd = await xml(sp);
			if(!sd) continue;
			const root = sd.documentElement;
			const srel = await relsOf(sp);
			const layPath = Object.keys(srel.map).map((k) => ({
				p: srel.map[k],
				t: srel.type[k]
			})).find((r) => /slideLayout$/.test(r.t));
			const layDoc = layPath ? await xml(layPath.p) : null;
			const lrel = layPath ? await relsOf(layPath.p) : {
				map: {},
				type: {}
			};
			const layoutTree = layDoc && path(layDoc.documentElement, 'cSld', 'spTree');
			const bg = bgOf(root) || (layDoc && bgOf(layDoc.documentElement)) || masterBg || '#FFFFFF';
			const els = [];
			const showMaster = at(root, 'showMasterSp', '1') !== '0' && !(layDoc && at(layDoc.documentElement, 'showMasterSp', '1') === '0');
			if(showMaster && masterTree) await parseTree(masterTree, Object.assign({}, base, {
				rels: mrel.map,
				layoutTree: null
			}), M0, els, {
				skipPh: true,
				locked: true
			});
			if(layoutTree && (!layDoc || at(layDoc.documentElement, 'showMasterSp', '1') !== '0' || true)) await parseTree(layoutTree, Object.assign({}, base, {
				rels: lrel.map,
				layoutTree: null
			}), M0, els, {
				skipPh: true,
				locked: true
			});
			await parseTree(path(root, 'cSld', 'spTree'), Object.assign({}, base, {
				rels: srel.map,
				layoutTree
			}), M0, els, {});
			slides.push({
				bg, els
			});
		}
		if(!slides.length) throw new Error('No slides could be read from this file.');
		cur = 0;
		selId = null;
		editing = false;
		const skipped = Array.from(new Set(base.skipped));
		slides.forEach((s) => s.els.forEach((e) => {
			if(e.html) loadFontsIn(e.html);
		}));
		return skipped;
	}

	const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
	const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
	const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
	const isBlock = (n) => n.nodeType === 1 && /^(P|DIV|UL|OL|LI|H[1-6]|BLOCKQUOTE)$/.test(n.tagName);

	function styleOf(elm, root) {
		const cs = getComputedStyle(elm);
		let u = false;
		for(let n = elm; n && n !== root.parentElement; n = n.parentElement) {
			if(n.tagName === 'U' || /underline/.test(getComputedStyle(n).textDecorationLine)) {
				u = true;
				break;
			}
		}
		return {
			sz: Math.max(100, Math.round(parseFloat(cs.fontSize) * 75)),
			font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'Calibri',
			color: toHex(cs.color).slice(1),
			b: parseInt(cs.fontWeight, 10) >= 600,
			i: cs.fontStyle === 'italic',
			u
		};
	}
	const algnOf = (cs) => ({
		center: 'ctr',
		right: 'r',
		end: 'r',
		justify: 'just'
	}[cs.textAlign] || 'l');

	function runXml(r) {
		const s = r.st;
		return '<a:r><a:rPr lang="en-US" sz="' + s.sz + '"' + (s.b ? ' b="1"' : '') + (s.i ? ' i="1"' : '') + (s.u ? ' u="sng"' : '') + ' dirty="0"><a:solidFill><a:srgbClr val="' + s.color + '"/></a:solidFill><a:latin typeface="' + esc(s.font) + '"/><a:cs typeface="' + esc(s.font) + '"/></a:rPr><a:t>' + esc(r.t) + '</a:t></a:r>';
	}

	function parasXml(root) {
		const paras = [];
		let curP = null;
		const start = (elm, bullet, depth) => {
			curP = {
				runs: [],
				algn: algnOf(getComputedStyle(elm)),
				bullet,
				depth,
				st: styleOf(elm, root)
			};
			paras.push(curP);
		};
		const inline = (node) => {
			if(node.nodeType === 3) {
				const t = node.nodeValue.replace(/[\r\n]+/g, ' ').replace(/​/g, '');
				if(t !== '') curP.runs.push({
					t, st: styleOf(node.parentElement, root)
				});
			} else if(node.nodeType === 1) {
				if(node.tagName === 'BR') curP.runs.push({
					br: true,
					st: styleOf(node.parentElement, root)
				});
				else if(!/^(UL|OL)$/.test(node.tagName)) Array.from(node.childNodes).forEach(inline);
			}
		};
		const list = (ul, depth) => {
			Array.from(ul.children).forEach((li) => {
				if(li.tagName !== 'LI') return;
				start(li, ul.tagName === 'OL' ? 'num' : 'bullet', depth);
				Array.from(li.childNodes).forEach(inline);
				Array.from(li.children).forEach((c) => {
					if(/^(UL|OL)$/.test(c.tagName)) list(c, depth + 1);
				});
			});
		};
		const walk = (parent) => {
			let loose = false;
			Array.from(parent.childNodes).forEach((n) => {
				if(/^(UL|OL)$/.test(n.nodeType === 1 ? n.tagName : '')) {
					loose = false;
					list(n, 1);
					return;
				}
				if(isBlock(n)) {
					loose = false;
					if(Array.from(n.children).some(isBlock)) {
						walk(n);
						return;
					}
					start(n, null, 0);
					Array.from(n.childNodes).forEach(inline);
				} else if(n.nodeType === 3 || n.nodeType === 1) {
					if(n.nodeType === 3 && n.nodeValue.trim() === '' && !loose) return;
					if(!loose) {
						start(parent, null, 0);
						loose = true;
					}
					inline(n);
				}
			});
		};
		walk(root);
		if(!paras.length) start(root, null, 0);
		return paras.map((p) => {
			let runs = p.runs;
			if(runs.length === 1 && runs[0].br) runs = [];
			const last = runs.length ? runs[runs.length - 1].st : p.st;
			const bu = p.bullet === 'num' ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>' : (p.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : '<a:buNone/>');
			const ind = p.bullet ? ' marL="' + (342900 * p.depth) + '" indent="-342900"' : ' marL="0" indent="0"';
			return '<a:p><a:pPr' + ind + ' algn="' + p.algn + '">' + bu + '</a:pPr>' + runs.map((r) => (r.br ? '<a:br><a:rPr lang="en-US" sz="' + r.st.sz + '"/></a:br>' : runXml(r))).join('') + '<a:endParaRPr lang="en-US" sz="' + last.sz + '" dirty="0"/></a:p>';
		}).join('');
	}

	const fillXml = (c) => (c ? '<a:solidFill><a:srgbClr val="' + c.replace('#', '') + '"/></a:solidFill>' : '<a:noFill/>');

	function xfrmXml(el, tag) {
		return '<' + (tag || 'a:xfrm') + (el.rot ? ' rot="' + Math.round(el.rot * 60000) + '"' : '') + (el.flipH ? ' flipH="1"' : '') + (el.flipV ? ' flipV="1"' : '') + '><a:off x="' + emu(el.x) + '" y="' + emu(el.y) + '"/><a:ext cx="' + emu(el.w) + '" cy="' + emu(el.h) + '"/></' + (tag || 'a:xfrm') + '>';
	}

	function tableXml(el, node, sid) {
		const t = node.querySelector('table');
		const rows = Array.from(t.rows);
		const ncols = Math.max.apply(null, rows.map((r) => Array.from(r.cells).reduce((a, c) => a + (c.colSpan || 1), 0)));
		const cols = Array.from(t.querySelectorAll('col')).map((c) => parseFloat(c.style.width) || el.w / ncols);
		while(cols.length < ncols) cols.push(el.w / ncols);
		const occ = rows.map(() => new Array(ncols).fill(null));
		rows.forEach((r, ri) => {
			let ci = 0;
			Array.from(r.cells).forEach((td) => {
				while(ci < ncols && occ[ri][ci]) ci++;
				const gs = td.colSpan || 1,
					rs = td.rowSpan || 1;
				for(let a = 0; a < rs; a++)
					for(let b = 0; b < gs; b++)
						if(rows[ri + a] && ci + b < ncols) occ[ri + a][ci + b] = (a === 0 && b === 0) ? {
							td
						} : {
							h: b > 0,
							v: a > 0
						};
				ci += gs;
			});
		});
		let total = 0;
		const ln = (n) => '<a:' + n + ' w="12700"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:' + n + '>';
		const trs = rows.map((r, ri) => {
			const h = Math.max(emu(r.offsetHeight || 40), 91440);
			total += h;
			let x = '<a:tr h="' + h + '">';
			for(let ci = 0; ci < ncols; ci++) {
				const o = occ[ri][ci];
				if(!o) {
					x += '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody><a:tcPr/></a:tc>';
					continue;
				}
				if(o.td) {
					const td = o.td,
						bg = getComputedStyle(td).backgroundColor;
					const fill = /rgba\(0, 0, 0, 0\)|transparent/.test(bg) ? '' : '<a:solidFill><a:srgbClr val="' + toHex(bg).slice(1) + '"/></a:solidFill>';
					x += '<a:tc' + (td.colSpan > 1 ? ' gridSpan="' + td.colSpan + '"' : '') + (td.rowSpan > 1 ? ' rowSpan="' + td.rowSpan + '"' : '') + '><a:txBody><a:bodyPr/><a:lstStyle/>' + parasXml(td) + '</a:txBody><a:tcPr marL="91440" marR="91440" marT="45720" marB="45720" anchor="t">' + ln('lnL') + ln('lnR') + ln('lnT') + ln('lnB') + fill + '</a:tcPr></a:tc>';
				} else x += '<a:tc' + (o.h ? ' hMerge="1"' : '') + (o.v ? ' vMerge="1"' : '') + '><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody><a:tcPr/></a:tc>';
			}
			return x + '</a:tr>';
		}).join('');
		const w = cols.reduce((a, b) => a + emu(b), 0);
		return '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="' + sid + '" name="Table ' + sid + '"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="' + emu(el.x) + '" y="' + emu(el.y) + '"/><a:ext cx="' + w + '" cy="' + total + '"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="0" bandRow="0"/><a:tblGrid>' + cols.map((c) => '<a:gridCol w="' + emu(c) + '"/>').join('') + '</a:tblGrid>' + trs + '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>';
	}

	function spXml(el, node, sid) {
		const lineX = el.line && el.lineW > 0 ? '<a:ln w="' + Math.round(el.lineW * 12700) + '"><a:solidFill><a:srgbClr val="' + el.line.replace('#', '') + '"/></a:solidFill></a:ln>' : '<a:ln><a:noFill/></a:ln>';
		if(el.geom === 'line') return '<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="' + sid + '" name="Line ' + sid + '"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>' + xfrmXml(el) + '<a:prstGeom prst="line"><a:avLst/></a:prstGeom>' + lineX + '</p:spPr></p:cxnSp>';
		const pad = (el.pad || [9.6, 4.8, 9.6, 4.8]).map(emu);
		const tb = el.geom === 'rect' && !el.fill && !(el.line && el.lineW > 0);
		return '<p:sp><p:nvSpPr><p:cNvPr id="' + sid + '" name="' + (tb ? 'TextBox ' : 'Shape ') + sid + '"/><p:cNvSpPr' + (tb ? ' txBox="1"' : '') + '/><p:nvPr/></p:nvSpPr><p:spPr>' + xfrmXml(el) + '<a:prstGeom prst="' + esc(el.geom || 'rect') + '"><a:avLst/></a:prstGeom>' + fillXml(el.fill) + lineX + '</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="' + pad[0] + '" tIns="' + pad[1] + '" rIns="' + pad[2] + '" bIns="' + pad[3] + '" rtlCol="0" anchor="' + (el.anchor || 't') + '"><a:noAutofit/></a:bodyPr><a:lstStyle/>' + parasXml(node.querySelector('.pe-body')) + '</p:txBody></p:sp>';
	}

	const THEME = XML + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Matte"><a:themeElements><a:clrScheme name="Matte"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="3B4051"/></a:dk2><a:lt2><a:srgbClr val="F7F5F0"/></a:lt2><a:accent1><a:srgbClr val="FF6224"/></a:accent1><a:accent2><a:srgbClr val="3B4051"/></a:accent2><a:accent3><a:srgbClr val="2F8A4A"/></a:accent3><a:accent4><a:srgbClr val="C4432B"/></a:accent4><a:accent5><a:srgbClr val="6E6656"/></a:accent5><a:accent6><a:srgbClr val="DDD6C6"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Matte"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Matte"><a:fillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:fillStyleLst><a:lnStyleLst>' + '<a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>'.repeat(3) + '</a:lnStyleLst><a:effectStyleLst>' + '<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3) + '</a:effectStyleLst><a:bgFillStyleLst>' + '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3) + '</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
	const MASTER = XML + '<p:sldMaster ' + NS + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + GRP + '</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900" algn="l"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr algn="l"><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>';
	const LAYOUT = XML + '<p:sldLayout ' + NS + ' type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>' + GRP + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
	const relsXml = (list) => XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.map((r) => '<Relationship Id="' + r[0] + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + r[1] + '" Target="' + r[2] + '"/>').join('') + '</Relationships>';
	
	async function mediaBytes(url) { 
		const m = /^data:(image\/[a-z+.-]+);base64,/i.exec(url);
		const mime = m ? m[1].toLowerCase() : '';
		if(mime === 'image/png') return {
			ext: 'png',
			bytes: dataUrlToBytes(url)
		};
		if(mime === 'image/jpeg') return {
			ext: 'jpg',
			bytes: dataUrlToBytes(url)
		};
		if(mime === 'image/gif') return {
			ext: 'gif',
			bytes: dataUrlToBytes(url)
		};
		const im = await loadImage(url);
		const cv = document.createElement('canvas');
		cv.width = im.naturalWidth || 400;
		cv.height = im.naturalHeight || 300;
		cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
		return {
			ext: 'png',
			bytes: dataUrlToBytes(cv.toDataURL('image/png'))
		};
	}

	async function buildPptx() {
		if(editing) endEdit();
		const zip = new JSZip();
		const host = document.createElement('div');
		host.className = 'pe-offscreen';
		document.body.appendChild(host);
		try {
			const media = {}; // media id -> { name, bytes }
			const slideXml = [],
				slideRels = [];
			let mcount = 0;
			for(let si = 0; si < deck.slides.length; si++) {
				const sl = deck.slides[si];
				const node = document.createElement('div');
				node.className = 'pe-slide is-static';
				fillSlideNode(node, sl, {
					static: true
				});
				host.appendChild(node);
				const rels = [
					['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']
				];
				const relFor = {};
				let shapes = '',
					sid = 2;
				for(const el of sl.els) {
					const n = node.querySelector('.pe-el[data-id="' + el.id + '"]');
					if(!n) continue;
					if(el.kind === 'pic') {
						const url = deck.media[el.media];
						if(!url) continue;
						if(!media[el.media]) {
							const mb = await mediaBytes(url);
							media[el.media] = {
								name: 'image' + (++mcount) + '.' + mb.ext,
								bytes: mb.bytes
							};
						}
						if(!relFor[el.media]) {
							relFor[el.media] = 'rId' + (rels.length + 1);
							rels.push([relFor[el.media], 'image', '../media/' + media[el.media].name]);
						}
						shapes += '<p:pic><p:nvPicPr><p:cNvPr id="' + sid + '" name="Picture ' + sid + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="' + relFor[el.media] + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' + xfrmXml(el) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>';
					} else if(el.kind === 'tbl') shapes += tableXml(el, n, sid);
					else shapes += spXml(el, n, sid);
					sid++;
				}
				const bg = sl.bg && sl.bg.toUpperCase() !== '#FFFFFF' ? '<p:bg><p:bgPr>' + fillXml(sl.bg) + '<a:effectLst/></p:bgPr></p:bg>' : '';
				slideXml.push(XML + '<p:sld ' + NS + '><p:cSld>' + bg + '<p:spTree>' + GRP + shapes + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>');
				slideRels.push(rels);
				node.remove();
			}
			const n = deck.slides.length;
			const ct = XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' + slideXml.map((s, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>').join('') + '</Types>';
			zip.file('[Content_Types].xml', ct);
			zip.file('_rels/.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>');
			const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
			zip.file('docProps/core.xml', XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>' + esc($('peName').value || 'presentation') + '</dc:title><dc:creator>Matte</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + '</dcterms:modified></cp:coreProperties>');
			zip.file('docProps/app.xml', XML + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Matte</Application><Slides>' + n + '</Slides></Properties>');
			zip.file('ppt/presentation.xml', XML + '<p:presentation ' + NS + ' saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + slideXml.map((s, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (i + 2) + '"/>').join('') + '</p:sldIdLst><p:sldSz cx="' + emu(deck.w) + '" cy="' + emu(deck.h) + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>');
			zip.file('ppt/_rels/presentation.xml.rels', relsXml([
				['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml']
			].concat(slideXml.map((s, i) => ['rId' + (i + 2), 'slide', 'slides/slide' + (i + 1) + '.xml']), [
				['rId' + (n + 2), 'presProps', 'presProps.xml'],
				['rId' + (n + 3), 'viewProps', 'viewProps.xml'],
				['rId' + (n + 4), 'theme', 'theme/theme1.xml'],
				['rId' + (n + 5), 'tableStyles', 'tableStyles.xml']
			])));
			zip.file('ppt/presProps.xml', XML + '<p:presentationPr ' + NS + '/>');
			zip.file('ppt/viewProps.xml', XML + '<p:viewPr ' + NS + '><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr><p:cViewPr varScale="1"><p:scale><a:sx n="100" d="100"/><a:sy n="100" d="100"/></p:scale><p:origin x="0" y="0"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>');
			zip.file('ppt/tableStyles.xml', XML + '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>');
			zip.file('ppt/theme/theme1.xml', THEME);
			zip.file('ppt/slideMasters/slideMaster1.xml', MASTER);
			zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', relsXml([
				['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'],
				['rId2', 'theme', '../theme/theme1.xml']
			]));
			zip.file('ppt/slideLayouts/slideLayout1.xml', LAYOUT);
			zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', relsXml([
				['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']
			]));
			slideXml.forEach((s, i) => {
				zip.file('ppt/slides/slide' + (i + 1) + '.xml', s);
				zip.file('ppt/slides/_rels/slide' + (i + 1) + '.xml.rels', relsXml(slideRels[i]));
			});
			Object.keys(media).forEach((k) => zip.file('ppt/media/' + media[k].name, media[k].bytes));
			return await zip.generateAsync({
				type: 'blob',
				mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
				compression: 'DEFLATE'
			});
		} finally {
			host.remove();
		}
	}

	async function savePptx() {
		clearError();
		try {
			setStatus('Saving…');
			const blob = await buildPptx();
			const name = ($('peName').value || 'presentation').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'presentation';
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = name + '.pptx';
			document.body.appendChild(a);
			a.click();
			setTimeout(() => {
				URL.revokeObjectURL(a.href);
				a.remove();
			}, 1500);
			dirty = false;
			setStatus('Saved ' + name + '.pptx');
		} catch(e) {
			showError('The file could not be saved: ' + e.message);
			setStatus('Not saved', true);
		}
	}

	window.__peDebug = {get deck() {
			return deck;
		},
		buildPptx,
		openPptx,
		goTo,
		renderAll
	};
	
	$('peOpenBtn').addEventListener('click', () => {
		if(!dirty || confirm('Open another file? Unsaved changes will be lost.')) $('peFileInput').click();
	});

	$('peFileInput').addEventListener('change', async() => {
		const f = $('peFileInput').files[0];
		$('peFileInput').value = '';
		if(!f) return;
		clearError();
		setStatus('Opening…');
		try {
			const skipped = await openPptx(f);
			$('peName').value = f.name.replace(/\.pptx$/i, '');
			resetHistory();
			renderAll();
			dirty = false;
			setStatus('Opened ' + f.name + ' · ' + deck.slides.length + ' slide' + (deck.slides.length === 1 ? '' : 's'));
			if(skipped.length) showError('Not everything could be kept: ' + skipped.join(', ') + ' will be left out when you save.');
		} catch(e) {
			showError(e.message || 'The file could not be opened.');
			setStatus('Not opened', true);
		}
	});

	$('peNewBtn').addEventListener('click', () => {
		if(dirty && !confirm('Start a new presentation? Unsaved changes will be lost.')) return;
		deck = newDeck();
		deck.slides[0].els = layoutEls('title');
		cur = 0;
		selId = null;
		editing = false;
		$('peName').value = 'presentation';
		clearError();
		resetHistory();
		renderAll();
		dirty = false;
		setStatus('New presentation');
	});

	$('peSaveBtn').addEventListener('click', savePptx);
	$('pePresentBtn').addEventListener('click', startShow);
	$('peAddSlide').addEventListener('click', () => addSlideAfter($('peLayout').value));
	$('peDupSlide').addEventListener('click', duplicateSlide);
	$('peDelSlide').addEventListener('click', deleteSlide);
	$('peAddText').addEventListener('click', addTextBox);
	$('peAddTable').addEventListener('click', addTable);
	$('peAddPic').addEventListener('click', () => $('peImgInput').click());
	$('peImgInput').addEventListener('change', () => {
		const f = $('peImgInput').files[0];
		$('peImgInput').value = '';
		if(f) addPicture(f);
	});

	$('peAddShape').addEventListener('change', () => {
		addShape($('peAddShape').value);
		$('peAddShape').value = '';
	});

	$('peInsert').addEventListener('click', (e) => {
		const b = e.target.closest('[data-act]');
		if(!b) return;
		const a = b.dataset.act;
		if(a === 'front') reorderSel(true);
		else if(a === 'back') reorderSel(false);
		else if(a === 'duplicate') duplicateSel();
		else if(a === 'delete') removeSel();
	});

	$('peName').addEventListener('input', setDirty);
	window.addEventListener('beforeunload', (e) => {
		if(dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	});
	
	document.addEventListener('keydown', (e) => {
		if(!presNode.classList.contains('is-hidden')) {
			e.preventDefault();
			e.stopPropagation();
			if(e.key === 'Escape') stopShow();
			else if(/^(ArrowRight|ArrowDown|PageDown| |Enter)$/.test(e.key)) stepShow(1);
			else if(/^(ArrowLeft|ArrowUp|PageUp|Backspace)$/.test(e.key)) stepShow(-1);
			else if(e.key === 'Home') {
				presIdx = 0;
				drawPresent();
			} else if(e.key === 'End') {
				presIdx = deck.slides.length - 1;
				drawPresent();
			}
			return;
		}
		const t = e.target;
		const inField = t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
		const mod = e.ctrlKey || e.metaKey;
		if(editing) {
			if(e.key === 'Escape') {
				e.preventDefault();
				endEdit();
			} else if(e.key === 'Tab' && selEl() && selEl().kind === 'tbl') { // Tab walks through the cells
				e.preventDefault();
				const c = tableCtx();
				const tds = c ? Array.from(c.t.querySelectorAll('td')) : [];
				const i = c && c.cell ? tds.indexOf(c.cell) : -1;
				const nx = tds[i + (e.shiftKey ? -1 : 1)];
				if(nx) {
					nx.focus();
					const r = document.createRange();
					r.selectNodeContents(nx);
					r.collapse(false);
					const s = window.getSelection();
					s.removeAllRanges();
					s.addRange(r);
				}
			}
			return;
		}
		if(inField) return;
		if(mod && /^z$/i.test(e.key)) {
			e.preventDefault();
			e.shiftKey ? redo() : undo();
			return;
		}
		if(mod && /^y$/i.test(e.key)) {
			e.preventDefault();
			redo();
			return;
		}
		if(mod && /^s$/i.test(e.key)) {
			e.preventDefault();
			savePptx();
			return;
		}
		const el = selEl();
		if(mod && /^d$/i.test(e.key) && el) {
			e.preventDefault();
			duplicateSel();
			return;
		}
		if(mod && /^c$/i.test(e.key) && el && !el.locked) {
			clipboard = JSON.parse(JSON.stringify(el));
			return;
		}
		if(mod && /^x$/i.test(e.key) && el && !el.locked) {
			clipboard = JSON.parse(JSON.stringify(el));
			removeSel();
			e.preventDefault();
			return;
		}
		if(mod && /^v$/i.test(e.key) && clipboard) {
			e.preventDefault();
			const c = cloneEl(clipboard, 24);
			clipboard.x += 24;
			clipboard.y += 24;
			addElement(c);
			return;
		}
		if(el && !el.locked) {
			if(e.key === 'Delete' || e.key === 'Backspace') {
				e.preventDefault();
				removeSel();
				return;
			}
			if(e.key === 'Enter' || e.key === 'F2') {
				e.preventDefault();
				startEdit(null, null);
				return;
			}
			const st = e.shiftKey ? 10 : 1;
			if(e.key === 'ArrowLeft') {
				e.preventDefault();
				nudge(-st, 0);
				return;
			}
			if(e.key === 'ArrowRight') {
				e.preventDefault();
				nudge(st, 0);
				return;
			}
			if(e.key === 'ArrowUp') {
				e.preventDefault();
				nudge(0, -st);
				return;
			}
			if(e.key === 'ArrowDown') {
				e.preventDefault();
				nudge(0, st);
				return;
			}
		}
		if(e.key === 'Escape' && el) {
			selId = null;
			updateSel();
			updateToolbar();
			return;
		}
		if(e.key === 'PageDown' || (!el && e.key === 'ArrowDown')) {
			e.preventDefault();
			goTo(cur + 1);
		} else if(e.key === 'PageUp' || (!el && e.key === 'ArrowUp')) {
			e.preventDefault();
			goTo(cur - 1);
		}
	});

	(function init() {
		try {
			document.execCommand('defaultParagraphSeparator', false, 'p');
		} catch(e) { /* older browsers */ }
		deck.slides[0].els = layoutEls('title');
		resetHistory();
		renderAll();
		dirty = false;
	})();
})();