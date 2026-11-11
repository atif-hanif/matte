/* =====================================================================
   Matte: Excel editor
   Opens .xlsx / .csv in the browser, edits cells (values, formulas, formatting, structure) and saves a new .xlsx.
   Needs xlsx-engine.js (formulas, number formats) and JSZip. Nothing is uploaded.
   Sections: 1 helpers  2 workbook model, styles, history  3 calculation  4 geometry  5 drawing the grid
             6 selecting and editing  7 clipboard, fill, structure, sort, filter, find  8 toolbar  9 opening  10 saving  11 start
===================================================================== */
(function() {
	'use strict';
	const XE = window.XE;
	const $ = (id) => document.getElementById(id);
	const ERR = XE.ERR,
		isErr = XE.isErr;
	const MAXR = 1048576,
		MAXC = 16384;
	const HDR_W = 50,
		HDR_H = 24;
	const DEF_COLW = 64,
		DEF_ROWH = 20;
	/* ---------------- 1. helpers ---------------- */
	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
	const num = (v, d) => {
		const n = parseFloat(v);
		return isNaN(n) ? d : n;
	};

	function showError(m) {
		const e = $('xeErr');
		e.textContent = m;
		e.classList.add('show');
	}

	function clearError() {
		$('xeErr').classList.remove('show');
	}

	function setStatus(m, dirty) {
		const s = $('xeStatus');
		s.textContent = m;
		s.classList.toggle('is-dirty', !!dirty);
	}
	const key = (r, c) => r * MAXC + c;
	const keyR = (k) => Math.floor(k / MAXC),
		keyC = (k) => k % MAXC;
	const addr = XE.addr;

	function readFile(file, as) {
		return new Promise((res, rej) => {
			const r = new FileReader();
			r.onload = () => res(r.result);
			r.onerror = () => rej(new Error('The file could not be read.'));
			as === 'buffer' ? r.readAsArrayBuffer(file) : r.readAsText(file);
		});
	}
	const mctx = document.createElement('canvas').getContext('2d');
	const widthCache = new Map();

	function textWidth(text, font) {
		const k = font + '|' + text;
		let w = widthCache.get(k);
		if(w === undefined) {
			mctx.font = font;
			w = mctx.measureText(text).width;
			if(widthCache.size > 20000) widthCache.clear();
			widthCache.set(k, w);
		}
		return w;
	}
	/* fonts: any Google Font typed into the font box is loaded on demand */
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
		l.onload = () => {
			widthCache.clear();
			scheduleDraw();
		};
		document.head.appendChild(l);
	}
	/* ---------------- 2. workbook model, styles, history ----------------
	   wb = { sheets: [sheet], active, styles: [style] }
	   sheet = { name, cells: Map(key -> {v, f, s}), colW: {}, rowH: {}, hidden: Set(rows), merges: [{r1,c1,r2,c2}], freeze: {r,c}, filter, maxR, maxC, ... }
	   style = { b, i, u, st, color, bg, font, sz, al, va, wrap, nf, bd: {t,r,b,l} }  (all optional; missing = default)  */
	let wb, sh; // current workbook and sheet
	let dirty = false,
		fileName = 'spreadsheet';
	const styleIds = new Map();

	function newStyleTable() {
		wb.styles = [{}];
		styleIds.clear();
		styleIds.set('{}', 0);
	}

	function styleKey(o) {
		const k = {};
		Object.keys(o).sort().forEach((p) => {
			if(o[p] !== undefined && o[p] !== null && o[p] !== false && o[p] !== '') k[p] = o[p];
		});
		return k;
	}

	function styleId(o) {
		const k = styleKey(o),
			js = JSON.stringify(k);
		let id = styleIds.get(js);
		if(id === undefined) {
			id = wb.styles.length;
			wb.styles.push(k);
			styleIds.set(js, id);
		}
		return id;
	}
	const styleOf = (id) => wb.styles[id] || wb.styles[0];
	const withStyle = (id, patch) => styleId(Object.assign({}, styleOf(id), patch));

	function newSheet(name) {
		return {
			name, cells: new Map(), colW: {}, rowH: {}, hidden: new Set(), merges: [], freeze: {
				r: 0,
				c: 0
			}, filter: null, maxR: -1, maxC: -1, nRows: 100, nCols: 26, sel: {
				ar: 0,
				ac: 0,
				r1: 0,
				c1: 0,
				r2: 0,
				c2: 0,
				fr: 0,
				fc: 0
			}, scrollX: 0, scrollY: 0, geomDirty: true, defColW: DEF_COLW, defRowH: DEF_ROWH
		};
	}

	function newWorkbook() {
		wb = {
			sheets: [],
			active: 0,
			styles: [{}],
			defFont: 'Calibri',
			defSz: 11
		};
		newStyleTable();
		wb.sheets.push(newSheet('Sheet1'));
		sh = wb.sheets[0];
	}
	let undoStack = [],
		redoStack = [],
		tx = null;

	function begin() {
		if(!tx) tx = {
			cells: [],
			props: [],
			struct: null,
			seen: new Set()
		};
		return tx;
	}

	function propsSnap(s) {
		return JSON.stringify({
			colW: s.colW,
			rowH: s.rowH,
			hidden: Array.from(s.hidden),
			merges: s.merges,
			freeze: s.freeze,
			filter: s.filter ? {
				r1: s.filter.r1,
				c1: s.filter.c1,
				r2: s.filter.r2,
				c2: s.filter.c2,
				cols: Object.keys(s.filter.cols).map((c) => [c, Array.from(s.filter.cols[c])])
			} : null,
			name: s.name,
			defColW: s.defColW,
			defRowH: s.defRowH
		});
	}

	function propsApply(s, js) {
		const o = JSON.parse(js);
		s.colW = o.colW;
		s.rowH = o.rowH;
		s.hidden = new Set(o.hidden);
		s.merges = o.merges;
		s.freeze = o.freeze;
		s.name = o.name;
		s.defColW = o.defColW;
		s.defRowH = o.defRowH;
		s.filter = o.filter ? {
			r1: o.filter.r1,
			c1: o.filter.c1,
			r2: o.filter.r2,
			c2: o.filter.c2,
			cols: {}
		} : null;
		if(s.filter) o.filter.cols.forEach((p) => {
			s.filter.cols[p[0]] = new Set(p[1]);
		});
		s.geomDirty = true;
	}

	function touchProps(s) {
		const t = begin();
		if(t.seen.has(s)) return;
		t.seen.add(s);
		t.props.push({
			s, before: propsSnap(s)
		});
	}

	function setCell(s, r, c, cell) { // cell: {v,f,s} | null
		const t = begin(),
			k = key(r, c);
		const old = s.cells.get(k) || null;
		if(old === cell) return;
		t.cells.push({
			s, k, old, cell
		});
		if(cell) {
			s.cells.set(k, cell);
			if(r > s.maxR) s.maxR = r;
			if(c > s.maxC) s.maxC = c;
		} else s.cells.delete(k);
	}
	const cellAt = (s, r, c) => s.cells.get(key(r, c)) || null;

	function patchCell(s, r, c, fn) { // copy-on-write edit of one cell
		const o = cellAt(s, r, c);
		const n = fn(o ? {
			v: o.v,
			f: o.f,
			s: o.s
		} : {
			v: null,
			f: null,
			s: 0
		});
		if(n && n.v === null && !n.f && !n.s) setCell(s, r, c, null);
		else setCell(s, r, c, n);
	}

	function end() {
		const t = tx;
		tx = null;
		if(!t) return;
		t.props.forEach((p) => {
			p.after = propsSnap(p.s);
		});
		t.props = t.props.filter((p) => p.before !== p.after);
		if(!t.cells.length && !t.props.length && !t.struct) return;
		undoStack.push(t);
		if(undoStack.length > 200) undoStack.shift();
		redoStack = [];
		markDirty();
		afterChange();
	}

	function run(fn) {
		begin();
		try {
			fn();
		} finally {
			end();
		}
	}

	function applyTx(t, back) {
		const cs = back ? t.cells.slice().reverse() : t.cells;
		cs.forEach((e) => {
			const v = back ? e.old : e.cell,
				r = keyR(e.k),
				c = keyC(e.k);
			if(v) {
				e.s.cells.set(e.k, v);
				if(r > e.s.maxR) e.s.maxR = r;
				if(c > e.s.maxC) e.s.maxC = c;
			} else e.s.cells.delete(e.k);
		});
		t.props.forEach((p) => propsApply(p.s, back ? p.before : p.after));
		if(t.struct) {
			wb.sheets = (back ? t.struct.before : t.struct.after).slice();
			wb.active = back ? t.struct.activeBefore : t.struct.activeAfter;
		}
		sh = wb.sheets[clamp(wb.active, 0, wb.sheets.length - 1)];
		wb.active = wb.sheets.indexOf(sh);
	}

	function undo() {
		if(editing) return;
		if(!undoStack.length) return;
		const t = undoStack.pop();
		applyTx(t, true);
		redoStack.push(t);
		markDirty();
		afterChange(true);
	}

	function redo() {
		if(editing) return;
		if(!redoStack.length) return;
		const t = redoStack.pop();
		applyTx(t, false);
		undoStack.push(t);
		markDirty();
		afterChange(true);
	}

	function markDirty() {
		dirty = true;
		setStatus('Unsaved changes', true);
	}

	function resetHistory() {
		undoStack = [];
		redoStack = [];
		tx = null;
	}
	/* ---------------- 3. calculation ---------------- */
	let epoch = 1;
	const host = {
		sheetByName: (n) => {
			const l = String(n).toLowerCase();
			return wb.sheets.find((s) => s.name.toLowerCase() === l) || null;
		},
		bounds: (s) => ({
			maxR: s.maxR,
			maxC: s.maxC
		}),
		value(s, r, c) {
			const cell = s.cells.get(key(r, c));
			if(!cell) return null;
			if(!cell.f) return cell.v === undefined ? null : cell.v;
			if(cell.ep === epoch) return cell.v;
			if(cell.busy) return ERR['#CIRC!'];
			cell.busy = true;
			let v;
			try {
				v = XE.evalFormula(cell.f, {
					host, sheet: s, r, c
				});
			} catch(e) {
				v = ERR['#VALUE!'];
			}
			cell.busy = false;
			if(v === ERR['#NAME?'] && cell.cached !== undefined) v = cell.cached;
			if(v === null || v === undefined) v = 0;
			cell.v = v;
			cell.ep = epoch;
			return v;
		}
	};

	function recalc() {
		epoch++;
		wb.sheets.forEach((s) => {
			s.cells.forEach((cell, k) => {
				if(cell.f) host.value(s, keyR(k), keyC(k));
			});
		});
	}

	function afterChange(full) {
		recalc();
		sh.geomDirty = true;
		if(full) {
			clampSel();
		}
		drawAll();
	}
	const hostValue = (r, c) => host.value(sh, r, c);
	/* typing: text -> cell */
	function parseInput(text, oldStyle) { // returns {v, f, nf?}
		if(text === '') return {
			v: null,
			f: null
		};
		if(text.charAt(0) === '=' && text.length > 1) return {
			v: 0,
			f: text.slice(1).replace(/_xlfn\./g, '')
		};
		if(text.charAt(0) === "'") return {
			v: text.slice(1),
			f: null
		};
		const t = text.trim();
		const nf = styleOf(oldStyle).nf;
		if(nf === '@') return {
			v: text,
			f: null
		};
		if(/^(true|false)$/i.test(t)) return {
			v: t.toUpperCase() === 'TRUE',
			f: null
		};
		let m;
		if((m = /^([-+]?[\d,]*\.?\d+(?:[eE][-+]?\d+)?)\s*%$/.exec(t)) && !isNaN(Number(m[1].replace(/,/g, '')))) return {
			v: Number(m[1].replace(/,/g, '')) / 100,
			f: null,
			nf: (!nf || nf === 'General') ? (/\./.test(m[1]) ? '0.00%' : '0%') : undefined
		};
		if((m = /^(-?)\$\s*(-?[\d,]*\.?\d+)$/.exec(t)) && !isNaN(Number(m[2].replace(/,/g, '')))) return {
			v: (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, '')),
			f: null,
			nf: (!nf || nf === 'General') ? '$#,##0.00' : undefined
		};
		if(/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return {
			v: Number(t),
			f: null
		};
		if(/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return {
			v: Number(t.replace(/,/g, '')),
			f: null
		};
		if(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}:\d{2}(:\d{2})?)$/.test(t)) {
			const d = XE.parseDate(t);
			if(d !== null) return {
				v: d,
				f: null,
				nf: (!nf || nf === 'General') ? (/:/.test(t) && !/[-/]/.test(t) ? 'h:mm' : (/-/.test(t) ? 'yyyy-mm-dd' : 'm/d/yyyy')) : undefined
			};
		}
		return {
			v: text,
			f: null
		};
	}

	function setInput(s, r, c, text) {
		const o = cellAt(s, r, c);
		const p = parseInput(text, o ? o.s : 0);
		let st = o ? o.s : 0;
		if(p.nf) st = withStyle(st, {
			nf: p.nf
		});
		if(p.v === null && !p.f && !st) setCell(s, r, c, null);
		else setCell(s, r, c, {
			v: p.v,
			f: p.f,
			s: st
		});
	}

	function editText(cell) { // what the editor shows for a cell
		if(!cell) return '';
		if(cell.f) return '=' + cell.f;
		const v = cell.v;
		if(v === null || v === undefined) return '';
		if(typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
		if(typeof v === 'number') {
			const nf = styleOf(cell.s).nf;
			if(nf && XE.isDateFormat(nf)) return XE.format(v, Number.isInteger(v) ? 'm/d/yyyy' : 'm/d/yyyy h:mm');
			if(nf && /%/.test(nf) && !/[#0]\.?[#0]*%.*;/.test(nf)) return XE.numToStr(Math.round(v * 1e10) / 1e10 * 100).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') + '%';
			return XE.numToStr(v);
		}
		if(isErr(v)) return v.code;
		return String(v);
	}

	function displayOf(cell) { // { text, color, kind } for drawing
		if(!cell) return null;
		const v = cell.v;
		if(v === null || v === undefined) return null;
		const st = styleOf(cell.s);
		let text = XE.format(v, st.nf || 'General');
		const col = typeof v === 'number' ? XE.formatColor(v, st.nf) : null;
		return {
			text, color: col, kind: isErr(v) ? 'err' : typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : 'str'
		};
	}
	/* ---------------- 4. geometry ---------------- */
	const colWOf = (s, c) => (s.colW[c] !== undefined ? s.colW[c] : s.defColW);
	const rowHOf = (s, r) => (s.hidden.has(r) ? 0 : (s.rowH[r] !== undefined ? s.rowH[r] : s.defRowH));

	function ensureGeom(s) {
		if(!s.geomDirty && s.colPos) return;
		s.nRows = clamp(Math.max(s.nRows, s.maxR + 31, s.sel.r2 + 15, 100), 1, MAXR);
		s.nCols = clamp(Math.max(s.nCols, s.maxC + 6, s.sel.c2 + 4, 26), 1, MAXC);
		const cp = new Float64Array(s.nCols + 1),
			rp = new Float64Array(s.nRows + 1);
		for(let c = 0; c < s.nCols; c++) cp[c + 1] = cp[c] + colWOf(s, c);
		for(let r = 0; r < s.nRows; r++) rp[r + 1] = rp[r] + rowHOf(s, r);
		s.colPos = cp;
		s.rowPos = rp;
		s.geomDirty = false;
	}

	function findIdx(pos, x) { // largest i with pos[i] <= x
		let lo = 0,
			hi = pos.length - 2;
		if(x <= 0) return 0;
		while(lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if(pos[mid] <= x) lo = mid;
			else hi = mid - 1;
		}
		return lo;
	}
	const view = $('xeView'),
		vbar = $('xeVBar'),
		hbar = $('xeHBar'),
		gridEl = $('xeGrid');
	let VW = 800,
		VH = 500,
		L = null; // L: layout of the current frame
	function layout() {
		const s = sh;
		VW = view.clientWidth;
		VH = view.clientHeight;
		ensureGeom(s);
		const fr = Math.min(s.freeze.r, s.nRows),
			fc = Math.min(s.freeze.c, s.nCols);
		const fw = s.colPos[fc],
			fh = s.rowPos[fr];
		const bodyX = HDR_W + fw,
			bodyY = HDR_H + fh;
		const bodyW = Math.max(40, VW - bodyX),
			bodyH = Math.max(40, VH - bodyY);
		let maxSX = Math.max(0, s.colPos[s.nCols] - fw - bodyW),
			maxSY = Math.max(0, s.rowPos[s.nRows] - fh - bodyH);
		if(s.scrollY > maxSY - 120 && s.nRows < MAXR) {
			s.nRows = Math.min(MAXR, s.nRows + 100);
			s.geomDirty = true;
			return layout();
		}
		if(s.scrollX > maxSX - 120 && s.nCols < MAXC) {
			s.nCols = Math.min(MAXC, s.nCols + 10);
			s.geomDirty = true;
			return layout();
		}
		s.scrollX = clamp(s.scrollX, 0, maxSX);
		s.scrollY = clamp(s.scrollY, 0, maxSY);
		const ox = fw + s.scrollX,
			oy = fh + s.scrollY;
		const c0 = findIdx(s.colPos, ox),
			c1 = Math.min(s.nCols - 1, findIdx(s.colPos, ox + bodyW) + 1);
		const r0 = findIdx(s.rowPos, oy),
			r1 = Math.min(s.nRows - 1, findIdx(s.rowPos, oy + bodyH) + 1);
		L = {
			fr, fc, fw, fh, bodyX, bodyY, bodyW, bodyH, ox, oy, c0, c1, r0, r1, maxSX, maxSY
		};
		return L;
	}
	const screenX = (cx) => (cx < sh.colPos[L.fc] ? cx + HDR_W : cx - L.ox + HDR_W + L.fw);
	const screenY = (cy) => (cy < sh.rowPos[L.fr] ? cy + HDR_H : cy - L.oy + HDR_H + L.fh);
	const contentX = (x) => (x < HDR_W + L.fw ? x - HDR_W : x - HDR_W - L.fw + L.ox);
	const contentY = (y) => (y < HDR_H + L.fh ? y - HDR_H : y - HDR_H - L.fh + L.oy);

	function mergeAt(s, r, c) {
		for(let i = 0; i < s.merges.length; i++) {
			const m = s.merges[i];
			if(r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2) return m;
		}
		return null;
	}

	function cellRect(r, c) { // in view coordinates
		const m = mergeAt(sh, r, c);
		const r1 = m ? m.r1 : r,
			c1 = m ? m.c1 : c,
			r2 = m ? m.r2 : r,
			c2 = m ? m.c2 : c;
		return {
			x: screenX(sh.colPos[c1]),
			y: screenY(sh.rowPos[r1]),
			w: sh.colPos[c2 + 1] - sh.colPos[c1],
			h: sh.rowPos[r2 + 1] - sh.rowPos[r1]
		};
	}

	function ensureVisible(r, c) {
		layout();
		const s = sh,
			m = mergeAt(s, r, c);
		const rr = m ? m.r1 : r,
			cc = m ? m.c1 : c;
		if(rr >= L.fr) {
			const top = s.rowPos[rr] - s.rowPos[L.fr],
				bot = s.rowPos[(m ? m.r2 : rr) + 1] - s.rowPos[L.fr];
			if(top < s.scrollY) s.scrollY = top;
			else if(bot > s.scrollY + L.bodyH) s.scrollY = bot - L.bodyH;
		}
		if(cc >= L.fc) {
			const left = s.colPos[cc] - s.colPos[L.fc],
				right = s.colPos[(m ? m.c2 : cc) + 1] - s.colPos[L.fc];
			if(left < s.scrollX) s.scrollX = left;
			else if(right > s.scrollX + L.bodyW) s.scrollX = right - L.bodyW;
		}
		scheduleDraw();
	}
	/* ---------------- 5. drawing the grid ---------------- */
	const paneNames = ['body', 'top', 'left', 'corner', 'colhR', 'colhL', 'rowhB', 'rowhT', 'cornerH'];
	const panes = {};
	paneNames.forEach((n) => {
		const d = document.createElement('div');
		d.className = 'xe-pane';
		view.appendChild(d);
		panes[n] = d;
	});
	const editBox = document.createElement('textarea');
	editBox.className = 'xe-edit';
	editBox.spellcheck = false;
	editBox.style.display = 'none';
	view.appendChild(editBox);
	let drawQueued = false;

	function scheduleDraw() {
		if(drawQueued) return;
		drawQueued = true;
		requestAnimationFrame(() => {
			drawQueued = false;
			drawGrid();
		});
	}
	const px = (n) => Math.round(n * 100) / 100;

	function fontOf(st) {
		return(st.i ? 'italic ' : '') + (st.b ? 'bold ' : '') + px((st.sz || wb.defSz) * 4 / 3) + "px '" + String(st.font || wb.defFont).replace(/['"\\]/g, '') + "', Calibri, Carlito, Arial, sans-serif";
	}

	function borderShadow(bd) {
		if(!bd) return '';
		const out = [];
		const one = (v, dx, dy) => {
			if(!v) return;
			const p = String(v).split(':');
			const w = p[1] ? +p[1] : 1;
			out.push('inset ' + (dx * w) + 'px ' + (dy * w) + 'px 0 ' + p[0]);
		};
		one(bd.r, -1, 0);
		one(bd.b, 0, -1);
		one(bd.l, 1, 0);
		one(bd.t, 0, 1);
		return out.join(',');
	}

	function fitNumberText(cell, disp, w, font) {
		const st = styleOf(cell.s);
		let t = disp.text;
		if(textWidth(t, font) <= w - 6) return t;
		if(!st.nf || st.nf === 'General') {
			for(let p = 9; p >= 1; p--) {
				t = String(+cell.v.toPrecision(p));
				if(Math.abs(cell.v) >= 1e11) t = cell.v.toExponential(Math.max(0, p - 1)).replace('e', 'E').replace('E+', 'E+');
				if(textWidth(t, font) <= w - 6) return t;
			}
		}
		return '#'.repeat(Math.max(1, Math.floor((w - 6) / Math.max(5, textWidth('#', font)))));
	}

	function cellHtml(r, c, cell, rect, spillMax) {
		const st = styleOf(cell ? cell.s : 0);
		const disp = displayOf(cell);
		let css = 'left:' + px(rect.x) + 'px;top:' + px(rect.y) + 'px;width:' + px(rect.w) + 'px;height:' + px(rect.h) + 'px;';
		const font = fontOf(st);
		css += 'font:' + font + ';';
		let color = (disp && disp.color) || st.color;
		if(color) {
			if(/^(red|black|blue|green|magenta|cyan|yellow|white)$/.test(color)) color = ({
				red: '#FF0000',
				black: '#000000',
				blue: '#0000FF',
				green: '#00B050',
				magenta: '#FF00FF',
				cyan: '#00FFFF',
				yellow: '#FFFF00',
				white: '#FFFFFF'
			})[color];
			css += 'color:' + color + ';';
		}
		if(st.bg) css += 'background:' + st.bg + ';';
		const deco = (st.u ? 'underline ' : '') + (st.st ? 'line-through' : '');
		if(deco) css += 'text-decoration:' + deco + ';';
		const bs = borderShadow(st.bd);
		if(bs) css += 'box-shadow:' + bs + ';';
		let al = st.al || (disp ? (disp.kind === 'num' ? 'right' : (disp.kind === 'str' ? 'left' : 'center')) : 'left');
		if(disp && disp.kind === 'str' && !st.al && cell.f && false) al = 'left';
		const va = st.va || 'bottom';
		css += 'justify-content:' + (al === 'center' ? 'center' : (al === 'right' ? 'flex-end' : 'flex-start')) + ';align-items:' + (va === 'top' ? 'flex-start' : (va === 'middle' ? 'center' : 'flex-end')) + ';';
		css += 'text-align:' + al + ';';
		let cls = 'xe-c' + (st.wrap ? ' is-wrap' : '');
		let inner = '';
		if(disp) {
			let text = disp.text;
			if(disp.kind === 'num') text = fitNumberText(cell, disp, rect.w, font);
			else if(!st.wrap && al === 'left' && spillMax > rect.w) {
				const need = textWidth(text, font) + 8;
				if(need > rect.w) {
					const w2 = Math.min(need, spillMax);
					css = css.replace(/width:[\d.]+px;/, 'width:' + px(w2) + 'px;');
				}
			}
			inner = '<span>' + esc(text) + '</span>';
		}
		return '<div class="' + cls + '" style="' + css + '">' + inner + '</div>';
	}

	function selRectHtml(cls, r1, c1, r2, c2, ox, oy, extra) {
		const x = sh.colPos[c1] - ox,
			y = sh.rowPos[r1] - oy,
			w = sh.colPos[c2 + 1] - sh.colPos[c1],
			h = sh.rowPos[r2 + 1] - sh.rowPos[r1];
		return '<div class="' + cls + '" style="left:' + px(x - (extra ? 1 : 0)) + 'px;top:' + px(y - (extra ? 1 : 0)) + 'px;width:' + px(w + (extra ? 1 : 0)) + 'px;height:' + px(h + (extra ? 1 : 0)) + 'px"></div>';
	}

	function drawCellsPane(el, p) {
		const s = sh;
		let html = '';
		// grid lines
		for(let r = p.r0; r <= p.r1; r++) {
			const h = s.rowPos[r + 1] - s.rowPos[r];
			if(h <= 0) continue;
			html += '<div class="xe-gl" style="left:0;top:' + px(s.rowPos[r + 1] - p.oy - 1) + 'px;width:' + px(p.w) + 'px;height:1px"></div>';
		}
		for(let c = p.c0; c <= p.c1; c++) {
			const w = s.colPos[c + 1] - s.colPos[c];
			if(w <= 0) continue;
			html += '<div class="xe-gl" style="top:0;left:' + px(s.colPos[c + 1] - p.ox - 1) + 'px;height:' + px(p.h) + 'px;width:1px"></div>';
		}
		// merges
		const covered = new Set(),
			masters = [];
		s.merges.forEach((m) => {
			if(m.r2 < p.r0 || m.r1 > p.r1 || m.c2 < p.c0 || m.c1 > p.c1) return;
			masters.push(m);
			for(let r = Math.max(m.r1, p.r0); r <= Math.min(m.r2, p.r1); r++)
				for(let c = Math.max(m.c1, p.c0); c <= Math.min(m.c2, p.c1); c++)
					if(r !== m.r1 || c !== m.c1) covered.add(key(r, c));
		});
		for(let r = p.r0; r <= p.r1; r++) {
			if(s.rowPos[r + 1] - s.rowPos[r] <= 0) continue;
			for(let c = p.c0; c <= p.c1; c++) {
				const k = key(r, c);
				const cell = s.cells.get(k);
				if(!cell || covered.has(k)) continue;
				if(!cell.s && (cell.v === null || cell.v === undefined)) continue;
				if(s.colPos[c + 1] - s.colPos[c] <= 0) continue;
				if(masters.some((mm) => mm.r1 === r && mm.c1 === c)) continue; // drawn below
				const m = null;
				const w = s.colPos[c + 1] - s.colPos[c],
					h = s.rowPos[r + 1] - s.rowPos[r];
				let spill = w;
				if(!m) {
					let c2 = c + 1;
					while(c2 < s.nCols && spill < 1500) {
						const nx = s.cells.get(key(r, c2));
						if((nx && (nx.v !== null && nx.v !== undefined)) || covered.has(key(r, c2))) break;
						spill += s.colPos[c2 + 1] - s.colPos[c2];
						c2++;
					}
				}
				html += cellHtml(r, c, cell, {
					x: s.colPos[c] - p.ox,
					y: s.rowPos[r] - p.oy,
					w,
					h
				}, spill);
			}
		}
		masters.forEach((m) => {
			const cell = s.cells.get(key(m.r1, m.c1));
			if(!cell || (!cell.s && (cell.v === null || cell.v === undefined))) return;
			if((p.oy > 0 && m.r1 < L.fr) || (p.ox > 0 && m.c1 < L.fc)) return; // belongs to the frozen pane
			const x = s.colPos[m.c1] - p.ox,
				y = s.rowPos[m.r1] - p.oy;
			const w = Math.min(s.colPos[m.c2 + 1] - s.colPos[m.c1], p.w - x),
				h = Math.min(s.rowPos[m.r2 + 1] - s.rowPos[m.r1], p.h - y);
			if(w <= 0 || h <= 0) return;
			html += cellHtml(m.r1, m.c1, cell, {
				x, y, w, h
			}, w);
		});
		// filter arrows
		if(s.filter) {
			const f = s.filter;
			for(let c = f.c1; c <= f.c2; c++) {
				if(f.r1 < p.r0 || f.r1 > p.r1 || c < p.c0 || c > p.c1) continue;
				const x = s.colPos[c + 1] - p.ox - 18,
					y = s.rowPos[f.r1 + 1] - p.oy - 18;
				html += '<div class="xe-fb' + (f.cols[c] ? ' is-on' : '') + '" style="left:' + px(x) + 'px;top:' + px(y) + 'px">▾</div>';
			}
		}
		// find hit
		if(findHit && findHit.s === s && findHit.r >= p.r0 && findHit.r <= p.r1 && findHit.c >= p.c0 && findHit.c <= p.c1) html += selRectHtml('xe-find-hit', findHit.r, findHit.c, findHit.r, findHit.c, p.ox, p.oy);
		// selection
		const g = s.sel;
		const mm = mergeAt(s, g.ar, g.ac);
		const multi = g.r1 !== g.r2 || g.c1 !== g.c2;
		if(multi && !(mm && mm.r1 === g.r1 && mm.c1 === g.c1 && mm.r2 === g.r2 && mm.c2 === g.c2)) html += selRectHtml('xe-sel', g.r1, g.c1, g.r2, g.c2, p.ox, p.oy);
		if(!editing) html += selRectHtml('xe-act', mm ? mm.r1 : g.ar, mm ? mm.c1 : g.ac, mm ? mm.r2 : g.ar, mm ? mm.c2 : g.ac, p.ox, p.oy, true);
		if(!editing && g.r2 >= p.r0 - 1 && g.r2 <= p.r1 + 1 && g.c2 >= p.c0 - 1 && g.c2 <= p.c1 + 1) {
			const hx = s.colPos[g.c2 + 1] - p.ox - 4,
				hy = s.rowPos[g.r2 + 1] - p.oy - 4;
			html += '<div class="xe-handle" style="left:' + px(hx) + 'px;top:' + px(hy) + 'px"></div>';
		}
		el.innerHTML = html;
	}

	function setRect(el, x, y, w, h) {
		el.style.left = x + 'px';
		el.style.top = y + 'px';
		el.style.width = Math.max(0, w) + 'px';
		el.style.height = Math.max(0, h) + 'px';
	}

	function drawHeader(el, p) {
		const s = sh,
			g = s.sel;
		const wholeRows = g.c1 === 0 && g.c2 >= s.nCols - 1,
			wholeCols = g.r1 === 0 && g.r2 >= s.nRows - 1;
		let html = '';
		if(p.kind === 'col') {
			for(let c = p.c0; c <= p.c1; c++) {
				const w = s.colPos[c + 1] - s.colPos[c];
				if(w <= 0) continue;
				const on = c >= g.c1 && c <= g.c2;
				html += '<div class="xe-hd' + (on ? ' is-sel' : '') + (on && wholeCols ? ' is-all' : '') + '" style="left:' + px(s.colPos[c] - p.ox) + 'px;top:0;width:' + px(w) + 'px;height:' + HDR_H + 'px">' + XE.colName(c) + '</div>';
			}
		} else {
			for(let r = p.r0; r <= p.r1; r++) {
				const h = s.rowPos[r + 1] - s.rowPos[r];
				if(h <= 0) continue;
				const on = r >= g.r1 && r <= g.r2;
				html += '<div class="xe-hd' + (on ? ' is-sel' : '') + (on && wholeRows ? ' is-all' : '') + '" style="top:' + px(s.rowPos[r] - p.oy) + 'px;left:0;height:' + px(h) + 'px;width:' + HDR_W + 'px">' + (r + 1) + '</div>';
			}
		}
		el.innerHTML = html;
	}

	function drawGrid() {
		if(!sh) return;
		layout();
		const s = sh,
			l = L;
		// scrollbars
		$('xeVSizer').style.height = Math.round(s.rowPos[s.nRows] - l.fh + HDR_H + l.fh) + 'px';
		$('xeHSizer').style.width = Math.round(s.colPos[s.nCols] - l.fw + HDR_W + l.fw) + 'px';
		syncingBars = true;
		if(Math.abs(vbar.scrollTop - s.scrollY) > 1) vbar.scrollTop = s.scrollY;
		if(Math.abs(hbar.scrollLeft - s.scrollX) > 1) hbar.scrollLeft = s.scrollX;
		syncingBars = false;
		const cellsPane = (name, x, y, w, h, ox, oy, r0, r1, c0, c1) => {
			const el = panes[name];
			if(w <= 0 || h <= 0 || r1 < r0 || c1 < c0) {
				el.style.display = 'none';
				el.innerHTML = '';
				return;
			}
			el.style.display = '';
			setRect(el, x, y, w, h);
			drawCellsPane(el, {
				x, y, w, h, ox, oy, r0, r1, c0, c1
			});
		};
		cellsPane('body', l.bodyX, l.bodyY, l.bodyW, l.bodyH, l.ox, l.oy, l.r0, l.r1, l.c0, l.c1);
		cellsPane('top', l.bodyX, HDR_H, l.bodyW, l.fh, l.ox, 0, 0, l.fr - 1, l.c0, l.c1);
		cellsPane('left', HDR_W, l.bodyY, l.fw, l.bodyH, 0, l.oy, l.r0, l.r1, 0, l.fc - 1);
		cellsPane('corner', HDR_W, HDR_H, l.fw, l.fh, 0, 0, 0, l.fr - 1, 0, l.fc - 1);
		const hdr = (name, x, y, w, h, p) => {
			const el = panes[name];
			if(w <= 0 || h <= 0) {
				el.style.display = 'none';
				return;
			}
			el.style.display = '';
			setRect(el, x, y, w, h);
			drawHeader(el, p);
		};
		hdr('colhR', l.bodyX, 0, l.bodyW, HDR_H, {
			kind: 'col',
			ox: l.ox,
			c0: l.c0,
			c1: l.c1
		});
		hdr('colhL', HDR_W, 0, l.fw, HDR_H, {
			kind: 'col',
			ox: 0,
			c0: 0,
			c1: l.fc - 1
		});
		hdr('rowhB', 0, l.bodyY, HDR_W, l.bodyH, {
			kind: 'row',
			oy: l.oy,
			r0: l.r0,
			r1: l.r1
		});
		hdr('rowhT', 0, HDR_H, HDR_W, l.fh, {
			kind: 'row',
			oy: 0,
			r0: 0,
			r1: l.fr - 1
		});
		const ch = panes.cornerH;
		setRect(ch, 0, 0, HDR_W, HDR_H);
		ch.innerHTML = '<div class="xe-corner" style="left:0;top:0;width:' + HDR_W + 'px;height:' + HDR_H + 'px"></div>';
		if(editing) placeEditor();
		updateBars();
	}
	let syncingBars = false;
	vbar.addEventListener('scroll', () => {
		if(syncingBars) return;
		sh.scrollY = vbar.scrollTop;
		scheduleDraw();
	});
	hbar.addEventListener('scroll', () => {
		if(syncingBars) return;
		sh.scrollX = hbar.scrollLeft;
		scheduleDraw();
	});
	view.addEventListener('wheel', (e) => {
		e.preventDefault();
		const k = e.deltaMode === 1 ? 20 : 1;
		if(e.shiftKey) sh.scrollX += (e.deltaY || e.deltaX) * k;
		else {
			sh.scrollY += e.deltaY * k;
			sh.scrollX += e.deltaX * k;
		}
		sh.scrollX = Math.max(0, sh.scrollX);
		sh.scrollY = Math.max(0, sh.scrollY);
		scheduleDraw();
	}, {
		passive: false
	});
	window.addEventListener('resize', scheduleDraw);
	let findHit = null;
	/* ---------------- 6. selecting and editing ---------------- */
	let editing = null; // { r, c, mode: 'enter' | 'edit' | 'bar' }
	const fxInput = $('xeFxInput'),
		nameBox = $('xeNameBox');

	function normSel(s) {
		const g = s.sel;
		g.r1 = Math.min(g.ar, g.fr);
		g.r2 = Math.max(g.ar, g.fr);
		g.c1 = Math.min(g.ac, g.fc);
		g.c2 = Math.max(g.ac, g.fc);
		let changed = true;
		while(changed) { // a selection always covers whole merged blocks
			changed = false;
			s.merges.forEach((m) => {
				if(m.r2 < g.r1 || m.r1 > g.r2 || m.c2 < g.c1 || m.c1 > g.c2) return;
				if(m.r1 < g.r1) {
					g.r1 = m.r1;
					changed = true;
				}
				if(m.r2 > g.r2) {
					g.r2 = m.r2;
					changed = true;
				}
				if(m.c1 < g.c1) {
					g.c1 = m.c1;
					changed = true;
				}
				if(m.c2 > g.c2) {
					g.c2 = m.c2;
					changed = true;
				}
			});
		}
	}

	function setSel(ar, ac, fr, fc) {
		const g = sh.sel;
		g.ar = clamp(ar, 0, MAXR - 1);
		g.ac = clamp(ac, 0, MAXC - 1);
		g.fr = clamp(fr === undefined ? ar : fr, 0, MAXR - 1);
		g.fc = clamp(fc === undefined ? ac : fc, 0, MAXC - 1);
		normSel(sh);
		sh.geomDirty = true;
		scheduleDraw();
	}

	function clampSel() {
		const g = sh.sel;
		setSel(Math.min(g.ar, MAXR - 1), Math.min(g.ac, MAXC - 1), Math.min(g.fr, MAXR - 1), Math.min(g.fc, MAXC - 1));
	}

	function activeCell() {
		return cellAt(sh, sh.sel.ar, sh.sel.ac);
	}

	function hitTest(e) {
		const rc = view.getBoundingClientRect();
		const x = e.clientX - rc.left,
			y = e.clientY - rc.top;
		layout();
		const s = sh;
		if(x < 0 || y < 0 || x > VW || y > VH) return {
			zone: 'out',
			x,
			y
		};
		if(x < HDR_W && y < HDR_H) return {
			zone: 'corner',
			x,
			y
		};
		if(y < HDR_H) {
			const c = findIdx(s.colPos, contentX(x));
			let edge = -1;
			if(Math.abs(screenX(s.colPos[c + 1]) - x) <= 4) edge = c;
			else if(c > 0 && Math.abs(screenX(s.colPos[c]) - x) <= 4) edge = c - 1;
			return {
				zone: 'colh',
				c,
				edge,
				x,
				y
			};
		}
		if(x < HDR_W) {
			const r = findIdx(s.rowPos, contentY(y));
			let edge = -1;
			if(Math.abs(screenY(s.rowPos[r + 1]) - y) <= 4) edge = r;
			else if(r > 0 && Math.abs(screenY(s.rowPos[r]) - y) <= 4) edge = r - 1;
			return {
				zone: 'rowh',
				r,
				edge,
				x,
				y
			};
		}
		const r = findIdx(s.rowPos, contentY(y)),
			c = findIdx(s.colPos, contentX(x));
		const g = s.sel;
		const hr = cellRect(g.r2, g.c2);
		if(!editing && Math.abs(hr.x + hr.w - x) <= 6 && Math.abs(hr.y + hr.h - y) <= 6) return {
			zone: 'handle',
			r,
			c,
			x,
			y
		};
		if(s.filter && r === s.filter.r1 && c >= s.filter.c1 && c <= s.filter.c2) {
			const cr = cellRect(r, c);
			if(x >= cr.x + cr.w - 20 && y >= cr.y + cr.h - 20) return {
				zone: 'filter',
				r,
				c,
				x,
				y,
				rect: cr
			};
		}
		return {
			zone: 'cell',
			r,
			c,
			x,
			y
		};
	}
	let drag = null,
		lastPtr = null,
		scrollRaf = 0;

	function autoScrollLoop() {
		scrollRaf = 0;
		if(!drag || !lastPtr || (drag.type !== 'select' && drag.type !== 'selCols' && drag.type !== 'selRows' && drag.type !== 'fill')) return;
		const rc = view.getBoundingClientRect();
		let dx = 0,
			dy = 0;
		if(lastPtr.x > rc.right - 20) dx = Math.min(40, (lastPtr.x - rc.right + 40) / 2);
		else if(lastPtr.x < rc.left + HDR_W + 10) dx = -20;
		if(lastPtr.y > rc.bottom - 20) dy = Math.min(40, (lastPtr.y - rc.bottom + 40) / 2);
		else if(lastPtr.y < rc.top + HDR_H + 10) dy = -20;
		if(dx || dy) {
			sh.scrollX = Math.max(0, sh.scrollX + dx);
			sh.scrollY = Math.max(0, sh.scrollY + dy);
			dragMove(lastPtr);
			scheduleDraw();
			scrollRaf = requestAnimationFrame(autoScrollLoop);
		}
	}

	function canInsertRef() {
		if(!editing) return false;
		const t = editBoxText(),
			p = editCaret();
		if(t.charAt(0) !== '=') return false;
		const before = t.slice(0, p).replace(/\s+$/, '');
		return before === '=' || /[=(+\-*\/^&,;<>:]$/.test(before);
	}
	const editBoxText = () => (editing && editing.mode === 'bar' ? fxInput.value : editBox.value);
	const editCaret = () => (editing && editing.mode === 'bar' ? fxInput.selectionStart : editBox.selectionStart);

	function insertRefText(text, replaceLen) {
		const el = editing.mode === 'bar' ? fxInput : editBox;
		const p = el.selectionStart;
		el.value = el.value.slice(0, p - replaceLen) + text + el.value.slice(p);
		const np = p - replaceLen + text.length;
		el.setSelectionRange(np, np);
		syncEditors(el);
	}

	function syncEditors(src) {
		if(src === editBox) fxInput.value = editBox.value;
		else if(editing && editing.mode !== 'bar') editBox.value = fxInput.value;
		placeEditor();
	}
	view.addEventListener('pointerdown', (e) => {
		if(e.pointerType === 'mouse' && e.button !== 0) return;
		hideMenu();
		const h = hitTest(e);
		if(h.zone === 'out') return;
		gridEl.focus({
			preventScroll: true
		});
		if(editing && h.zone === 'cell' && canInsertRef()) { // pointing at a cell while typing a formula
			e.preventDefault();
			const t = XE.addr(h.r, h.c);
			insertRefText(t, 0);
			drag = {
				type: 'ref',
				r0: h.r,
				c0: h.c,
				len: t.length
			};
			view.setPointerCapture(e.pointerId);
			return;
		}
		if(editing) commitEdit(0, 0, true);
		lastPtr = {
			x: e.clientX,
			y: e.clientY
		};
		if(e.pointerType === 'touch' && h.zone === 'cell') {
			drag = {
				type: 'pan',
				x0: e.clientX,
				y0: e.clientY,
				sx: sh.scrollX,
				sy: sh.scrollY,
				moved: false,
				r: h.r,
				c: h.c
			};
			view.setPointerCapture(e.pointerId);
			return;
		}
		if(h.zone === 'corner') {
			sh.sel.ar = 0;
			sh.sel.ac = 0;
			setSel(0, 0, MAXR - 1, MAXC - 1);
			return;
		}
		if(h.zone === 'colh') {
			if(h.edge >= 0) {
				drag = {
					type: 'resizeCol',
					c: h.edge,
					x0: e.clientX,
					w0: colWOf(sh, h.edge),
					multi: h.edge >= sh.sel.c1 && h.edge <= sh.sel.c2 && sh.sel.c1 !== sh.sel.c2 ? [sh.sel.c1, sh.sel.c2] : null
				};
				touchProps(sh);
			} else {
				drag = {
					type: 'selCols',
					c0: h.c
				};
				setSel(0, e.shiftKey ? sh.sel.ac : h.c, MAXR - 1, h.c);
			}
			view.setPointerCapture(e.pointerId);
			document.body.classList.add('xe-dragging');
			return;
		}
		if(h.zone === 'rowh') {
			if(h.edge >= 0) {
				drag = {
					type: 'resizeRow',
					r: h.edge,
					y0: e.clientY,
					h0: rowHOf(sh, h.edge) || sh.defRowH,
					multi: h.edge >= sh.sel.r1 && h.edge <= sh.sel.r2 && sh.sel.r1 !== sh.sel.r2 ? [sh.sel.r1, sh.sel.r2] : null
				};
				touchProps(sh);
			} else {
				drag = {
					type: 'selRows',
					r0: h.r
				};
				setSel(e.shiftKey ? sh.sel.ar : h.r, 0, h.r, MAXC - 1);
			}
			view.setPointerCapture(e.pointerId);
			document.body.classList.add('xe-dragging');
			return;
		}
		if(h.zone === 'filter') {
			openFilterMenu(h.c, h.rect);
			return;
		}
		if(h.zone === 'handle') {
			drag = {
				type: 'fill',
				src: {
					r1: sh.sel.r1,
					c1: sh.sel.c1,
					r2: sh.sel.r2,
					c2: sh.sel.c2
				},
				dest: null
			};
			view.setPointerCapture(e.pointerId);
			document.body.classList.add('xe-dragging');
			return;
		}
		// plain cell
		if(e.shiftKey) setSel(sh.sel.ar, sh.sel.ac, h.r, h.c);
		else setSel(h.r, h.c);
		drag = {
			type: 'select'
		};
		view.setPointerCapture(e.pointerId);
		document.body.classList.add('xe-dragging');
	});

	function dragMove(p) {
		const rc = view.getBoundingClientRect();
		const fake = {
			clientX: p.x,
			clientY: p.y
		};
		const x = p.x - rc.left,
			y = p.y - rc.top;
		layout();
		const cx = x < HDR_W ? 0 : (x < HDR_W + L.fw ? x - HDR_W : contentX(x)),
			cy = y < HDR_H ? 0 : contentY(y);
		const c = clamp(findIdx(sh.colPos, x < HDR_W ? 0 : contentX(Math.max(HDR_W, x))), 0, sh.nCols - 1);
		const r = clamp(findIdx(sh.rowPos, y < HDR_H ? 0 : contentY(Math.max(HDR_H, y))), 0, sh.nRows - 1);
		if(drag.type === 'select') setSel(sh.sel.ar, sh.sel.ac, r, c);
		else if(drag.type === 'selCols') setSel(0, drag.c0, MAXR - 1, c);
		else if(drag.type === 'selRows') setSel(drag.r0, 0, r, MAXC - 1);
		else if(drag.type === 'ref') {
			const t = drag.r0 === r && drag.c0 === c ? XE.addr(r, c) : XE.addr(Math.min(drag.r0, r), Math.min(drag.c0, c)) + ':' + XE.addr(Math.max(drag.r0, r), Math.max(drag.c0, c));
			insertRefText(t, drag.len);
			drag.len = t.length;
		} else if(drag.type === 'resizeCol') {
			const w = Math.max(0, Math.round(drag.w0 + (p.x - drag.x0)));
			if(drag.multi)
				for(let k = drag.multi[0]; k <= drag.multi[1]; k++) sh.colW[k] = w;
			else sh.colW[drag.c] = w;
			sh.geomDirty = true;
			scheduleDraw();
		} else if(drag.type === 'resizeRow') {
			const hh = Math.max(0, Math.round(drag.h0 + (p.y - drag.y0)));
			if(drag.multi)
				for(let k = drag.multi[0]; k <= drag.multi[1]; k++) {
					sh.rowH[k] = hh;
					if(sh.rowManual) sh.rowManual.add(k);
				} else {
					sh.rowH[drag.r] = hh;
					if(sh.rowManual) sh.rowManual.add(drag.r);
				}
			sh.rowManual = sh.rowManual || new Set([drag.r]);
			sh.geomDirty = true;
			scheduleDraw();
		} else if(drag.type === 'fill') {
			const s = drag.src;
			const dr = r > s.r2 ? r - s.r2 : (r < s.r1 ? r - s.r1 : 0),
				dc = c > s.c2 ? c - s.c2 : (c < s.c1 ? c - s.c1 : 0);
			if(Math.abs(dr) >= Math.abs(dc) && dr !== 0 || dc === 0) drag.dest = dr > 0 ? {
				r1: s.r2 + 1,
				r2: r,
				c1: s.c1,
				c2: s.c2,
				dir: 'down'
			} : (dr < 0 ? {
				r1: r,
				r2: s.r1 - 1,
				c1: s.c1,
				c2: s.c2,
				dir: 'up'
			} : null);
			else drag.dest = dc > 0 ? {
				r1: s.r1,
				r2: s.r2,
				c1: s.c2 + 1,
				c2: c,
				dir: 'right'
			} : {
				r1: s.r1,
				r2: s.r2,
				c1: c,
				c2: s.c1 - 1,
				dir: 'left'
			};
			const g = sh.sel;
			if(drag.dest) {
				g.r1 = Math.min(s.r1, drag.dest.r1);
				g.r2 = Math.max(s.r2, drag.dest.r2);
				g.c1 = Math.min(s.c1, drag.dest.c1);
				g.c2 = Math.max(s.c2, drag.dest.c2);
			} else {
				g.r1 = s.r1;
				g.r2 = s.r2;
				g.c1 = s.c1;
				g.c2 = s.c2;
			}
			scheduleDraw();
		}
	}
	view.addEventListener('pointermove', (e) => {
		if(!drag) {
			if(e.pointerType !== 'mouse') return;
			const h = hitTest(e);
			view.style.cursor = h.zone === 'colh' && h.edge >= 0 ? 'col-resize' : (h.zone === 'rowh' && h.edge >= 0 ? 'row-resize' : (h.zone === 'handle' ? 'crosshair' : (h.zone === 'filter' ? 'pointer' : 'cell')));
			return;
		}
		lastPtr = {
			x: e.clientX,
			y: e.clientY
		};
		if(drag.type === 'pan') {
			const dx = e.clientX - drag.x0,
				dy = e.clientY - drag.y0;
			if(!drag.moved && Math.hypot(dx, dy) < 6) return;
			drag.moved = true;
			sh.scrollX = Math.max(0, drag.sx - dx);
			sh.scrollY = Math.max(0, drag.sy - dy);
			scheduleDraw();
			return;
		}
		dragMove(lastPtr);
		if(!scrollRaf) scrollRaf = requestAnimationFrame(autoScrollLoop);
	});

	function endDrag() {
		if(!drag) return;
		const d = drag;
		drag = null;
		document.body.classList.remove('xe-dragging');
		if(d.type === 'pan') {
			if(!d.moved) {
				setSel(d.r, d.c);
				const now = Date.now();
				if(now - lastTap < 350 && lastTapKey === key(d.r, d.c)) startEdit('edit');
				lastTap = now;
				lastTapKey = key(d.r, d.c);
			}
			return;
		}
		if(d.type === 'resizeCol' || d.type === 'resizeRow') {
			sh.geomDirty = true;
			end();
			drawAll();
			return;
		}
		if(d.type === 'fill') {
			if(d.dest) doFill(d.src, d.dest);
			else setSel(d.src.r1, d.src.c1, d.src.r2, d.src.c2);
			return;
		}
		if(d.type === 'ref') {
			const el = editing && editing.mode === 'bar' ? fxInput : editBox;
			el.focus();
			return;
		}
	}
	let lastTap = 0,
		lastTapKey = -1;
	view.addEventListener('pointerup', endDrag);
	view.addEventListener('pointercancel', endDrag);
	view.addEventListener('dblclick', (e) => {
		const h = hitTest(e);
		if(h.zone === 'colh' && h.edge >= 0) autoFitCol(h.edge);
		else if(h.zone === 'rowh' && h.edge >= 0) autoFitRow(h.edge, true);
		else if(h.zone === 'cell') {
			setSel(h.r, h.c);
			startEdit('edit');
		}
	});
	view.addEventListener('contextmenu', (e) => {
		e.preventDefault();
		const h = hitTest(e);
		if(h.zone === 'out') return;
		const g = sh.sel;
		if(h.zone === 'cell' && !(h.r >= g.r1 && h.r <= g.r2 && h.c >= g.c1 && h.c <= g.c2)) setSel(h.r, h.c);
		if(h.zone === 'colh' && !(h.c >= g.c1 && h.c <= g.c2)) setSel(0, h.c, MAXR - 1, h.c);
		if(h.zone === 'rowh' && !(h.r >= g.r1 && h.r <= g.r2)) setSel(h.r, 0, h.r, MAXC - 1);
		showMenu(e.clientX, e.clientY, [
			['Insert row above', 'rowAbove'],
			['Insert row below', 'rowBelow'],
			['Insert column left', 'colLeft'],
			['Insert column right', 'colRight'], '-', ['Delete row', 'rowDel'],
			['Delete column', 'colDel'], '-', ['Clear contents', 'clear'],
			['Clear formatting', 'clearFmt'], '-', ['Merge / unmerge cells', 'merge'],
			['Freeze panes here', 'freeze']
		]);
	});
	/* ---- the cell editor ---- */
	function startEdit(mode, initial) {
		if(editing) return;
		const g = sh.sel;
		const m = mergeAt(sh, g.ar, g.ac);
		const r = m ? m.r1 : g.ar,
			c = m ? m.c1 : g.ac;
		ensureVisible(r, c);
		editing = {
			r, c, mode, orig: editText(cellAt(sh, r, c))
		};
		const txt = initial !== undefined ? initial : editing.orig;
		editBox.value = txt;
		fxInput.value = txt;
		editBox.style.display = '';
		layout();
		placeEditor();
		editBox.focus();
		editBox.setSelectionRange(txt.length, txt.length);
		drawGrid();
	}

	function placeEditor() {
		if(!editing || editing.mode === 'bar') {
			editBox.style.display = 'none';
			return;
		}
		layout();
		const st = styleOf((cellAt(sh, editing.r, editing.c) || {}).s || 0);
		const rc = cellRect(editing.r, editing.c);
		const font = fontOf(st);
		editBox.style.font = font;
		editBox.classList.toggle('is-wrap', !!st.wrap);
		const lines = editBox.value.split('\n');
		const tw = Math.max.apply(null, lines.map((l) => textWidth(l, font))) + 22;
		const w = st.wrap ? rc.w : Math.min(Math.max(rc.w, tw), Math.max(rc.w, VW - rc.x - 4));
		const h = Math.max(rc.h, lines.length * (parseFloat(font.match(/([\d.]+)px/)[1]) * 1.3) + 4);
		editBox.style.left = rc.x + 'px';
		editBox.style.top = rc.y + 'px';
		editBox.style.width = w + 'px';
		editBox.style.height = h + 'px';
		editBox.style.textAlign = st.al || '';
		editBox.style.color = st.color || '';
	}
	editBox.addEventListener('input', () => {
		fxInput.value = editBox.value;
		placeEditor();
	});
	editBox.addEventListener('keydown', (e) => {
		if(!editing) return;
		if(e.key === 'Enter' && !e.altKey) {
			e.preventDefault();
			commitEdit(e.shiftKey ? -1 : 1, 0);
		} else if(e.key === 'Enter' && e.altKey) {
			e.preventDefault();
			const p = editBox.selectionStart;
			editBox.value = editBox.value.slice(0, p) + '\n' + editBox.value.slice(editBox.selectionEnd);
			editBox.setSelectionRange(p + 1, p + 1);
			fxInput.value = editBox.value;
			placeEditor();
		} else if(e.key === 'Tab') {
			e.preventDefault();
			commitEdit(0, e.shiftKey ? -1 : 1);
		} else if(e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		} else if(editing.mode === 'enter' && /^Arrow(Up|Down|Left|Right)$/.test(e.key) && editBox.value.charAt(0) !== '=') {
			e.preventDefault();
			commitEdit(e.key === 'ArrowDown' ? 1 : (e.key === 'ArrowUp' ? -1 : 0), e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowLeft' ? -1 : 0));
		} else if(e.key === 'F4') {
			e.preventDefault();
			cycleAbsolute(editBox);
		}
		e.stopPropagation();
	});

	function cycleAbsolute(el) { // F4 turns the reference at the caret into $A$1, A$1, $A1, A1
		const t = el.value,
			p = el.selectionStart;
		const re = /\$?[A-Za-z]{1,3}\$?\d+/g;
		let m;
		while((m = re.exec(t)))
			if(p >= m.index && p <= m.index + m[0].length) {
				const c = XE.parseCell(m[0]);
				const st = (c.ar ? 1 : 0) + (c.ac ? 2 : 0);
				const next = [
					[true, true],
					[true, false],
					[false, true],
					[false, false]
				][(st === 3 ? 0 : st === 1 ? 1 : st === 0 ? 2 : 3)];
				// cycle: A1 -> $A$1 -> A$1 -> $A1 -> A1
				const order = [
					[false, false],
					[true, true],
					[true, false],
					[false, true]
				];
				const idx = order.findIndex((o) => o[0] === c.ar && o[1] === c.ac);
				const n = order[(idx + 1) % 4];
				const s2 = XE.cellStr(c.r, c.c, n[0], n[1]);
				el.value = t.slice(0, m.index) + s2 + t.slice(m.index + m[0].length);
				el.setSelectionRange(m.index + s2.length, m.index + s2.length);
				syncEditors(el);
				return;
			}
	}

	function commitEdit(dr, dc, keepSel) {
		if(!editing) return;
		const e = editing,
			text = editBoxText();
		editing = null;
		editBox.style.display = 'none';
		if(text !== e.orig) {
			run(() => {
				setInput(sh, e.r, e.c, text);
				const c = cellAt(sh, e.r, e.c);
				if(c && styleOf(c.s).wrap) autoFitRow(e.r, false);
			});
		}
		gridEl.focus({
			preventScroll: true
		});
		if(!keepSel && (dr || dc)) moveActive(dr, dc, false, false, true);
		else {
			drawAll();
		}
	}

	function cancelEdit() {
		editing = null;
		editBox.style.display = 'none';
		gridEl.focus({
			preventScroll: true
		});
		drawAll();
	}
	fxInput.addEventListener('focus', () => {
		if(!editing) {
			const g = sh.sel;
			editing = {
				r: g.ar,
				c: g.ac,
				mode: 'bar',
				orig: editText(activeCell())
			};
			editBox.style.display = 'none';
			drawGrid();
		}
	});
	fxInput.addEventListener('input', () => {
		if(editing && editing.mode !== 'bar') {
			editBox.value = fxInput.value;
			placeEditor();
		}
	});
	fxInput.addEventListener('keydown', (e) => {
		if(e.key === 'Enter') {
			e.preventDefault();
			if(editing) commitEdit(1, 0);
			else gridEl.focus();
		} else if(e.key === 'Escape') {
			e.preventDefault();
			if(editing) cancelEdit();
		} else if(e.key === 'Tab') {
			e.preventDefault();
			if(editing) commitEdit(0, 1);
		} else if(e.key === 'F4') {
			e.preventDefault();
			cycleAbsolute(fxInput);
		}
		e.stopPropagation();
	});
	fxInput.addEventListener('blur', () => {
		if(editing && editing.mode === 'bar') {
			setTimeout(() => {
				if(editing && editing.mode === 'bar' && document.activeElement !== fxInput) commitEdit(0, 0, true);
			}, 0);
		}
	});
	nameBox.addEventListener('keydown', (e) => {
		if(e.key === 'Enter') {
			e.preventDefault();
			const t = nameBox.value.trim().replace(/\$/g, '');
			let r = XE.parseRange(t);
			if(!r) {
				const m = /^([A-Za-z]{1,3}):([A-Za-z]{1,3})$/.exec(t);
				if(m) r = {
					r1: 0,
					c1: XE.colIdx(m[1]),
					r2: MAXR - 1,
					c2: XE.colIdx(m[2])
				};
			}
			if(!r) {
				showError('"' + nameBox.value + '" is not a valid cell or range.');
				return;
			}
			clearError();
			setSel(r.r1, r.c1, r.r2, r.c2);
			ensureVisible(r.r1, r.c1);
			gridEl.focus();
		} else if(e.key === 'Escape') {
			drawAll();
			gridEl.focus();
		}
		e.stopPropagation();
	});
	nameBox.addEventListener('focus', () => nameBox.select());
	/* ---- moving the cursor ---- */
	function jumpTo(r, c, dr, dc) { // Ctrl+arrow
		const s = sh;
		const has = (rr, cc) => {
			const x = s.cells.get(key(rr, cc));
			return !!x && x.v !== null && x.v !== undefined;
		};
		const maxR = Math.max(s.maxR, 0),
			maxC = Math.max(s.maxC, 0);
		const inb = (rr, cc) => rr >= 0 && cc >= 0 && rr <= (dr ? MAXR - 1 : maxR + 1) && cc <= (dc ? MAXC - 1 : maxC + 1);
		let rr = r + dr,
			cc = c + dc;
		if(!inb(rr, cc)) return {
			r: clamp(rr, 0, dr > 0 ? Math.max(maxR, r) : MAXR),
			c: clamp(cc, 0, dc > 0 ? Math.max(maxC, c) : MAXC)
		};
		if(has(r, c) && has(rr, cc)) {
			while(inb(rr + dr, cc + dc) && has(rr + dr, cc + dc)) {
				rr += dr;
				cc += dc;
			}
			return {
				r: rr,
				c: cc
			};
		}
		while(inb(rr, cc) && !has(rr, cc)) {
			rr += dr;
			cc += dc;
		}
		if(!inb(rr, cc)) {
			rr -= dr;
			cc -= dc;
			if(dr > 0) rr = Math.max(maxR, r);
			else if(dr < 0) rr = 0;
			if(dc > 0) cc = Math.max(maxC, c);
			else if(dc < 0) cc = 0;
		}
		return {
			r: clamp(rr, 0, MAXR - 1),
			c: clamp(cc, 0, MAXC - 1)
		};
	}

	function moveActive(dr, dc, extend, ctrl, wrapInRange) {
		const g = sh.sel;
		if(wrapInRange && (g.r1 !== g.r2 || g.c1 !== g.c2) && !extend) { // Enter and Tab move through a multi-cell selection
			let r = g.ar + dr,
				c = g.ac + dc;
			if(dr) {
				if(r > g.r2) {
					r = g.r1;
					c = g.ac + 1;
					if(c > g.c2) c = g.c1;
				} else if(r < g.r1) {
					r = g.r2;
					c = g.ac - 1;
					if(c < g.c1) c = g.c2;
				}
			}
			if(dc) {
				if(c > g.c2) {
					c = g.c1;
					r = g.ar + 1;
					if(r > g.r2) r = g.r1;
				} else if(c < g.c1) {
					c = g.c2;
					r = g.ar - 1;
					if(r < g.r1) r = g.r2;
				}
			}
			g.ar = r;
			g.ac = c;
			sh.geomDirty = true;
			ensureVisible(r, c);
			updateBars();
			drawGrid();
			return;
		}
		let r = extend ? g.fr : g.ar,
			c = extend ? g.fc : g.ac;
		const m = mergeAt(sh, r, c);
		if(m && !ctrl) {
			if(dr > 0) r = m.r2;
			else if(dr < 0) r = m.r1;
			if(dc > 0) c = m.c2;
			else if(dc < 0) c = m.c1;
		}
		if(ctrl) {
			const j = jumpTo(r, c, dr, dc);
			r = j.r;
			c = j.c;
		} else {
			r = clamp(r + dr, 0, MAXR - 1);
			c = clamp(c + dc, 0, MAXC - 1);
		}
		if(!ctrl) {
			while(dr && sh.hidden.has(r) && r > 0 && r < MAXR - 1) r += dr;
		}
		if(extend) setSel(g.ar, g.ac, r, c);
		else setSel(r, c);
		ensureVisible(r, c);
	}
	
	gridEl.addEventListener('keydown', (e) => {
		if(editing) return;
		const ctrl = e.ctrlKey || e.metaKey;
		const k = e.key;
		if(ctrl) {
			const lk = k.toLowerCase();
			if(lk === 'a') {
				e.preventDefault();
				setSel(0, 0, MAXR - 1, MAXC - 1);
				return;
			}

			if(lk === 'z') {
				e.preventDefault();
				e.shiftKey ? redo() : undo();
				return;
			}

			if(lk === 'y') {
				e.preventDefault();
				redo();
				return;
			}

			if(lk === 'b') {
				e.preventDefault();
				toggleStyle('b');
				return;
			}

			if(lk === 'i') {
				e.preventDefault();
				toggleStyle('i');
				return;
			}

			if(lk === 'u') {
				e.preventDefault();
				toggleStyle('u');
				return;
			}

			if(lk === 'd') {
				e.preventDefault();
				fillFromEdge('down');
				return;
			}

			if(lk === 'r') {
				e.preventDefault();
				fillFromEdge('right');
				return;
			}

			if(k === 'Home') {
				e.preventDefault();
				e.shiftKey ? setSel(sh.sel.ar, sh.sel.ac, 0, 0) : setSel(0, 0);
				sh.scrollX = 0;
				sh.scrollY = 0;
				scheduleDraw();
				return;
			}

			if(k === 'End') {
				e.preventDefault();
				const r = Math.max(0, sh.maxR),
					c = Math.max(0, sh.maxC);
				e.shiftKey ? setSel(sh.sel.ar, sh.sel.ac, r, c) : setSel(r, c);
				ensureVisible(r, c);
				return;
			}

			if(/^Arrow/.test(k)) {
				e.preventDefault();
				moveActive(k === 'ArrowDown' ? 1 : (k === 'ArrowUp' ? -1 : 0), k === 'ArrowRight' ? 1 : (k === 'ArrowLeft' ? -1 : 0), e.shiftKey, true);
				return;
			}
			if(lk === 'c' || lk === 'x' || lk === 'v') return; // clipboard events handle these
			return;
		}

		if(/^Arrow/.test(k)) {
			e.preventDefault();
			moveActive(k === 'ArrowDown' ? 1 : (k === 'ArrowUp' ? -1 : 0), k === 'ArrowRight' ? 1 : (k === 'ArrowLeft' ? -1 : 0), e.shiftKey, false);
			return;
		}

		if(k === 'Tab') {
			e.preventDefault();
			moveActive(0, e.shiftKey ? -1 : 1, false, false, true);
			return;
		}

		if(k === 'Enter') {
			e.preventDefault();
			if(e.shiftKey) moveActive(-1, 0, false, false, true);
			else moveActive(1, 0, false, false, true);
			return;
		}

		if(k === 'F2') {
			e.preventDefault();
			startEdit('edit');
			return;
		}

		if(k === 'Delete' || k === 'Backspace') {
			e.preventDefault();
			clearContents();
			return;
		}

		if(k === 'Escape') {
			findHit = null;
			scheduleDraw();
			return;
		}

		if(k === 'Home') {
			e.preventDefault();
			e.shiftKey ? setSel(sh.sel.ar, sh.sel.ac, sh.sel.fr, 0) : setSel(sh.sel.ar, 0);
			sh.scrollX = 0;
			ensureVisible(sh.sel.ar, 0);
			return;
		}

		if(k === 'PageDown' || k === 'PageUp') {
			e.preventDefault();
			const rows = Math.max(1, Math.floor(L.bodyH / sh.defRowH) - 1) * (k === 'PageDown' ? 1 : -1);
			moveActive(rows, 0, e.shiftKey, false);
			return;
		}

		if(k.length === 1 && !e.altKey) {
			e.preventDefault();
			startEdit('enter', k);
			return;
		}
	});
	
	function drawAll() {
		renderTabsIfNeeded();
		drawGrid();
	}

	function usedRect(g) {
		return {
			r1: g.r1,
			c1: g.c1,
			r2: Math.min(g.r2, Math.max(sh.maxR, g.r1, 0)),
			c2: Math.min(g.c2, Math.max(sh.maxC, g.c1, 0))
		};
	}

	function cellsInRect(s, rc) {
		const out = [];
		const area = (rc.r2 - rc.r1 + 1) * (rc.c2 - rc.c1 + 1);
		if(area > s.cells.size * 2) {
			s.cells.forEach((cell, k) => {
				const r = keyR(k),
					c = keyC(k);
				if(r >= rc.r1 && r <= rc.r2 && c >= rc.c1 && c <= rc.c2) out.push([r, c, cell]);
			});
		} else
			for(let r = rc.r1; r <= rc.r2; r++)
				for(let c = rc.c1; c <= rc.c2; c++) {
					const x = s.cells.get(key(r, c));
					if(x) out.push([r, c, x]);
				}
		return out;
	}

	function clearContents() {
		const rc = sh.sel;
		run(() => {
			cellsInRect(sh, {
				r1: rc.r1,
				c1: rc.c1,
				r2: rc.r2,
				c2: rc.c2
			}).forEach(([r, c, cell]) => {
				patchCell(sh, r, c, (x) => {
					x.v = null;
					x.f = null;
					return x;
				});
			});
		});
	}

	function clearFormats() {
		const rc = sh.sel;
		run(() => {
			cellsInRect(sh, {
				r1: rc.r1,
				c1: rc.c1,
				r2: rc.r2,
				c2: rc.c2
			}).forEach(([r, c]) => patchCell(sh, r, c, (x) => {
				x.s = 0;
				return x;
			}));
		});
	}
	
	function applyStyle(patch, boundsFn) {
		const rc = sh.sel;
		const rect = {
			r1: rc.r1,
			c1: rc.c1,
			r2: Math.min(rc.r2, Math.max(sh.maxR + 0, rc.r1, rc.r2 === MAXR - 1 ? sh.maxR : rc.r2)),
			c2: Math.min(rc.c2, rc.c2 >= MAXC - 1 ? Math.max(sh.maxC, rc.c1) : rc.c2)
		};
		if((rect.r2 - rect.r1 + 1) * (rect.c2 - rect.c1 + 1) > 300000) {
			showError('That selection is too large to format at once.');
			return;
		}
		run(() => {
			for(let r = rect.r1; r <= rect.r2; r++)
				for(let c = rect.c1; c <= rect.c2; c++) {
					patchCell(sh, r, c, (x) => {
						x.s = withStyle(x.s, typeof patch === 'function' ? patch(styleOf(x.s), r, c, rect) : patch);
						return x;
					});
				}
		});
		if(patch && (patch.wrap !== undefined || (patch.sz || patch.font))) {
			run(() => {
				for(let r = rect.r1; r <= rect.r2; r++) autoFitRow(r, false);
			});
		}
		drawAll();
	}

	function toggleStyle(k) {
		const cur = styleOf((activeCell() || {}).s || 0)[k];
		const o = {};
		o[k] = !cur;
		applyStyle(o);
	}

	function setBorders(kind) {
		const C = '#000000';
		applyStyle((st, r, c, rc) => {
			const bd = Object.assign({}, st.bd || {});
			if(kind === 'none') return {
				bd: null
			};
			if(kind === 'all') {
				bd.t = bd.r = bd.b = bd.l = C;
			}
			if(kind === 'outer') {
				if(r === rc.r1) bd.t = C;
				if(r === rc.r2) bd.b = C;
				if(c === rc.c1) bd.l = C;
				if(c === rc.c2) bd.r = C;
			}
			if(kind === 'bottom' && r === rc.r2) bd.b = C;
			if(kind === 'top' && r === rc.r1) bd.t = C;
			if(kind === 'left' && c === rc.c1) bd.l = C;
			if(kind === 'right' && c === rc.c2) bd.r = C;
			return {
				bd
			};
		});
	}

	function changeDecimals(code, delta) {
		if(!code || code === 'General') code = delta > 0 ? '0.0' : '0';
		else {
			const m = /^([^;]*?)(\.(0*#*))?((?:[eE][+-]0+)?[^0#.]*)(;.*)?$/.exec(code);
			if(!m) return code;
			let dec = m[3] || '';
			if(delta > 0) dec += '0';
			else dec = dec.slice(0, -1);
			const base = m[1];
			
			code = base + (dec.length ? '.' + dec : '') + (m[4] || '') + (m[5] || '');
		}
		return code;
	}
	
	let clip = null;

	function tsvOf(rows) {
		return rows.map((r) => r.map((t) => (/[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t)).join('\t')).join('\n');
	}

	function copySel(cut) {
		const g = sh.sel,
			rc = usedRect(g);
		const cells = [],
			text = [];
		for(let r = rc.r1; r <= rc.r2; r++) {
			const row = [],
				trow = [];
			for(let c = rc.c1; c <= rc.c2; c++) {
				const x = cellAt(sh, r, c);
				row.push(x ? {
					v: x.v,
					f: x.f,
					s: x.s
				} : null);
				const d = displayOf(x);
				trow.push(d ? d.text : '');
			}
			cells.push(row);
			text.push(trow);
		}
		const merges = sh.merges.filter((m) => m.r1 >= rc.r1 && m.r2 <= rc.r2 && m.c1 >= rc.c1 && m.c2 <= rc.c2).map((m) => ({
			r1: m.r1 - rc.r1,
			c1: m.c1 - rc.c1,
			r2: m.r2 - rc.r1,
			c2: m.c2 - rc.c1
		}));
		clip = {
			cells, rows: cells.length, cols: cells[0].length, r1: rc.r1, c1: rc.c1, text: tsvOf(text), cut: cut ? {
				s: sh,
				rc
			} : null, merges
		};
		return clip.text;
	}

	function parseTsv(t) {
		const rows = [];
		let row = [],
			cur = '',
			q = false;
		for(let i = 0; i < t.length; i++) {
			const ch = t[i];
			if(q) {
				if(ch === '"') {
					if(t[i + 1] === '"') {
						cur += '"';
						i++;
					} else q = false;
				} else cur += ch;
			} else if(ch === '"' && cur === '') q = true;
			else if(ch === '\t') {
				row.push(cur);
				cur = '';
			} else if(ch === '\n' || ch === '\r') {
				if(ch === '\r' && t[i + 1] === '\n') i++;
				row.push(cur);
				rows.push(row);
				row = [];
				cur = '';
			} else cur += ch;
		}
		if(cur !== '' || row.length) {
			row.push(cur);
			rows.push(row);
		}
		return rows;
	}

	function pasteInternal() {
		const g = sh.sel,
			c0 = clip;
		let tr = g.r1,
			tc = g.c1,
			reps = [1, 1];
		if(c0.rows === 1 && c0.cols === 1 && (g.r1 !== g.r2 || g.c1 !== g.c2)) reps = [g.r2 - g.r1 + 1, g.c2 - g.c1 + 1];
		else if((g.r2 - g.r1 + 1) % c0.rows === 0 && (g.c2 - g.c1 + 1) % c0.cols === 0 && (g.r1 !== g.r2 || g.c1 !== g.c2)) reps = [(g.r2 - g.r1 + 1) / c0.rows, (g.c2 - g.c1 + 1) / c0.cols];
		const endR = tr + c0.rows * reps[0] - 1,
			endC = tc + c0.cols * reps[1] - 1;
		if(endR >= MAXR || endC >= MAXC) {
			showError('That does not fit on the sheet.');
			return;
		}
		run(() => {
			touchProps(sh);
			for(let a = 0; a < reps[0]; a++)
				for(let b = 0; b < reps[1]; b++) {
					const br = tr + a * c0.rows,
						bc = tc + b * c0.cols;
					for(let i = 0; i < c0.rows; i++)
						for(let j = 0; j < c0.cols; j++) {
							const src = c0.cells[i][j];
							const nr = br + i,
								nc = bc + j;
							if(!src) {
								setCell(sh, nr, nc, null);
								continue;
							}
							const f = src.f ? XE.shiftFormula(src.f, nr - (c0.r1 + i), nc - (c0.c1 + j)) : null;
							setCell(sh, nr, nc, {
								v: src.v,
								f,
								s: src.s
							});
						}
					sh.merges = sh.merges.filter((m) => !(m.r2 >= br && m.r1 < br + c0.rows && m.c2 >= bc && m.c1 < bc + c0.cols));
					c0.merges.forEach((m) => sh.merges.push({
						r1: m.r1 + br,
						c1: m.c1 + bc,
						r2: m.r2 + br,
						c2: m.c2 + bc
					}));
				}
			if(c0.cut) {
				const rc = c0.cut.rc;
				if(c0.cut.s === sh)
					for(let r = rc.r1; r <= rc.r2; r++)
						for(let c = rc.c1; c <= rc.c2; c++) {
							if(r >= tr && r <= endR && c >= tc && c <= endC) continue;
							setCell(sh, r, c, null);
						}
				clip = null;
			}
		});
		setSel(tr, tc, endR, endC);
	}

	function pasteText(text) {
		const rows = parseTsv(text.replace(/\n$/, ''));
		if(!rows.length) return;
		const g = sh.sel;
		const endR = g.r1 + rows.length - 1,
			endC = g.c1 + Math.max.apply(null, rows.map((r) => r.length)) - 1;
		if(endR >= MAXR || endC >= MAXC) {
			showError('That does not fit on the sheet.');
			return;
		}
		run(() => {
			rows.forEach((row, i) => row.forEach((t, j) => setInput(sh, g.r1 + i, g.c1 + j, t)));
		});
		setSel(g.r1, g.c1, endR, endC);
	}

	document.addEventListener('copy', (e) => {
		if(document.activeElement !== gridEl || editing) return;
		e.preventDefault();
		e.clipboardData.setData('text/plain', copySel(false));
	});

	document.addEventListener('cut', (e) => {
		if(document.activeElement !== gridEl || editing) return;
		e.preventDefault();
		e.clipboardData.setData('text/plain', copySel(true));
	});

	document.addEventListener('paste', (e) => {
		if(document.activeElement !== gridEl || editing) return;
		e.preventDefault();
		const t = (e.clipboardData || window.clipboardData).getData('text/plain');
		if(clip && t.replace(/\r/g, '').replace(/\n$/, '') === clip.text.replace(/\n$/, '')) pasteInternal();
		else if(t) {
			clip = null;
			pasteText(t);
		}
	});
	
	function seriesStep(vals) { 
		if(vals.length < 2 || vals.some((x) => !x || x.f || typeof x.v !== 'number')) return null;
		const step = vals[1].v - vals[0].v;
		for(let i = 2; i < vals.length; i++)
			if(Math.abs(vals[i].v - vals[i - 1].v - step) > 1e-9) return null;
		return step;
	}

	function doFill(src, dest, copyOnly) {
		const vertical = dest.dir === 'down' || dest.dir === 'up';
		run(() => {
			const lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1;
			for(let l = 0; l < lines; l++) {
				const srcCells = [];
				const len = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
				for(let i = 0; i < len; i++) srcCells.push(vertical ? cellAt(sh, src.r1 + i, src.c1 + l) : cellAt(sh, src.r1 + l, src.c1 + i));
				const step = copyOnly ? null : seriesStep(srcCells);
				const forward = dest.dir === 'down' || dest.dir === 'right';
				const count = vertical ? dest.r2 - dest.r1 + 1 : dest.c2 - dest.c1 + 1;
				for(let n = 0; n < count; n++) {
					const idxFromEdge = forward ? n : count - 1 - n; // distance from the source block, 0-based
					const pos = (vertical ? (forward ? dest.r1 + n : dest.r1 + n) : (forward ? dest.c1 + n : dest.c1 + n));
					const k = forward ? (idxFromEdge % len) : (len - 1 - (idxFromEdge % len));
					const s0 = srcCells[k];
					const tr = vertical ? pos : src.r1 + l,
						tc = vertical ? src.c1 + l : pos;
					if(!s0) {
						setCell(sh, tr, tc, null);
						continue;
					}
					let nc;
					if(step !== null) {
						const dist = forward ? (idxFromEdge + 1) : -(idxFromEdge + 1);
						const base = forward ? srcCells[len - 1].v : srcCells[0].v;
						nc = {
							v: base + step * dist,
							f: null,
							s: s0.s
						};
					} else if(s0.f) {
						const srcR = vertical ? src.r1 + k : src.r1 + l,
							srcC = vertical ? src.c1 + l : src.c1 + k;
						nc = {
							v: 0,
							f: XE.shiftFormula(s0.f, tr - srcR, tc - srcC),
							s: s0.s
						};
					} else if(!copyOnly && len === 1 && typeof s0.v === 'string' && /\d+$/.test(s0.v)) {
						const m = /^(.*?)(\d+)$/.exec(s0.v);
						const inc = (forward ? idxFromEdge + 1 : -(idxFromEdge + 1));
						const nv = String(Math.max(0, +m[2] + inc)).padStart(m[2].length, '0');
						nc = {
							v: m[1] + nv,
							f: null,
							s: s0.s
						};
					} else nc = {
						v: s0.v,
						f: null,
						s: s0.s
					};
					setCell(sh, tr, tc, nc);
				}
			}
		});
		setSel(Math.min(src.r1, dest.r1), Math.min(src.c1, dest.c1), Math.max(src.r2, dest.r2), Math.max(src.c2, dest.c2));
	}

	function fillFromEdge(dir) {
		const g = sh.sel;
		if(dir === 'down' && g.r2 > g.r1) doFill({
			r1: g.r1,
			r2: g.r1,
			c1: g.c1,
			c2: g.c2
		}, {
			r1: g.r1 + 1,
			r2: g.r2,
			c1: g.c1,
			c2: g.c2,
			dir: 'down'
		}, true);
		else if(dir === 'right' && g.c2 > g.c1) doFill({
			r1: g.r1,
			r2: g.r2,
			c1: g.c1,
			c2: g.c1
		}, {
			r1: g.r1,
			r2: g.r2,
			c1: g.c1 + 1,
			c2: g.c2,
			dir: 'right'
		}, true);
	}
	
	function lineHeightOf(st) {
		return Math.ceil((st.sz || wb.defSz) * 4 / 3 * 1.25);
	}

	function autoFitCol(c) {
		const g = sh.sel;
		const cols = (c >= g.c1 && c <= g.c2 && g.c1 !== g.c2) ? [g.c1, g.c2] : [c, c];
		run(() => {
			touchProps(sh);
			for(let cc = cols[0]; cc <= cols[1]; cc++) {
				let w = 0;
				sh.cells.forEach((cell, k) => {
					if(keyC(k) !== cc) return;
					const d = displayOf(cell);
					if(!d) return;
					const st = styleOf(cell.s);
					if(st.wrap) return;
					const lines = d.text.split('\n');
					const f = fontOf(st);
					w = Math.max(w, Math.max.apply(null, lines.map((t) => textWidth(t, f))) + 14);
				});
				if(sh.filter && sh.filter.c1 <= cc && cc <= sh.filter.c2) w += 18;
				sh.colW[cc] = clamp(Math.round(w || sh.defColW), 20, 700);
			}
		});
		drawAll();
	}

	function autoFitRow(r, force) {
		if(!force && sh.rowManual && sh.rowManual.has(r)) return;
		let h = sh.defRowH;
		sh.cells.forEach((cell, k) => {
			if(keyR(k) !== r) return;
			const st = styleOf(cell.s),
				d = displayOf(cell);
			const lh = lineHeightOf(st);
			h = Math.max(h, lh + 3);
			if(!d || !st.wrap) return;
			const f = fontOf(st),
				w = colWOf(sh, keyC(k)) - 8;
			let lines = 0;
			d.text.split('\n').forEach((para) => {
				let cur = '',
					n = 1;
				para.split(/(\s+)/).forEach((word) => {
					if(cur && textWidth(cur + word, f) > w) {
						n++;
						cur = word.trim() ? word : '';
					} else cur += word;
				});
				lines += n;
			});
			h = Math.max(h, lines * lh + 3);
		});
		const own = !tx;
		begin();
		touchProps(sh);
		if(h <= sh.defRowH && !force) delete sh.rowH[r];
		else sh.rowH[r] = Math.round(h);
		if(force && sh.rowManual) sh.rowManual.delete(r);
		sh.geomDirty = true;
		if(own) end();
		if(force) drawAll();
	}
	
	function quoteSheet(n) {
		return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) ? n : "'" + n.replace(/'/g, "''") + "'";
	}

	function shiftAxis(axis, at, n) { 
		const isR = axis === 'r';
		const lim = isR ? MAXR : MAXC;
		if(n > 0 && ((isR ? sh.maxR : sh.maxC) + n >= lim)) {
			showError('There is no room to insert that.');
			return;
		}
		run(() => {
			touchProps(sh);
			const cnt = Math.abs(n);
			const mapIdx = (v, isRange, isEnd) => {
				if(n > 0) return v >= at ? v + n : v;
				if(v < at) return v;
				if(v >= at + cnt) return v - cnt;
				return isRange ? (isEnd ? at - 1 : at) : null;
			};
			
			wb.sheets.forEach((S2) => {
				S2.cells.forEach((cell, k) => {
					if(!cell.f) return;
					const nf = XE.rewrite(cell.f, (sheetName, node, isEnd, isRange) => {
						const target = sheetName ? host.sheetByName(sheetName) : S2;
						if(target !== sh) return {
							r: node.r,
							c: node.c
						};
						const nv = mapIdx(isR ? node.r : node.c, isRange, isEnd);
						if(nv === null || nv < 0) return null;
						return isR ? {
							r: nv,
							c: node.c
						} : {
							r: node.r,
							c: nv
						};
					});
					if(nf !== cell.f) setCell(S2, keyR(k), keyC(k), {
						v: cell.v,
						f: nf,
						s: cell.s
					});
				});
			});
			
			const moves = [];
			sh.cells.forEach((cell, k) => {
				const v = isR ? keyR(k) : keyC(k);
				if(v >= at) moves.push([k, cell]);
			});
			moves.forEach(([k]) => setCell(sh, keyR(k), keyC(k), null));
			moves.forEach(([k, cell]) => {
				const r = keyR(k),
					c = keyC(k),
					v = isR ? r : c;
				const nv = n > 0 ? v + n : (v >= at + cnt ? v - cnt : null);
				if(nv === null) return;
				setCell(sh, isR ? nv : r, isR ? c : nv, cell);
			});
			
			const remap = (obj) => {
				const o = {};
				Object.keys(obj).forEach((kk) => {
					const nv = mapIdx(+kk, false);
					if(nv !== null) o[nv] = obj[kk];
				});
				return o;
			};
			if(isR) {
				sh.rowH = remap(sh.rowH);
				const h = new Set();
				sh.hidden.forEach((v) => {
					const nv = mapIdx(v, false);
					if(nv !== null) h.add(nv);
				});
				sh.hidden = h;
				if(sh.rowManual) {
					const m = new Set();
					sh.rowManual.forEach((v) => {
						const nv = mapIdx(v, false);
						if(nv !== null) m.add(nv);
					});
					sh.rowManual = m;
				}
			} else sh.colW = remap(sh.colW);
			sh.merges = sh.merges.map((m) => {
				const a = isR ? m.r1 : m.c1,
					b = isR ? m.r2 : m.c2;
				const na = mapIdx(a, true, false),
					nb = mapIdx(b, true, true);
				if(na === null || nb === null || nb < na) return null;
				return isR ? {
					r1: na,
					r2: nb,
					c1: m.c1,
					c2: m.c2
				} : {
					c1: na,
					c2: nb,
					r1: m.r1,
					r2: m.r2
				};
			}).filter((m) => m && (m.r2 > m.r1 || m.c2 > m.c1));
			if(sh.filter) {
				const f = sh.filter;
				if(isR) {
					const a = mapIdx(f.r1, true, false),
						b = mapIdx(f.r2, true, true);
					if(a === null || b < a) sh.filter = null;
					else {
						f.r1 = a;
						f.r2 = b;
					}
				} else {
					const a = mapIdx(f.c1, true, false),
						b = mapIdx(f.c2, true, true);
					if(a === null || b < a) sh.filter = null;
					else {
						f.c1 = a;
						f.c2 = b;
					}
				}
			}
			if(n < 0) {
				if(isR && sh.freeze.r > at) sh.freeze.r = Math.max(at, sh.freeze.r - Math.min(cnt, sh.freeze.r - at));
				if(!isR && sh.freeze.c > at) sh.freeze.c = Math.max(at, sh.freeze.c - Math.min(cnt, sh.freeze.c - at));
			} else {
				if(isR && sh.freeze.r > at) sh.freeze.r += n;
				if(!isR && sh.freeze.c > at) sh.freeze.c += n;
			}
			sh.maxR = -1;
			sh.maxC = -1;
			sh.cells.forEach((cell, k) => {
				const r = keyR(k),
					c = keyC(k);
				if(r > sh.maxR) sh.maxR = r;
				if(c > sh.maxC) sh.maxC = c;
			});
			sh.geomDirty = true;
		});
		const g = sh.sel;
		if(n < 0) setSel(g.ar, g.ac, g.fr, g.fc);
	}
	
	function dataRegion(r, c) { 
		const s = sh;
		const has = (rr, cc) => {
			const x = s.cells.get(key(rr, cc));
			return !!x && x.v !== null && x.v !== undefined;
		};
		let r1 = r,
			r2 = r,
			c1 = c,
			c2 = c,
			grew = true,
			guard = 0;
		while(grew && guard++ < 100000) {
			grew = false;
			const anyRow = (rr) => {
				if(rr < 0) return false;
				for(let cc = Math.max(0, c1 - 1); cc <= Math.min(s.maxC, c2 + 1); cc++)
					if(has(rr, cc)) return true;
				return false;
			};
			const anyCol = (cc) => {
				if(cc < 0) return false;
				for(let rr = Math.max(0, r1 - 1); rr <= Math.min(s.maxR, r2 + 1); rr++)
					if(has(rr, cc)) return true;
				return false;
			};
			if(anyRow(r1 - 1)) {
				r1--;
				grew = true;
			}
			if(r2 + 1 <= s.maxR && anyRow(r2 + 1)) {
				r2++;
				grew = true;
			}
			if(anyCol(c1 - 1)) {
				c1--;
				grew = true;
			}
			if(c2 + 1 <= s.maxC && anyCol(c2 + 1)) {
				c2++;
				grew = true;
			}
		}
		return {
			r1, r2, c1, c2
		};
	}

	function sortRegion(region, col, desc, hasHeader) {
		const s = sh;
		if(s.merges.some((m) => m.r2 >= region.r1 && m.r1 <= region.r2 && m.c2 >= region.c1 && m.c1 <= region.c2)) {
			showError('Merged cells in the range prevent sorting. Unmerge them first.');
			return;
		}
		const first = region.r1 + (hasHeader ? 1 : 0);
		if(region.r2 <= first) return;
		const rows = [];
		for(let r = first; r <= region.r2; r++) {
			const kc = cellAt(s, r, col);
			const cells = [];
			for(let c = region.c1; c <= region.c2; c++) cells.push(cellAt(s, r, c));
			rows.push({
				r, cells, kv: kc && kc.v !== undefined ? kc.v : null
			});
		}
		const blank = (v) => v === null || v === '';
		rows.sort((a, b) => {
			if(blank(a.kv) && blank(b.kv)) return a.r - b.r;
			if(blank(a.kv)) return 1;
			if(blank(b.kv)) return -1;
			let c = XE.compare(a.kv, b.kv);
			if(isErr(a.kv) || isErr(b.kv)) c = isErr(a.kv) ? (isErr(b.kv) ? 0 : 1) : -1;
			return(desc ? -c : c) || (a.r - b.r);
		});
		run(() => {
			rows.forEach((row, i) => {
				const nr = first + i;
				row.cells.forEach((cell, j) => {
					const c = region.c1 + j;
					if(!cell) setCell(s, nr, c, null);
					else setCell(s, nr, c, {
						v: cell.v,
						f: cell.f ? XE.shiftFormula(cell.f, nr - row.r, 0) : null,
						s: cell.s
					});
				});
			});
		});
	}

	function doSort(desc) {
		const g = sh.sel;
		let region;
		if(g.r1 === g.r2 && g.c1 === g.c2) region = dataRegion(g.ar, g.ac);
		else region = usedRect(g);
		if(sh.filter && g.r1 === g.r2 && g.c1 === g.c2) region = {
			r1: sh.filter.r1,
			r2: sh.filter.r2,
			c1: sh.filter.c1,
			c2: sh.filter.c2
		};
		const col = clamp(g.ac, region.c1, region.c2);
		sortRegion(region, col, desc, $('xeHeader').checked);
		if(sh.filter) applyFilter();
	}
	
	function cellText(r, c) {
		const d = displayOf(cellAt(sh, r, c));
		return d ? d.text : '';
	}

	function applyFilter() {
		const f = sh.filter;
		if(!f) return;
		run(() => {
			touchProps(sh);
			for(let r = f.r1 + 1; r <= f.r2; r++) {
				let hide = false;
				for(const c in f.cols) {
					if(!f.cols[c].has(cellText(r, +c))) {
						hide = true;
						break;
					}
				}
				if(hide) sh.hidden.add(r);
				else sh.hidden.delete(r);
			}
			sh.geomDirty = true;
		});
	}

	function toggleFilter() {
		run(() => {
			touchProps(sh);
			if(sh.filter) {
				for(let r = sh.filter.r1 + 1; r <= sh.filter.r2; r++) sh.hidden.delete(r);
				sh.filter = null;
			} else {
				const g = sh.sel;
				const reg = (g.r1 === g.r2 && g.c1 === g.c2) ? dataRegion(g.ar, g.ac) : usedRect(g);
				if(reg.c2 < reg.c1) return;
				sh.filter = {
					r1: reg.r1,
					c1: reg.c1,
					r2: Math.max(reg.r2, reg.r1 + 1),
					c2: reg.c2,
					cols: {}
				};
			}
			sh.geomDirty = true;
		});
	}

	function openFilterMenu(c, rect) {
		const f = sh.filter;
		const vals = new Map();
		for(let r = f.r1 + 1; r <= f.r2; r++) {
			const t = cellText(r, c);
			vals.set(t, (vals.get(t) || 0) + 1);
		}
		const uniq = Array.from(vals.keys()).sort((a, b) => {
			const na = Number(a),
				nb = Number(b);
			if(a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
			return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
		}).slice(0, 1000);
		const allow = f.cols[c];
		const vr = view.getBoundingClientRect();
		const m = $('xeMenu');
		m.innerHTML = '<button data-m="asc">Sort A → Z</button><button data-m="desc">Sort Z → A</button><button data-m="clr"' + (allow ? '' : ' disabled') + '>Clear filter</button><hr>' + '<input type="text" placeholder="Search" id="xeFSearch" autocomplete="off"><div class="xe-list" id="xeFList"><label><input type="checkbox" id="xeFAll"' + (!allow || allow.size >= uniq.length ? ' checked' : '') + '> <b>Select all</b></label>' + uniq.map((v, i) => '<label data-v="' + esc(v.toLowerCase()) + '"><input type="checkbox" class="xe-fv" data-i="' + i + '"' + (!allow || allow.has(v) ? ' checked' : '') + '> ' + (v === '' ? '(Blanks)' : esc(v)) + '</label>').join('') + '</div><div class="xe-row"><button data-m="cancel">Cancel</button><button data-m="ok" class="is-primary">OK</button></div>';
		m.classList.remove('is-hidden');
		m.style.left = Math.min(vr.left + rect.x, window.innerWidth - 310) + 'px';
		m.style.top = Math.min(vr.top + rect.y + rect.h, window.innerHeight - 380) + 'px';
		const boxes = () => Array.from(m.querySelectorAll('.xe-fv'));
		$('xeFAll').addEventListener('change', (e) => {
			m.querySelectorAll('label[data-v]').forEach((l) => {
				if(l.style.display !== 'none') l.querySelector('input').checked = e.target.checked;
			});
		});
		$('xeFSearch').addEventListener('input', (e) => {
			const q = e.target.value.toLowerCase();
			m.querySelectorAll('label[data-v]').forEach((l) => {
				l.style.display = l.dataset.v.indexOf(q) >= 0 ? '' : 'none';
			});
		});
		m.onclick = (e) => {
			const b = e.target.closest('button');
			if(!b) return;
			const a = b.dataset.m;
			if(a === 'cancel') {
				hideMenu();
				gridEl.focus({
					preventScroll: true
				});
				return;
			}
			hideMenu();
			gridEl.focus({
				preventScroll: true
			});
			if(a === 'asc' || a === 'desc') {
				sortRegion({
					r1: f.r1,
					r2: f.r2,
					c1: f.c1,
					c2: f.c2
				}, c, a === 'desc', true);
				applyFilter();
				drawAll();
				return;
			}
			if(a === 'clr') {
				begin();
				touchProps(sh);
				delete f.cols[c];
				applyFilter();
				drawAll();
				return;
			}
			if(a === 'ok') {
				const chosen = new Set();
				boxes().forEach((bx) => {
					if(bx.checked) chosen.add(uniq[+bx.dataset.i]);
				});
				begin();
				touchProps(sh);
				if(chosen.size >= uniq.length) delete f.cols[c];
				else f.cols[c] = chosen;
				applyFilter();
				drawAll();
			}
		};
		setTimeout(() => $('xeFSearch').focus(), 0);
	}
	
	const findBar = $('xeFindBar');

	function openFind(show) {
		findBar.classList.toggle('is-hidden', !show);
		if(show) {
			const g = sh.sel;
			const x = cellAt(sh, g.ar, g.ac);
			if(x && !$('xeFindText').value && typeof x.v === 'string') $('xeFindText').value = x.v;
			$('xeFindText').focus();
			$('xeFindText').select();
		} else {
			findHit = null;
			gridEl.focus();
			scheduleDraw();
		}
	}

	function findRegex() {
		const t = $('xeFindText').value;
		if(t === '') return null;
		const body = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		return new RegExp($('xeFindWhole').checked ? '^' + body + '$' : body, $('xeFindCase').checked ? 'g' : 'gi');
	}

	function searchText(cell) {
		if(!cell) return null;
		if(cell.f) return $('xeFindFormulas').checked ? '=' + cell.f : (displayOf(cell) || {}).text || null;
		return $('xeFindFormulas').checked ? editText(cell) : ((displayOf(cell) || {}).text || null);
	}

	function findMatches() {
		const re = findRegex();
		if(!re) return [];
		const keys = Array.from(sh.cells.keys()).sort((a, b) => a - b);
		const out = [];
		keys.forEach((k) => {
			const t = searchText(sh.cells.get(k));
			if(t !== null && t !== '') {
				re.lastIndex = 0;
				if(re.test(t)) out.push(k);
			}
		});
		return out;
	}

	function findStep(dir, quiet) {
		const ms = findMatches();
		$('xeFindInfo').textContent = findRegex() ? ms.length + ' match' + (ms.length === 1 ? '' : 'es') : '';
		if(!ms.length) {
			findHit = null;
			scheduleDraw();
			return false;
		}
		const g = sh.sel,
			cur = key(g.ar, g.ac);
		let k;
		if(dir > 0) k = ms.find((x) => x > cur);
		else {
			for(let i = ms.length - 1; i >= 0; i--)
				if(ms[i] < cur) {
					k = ms[i];
					break;
				}
		}
		if(k === undefined) k = dir > 0 ? ms[0] : ms[ms.length - 1];
		const r = keyR(k),
			c = keyC(k);
		findHit = {
			s: sh,
			r,
			c
		};
		setSel(r, c);
		ensureVisible(r, c);
		return true;
	}

	function replaceText(text, re, repl) {
		if($('xeFindWhole').checked) return repl;
		return text.replace(re, () => repl);
	}

	function doReplace(all) {
		const re = findRegex();
		if(!re) return;
		const repl = $('xeReplText').value;
		const ms = all ? findMatches() : (() => {
			const g = sh.sel;
			const k = key(g.ar, g.ac);
			return findMatches().filter((x) => x === k);
		})();
		if(!all && !ms.length) {
			findStep(1);
			return;
		}
		let n = 0;
		run(() => {
			ms.forEach((k) => {
				const cell = sh.cells.get(k);
				if(cell.f && !$('xeFindFormulas').checked) return;
				const t = cell.f ? '=' + cell.f : editText(cell);
				re.lastIndex = 0;
				const nt = replaceText(t, re, repl);
				if(nt !== t) {
					setInput(sh, keyR(k), keyC(k), nt);
					n++;
				}
			});
		});
		if(all) {
			$('xeFindInfo').textContent = n + ' replaced';
			drawAll();
		} else findStep(1);
	}
	findBar.addEventListener('mousedown', (e) => {
		if(e.target.closest('button')) e.preventDefault();
	});

	findBar.addEventListener('click', (e) => {
		const b = e.target.closest('button');
		if(!b) return;
		const a = b.dataset.find;
		if(a === 'next') findStep(1);
		else if(a === 'prev') findStep(-1);
		else if(a === 'replace') doReplace(false);
		else if(a === 'all') doReplace(true);
		else if(a === 'close') openFind(false);
	});

	$('xeFindText').addEventListener('keydown', (e) => {
		if(e.key === 'Enter') {
			e.preventDefault();
			findStep(e.shiftKey ? -1 : 1);
		} else if(e.key === 'Escape') openFind(false);
		e.stopPropagation();
	});

	$('xeFindText').addEventListener('input', () => {
		const ms = findMatches();
		$('xeFindInfo').textContent = $('xeFindText').value ? ms.length + ' match' + (ms.length === 1 ? '' : 'es') : '';
	});

	$('xeReplText').addEventListener('keydown', (e) => {
		if(e.key === 'Enter') {
			e.preventDefault();
			doReplace(false);
		} else if(e.key === 'Escape') openFind(false);
		e.stopPropagation();
	});
	
	function toggleMerge() {
		const g = sh.sel;
		const ex = mergeAt(sh, g.ar, g.ac);
		run(() => {
			touchProps(sh);
			if(ex && ex.r1 === g.r1 && ex.c1 === g.c1 && ex.r2 === g.r2 && ex.c2 === g.c2) {
				sh.merges = sh.merges.filter((m) => m !== ex);
				return;
			}
			if(g.r1 === g.r2 && g.c1 === g.c2) return;
			const rc = usedRect(g);
			const r2 = g.r2,
				c2 = g.c2;
			if(((r2 - g.r1 + 1) * (c2 - g.c1 + 1)) > 200000) {
				showError('That range is too large to merge.');
				return;
			}
			sh.merges = sh.merges.filter((m) => !(m.r2 >= g.r1 && m.r1 <= r2 && m.c2 >= g.c1 && m.c1 <= c2));
			cellsInRect(sh, {
				r1: g.r1,
				c1: g.c1,
				r2: Math.min(r2, sh.maxR),
				c2: Math.min(c2, sh.maxC)
			}).forEach(([r, c]) => {
				if(r !== g.r1 || c !== g.c1) patchCell(sh, r, c, (x) => {
					x.v = null;
					x.f = null;
					return x;
				});
			});
			sh.merges.push({
				r1: g.r1,
				c1: g.c1,
				r2,
				c2
			});
		});
	}

	function toggleFreeze() {
		run(() => {
			touchProps(sh);
			if(sh.freeze.r || sh.freeze.c) sh.freeze = {
				r: 0,
				c: 0
			};
			else {
				const g = sh.sel;
				sh.freeze = (g.r1 === 0 && g.c1 === 0) ? {
					r: 1,
					c: 0
				} : {
					r: g.r1,
					c: g.c1
				};
				sh.scrollX = 0;
				sh.scrollY = 0;
			}
			sh.geomDirty = true;
		});
	}
	
	const menuEl = $('xeMenu');

	function showMenu(x, y, items) {
		menuEl.innerHTML = items.map((it) => (it === '-' ? '<hr>' : '<button data-op="' + it[1] + '">' + it[0] + '</button>')).join('');
		menuEl.classList.remove('is-hidden');
		menuEl.style.left = Math.min(x, window.innerWidth - 220) + 'px';
		menuEl.style.top = Math.min(y, window.innerHeight - 380) + 'px';
		menuEl.onclick = (e) => {
			const b = e.target.closest('button');
			if(!b) return;
			hideMenu();
			if(b.dataset.op) doOp(b.dataset.op);
		};
	}

	function hideMenu() {
		menuEl.classList.add('is-hidden');
		menuEl.onclick = null;
	}

	document.addEventListener('pointerdown', (e) => {
		if(!menuEl.classList.contains('is-hidden') && !menuEl.contains(e.target)) hideMenu();
	}, true);

	function doOp(op) {
		if(editing) commitEdit(0, 0, true);
		clearError();
		const g = sh.sel;
		const nr = g.r2 - g.r1 + 1,
			nc = g.c2 - g.c1 + 1;
		switch(op) {
			case 'rowAbove':
				shiftAxis('r', g.r1, Math.min(nr, 1000));
				break;
			case 'rowBelow':
				shiftAxis('r', g.r2 + 1, Math.min(nr, 1000));
				break;
			case 'colLeft':
				shiftAxis('c', g.c1, Math.min(nc, 200));
				break;
			case 'colRight':
				shiftAxis('c', g.c2 + 1, Math.min(nc, 200));
				break;
			case 'rowDel':
				shiftAxis('r', g.r1, -Math.min(nr, MAXR - g.r1));
				break;
			case 'colDel':
				shiftAxis('c', g.c1, -Math.min(nc, MAXC - g.c1));
				break;
			case 'freeze':
				toggleFreeze();
				break;
			case 'sortAsc':
				doSort(false);
				break;
			case 'sortDesc':
				doSort(true);
				break;
			case 'filter':
				toggleFilter();
				break;
			case 'clear':
				clearContents();
				break;
			case 'clearFmt':
				clearFormats();
				break;
			case 'merge':
				toggleMerge();
				break;
		}
		gridEl.focus({
			preventScroll: true
		});
	}
	
	function updateBars() {
		if(!sh) return;
		const g = sh.sel;
		if(document.activeElement !== nameBox) nameBox.value = (g.r1 === g.r2 && g.c1 === g.c2) ? addr(g.ar, g.ac) : addr(g.r1, g.c1) + ':' + addr(g.r2, g.c2);
		const ac = activeCell();
		if(!editing && document.activeElement !== fxInput) fxInput.value = editText(ac);
		const st = styleOf(ac ? ac.s : 0);
		document.querySelectorAll('#xeFormat [data-fmt]').forEach((b) => {
			const f = b.dataset.fmt;
			let on = false;
			if(f.indexOf(':') > 0) {
				const p = f.split(':');
				on = (st[p[0]] || (p[0] === 'va' ? 'bottom' : '')) === p[1];
			} else on = !!st[f];
			b.classList.toggle('is-active', on);
		});
		fontPick.setCurrent(st.font || wb.defFont);
		const sz = String(st.sz || wb.defSz),
			sel = $('xeSize');
		if(!Array.prototype.some.call(sel.options, (o) => o.value === sz || o.text === sz)) sel.add(new Option(sz, sz));
		sel.value = sz;
		const nf = st.nf || 'General',
			nsel = $('xeNumFmt');
		nsel.value = Array.prototype.some.call(nsel.options, (o) => o.value === nf) ? nf : 'General';
		$('xeFreeze').classList.toggle('is-active', !!(sh.freeze.r || sh.freeze.c));
		$('xeFreeze').textContent = (sh.freeze.r || sh.freeze.c) ? 'Unfreeze panes' : 'Freeze panes';
		$('xeFilter').classList.toggle('is-active', !!sh.filter);
		$('xeMerge').classList.toggle('is-active', !!mergeAt(sh, g.ar, g.ac));
		
		let n = 0,
			cnt = 0,
			sum = 0,
			mn = Infinity,
			mx = -Infinity;
		if((g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1) > 1) {
			cellsInRect(sh, {
				r1: g.r1,
				c1: g.c1,
				r2: g.r2,
				c2: g.c2
			}).forEach(([r, c, cell]) => {
				if(sh.hidden.has(r) || cell.v === null || cell.v === undefined || cell.v === '') return;
				cnt++;
				if(typeof cell.v === 'number') {
					n++;
					sum += cell.v;
					if(cell.v < mn) mn = cell.v;
					if(cell.v > mx) mx = cell.v;
				}
			});
		}
		const fm = (v) => XE.numToStr(Math.round(v * 1e9) / 1e9);
		$('xeStats').textContent = cnt > 1 ? 'Count ' + cnt + (n ? '   Sum ' + fm(sum) + '   Average ' + fm(sum / n) + '   Min ' + fm(mn) + '   Max ' + fm(mx) : '') : '';
	}

	let tabSig = '';

	function renderTabsIfNeeded() {
		const sig = wb.sheets.map((s) => s.name).join('\u0001') + '|' + wb.active;
		if(sig === tabSig) return;
		tabSig = sig;
		const box = $('xeTabs');
		box.innerHTML = wb.sheets.map((s, i) => '<button type="button" class="xe-tab' + (i === wb.active ? ' is-current' : '') + '" data-i="' + i + '">' + esc(s.name) + '</button>').join('') + '<button type="button" class="xe-tab-add" data-add="1" title="Add sheet" aria-label="Add sheet">+</button>';
		const cur = box.querySelector('.is-current');
		if(cur && cur.scrollIntoView) cur.scrollIntoView({
			block: 'nearest',
			inline: 'nearest'
		});
	}

	function switchSheet(i) {
		if(i === wb.active || !wb.sheets[i]) return;
		if(editing) commitEdit(0, 0, true);
		wb.active = i;
		sh = wb.sheets[i];
		findHit = null;
		afterChange(true);
		gridEl.focus({
			preventScroll: true
		});
	}

	function structChange(fn) {
		if(editing) commitEdit(0, 0, true);
		const t = begin();
		const before = wb.sheets.slice(),
			ab = wb.active;
		fn();
		t.struct = {
			before, after: wb.sheets.slice(), activeBefore: ab, activeAfter: wb.active
		};
		end();
		sh = wb.sheets[wb.active];
		afterChange(true);
	}

	function uniqueName(base) {
		const have = new Set(wb.sheets.map((s) => s.name.toLowerCase()));
		if(!have.has(base.toLowerCase())) return base;
		let n = 2;
		while(have.has((base + ' (' + n + ')').toLowerCase())) n++;
		return base + ' (' + n + ')';
	}

	function addSheet() {
		structChange(() => {
			let n = wb.sheets.length + 1;
			while(wb.sheets.some((s) => s.name.toLowerCase() === 'sheet' + n)) n++;
			wb.sheets.splice(wb.active + 1, 0, newSheet('Sheet' + n));
			wb.active = wb.active + 1;
		});
	}

	function duplicateSheet(i) {
		structChange(() => {
			const o = wb.sheets[i],
				n = newSheet(uniqueName(o.name + ' copy'));
			o.cells.forEach((c, k) => {
				n.cells.set(k, {
					v: c.v,
					f: c.f,
					s: c.s
				});
			});
			n.maxR = o.maxR;
			n.maxC = o.maxC;
			n.colW = Object.assign({}, o.colW);
			n.rowH = Object.assign({}, o.rowH);
			n.hidden = new Set(o.hidden);
			n.merges = o.merges.map((m) => Object.assign({}, m));
			n.freeze = Object.assign({}, o.freeze);
			n.defColW = o.defColW;
			n.defRowH = o.defRowH;
			if(o.filter) {
				n.filter = {
					r1: o.filter.r1,
					c1: o.filter.c1,
					r2: o.filter.r2,
					c2: o.filter.c2,
					cols: {}
				};
				Object.keys(o.filter.cols).forEach((c) => {
					n.filter.cols[c] = new Set(o.filter.cols[c]);
				});
			}
			if(o.rowManual) n.rowManual = new Set(o.rowManual);
			wb.sheets.splice(i + 1, 0, n);
			wb.active = i + 1;
		});
	}

	function deleteSheet(i) {
		if(wb.sheets.length < 2) {
			showError('A workbook needs at least one sheet.');
			return;
		}
		if(!confirm('Delete the sheet "' + wb.sheets[i].name + '"? Formulas that use it will show #REF!.')) return;
		structChange(() => {
			wb.sheets.splice(i, 1);
			wb.active = Math.min(i, wb.sheets.length - 1);
		});
	}

	function moveSheet(i, d) {
		const j = i + d;
		if(j < 0 || j >= wb.sheets.length) return;
		structChange(() => {
			const s = wb.sheets.splice(i, 1)[0];
			wb.sheets.splice(j, 0, s);
			wb.active = j;
		});
	}

	function renameSheet(i, name) {
		name = name.trim();
		const s = wb.sheets[i];
		if(!name || name === s.name) return;
		if(name.length > 31 || /[\\\/\?\*\[\]:]/.test(name)) {
			showError('Sheet names cannot be longer than 31 characters or contain \\ / ? * [ ] :');
			return;
		}
		if(wb.sheets.some((x, k) => k !== i && x.name.toLowerCase() === name.toLowerCase())) {
			showError('A sheet with that name already exists.');
			return;
		}
		const old = s.name;
		run(() => {
			touchProps(s);
			s.name = name;
			// keep formulas that point at this sheet working
			wb.sheets.forEach((S2) => S2.cells.forEach((cell, k) => {
				if(!cell.f || cell.f.toLowerCase().indexOf(old.toLowerCase()) < 0) return;
				const re = new RegExp("(^|[^A-Za-z0-9_.'])(?:'" + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "''") + "'|" + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ")!", 'gi');
				const nf = cell.f.split(/("(?:[^"]|"")*")/).map((p, i) => (i % 2 ? p : p.replace(re, (m, a) => a + quoteSheet(name) + '!'))).join('');
				if(nf !== cell.f) setCell(S2, keyR(k), keyC(k), {
					v: cell.v,
					f: nf,
					s: cell.s
				});
			}));
		});
		tabSig = '';
		drawAll();
	}

	function editTab(i) {
		const btn = $('xeTabs').querySelector('[data-i="' + i + '"]');
		if(!btn) return;
		const inp = document.createElement('input');
		inp.type = 'text';
		inp.className = 'xe-tab-edit';
		inp.value = wb.sheets[i].name;
		inp.maxLength = 31;
		btn.replaceWith(inp);
		inp.focus();
		inp.select();
		let done = false;
		const fin = (ok) => {
			if(done) return;
			done = true;
			if(ok) renameSheet(i, inp.value);
			tabSig = '';
			drawAll();
			gridEl.focus({
				preventScroll: true
			});
		};
		inp.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if(e.key === 'Enter') fin(true);
			else if(e.key === 'Escape') fin(false);
		});
		inp.addEventListener('blur', () => fin(true));
	}

	$('xeTabs').addEventListener('click', (e) => {
		clearError();
		if(e.target.closest('[data-add]')) {
			addSheet();
			return;
		}
		const b = e.target.closest('[data-i]');
		if(b) switchSheet(+b.dataset.i);
	});

	$('xeTabs').addEventListener('dblclick', (e) => {
		const b = e.target.closest('[data-i]');
		if(b) editTab(+b.dataset.i);
	});

	$('xeTabs').addEventListener('contextmenu', (e) => {
		const b = e.target.closest('[data-i]');
		if(!b) return;
		e.preventDefault();
		const i = +b.dataset.i;
		switchSheet(i);
		showMenu(e.clientX, e.clientY - 150, [
			['Rename', 'ren'],
			['Duplicate', 'dup'],
			['Move left', 'ml'],
			['Move right', 'mr'], '-', ['Delete', 'del']
		]);
		menuEl.onclick = (ev) => {
			const o = ev.target.closest('button');
			if(!o) return;
			hideMenu();
			const op = o.dataset.op;
			if(op === 'ren') editTab(i);
			else if(op === 'dup') duplicateSheet(i);
			else if(op === 'ml') moveSheet(i, -1);
			else if(op === 'mr') moveSheet(i, 1);
			else if(op === 'del') deleteSheet(i);
		};
	});
	
	const fmtBar = $('xeFormat'),
		structBar = $('xeStruct');
	[fmtBar, structBar].forEach((bar) => bar.addEventListener('mousedown', (e) => {
		if(e.target.closest('button')) e.preventDefault();
	}));

	function done() {
		gridEl.focus({
			preventScroll: true
		});

	}
	fmtBar.addEventListener('click', (e) => {
		const b = e.target.closest('button');
		if(!b) return;
		if(editing) commitEdit(0, 0, true);
		clearError();
		if(b.dataset.act === 'undo') {
			undo();
			done();
			return;
		}
		if(b.dataset.act === 'redo') {
			redo();
			done();
			return;
		}
		const f = b.dataset.fmt;
		if(f) {
			if(f.indexOf(':') > 0) {
				const p = f.split(':'),
					o = {};
				o[p[0]] = p[1];
				applyStyle(o);
			} else toggleStyle(f);
			done();
		}
	});

	var fontPick = FontPicker.create({
		btn: $('xeFontBtn'),
		cur: $('xeFontCur'),
		pop: $('xeFontPop'),
		search: $('xeFontSearch'),
		cats: $('xeFontCats'),
		list: $('xeFontList'),
		count: $('xeFontCount'),
		onPick: (n) => {
			loadFont(n);
			applyStyle({
				font: n === wb.defFont ? null : n
			});
			done();
		},
		onClose: () => done()
	});

	$('xeSize').addEventListener('change', () => {
		const v = parseFloat($('xeSize').value);
		if(v > 0) applyStyle({
			sz: v === wb.defSz ? null : v
		});
		done();
	});

	$('xeColor').addEventListener('change', () => {
		applyStyle({
			color: $('xeColor').value.toUpperCase() === '#000000' ? null : $('xeColor').value.toUpperCase()
		});
		done();
	});

	$('xeFill').addEventListener('change', () => {
		applyStyle({
			bg: $('xeFill').value.toUpperCase()
		});
		done();
	});

	$('xeNoFill').addEventListener('click', () => {
		applyStyle({
			bg: null
		});
		done();
	});

	$('xeBorders').addEventListener('change', () => {
		const v = $('xeBorders').value;
		$('xeBorders').value = '';
		if(v) setBorders(v);
		done();
	});

	$('xeMerge').addEventListener('click', () => {
		doOp('merge');
	});

	$('xeNumFmt').addEventListener('change', () => {
		const v = $('xeNumFmt').value;
		applyStyle({
			nf: v === 'General' ? null : v
		});
		done();
	});

	$('xeDecMore').addEventListener('click', () => {
		applyStyle((st) => ({
			nf: changeDecimals(st.nf, 1)
		}));
		done();
	});

	$('xeDecLess').addEventListener('click', () => {
		applyStyle((st) => ({
			nf: changeDecimals(st.nf, -1)
		}));
		done();
	});

	$('xeClearFmt').addEventListener('click', () => {
		doOp('clearFmt');
	});

	structBar.addEventListener('click', (e) => {
		const b = e.target.closest('button[data-op]');
		if(b) doOp(b.dataset.op);
	});

	$('xeFindBtn').addEventListener('click', () => openFind(findBar.classList.contains('is-hidden')));
	
	const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
	const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
	const parseXml = (t) => {
		const d = new DOMParser().parseFromString(t, 'application/xml');
		if(d.getElementsByTagName('parsererror').length) throw new Error('The file contains invalid XML.');
		return d;
	};

	const kids = (n, ln) => {
		const o = [];
		if(!n) return o;
		for(let c = n.firstElementChild; c; c = c.nextElementSibling)
			if(c.localName === ln) o.push(c);
		return o;
	};

	const kid = (n, ln) => {
		if(!n) return null;
		for(let c = n.firstElementChild; c; c = c.nextElementSibling)
			if(c.localName === ln) return c;
		return null;
	};

	const all = (n, ln) => Array.prototype.slice.call(n.getElementsByTagNameNS('*', ln));
	const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];

	function tintColor(hex, tint) {
		if(!tint) return hex;
		let r = parseInt(hex.substr(1, 2), 16) / 255,
			g = parseInt(hex.substr(3, 2), 16) / 255,
			b = parseInt(hex.substr(5, 2), 16) / 255;
		const mx = Math.max(r, g, b),
			mn = Math.min(r, g, b);
		let h = 0,
			s = 0,
			l = (mx + mn) / 2;
		if(mx !== mn) {
			const d = mx - mn;
			s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
			h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
			h /= 6;
		}
		l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
		const f = (p, q, t) => {
			if(t < 0) t += 1;
			if(t > 1) t -= 1;
			return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
		};
		if(s === 0) r = g = b = l;
		else {
			const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
				p = 2 * l - q;
			r = f(p, q, h + 1 / 3);
			g = f(p, q, h);
			b = f(p, q, h - 1 / 3);
		}
		const x = (v) => ('0' + Math.round(clamp(v, 0, 1) * 255).toString(16)).slice(-2);
		return '#' + (x(r) + x(g) + x(b)).toUpperCase();
	}

	function lerp() { /* placeholder to keep section numbering stable */ }

	function colorOf(node, theme) {
		if(!node) return null;
		if(node.getAttribute('auto') === '1') return null;
		let hex = null;
		const rgb = node.getAttribute('rgb'),
			th = node.getAttribute('theme'),
			ix = node.getAttribute('indexed');
		if(rgb) hex = '#' + rgb.slice(-6).toUpperCase();
		else if(th !== null && theme && theme[+th]) hex = theme[+th];
		else if(ix !== null && INDEXED[+ix]) hex = '#' + INDEXED[+ix];
		if(!hex) return null;
		return tintColor(hex, parseFloat(node.getAttribute('tint')) || 0);
	}

	function readTheme(xml) {
		if(!xml) return null;
		const d = parseXml(xml),
			cs = all(d, 'clrScheme')[0];
		if(!cs) return null;
		const get = (n) => {
			const e = kid(cs, n);
			if(!e || !e.firstElementChild) return null;
			const c = e.firstElementChild;
			return '#' + (c.getAttribute('lastClr') || c.getAttribute('val') || '000000').toUpperCase();
		};
		return [get('lt1'), get('dk1'), get('lt2'), get('dk2'), get('accent1'), get('accent2'), get('accent3'), get('accent4'), get('accent5'), get('accent6'), get('hlink'), get('folHlink')];
	}

	const LOCALE_DATE = {
		27: 'yyyy-mm-dd',
		28: 'yyyy-mm-dd',
		29: 'yyyy-mm-dd',
		30: 'm/d/yyyy',
		31: 'yyyy-mm-dd',
		32: 'h:mm',
		33: 'h:mm:ss',
		34: 'h:mm',
		35: 'h:mm:ss',
		36: 'yyyy-mm-dd',
		50: 'yyyy-mm-dd',
		51: 'yyyy-mm-dd',
		52: 'yyyy-mm-dd',
		53: 'yyyy-mm-dd',
		54: 'yyyy-mm-dd',
		55: 'yyyy-mm-dd',
		56: 'yyyy-mm-dd',
		57: 'yyyy-mm-dd',
		58: 'yyyy-mm-dd'
	};

	function readStyles(xml, theme) { // returns { xfs: [styleId], defFont, defSz }
		const out = {
			xfs: [],
			defFont: 'Calibri',
			defSz: 11
		};
		if(!xml) return out;
		const d = parseXml(xml),
			root = d.documentElement;
		const numFmts = {};
		kids(kid(root, 'numFmts'), 'numFmt').forEach((n) => {
			numFmts[n.getAttribute('numFmtId')] = n.getAttribute('formatCode');
		});
		const fonts = kids(kid(root, 'fonts'), 'font').map((f) => {
			const o = {};
			const nm = kid(f, 'name'),
				sz = kid(f, 'sz');
			if(nm) o.name = nm.getAttribute('val');
			if(sz) o.sz = parseFloat(sz.getAttribute('val'));
			const flag = (t) => {
				const e = kid(f, t);
				return !!e && e.getAttribute('val') !== '0' && e.getAttribute('val') !== 'false';
			};
			o.b = flag('b');
			o.i = flag('i');
			o.st = flag('strike');
			const u = kid(f, 'u');
			o.u = !!u && u.getAttribute('val') !== 'none';
			o.color = colorOf(kid(f, 'color'), theme);
			return o;
		});
		if(fonts[0]) {
			out.defFont = fonts[0].name || 'Calibri';
			out.defSz = fonts[0].sz || 11;
		}
		const fills = kids(kid(root, 'fills'), 'fill').map((f) => {
			const pf = kid(f, 'patternFill');
			if(!pf || pf.getAttribute('patternType') !== 'solid') return null;
			return colorOf(kid(pf, 'fgColor'), theme);
		});
		const borders = kids(kid(root, 'borders'), 'border').map((b) => {
			const o = {};
			[
				['left', 'l'],
				['right', 'r'],
				['top', 't'],
				['bottom', 'b']
			].forEach((p) => {
				const e = kid(b, p[0]);
				if(e && e.getAttribute('style')) o[p[1]] = colorOf(kid(e, 'color'), theme) || '#000000';
			});
			return Object.keys(o).length ? o : null;
		});
		kids(kid(root, 'cellXfs'), 'xf').forEach((xf) => {
			const st = {};
			const nid = xf.getAttribute('numFmtId') || '0';
			let nf = numFmts[nid] !== undefined ? numFmts[nid] : (XE.BUILTIN_FMT[nid] || LOCALE_DATE[nid]);
			if(nf && nf !== 'General') st.nf = nf;
			const f = fonts[+xf.getAttribute('fontId') || 0];
			if(f) {
				if(f.name && f.name !== out.defFont) st.font = f.name;
				if(f.sz && f.sz !== out.defSz) st.sz = f.sz;
				if(f.b) st.b = true;
				if(f.i) st.i = true;
				if(f.u) st.u = true;
				if(f.st) st.st = true;
				if(f.color && f.color !== '#000000') st.color = f.color;
			}
			const fl = fills[+xf.getAttribute('fillId') || 0];
			if(fl) st.bg = fl;
			const bd = borders[+xf.getAttribute('borderId') || 0];
			if(bd) st.bd = bd;
			const al = kid(xf, 'alignment');
			if(al) {
				const h = al.getAttribute('horizontal'),
					v = al.getAttribute('vertical');
				if(h === 'left' || h === 'center' || h === 'right') st.al = h;
				if(v === 'top') st.va = 'top';
				else if(v === 'center') st.va = 'middle';
				if(al.getAttribute('wrapText') === '1' || al.getAttribute('wrapText') === 'true') st.wrap = true;
			}
			out.xfs.push(styleId(st));
		});
		return out;
	}

	function resolvePath(base, target) {
		if(target.charAt(0) === '/') return target.slice(1);
		const parts = base.split('/');
		parts.pop();
		target.split('/').forEach((p) => {
			if(p === '..') parts.pop();
			else if(p !== '.') parts.push(p);
		});
		return parts.join('/');
	}

	function siText(si) {
		let t = '';
		(function walk(n) {
			for(let c = n.firstElementChild; c; c = c.nextElementSibling) {
				if(c.localName === 't') t += c.textContent;
				else if(c.localName === 'r') walk(c);
			}
		})(si);
		return t;
	}

	function errFromCode(code) {
		return ERR[code] || ERR['#VALUE!'];
	}

	function readSheetXml(xml, name, shared, sty) {
		const d = parseXml(xml),
			root = d.documentElement;
		const s = newSheet(name);
		s.rowManual = new Set();
		
		const fp = kid(root, 'sheetFormatPr');
		if(fp) {
			const dw = parseFloat(fp.getAttribute('defaultColWidth')),
				bw = parseFloat(fp.getAttribute('baseColWidth'));
			if(dw > 0) s.defColW = Math.round(dw * 7 + (dw > 1 ? 0 : 5));
			else if(bw > 0 && bw !== 8) s.defColW = Math.round(bw * 7 + 5);
			const dh = parseFloat(fp.getAttribute('defaultRowHeight'));
			if(dh > 0) s.defRowH = Math.max(12, Math.round(dh * 4 / 3));
		}
		
		const sv = kid(kid(root, 'sheetViews'), 'sheetView');
		const pane = sv && kid(sv, 'pane');
		if(pane && /frozen/.test(pane.getAttribute('state') || '')) s.freeze = {
			r: parseInt(pane.getAttribute('ySplit')) || 0,
			c: parseInt(pane.getAttribute('xSplit')) || 0
		};
		
		kids(kid(root, 'cols'), 'col').forEach((c) => {
			const mn = (parseInt(c.getAttribute('min')) || 1) - 1,
				mx = Math.min((parseInt(c.getAttribute('max')) || 1) - 1, MAXC - 1);
			const w = parseFloat(c.getAttribute('width'));
			if(!(w >= 0)) return;
			const hid = c.getAttribute('hidden') === '1' || c.getAttribute('hidden') === 'true';
			const px = hid ? 0 : Math.round(w * 7 + 5);
			if(mx - mn > 2000) {
				if(mn < 2000)
					for(let i = mn; i < 2000; i++) s.colW[i] = px;
				return;
			}
			for(let i = mn; i <= mx; i++) s.colW[i] = px;
		});
		
		const shared_f = {};
		let rowNo = -1;
		const rowsEl = kid(root, 'sheetData');
		kids(rowsEl, 'row').forEach((row) => {
			const ra = parseInt(row.getAttribute('r'));
			rowNo = ra ? ra - 1 : rowNo + 1;
			if(rowNo >= MAXR) return;
			const ht = parseFloat(row.getAttribute('ht'));
			if(ht > 0 && (row.getAttribute('customHeight') === '1' || row.getAttribute('customHeight') === 'true' || Math.abs(ht * 4 / 3 - s.defRowH) > 0.6)) {
				s.rowH[rowNo] = Math.round(ht * 4 / 3);
				if(row.getAttribute('customHeight') === '1' || row.getAttribute('customHeight') === 'true') s.rowManual.add(rowNo);
			}
			if(row.getAttribute('hidden') === '1' || row.getAttribute('hidden') === 'true') s.hidden.add(rowNo);
			let colNo = -1;
			kids(row, 'c').forEach((ce) => {
				const ref = ce.getAttribute('r');
				let rr = rowNo,
					cc;
				if(ref) {
					const p = XE.parseCell(ref);
					if(p) {
						rr = p.r;
						cc = p.c;
					}
				}
				if(cc === undefined) cc = colNo + 1;
				colNo = cc;
				if(cc >= MAXC) return;
				const t = ce.getAttribute('t'),
					si = parseInt(ce.getAttribute('s')) || 0;
				const style = sty.xfs[si] || 0;
				const fe = kid(ce, 'f'),
					ve = kid(ce, 'v');
				let v = null,
					f = null;
				const raw = ve ? ve.textContent : null;
				if(t === 's') v = raw !== null && shared[+raw] !== undefined ? shared[+raw] : null;
				else if(t === 'str') v = raw;
				else if(t === 'inlineStr') {
					const is = kid(ce, 'is');
					v = is ? siText(is) : '';
				} else if(t === 'b') v = raw === '1' || raw === 'true';
				else if(t === 'e') v = errFromCode(raw);
				else if(t === 'd') {
					const dd = XE.parseDate(raw);
					v = dd === null ? raw : dd;
				} else if(raw !== null && raw !== '') {
					const n = Number(raw);
					v = isNaN(n) ? raw : n;
				}
				if(fe) {
					let ft = fe.textContent;
					const ty = fe.getAttribute('t'),
						sid = fe.getAttribute('si');
					if(ty === 'shared' && sid !== null) {
						if(ft) shared_f[sid] = {
							f: ft,
							r: rr,
							c: cc
						};
						else if(shared_f[sid]) ft = XE.shiftFormula(shared_f[sid].f, rr - shared_f[sid].r, cc - shared_f[sid].c);
					}
					if(ft) f = ft.replace(/_xlfn\._xlws\./g, '').replace(/_xlfn\./g, '').replace(/_xlws\./g, '');
				}
				if(v === null && !f && !style) return;
				const cell = {
					v: f && v === null ? 0 : v,
					f,
					s: style
				};
				if(f) cell.cached = v;
				s.cells.set(key(rr, cc), cell);
				if(rr > s.maxR) s.maxR = rr;
				if(cc > s.maxC) s.maxC = cc;
			});
		});
		
		kids(kid(root, 'mergeCells'), 'mergeCell').forEach((m) => {
			const rg = XE.parseRange(m.getAttribute('ref'));
			if(rg && (rg.r2 > rg.r1 || rg.c2 > rg.c1)) s.merges.push({
				r1: rg.r1,
				c1: rg.c1,
				r2: rg.r2,
				c2: rg.c2
			});
		});
		
		const af = kid(root, 'autoFilter');
		if(af && af.getAttribute('ref')) {
			const rg = XE.parseRange(af.getAttribute('ref'));
			if(rg) {
				s.filter = {
					r1: rg.r1,
					c1: rg.c1,
					r2: rg.r2,
					c2: rg.c2,
					cols: {}
				};
				kids(af, 'filterColumn').forEach((fc) => {
					const flt = kid(fc, 'filters');
					if(!flt) return;
					const set = new Set();
					kids(flt, 'filter').forEach((x) => set.add(x.getAttribute('val') || ''));
					if(flt.getAttribute('blank') === '1') set.add('');
					s.filter.cols[rg.c1 + (parseInt(fc.getAttribute('colId')) || 0)] = set;
				});
			}
		}
		s.nRows = Math.max(100, s.maxR + 31);
		s.nCols = Math.max(26, s.maxC + 6);
		return s;
	}

	async function readXlsx(buf) {
		if(!window.JSZip) throw new Error('The file library did not load. Reload the page.');
		const zip = await JSZip.loadAsync(buf);
		const text = async(p) => {
			const f = zip.file(p);
			return f ? f.async('string') : null;
		};
		const wbXml = await text('xl/workbook.xml');
		if(!wbXml) throw new Error('This does not look like an Excel (.xlsx) file.');
		const wd = parseXml(wbXml);
		const relsXml = await text('xl/_rels/workbook.xml.rels');
		const rels = {};
		if(relsXml) all(parseXml(relsXml), 'Relationship').forEach((r) => {
			rels[r.getAttribute('Id')] = r.getAttribute('Target');
		});
		const ssXml = await text('xl/sharedStrings.xml');
		const shared = ssXml ? all(parseXml(ssXml), 'si').filter((si) => si.parentNode.localName === 'sst').map(siText) : [];
		const theme = readTheme(await text('xl/theme/theme1.xml'));

		const keepWb = wb,
			keepSh = sh;
		try {
			wb = {
				sheets: [],
				active: 0,
				styles: [{}],
				defFont: 'Calibri',
				defSz: 11
			};
			newStyleTable();
			const sty = readStyles(await text('xl/styles.xml'), theme);
			wb.defFont = sty.defFont;
			wb.defSz = sty.defSz;
			const sheetEls = all(wd, 'sheet');
			for(let i = 0; i < sheetEls.length; i++) {
				const el = sheetEls[i];
				const rid = el.getAttributeNS(NS_REL, 'id') || el.getAttribute('r:id');
				const target = rels[rid];
				if(!target) continue;
				if(el.getAttribute('state') === 'hidden' || el.getAttribute('state') === 'veryHidden') { /* shown anyway: hiding sheets is not supported */ }
				const xml = await text(resolvePath('xl/workbook.xml', target));
				if(!xml) continue;
				wb.sheets.push(readSheetXml(xml, el.getAttribute('name') || 'Sheet' + (i + 1), shared, sty));
			}
			if(!wb.sheets.length) throw new Error('The workbook has no worksheets.');
			const bv = all(wd, 'workbookView')[0];
			wb.active = clamp(bv ? parseInt(bv.getAttribute('activeTab')) || 0 : 0, 0, wb.sheets.length - 1);
			sh = wb.sheets[wb.active];
			return wb;
		} catch(e) {
			wb = keepWb;
			sh = keepSh;
			throw e;
		}
	}

	function parseCsv(t, delim) {
		const rows = [];
		let row = [],
			cur = '',
			q = false;
		for(let i = 0; i < t.length; i++) {
			const ch = t[i];
			if(q) {
				if(ch === '"') {
					if(t[i + 1] === '"') {
						cur += '"';
						i++;
					} else q = false;
				} else cur += ch;
			} else if(ch === '"' && cur === '') q = true;
			else if(ch === delim) {
				row.push(cur);
				cur = '';
			} else if(ch === '\n' || ch === '\r') {
				if(ch === '\r' && t[i + 1] === '\n') i++;
				row.push(cur);
				rows.push(row);
				row = [];
				cur = '';
			} else cur += ch;
		}
		if(cur !== '' || row.length) {
			row.push(cur);
			rows.push(row);
		}
		return rows;
	}

	function readCsv(text, name) {
		text = text.replace(/^﻿/, '');
		const line = text.split(/\r?\n/)[0] || '';
		const cnt = (ch) => line.split(ch).length - 1;
		const delim = cnt('\t') > cnt(',') && cnt('\t') >= cnt(';') ? '\t' : cnt(';') > cnt(',') ? ';' : ',';
		const rows = parseCsv(text, delim);
		if(rows.length > MAXR) throw new Error('The file has too many rows.');
		wb = {
			sheets: [],
			active: 0,
			styles: [{}],
			defFont: 'Calibri',
			defSz: 11
		};
		newStyleTable();
		const s = newSheet(name);
		sh = s;
		wb.sheets.push(s);
		rows.forEach((row, r) => row.forEach((t, c) => {
			if(c >= MAXC || t === '') return;
			const p = parseInput(t, 0);
			if(p.v === null) return;
			s.cells.set(key(r, c), {
				v: p.v,
				f: null,
				s: p.nf ? withStyle(0, {
					nf: p.nf
				}) : 0
			});
			if(r > s.maxR) s.maxR = r;
			if(c > s.maxC) s.maxC = c;
		}));
		s.nRows = Math.max(100, s.maxR + 31);
		s.nCols = Math.max(26, s.maxC + 6);
		return wb;
	}

	function afterOpen(name, msg) {
		resetHistory();
		fileName = name.replace(/\.[^.]+$/, '') || 'spreadsheet';
		$('xeName').value = fileName;
		dirty = false;
		findHit = null;
		clip = null;
		tabSig = '';
		wb.sheets.forEach((s) => {
			s.geomDirty = true;
		});
		sh = wb.sheets[wb.active];
		recalc();
		setStatus(msg, false);
		afterChange(true);
		gridEl.focus({
			preventScroll: true
		});
	}

	async function openFile(file) {
		clearError();
		if(dirty && !confirm('You have unsaved changes. Open another file anyway?')) return;
		setStatus('Opening…', false);
		try {
			if(/\.csv$|\.tsv$|\.txt$/i.test(file.name) || file.type === 'text/csv') {
				const t = await readFile(file, 'text');
				readCsv(t, file.name.replace(/\.[^.]+$/, '').slice(0, 31) || 'Sheet1');
				afterOpen(file.name, 'Opened ' + file.name + ' as a new workbook');
			} else {
				const buf = await readFile(file, 'buffer');
				await readXlsx(buf);
				afterOpen(file.name, 'Opened ' + file.name);
			}
		} catch(e) {
			showError(e && e.message ? e.message : 'The file could not be opened.');
			setStatus(dirty ? 'Unsaved changes' : 'Ready', dirty);
		}
	}

	$('xeOpenBtn').addEventListener('click', () => $('xeFileInput').click());

	$('xeFileInput').addEventListener('change', () => {
		const f = $('xeFileInput').files[0];
		$('xeFileInput').value = '';
		if(f) openFile(f);
	});

	document.addEventListener('dragover', (e) => {
		if(e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault();
	});

	document.addEventListener('drop', (e) => {
		if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
			e.preventDefault();
			openFile(e.dataTransfer.files[0]);
		}
	});

	$('xeNewBtn').addEventListener('click', () => {
		if(dirty && !confirm('You have unsaved changes. Start a new spreadsheet anyway?')) return;
		clearError();
		newWorkbook();
		afterOpen('spreadsheet', 'New spreadsheet');
	});

	const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
	const NEW_FUNCS = ['CONCAT', 'TEXTJOIN', 'IFS', 'SWITCH', 'MAXIFS', 'MINIFS', 'XLOOKUP', 'XMATCH', 'IFNA', 'DAYS', 'FILTER', 'SORT', 'UNIQUE', 'SEQUENCE', 'TEXTBEFORE', 'TEXTAFTER', 'LET'];
	const NEW_RE = new RegExp('(^|[^A-Za-z0-9_.])(' + NEW_FUNCS.join('|') + ')\\(', 'gi');

	function formulaOut(f) {
		return f.split(/("(?:[^"]|"")*")/).map((p, i) => (i % 2 ? p : p.replace(NEW_RE, (m, a, n) => a + '_xlfn.' + n.toUpperCase() + '('))).join('');
	}

	function buildStyles() {
		const fonts = [],
			fontIdx = new Map(),
			fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'],
			fillIdx = new Map(),
			borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'],
			borderIdx = new Map(),
			numFmts = [],
			numIdx = new Map();
		const rev = {};
		Object.keys(XE.BUILTIN_FMT).forEach((k) => {
			if(!(XE.BUILTIN_FMT[k] in rev)) rev[XE.BUILTIN_FMT[k]] = +k;
		});
		const argb = (h) => 'FF' + h.replace('#', '').toUpperCase();
		const fontXml = (o) => '<font>' + (o.b ? '<b/>' : '') + (o.i ? '<i/>' : '') + (o.st ? '<strike/>' : '') + (o.u ? '<u/>' : '') + '<sz val="' + o.sz + '"/><color ' + (o.color ? 'rgb="' + argb(o.color) + '"' : 'theme="1"') + '/><name val="' + xmlEsc(o.name) + '"/><family val="2"/></font>';
		const addFont = (o) => {
			const x = fontXml(o);
			let i = fontIdx.get(x);
			if(i === undefined) {
				i = fonts.length;
				fonts.push(x);
				fontIdx.set(x, i);
			}
			return i;
		};
		addFont({
			name: wb.defFont,
			sz: wb.defSz
		});
		const xfs = wb.styles.map((st) => {
			const fi = addFont({
				name: st.font || wb.defFont,
				sz: st.sz || wb.defSz,
				b: st.b,
				i: st.i,
				u: st.u,
				st: st.st,
				color: st.color
			});
			let fl = 0;
			if(st.bg) {
				const x = '<fill><patternFill patternType="solid"><fgColor rgb="' + argb(st.bg) + '"/><bgColor indexed="64"/></patternFill></fill>';
				fl = fillIdx.get(x);
				if(fl === undefined) {
					fl = fills.length;
					fills.push(x);
					fillIdx.set(x, fl);
				}
			}
			let bi = 0;
			if(st.bd) {
				const side = (n, k) => (st.bd[k] ? '<' + n + ' style="thin"><color rgb="' + argb(st.bd[k]) + '"/></' + n + '>' : '<' + n + '/>');
				const x = '<border>' + side('left', 'l') + side('right', 'r') + side('top', 't') + side('bottom', 'b') + '<diagonal/></border>';
				bi = borderIdx.get(x);
				if(bi === undefined) {
					bi = borders.length;
					borders.push(x);
					borderIdx.set(x, bi);
				}
			}
			let ni = 0;
			if(st.nf && st.nf !== 'General') {
				if(rev[st.nf] !== undefined) ni = rev[st.nf];
				else {
					ni = numIdx.get(st.nf);
					if(ni === undefined) {
						ni = 164 + numFmts.length;
						numFmts.push('<numFmt numFmtId="' + ni + '" formatCode="' + xmlEsc(st.nf) + '"/>');
						numIdx.set(st.nf, ni);
					}
				}
			}
			let al = '';
			if(st.al || (st.va && st.va !== 'bottom') || st.wrap) al = '<alignment' + (st.al ? ' horizontal="' + st.al + '"' : '') + (st.va && st.va !== 'bottom' ? ' vertical="' + (st.va === 'middle' ? 'center' : st.va) + '"' : '') + (st.wrap ? ' wrapText="1"' : '') + '/>';
			return '<xf numFmtId="' + ni + '" fontId="' + fi + '" fillId="' + fl + '" borderId="' + bi + '" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"' + (al ? ' applyAlignment="1">' + al + '</xf>' : '/>');
		});
		return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="' + NS_MAIN + '">' + (numFmts.length ? '<numFmts count="' + numFmts.length + '">' + numFmts.join('') + '</numFmts>' : '') + '<fonts count="' + fonts.length + '">' + fonts.join('') + '</fonts><fills count="' + fills.length + '">' + fills.join('') + '</fills><borders count="' + borders.length + '">' + borders.join('') + '</borders>' + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="' + xfs.length + '">' + xfs.join('') + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
	}

	function buildSheet(s, idx, sst, sstMap) {
		const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">'];
		const hasData = s.maxR >= 0;
		out.push('<dimension ref="' + (hasData ? 'A1:' + addr(Math.max(0, s.maxR), Math.max(0, s.maxC)) : 'A1') + '"/>');
		let sv = '<sheetViews><sheetView workbookViewId="0"' + (idx === wb.active ? ' tabSelected="1"' : '') + '>';
		const fr = s.freeze.r,
			fc = s.freeze.c;
		if(fr || fc) sv += '<pane' + (fc ? ' xSplit="' + fc + '"' : '') + (fr ? ' ySplit="' + fr + '"' : '') + ' topLeftCell="' + addr(fr, fc) + '" activePane="' + (fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight') + '" state="frozen"/>';
		sv += '<selection' + ((fr || fc) ? ' pane="' + (fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight') + '"' : '') + ' activeCell="' + addr(s.sel.ar, s.sel.ac) + '" sqref="' + addr(s.sel.r1, s.sel.c1) + (s.sel.r1 !== s.sel.r2 || s.sel.c1 !== s.sel.c2 ? ':' + addr(s.sel.r2, s.sel.c2) : '') + '"/></sheetView></sheetViews>';
		out.push(sv);
		const dh = Math.round(s.defRowH * 0.75 * 100) / 100;
		out.push('<sheetFormatPr defaultRowHeight="' + dh + '"' + (Math.abs(dh - 15) > 0.01 ? ' customHeight="1"' : '') + (s.defColW !== DEF_COLW ? ' defaultColWidth="' + (Math.round((s.defColW - 5) / 7 * 100) / 100) + '"' : '') + '/>');
		const cw = Object.keys(s.colW).map(Number).sort((a, b) => a - b);
		if(cw.length) {
			let xml = '<cols>';
			for(let i = 0; i < cw.length;) {
				let j = i;
				while(j + 1 < cw.length && cw[j + 1] === cw[j] + 1 && s.colW[cw[j + 1]] === s.colW[cw[i]]) j++;
				const px = s.colW[cw[i]];
				xml += '<col min="' + (cw[i] + 1) + '" max="' + (cw[j] + 1) + '" width="' + (px <= 0 ? 0 : Math.round((px - 5) / 7 * 100) / 100) + '" customWidth="1"' + (px <= 0 ? ' hidden="1"' : '') + '/>';
				i = j + 1;
			}
			out.push(xml + '</cols>');
		}
		out.push('<sheetData>');
		const keys = Array.from(s.cells.keys()).sort((a, b) => a - b);
		const rowsWithProps = new Set(Object.keys(s.rowH).map(Number));
		s.hidden.forEach((r) => rowsWithProps.add(r));
		const rowList = new Map();
		keys.forEach((k) => {
			const r = keyR(k);
			if(!rowList.has(r)) rowList.set(r, []);
			rowList.get(r).push(k);
		});
		rowsWithProps.forEach((r) => {
			if(!rowList.has(r)) rowList.set(r, []);
		});
		Array.from(rowList.keys()).sort((a, b) => a - b).forEach((r) => {
			const hid = s.hidden.has(r),
				h = s.rowH[r];
			let x = '<row r="' + (r + 1) + '"' + (h !== undefined ? ' ht="' + Math.round(h * 0.75 * 100) / 100 + '" customHeight="1"' : '') + (hid ? ' hidden="1"' : '') + '>';
			rowList.get(r).forEach((k) => {
				const cell = s.cells.get(k),
					ref = addr(r, keyC(k)),
					sa = cell.s ? ' s="' + cell.s + '"' : '';
				const v = cell.v;
				let attrs = '',
					inner = '';
				if(cell.f) inner = '<f>' + xmlEsc(formulaOut(cell.f)) + '</f>';
				if(v === null || v === undefined) {
					if(!cell.f) {
						x += '<c r="' + ref + '"' + sa + '/>';
						return;
					}
				} else if(typeof v === 'number') {
					if(isFinite(v)) inner += '<v>' + v + '</v>';
					else {
						attrs = ' t="e"';
						inner += '<v>#NUM!</v>';
					}
				} else if(typeof v === 'boolean') {
					attrs = ' t="b"';
					inner += '<v>' + (v ? 1 : 0) + '</v>';
				} else if(isErr(v)) {
					attrs = ' t="e"';
					inner += '<v>' + (v.code === '#CIRC!' ? '#NUM!' : v.code) + '</v>';
				} else if(cell.f) {
					attrs = ' t="str"';
					inner += '<v>' + xmlEsc(v) + '</v>';
				} else {
					let i = sstMap.get(v);
					if(i === undefined) {
						i = sst.length;
						sst.push(v);
						sstMap.set(v, i);
					}
					attrs = ' t="s"';
					inner += '<v>' + i + '</v>';
				}
				x += '<c r="' + ref + '"' + sa + attrs + '>' + inner + '</c>';
			});
			out.push(x + '</row>');
		});
		out.push('</sheetData>');
		if(s.filter) {
			const f = s.filter;
			let x = '<autoFilter ref="' + addr(f.r1, f.c1) + ':' + addr(f.r2, f.c2) + '">';
			Object.keys(f.cols).forEach((c) => {
				const set = f.cols[c],
					vals = [];
				set.forEach((t) => vals.push(t));
				x += '<filterColumn colId="' + (c - f.c1) + '"><filters' + (set.has('') ? ' blank="1"' : '') + '>' + vals.filter((t) => t !== '').map((t) => '<filter val="' + xmlEsc(t) + '"/>').join('') + '</filters></filterColumn>';
			});
			out.push(x + '</autoFilter>');
		}
		if(s.merges.length) out.push('<mergeCells count="' + s.merges.length + '">' + s.merges.map((m) => '<mergeCell ref="' + addr(m.r1, m.c1) + ':' + addr(m.r2, m.c2) + '"/>').join('') + '</mergeCells>');
		out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
		return out.join('');
	}

	async function buildXlsx() {
		recalc();
		const zip = new JSZip(),
			sst = [],
			sstMap = new Map();
		const sheetsXml = wb.sheets.map((s, i) => buildSheet(s, i, sst, sstMap));
		const n = wb.sheets.length;
		zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + wb.sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
		zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
		const relBase = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
		zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + wb.sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + relBase + 'worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (n + 1) + '" Type="' + relBase + 'styles" Target="styles.xml"/><Relationship Id="rId' + (n + 2) + '" Type="' + relBase + 'sharedStrings" Target="sharedStrings.xml"/></Relationships>');
		const names = wb.sheets.map((s, i) => s.filter ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">' + xmlEsc(quoteSheet(s.name)) + '!$' + XE.colName(s.filter.c1) + '$' + (s.filter.r1 + 1) + ':$' + XE.colName(s.filter.c2) + '$' + (s.filter.r2 + 1) + '</definedName>' : '').join('');
		zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '"><bookViews><workbookView activeTab="' + wb.active + '"/></bookViews><sheets>' + wb.sheets.map((s, i) => '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>' + (names ? '<definedNames>' + names + '</definedNames>' : '') + '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
		zip.file('xl/styles.xml', buildStyles());
		sheetsXml.forEach((x, i) => zip.file('xl/worksheets/sheet' + (i + 1) + '.xml', x));
		zip.file('xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="' + NS_MAIN + '" count="' + sst.length + '" uniqueCount="' + sst.length + '">' + sst.map((t) => '<si><t xml:space="preserve">' + xmlEsc(t) + '</t></si>').join('') + '</sst>');
		return zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE',
			mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		});
	}

	async function save() {
		if(editing) commitEdit(0, 0, true);
		clearError();
		setStatus('Saving…', dirty);
		try {
			const blob = await buildXlsx();
			const nm = ($('xeName').value.trim().replace(/[\\/:*?"<>|]+/g, '_') || 'spreadsheet') + '.xlsx';
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = nm;
			document.body.appendChild(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 4000);
			dirty = false;
			setStatus('Saved ' + nm, false);
		} catch(e) {
			showError('The file could not be saved: ' + (e && e.message ? e.message : e));
			setStatus('Unsaved changes', true);
		}
	}

	$('xeSaveBtn').addEventListener('click', save);
	window.addEventListener('beforeunload', (e) => {
		if(dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	});

	document.addEventListener('keydown', (e) => {
		if((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
			const k = e.key.toLowerCase();
			if(k === 's') {
				e.preventDefault();
				save();
			} else if(k === 'f' || k === 'h') {
				e.preventDefault();
				openFind(true);
			}
		}
	});

	window.XEDebug = {get wb() {
			return wb;
		},
		get sh() {
			return sh;
		},
		buildXlsx,
		readXlsx,
		afterOpen,
		setInput,
		run,
		recalc,
		doOp,
		applyStyle,
		addSheet,
		shiftAxis,
		doSort,
		toggleFilter,
		findStep,
		switchSheet,
		openFile,
		copySel,
		pasteText
	};
	
	(function init() {
		newWorkbook();
		resetHistory();
		setSel(0, 0);
		dirty = false;
		setStatus('New spreadsheet', false);
		drawAll();
		scheduleDraw();
		gridEl.focus({
			preventScroll: true
		});
	})();
})();