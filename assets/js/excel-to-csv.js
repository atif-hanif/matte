(function() {
	'use strict';
	
	const $ = (id) => document.getElementById(id);
	const stage = $('xcStage'),
		dropMsg = $('xcDropMsg'),
		fileInput = $('xcFileInput'),
		grid = $('xcGrid');
	const toolbar = $('xcToolbar'),
		toolbarStatus = $('xcToolbarStatus'),
		clearBtn = $('xcClearBtn'),
		downloadAllBtn = $('xcDownloadAllBtn');
	const errBox = $('xcErr'),
		modeBox = $('xcMode'),
		delimEl = $('xcDelim'),
		bomEl = $('xcBom'),
		hintEl = $('xcHint');
	const dropBig = dropMsg.querySelector('.big'),
		dropSmall = dropMsg.querySelector('.small');
	let items = [],
		idCounter = 0,
		working = false,
		mode = 'shown';
	const HINTS = {
		shown: 'Numbers, dates and percentages look the way they do in Excel (for example 1,234.50 or 2024-03-05).',
		raw: 'Writes the stored values: dates become serial numbers and 12.5% becomes 0.125.'
	};

	hintEl.textContent = HINTS.shown;
	if(!window.JSZip || !window.XE) showError('A needed library did not load. Check assets/vendors/jszip and xlsx-engine.js.');
	
	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function formatBytes(n) {
		if(n < 1024) return n + ' B';
		if(n < 1024 * 1024) return(n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
		return(n / 1024 / 1024).toFixed(2) + ' MB';
	}

	function isXlsx(f) {
		return /\.(xlsx|xlsm|xltx|xltm)$/i.test(f.name) || /spreadsheetml/i.test(f.type);
	}

	function stem(item) {
		return item.file.name.replace(/\.[^.]+$/, '') || 'workbook';
	}

	function safe(s) {
		return String(s).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'sheet';
	}

	function uniqueName(name, taken) {
		if(!taken.has(name)) {
			taken.add(name);
			return name;
		}
		const dot = name.lastIndexOf('.'),
			st = dot > -1 ? name.slice(0, dot) : name,
			ext = dot > -1 ? name.slice(dot) : '';
		let n = 2,
			c;
		do {
			c = st + ' (' + n++ + ')' + ext;
		} while (taken.has(c));
		taken.add(c);
		return c;
	}

	function triggerDownload(blob, filename) {
		const url = URL.createObjectURL(blob),
			a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}

	function refreshDropMsg() {
		dropBig.textContent = items.length ? 'Drop more Excel files here' : 'Drop Excel files here';
		dropSmall.innerHTML = items.length ? 'or <b>click to add more</b>' : 'or <b>click to browse</b> — .xlsx files, as many as you like';
	}

	function showVeil(card) {
		const thumb = card.querySelector('.thumb');
		if(!thumb.querySelector('.veil')) {
			const v = document.createElement('div');
			v.className = 'veil show';
			v.innerHTML = '<div class="mini-spinner"></div>';
			thumb.appendChild(v);
		}
	}

	function hideVeil(card) {
		const v = card.querySelector('.thumb .veil');
		if(v) v.remove();
	}
	
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

	const LOCALE_FMT = {
		27: 'yyyy-mm-dd',
		28: 'yyyy-mm-dd',
		29: 'yyyy-mm-dd',
		30: 'm/d/yyyy',
		31: 'yyyy-mm-dd',
		32: 'h:mm',
		33: 'h:mm:ss',
		34: 'h:mm',
		35: 'h:mm:ss',
		36: 'yyyy-mm-dd'
	};

	function readFormats(xml) {
		const out = [];
		if(!xml) return out;
		const root = parseXml(xml).documentElement,
			custom = {};
		kids(kid(root, 'numFmts'), 'numFmt').forEach((n) => {
			custom[n.getAttribute('numFmtId')] = n.getAttribute('formatCode');
		});
		kids(kid(root, 'cellXfs'), 'xf').forEach((xf) => {
			const id = xf.getAttribute('numFmtId') || '0';
			let code = custom[id] !== undefined ? custom[id] : (XE.BUILTIN_FMT[id] || LOCALE_FMT[id] || (+id >= 50 && +id <= 58 ? 'yyyy-mm-dd' : 'General'));
			out.push(code);
		});
		return out;
	}

	function readSheet(xml, shared, formats) {
		const root = parseXml(xml).documentElement;
		const rows = [];
		let maxR = -1,
			maxC = -1,
			rowNo = -1;
		kids(kid(root, 'sheetData'), 'row').forEach((row) => {
			const ra = parseInt(row.getAttribute('r'));
			rowNo = ra ? ra - 1 : rowNo + 1;
			let colNo = -1;
			kids(row, 'c').forEach((ce) => {
				const ref = ce.getAttribute('r');
				let cc;
				if(ref) {
					const p = XE.parseCell(ref);
					if(p) cc = p.c;
				}
				if(cc === undefined) cc = colNo + 1;
				colNo = cc;
				const t = ce.getAttribute('t'),
					ve = kid(ce, 'v'),
					raw = ve ? ve.textContent : null;
				let v = null,
					kind = 's';
				if(t === 's') v = raw !== null && shared[+raw] !== undefined ? shared[+raw] : null;
				else if(t === 'str') v = raw;
				else if(t === 'inlineStr') {
					const is = kid(ce, 'is');
					v = is ? siText(is) : '';
				} else if(t === 'b') {
					v = raw === '1' || raw === 'true' ? 'TRUE' : 'FALSE';
				} else if(t === 'e') v = raw;
				else if(t === 'd') {
					const d = XE.parseDate(raw);
					if(d === null) v = raw;
					else {
						v = d;
						kind = 'n';
					}
				} else if(raw !== null && raw !== '') {
					const n = Number(raw);
					if(isNaN(n)) v = raw;
					else {
						v = n;
						kind = 'n';
					}
				}
				if(v === null || v === '') return;
				const code = formats[parseInt(ce.getAttribute('s')) || 0] || 'General';
				if(!rows[rowNo]) rows[rowNo] = [];
				rows[rowNo][cc] = {
					v, kind, code
				};
				if(rowNo > maxR) maxR = rowNo;
				if(cc > maxC) maxC = cc;
			});
		});
		return {
			rows, maxR, maxC
		};
	}
	
	async function readWorkbook(file) {
		const zip = await JSZip.loadAsync(await file.arrayBuffer());
		const text = async(p) => {
			const f = zip.file(p);
			return f ? f.async('string') : null;
		};
		const wbXml = await text('xl/workbook.xml');
		if(!wbXml) throw new Error('This does not look like an Excel (.xlsx) file.');
		const wd = parseXml(wbXml);
		const relsXml = await text('xl/_rels/workbook.xml.rels'),
			rels = {};
		if(relsXml) all(parseXml(relsXml), 'Relationship').forEach((r) => {
			rels[r.getAttribute('Id')] = r.getAttribute('Target');
		});
		const ssXml = await text('xl/sharedStrings.xml');
		const shared = ssXml ? all(parseXml(ssXml), 'si').filter((si) => si.parentNode.localName === 'sst').map(siText) : [];
		const formats = readFormats(await text('xl/styles.xml'));
		const sheets = [];
		let hidden = 0;
		for(const el of all(wd, 'sheet')) {
			const rid = el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || el.getAttribute('r:id');
			const target = rels[rid];
			if(!target) continue;
			if(/hidden/i.test(el.getAttribute('state') || '')) {
				hidden++;
				continue;
			}
			const xml = await text(resolvePath('xl/workbook.xml', target));
			if(!xml) continue; // chart sheets have no cells
			const s = readSheet(xml, shared, formats);
			s.name = el.getAttribute('name') || 'Sheet' + (sheets.length + 1);
			sheets.push(s);
		}
		if(!sheets.length) throw new Error(hidden ? 'All sheets in this workbook are hidden.' : 'The workbook has no worksheets.');
		return sheets;
	}
	
	function cellText(c, raw) {
		if(!c) return '';
		if(c.kind === 'n') return raw ? XE.numToStr(c.v) : XE.format(c.v, c.code);
		return String(c.v);
	}

	function csvOf(sheet, delim, raw, bom) {
		const out = [];
		for(let r = 0; r <= sheet.maxR; r++) {
			const row = sheet.rows[r],
				cells = [];
			for(let c = 0; c <= sheet.maxC; c++) {
				const t = cellText(row && row[c], raw);
				cells.push(t.indexOf(delim) >= 0 || /["\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t);
			}
			out.push(cells.join(delim));
		}
		return(bom ? '﻿' : '') + out.join('\r\n') + (out.length ? '\r\n' : '');
	}

	function opts() {
		return {
			delim: delimEl.value,
			raw: mode === 'raw',
			bom: bomEl.checked
		};
	}

	function fileList(item) { // [{ name, text }]
		const o = opts(),
			taken = new Set(),
			one = item.sheets.length === 1;
		return item.sheets.map((s) => ({
			name: uniqueName(one ? safe(stem(item)) + '.csv' : safe(stem(item)) + ' - ' + safe(s.name) + '.csv', taken),
			text: csvOf(s, o.delim, o.raw, o.bom)
		}));
	}

	function previewOf(sheet) {
		const o = opts(),
			lines = [];
		for(let r = 0; r <= Math.min(sheet.maxR, 7); r++) {
			const cells = [];
			for(let c = 0; c <= Math.min(sheet.maxC, 5); c++) cells.push(cellText(sheet.rows[r] && sheet.rows[r][c], o.raw));
			lines.push(cells.join(o.delim === '\t' ? ' │ ' : o.delim + ' '));
		}
		return lines.join('\n');
	}

	function makeCard(item) {
		const card = document.createElement('div');
		card.className = 'card';
		card.innerHTML = '<div class="thumb xc-thumb"><div class="xc-ph">XLSX</div></div>' + '<div class="card-foot">' + '<div class="card-foot-row"><div class="card-name"></div><div class="card-status pending" data-status>Queued</div>' + '<button class="card-dl" data-dl disabled title="Download CSV">⬇</button></div>' + '<div class="card-dims" data-info></div></div>';
		card.querySelector('.card-name').textContent = item.file.name;
		card.querySelector('[data-info]').textContent = formatBytes(item.file.size);
		card.querySelector('[data-dl]').addEventListener('click', () => downloadOne(item));
		grid.appendChild(card);
		return card;
	}

	function setStatus(item, text, cls) {
		const s = item.card.querySelector('[data-status]');
		s.textContent = text;
		s.className = 'card-status ' + cls;
	}

	function showPreview(item) {
		const th = item.card.querySelector('.thumb');
		let p = th.querySelector('.xc-preview');
		if(!p) {
			const ph = th.querySelector('.xc-ph');
			if(ph) ph.remove();
			p = document.createElement('div');
			p.className = 'xc-preview';
			th.insertBefore(p, th.firstChild);
		}
		p.textContent = previewOf(item.sheets[0]);
	}

	function updateToolbar() {
		const total = items.length,
			ready = items.filter((i) => i.status === 'ready').length,
			bad = items.filter((i) => i.status === 'error').length;
		if(working) toolbarStatus.innerHTML = '<div class="mini-spinner"></div> Working…';
		else if(total && ready + bad === total) toolbarStatus.textContent = bad ? ready + ' ready, ' + bad + ' failed' : ready + ' file' + (ready === 1 ? '' : 's') + ' ready';
		else toolbarStatus.textContent = total + ' file' + (total === 1 ? '' : 's') + ' queued';
		downloadAllBtn.disabled = working || ready === 0;
	}

	async function prepare(item) {
		showVeil(item.card);
		setStatus(item, 'Reading…', 'processing');
		try {
			item.sheets = await readWorkbook(item.file);
			item.status = 'ready';
			setStatus(item, 'Ready', 'done');
			const rows = item.sheets.reduce((a, s) => a + s.maxR + 1, 0);
			item.card.querySelector('[data-info]').textContent = formatBytes(item.file.size) + ' · ' + item.sheets.length + ' sheet' + (item.sheets.length === 1 ? '' : 's') + ' · ' + rows + ' row' + (rows === 1 ? '' : 's');
			item.card.querySelector('[data-dl]').disabled = false;
			item.card.querySelector('[data-dl]').title = item.sheets.length === 1 ? 'Download CSV' : 'Download CSV files (.zip)';
			showPreview(item);
		} catch(e) {
			console.error(e);
			item.status = 'error';
			setStatus(item, 'Failed', 'error');
			item.card.title = e && e.message ? e.message : String(e);
			showError('Could not read ' + item.file.name + ': ' + (e && e.message ? e.message : e));
		}
		hideVeil(item.card);
	}

	async function processQueue() {
		if(working) return;
		working = true;
		updateToolbar();
		for(const item of items)
			if(item.status === 'pending') await prepare(item);
		working = false;
		updateToolbar();
	}

	async function downloadOne(item) {
		if(working || item.status !== 'ready') return;
		clearError();
		const files = fileList(item);
		if(files.length === 1) {
			triggerDownload(new Blob([files[0].text], {
				type: 'text/csv;charset=utf-8'
			}), files[0].name);
			return;
		}
		const zip = new JSZip();
		files.forEach((f) => zip.file(f.name, f.text));
		triggerDownload(await zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE'
		}), safe(stem(item)) + '.zip');
	}

	function addFiles(list) {
		const every = Array.from(list),
			files = every.filter(isXlsx);
		if(!files.length) {
			showError(every.some((f) => /\.xls$/i.test(f.name)) ? 'Old .xls files are not supported. Open it in Excel and save it as .xlsx first.' : "Those don't look like .xlsx files.");
			return;
		}
		clearError();
		stage.classList.add('compact');
		toolbar.classList.add('show');
		files.forEach((file) => {
			const item = {
				id: ++idCounter,
				file,
				status: 'pending',
				sheets: []
			};
			item.card = makeCard(item);
			items.push(item);
		});
		refreshDropMsg();
		updateToolbar();
		processQueue();
	}

	stage.addEventListener('click', () => fileInput.click());
	fileInput.addEventListener('change', (e) => {
		if(e.target.files.length) addFiles(e.target.files);
		fileInput.value = '';
	});

	['dragenter', 'dragover'].forEach((ev) => stage.addEventListener(ev, (e) => {
		e.preventDefault();
		stage.classList.add('drag');
	}));

	['dragleave', 'drop'].forEach((ev) => stage.addEventListener(ev, (e) => {
		e.preventDefault();
		stage.classList.remove('drag');
	}));

	stage.addEventListener('drop', (e) => {
		if(e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
	});

	function refreshPreviews() {
		items.forEach((i) => {
			if(i.status === 'ready') showPreview(i);
		});
	}

	modeBox.addEventListener('click', (e) => {
		const b = e.target.closest('.mode-btn');
		if(!b) return;
		mode = b.dataset.mode;
		modeBox.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
		hintEl.textContent = HINTS[mode];
		refreshPreviews();
	});

	delimEl.addEventListener('change', refreshPreviews);
	clearBtn.addEventListener('click', () => {
		if(working) return;
		items = [];
		grid.innerHTML = '';
		stage.classList.remove('compact');
		toolbar.classList.remove('show');
		clearError();
		refreshDropMsg();
	});

	downloadAllBtn.addEventListener('click', async() => {
		const ready = items.filter((i) => i.status === 'ready');
		if(!ready.length || working) return;
		working = true;
		clearError();
		updateToolbar();
		try {
			const taken = new Set();
			const flat = [];
			ready.forEach((it) => fileList(it).forEach((f) => flat.push({
				name: uniqueName(f.name, taken),
				text: f.text
			})));
			if(flat.length === 1) triggerDownload(new Blob([flat[0].text], {
				type: 'text/csv;charset=utf-8'
			}), flat[0].name);
			else {
				const zip = new JSZip();
				flat.forEach((f) => zip.file(f.name, f.text));
				triggerDownload(await zip.generateAsync({
					type: 'blob',
					compression: 'DEFLATE'
				}), 'matte-csv-files.zip');
			}
		} catch(e) {
			console.error(e);
			showError('Could not build the download: ' + (e && e.message ? e.message : e));
		}
		working = false;
		updateToolbar();
	});
	refreshDropMsg();
})();