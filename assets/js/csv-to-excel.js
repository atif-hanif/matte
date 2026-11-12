(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const stage = $('cxStage'),
		dropMsg = $('cxDropMsg'),
		fileInput = $('cxFileInput'),
		grid = $('cxGrid');
	const toolbar = $('cxToolbar'),
		toolbarStatus = $('cxToolbarStatus'),
		clearBtn = $('cxClearBtn'),
		downloadAllBtn = $('cxDownloadAllBtn');
	const errBox = $('cxErr'),
		delimEl = $('cxDelim'),
		typesEl = $('cxTypes'),
		headerEl = $('cxHeader'),
		combineEl = $('cxCombine'),
		hintEl = $('cxHint');
	const dropBig = dropMsg.querySelector('.big'),
		dropSmall = dropMsg.querySelector('.small');
	const MAXR = 1048576,
		MAXC = 16384;
	let items = [],
		idCounter = 0,
		working = false;
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

	function isCsv(f) {
		return /\.(csv|tsv|txt)$/i.test(f.name) || /^text\/(csv|plain|tab-separated-values)/i.test(f.type);
	}

	function stem(item) {
		return item.file.name.replace(/\.[^.]+$/, '') || 'data';
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
		dropBig.textContent = items.length ? 'Drop more CSV files here' : 'Drop CSV files here';
		dropSmall.innerHTML = items.length ? 'or <b>click to add more</b>' : 'or <b>click to browse</b> — .csv, .tsv or .txt files, as many as you like';
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
	const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
	
	async function readText(file) {
		const buf = await file.arrayBuffer();
		try {
			return new TextDecoder('utf-8', {
				fatal: true
			}).decode(buf).replace(/^﻿/, '');
		} catch(e) {
			return new TextDecoder('windows-1252').decode(buf);
		}
	}

	function detectDelim(text) {
		const line = text.slice(0, 4000).split(/\r?\n/).find((l) => l.trim() !== '') || '';
		let best = ',',
			bestN = -1;
		[',', ';', '\t', '|'].forEach((d) => {
			let n = 0,
				q = false;
			for(let i = 0; i < line.length; i++) {
				const ch = line[i];
				if(ch === '"') q = !q;
				else if(!q && ch === d) n++;
			}
			if(n > bestN) {
				best = d;
				bestN = n;
			}
		});
		return best;
	}

	function parseCsv(t, delim) {
		const rows = [];
		let row = [],
			cur = '',
			q = false,
			any = false;
		for(let i = 0; i < t.length; i++) {
			const ch = t[i];
			if(q) {
				if(ch === '"') {
					if(t[i + 1] === '"') {
						cur += '"';
						i++;
					} else q = false;
				} else cur += ch;
			} else if(ch === '"' && cur === '') {
				q = true;
				any = true;
			} else if(ch === delim) {
				row.push(cur);
				cur = '';
				any = true;
			} else if(ch === '\n' || ch === '\r') {
				if(ch === '\r' && t[i + 1] === '\n') i++;
				row.push(cur);
				rows.push(row);
				row = [];
				cur = '';
				any = false;
			} else {
				cur += ch;
				any = true;
			}
		}
		if(cur !== '' || row.length || any) {
			row.push(cur);
			rows.push(row);
		}
		return rows;
	}
	
	const RE_NUM = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
	const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
	const RE_DT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;
	
	const S_TEXT = 0,
		S_HEAD = 1,
		S_DATE = 2,
		S_DT = 3,
		S_PCT0 = 4,
		S_PCT2 = 5;

	function typed(text, convert) {
		if(text === '') return null;
		if(!convert) return {
			t: 's',
			v: text
		};
		const s = text.trim();
		if(RE_NUM.test(s)) {
			const digits = s.replace(/^[-+]/, '');
			const leadingZero = /^0\d/.test(digits);
			const sig = digits.replace(/[.eE].*$/, '').length;
			if(!leadingZero && sig <= 15 && isFinite(Number(s))) return {
				t: 'n',
				v: Number(s)
			};
			return {
				t: 's',
				v: text
			};
		}
		if(/^[-+]?\d+(\.\d+)?%$/.test(s)) {
			const body = s.slice(0, -1);
			return {
				t: 'n',
				v: Number(body) / 100,
				s: /\./.test(body) ? S_PCT2 : S_PCT0
			};
		}
		if(/^(TRUE|FALSE)$/i.test(s)) return {
			t: 'b',
			v: s.toUpperCase() === 'TRUE' ? 1 : 0
		};
		if(RE_DATE.test(s) || RE_DT.test(s)) {
			const n = XE.parseDate(s.replace('T', ' '));
			if(typeof n === 'number' && isFinite(n)) return {
				t: 'n',
				v: n,
				s: RE_DATE.test(s) ? S_DATE : S_DT
			};
		}
		return {
			t: 's',
			v: text
		};
	}
	
	const colName = (c) => {
		let s = '';
		for(c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
		return s;
	};

	function sheetXml(rows, convert, header, sst, sstMap) {
		const nCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
		const widths = new Array(nCols).fill(8);
		const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
		out.push('<dimension ref="A1:' + colName(Math.max(0, nCols - 1)) + Math.max(1, rows.length) + '"/>');
		out.push('<sheetViews><sheetView workbookViewId="0">' + (header && rows.length > 1 ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>' : '') + '</sheetView></sheetViews>');
		out.push('<sheetFormatPr defaultRowHeight="15"/>');
		const body = [];
		rows.forEach((row, r) => {
			const cells = [];
			row.forEach((text, c) => {
				const isHead = header && r === 0;
				const v = isHead ? (text === '' ? null : {
					t: 's',
					v: text,
					s: S_HEAD
				}) : typed(text, convert);
				if(r < 200) {
					const len = v ? (v.t === 's' ? Math.min(...[String(v.v).length, 60]) : String(text).length) : 0;
					if(len + 2 > widths[c]) widths[c] = Math.min(50, len + 2);
				}
				if(!v) return;
				const ref = colName(c) + (r + 1),
					st = v.s ? ' s="' + v.s + '"' : '';
				if(v.t === 'n') cells.push('<c r="' + ref + '"' + st + '><v>' + v.v + '</v></c>');
				else if(v.t === 'b') cells.push('<c r="' + ref + '" t="b"><v>' + v.v + '</v></c>');
				else {
					let i = sstMap.get(v.v);
					if(i === undefined) {
						i = sst.length;
						sst.push(v.v);
						sstMap.set(v.v, i);
					}
					cells.push('<c r="' + ref + '"' + st + ' t="s"><v>' + i + '</v></c>');
				}
			});
			body.push('<row r="' + (r + 1) + '">' + cells.join('') + '</row>');
		});
		if(nCols) out.push('<cols>' + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + Math.max(8.43, w) + '" customWidth="1"/>').join('') + '</cols>');
		out.push('<sheetData>' + body.join('') + '</sheetData>');
		out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
		return out.join('');
	}

	const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/></numFmts>' + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' + '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' + '<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

	function sheetName(raw, taken) {
		let n = (raw.replace(/[\\\/\?\*\[\]:]+/g, ' ').trim() || 'Sheet').slice(0, 31);
		let c = n,
			k = 2;
		while(taken.has(c.toLowerCase())) {
			const suf = ' (' + k++ + ')';
			c = n.slice(0, 31 - suf.length) + suf;
		}
		taken.add(c.toLowerCase());
		return c;
	}

	async function buildXlsx(list) { // list: [{ name, rows }]
		const o = {
			convert: typesEl.checked,
			header: headerEl.checked
		};
		const zip = new JSZip(),
			sst = [],
			sstMap = new Map(),
			taken = new Set();
		const names = list.map((s) => sheetName(s.name, taken));
		const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
		list.forEach((s, i) => zip.file('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s.rows, o.convert, o.header, sst, sstMap)));
		const n = list.length;
		zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + list.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
		zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="' + R + 'officeDocument" Target="xl/workbook.xml"/></Relationships>');
		zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + list.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + R + 'worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (n + 1) + '" Type="' + R + 'styles" Target="styles.xml"/><Relationship Id="rId' + (n + 2) + '" Type="' + R + 'sharedStrings" Target="sharedStrings.xml"/></Relationships>');
		zip.file('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>' + names.map((nm, i) => '<sheet name="' + xmlEsc(nm) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
		zip.file('xl/styles.xml', STYLES);
		zip.file('xl/sharedStrings.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + sst.length + '" uniqueCount="' + sst.length + '">' + sst.map((t) => '<si><t xml:space="preserve">' + xmlEsc(t) + '</t></si>').join('') + '</sst>');
		return zip.generateAsync({
			type: 'blob',
			compression: 'DEFLATE',
			mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
		});
	}
	
	function rowsOf(item) {
		return parseCsv(item.text, delimEl.value === 'auto' ? detectDelim(item.text) : delimEl.value);
	}

	function makeCard(item) {
		const card = document.createElement('div');
		card.className = 'card';
		card.innerHTML = '<div class="thumb cx-thumb"><div class="cx-ph">CSV</div></div>' + '<div class="card-foot">' + '<div class="card-foot-row"><div class="card-name"></div><div class="card-status pending" data-status>Queued</div>' + '<button class="card-dl" data-dl disabled title="Download Excel file">⬇</button></div>' + '<div class="card-dims" data-info></div></div>';
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

	function showInfo(item) {
		const rows = rowsOf(item),
			cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
		item.card.querySelector('[data-info]').textContent = formatBytes(item.file.size) + ' · ' + rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' · ' + cols + ' column' + (cols === 1 ? '' : 's');
		const th = item.card.querySelector('.thumb');
		let p = th.querySelector('.cx-preview');
		if(!p) {
			const ph = th.querySelector('.cx-ph');
			if(ph) ph.remove();
			p = document.createElement('div');
			p.className = 'cx-preview';
			th.insertBefore(p, th.firstChild);
		}
		p.textContent = rows.slice(0, 8).map((r) => r.slice(0, 6).map((c) => (c.length > 14 ? c.slice(0, 13) + '…' : c)).join(' │ ')).join('\n');
		item.rowsN = rows.length;
		item.colsN = cols;
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
			item.text = await readText(item.file);
			showInfo(item);
			if(item.rowsN > MAXR || item.colsN > MAXC) throw new Error('Too big for one Excel sheet (limit ' + MAXR.toLocaleString() + ' rows, ' + MAXC.toLocaleString() + ' columns).');
			if(!item.text.trim()) throw new Error('The file is empty.');
			item.status = 'ready';
			setStatus(item, 'Ready', 'done');
			item.card.querySelector('[data-dl]').disabled = false;
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
		showVeil(item.card);
		try {
			triggerDownload(await buildXlsx([{
				name: stem(item),
				rows: rowsOf(item)
			}]), stem(item).replace(/[\\/:*?"<>|]+/g, '_') + '.xlsx');
		} catch(e) {
			console.error(e);
			showError('Could not build ' + item.file.name + ': ' + (e && e.message ? e.message : e));
		}
		hideVeil(item.card);
	}

	function addFiles(list) {
		const every = Array.from(list),
			files = every.filter(isCsv);
		if(!files.length) {
			showError("Those don't look like CSV files.");
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
				text: ''
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

	delimEl.addEventListener('change', () => items.forEach((i) => {
		if(i.status === 'ready') showInfo(i);
	}));

	clearBtn.addEventListener('click', () => {
		if(working) return;
		items = [];
		grid.innerHTML = '';
		stage.classList.remove('compact');
		toolbar.classList.remove('show');
		clearError();
		refreshDropMsg();
	});

	function syncDownloadLabel() {
		downloadAllBtn.textContent = combineEl.checked ? 'Download workbook' : 'Download all (.zip)';
	}

	combineEl.addEventListener('change', syncDownloadLabel);
	syncDownloadLabel();
	downloadAllBtn.addEventListener('click', async() => {
		const ready = items.filter((i) => i.status === 'ready');
		if(!ready.length || working) return;
		working = true;
		clearError();
		updateToolbar();
		try {
			if(combineEl.checked || ready.length === 1) {
				const blob = await buildXlsx(ready.map((i) => ({
					name: stem(i),
					rows: rowsOf(i)
				})));
				triggerDownload(blob, (ready.length === 1 ? stem(ready[0]).replace(/[\\/:*?"<>|]+/g, '_') : 'matte-workbook') + '.xlsx');
			} else {
				const zip = new JSZip(),
					taken = new Set();
				for(const it of ready) zip.file(uniqueName(stem(it).replace(/[\\/:*?"<>|]+/g, '_') + '.xlsx', taken), await buildXlsx([{
					name: stem(it),
					rows: rowsOf(it)
				}]));
				triggerDownload(await zip.generateAsync({
					type: 'blob'
				}), 'matte-excel-files.zip');
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