(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const leftEl = $('dcLeft'),
		rightEl = $('dcRight'),
		outEl = $('dcOut'),
		statsEl = $('dcStats'),
		statusEl = $('dcStatus'),
		errBox = $('dcErr');
	const optWs = $('dcIgnoreWs'),
		optCase = $('dcIgnoreCase'),
		optFold = $('dcCollapse'),
		optLevel = $('dcLevel'),
		viewBox = $('dcView');
	const copyBtn = $('dcCopyBtn'),
		dlBtn = $('dcDownloadBtn');

	const CONTEXT = 3;
	const LINE_LIMIT = 8000; // edit distance at which the line diff gives up and shows a block replace
	const INLINE_MAX = 3000; // longest line that gets word or character highlights

	let view = 'split',
		timer = null,
		last = null,
		openFolds = {};

	/* ---------- Myers diff ---------- */

	// Returns ops: [type, aIndex, bIndex], type is 0 equal, -1 removed, 1 added
	function diff(a, b, limit) {
		const ops = [];
		const n = a.length,
			m = b.length;
		let s = 0;
		while(s < n && s < m && a[s] === b[s]) ops.push([0, s, s++]);
		let ea = n,
			eb = m;
		const tail = [];
		while(ea > s && eb > s && a[ea - 1] === b[eb - 1]) tail.push([0, --ea, --eb]);

		const N = ea - s,
			M = eb - s;
		if(N === 0 || M === 0) {
			for(let i = 0; i < N; i++) ops.push([-1, s + i, -1]);
			for(let j = 0; j < M; j++) ops.push([1, -1, s + j]);
			return ops.concat(tail.reverse());
		}

		const max = N + M,
			off = max + 1;
		const v = new Int32Array(2 * max + 3);
		const trace = [];
		let found = false;
		for(let d = 0; d <= max && d <= limit; d++) {
			trace.push(v.slice(off - d - 1, off + d + 2));
			for(let k = -d; k <= d; k += 2) {
				let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
				let y = x - k;
				while(x < N && y < M && a[s + x] === b[s + y]) { x++; y++; }
				v[off + k] = x;
				if(x >= N && y >= M) { found = true; break; }
			}
			if(found) break;
		}

		if(!found) {
			// Too different to diff cheaply: show the changed middle as one replaced block
			for(let i = 0; i < N; i++) ops.push([-1, s + i, -1]);
			for(let j = 0; j < M; j++) ops.push([1, -1, s + j]);
			return ops.concat(tail.reverse());
		}

		const mid = [];
		let x = N,
			y = M;
		for(let d = trace.length - 1; d >= 0; d--) {
			const t = trace[d],
				k = x - y,
				at = (kk) => t[kk + d + 1];
			const pk = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
			const px = at(pk),
				py = px - pk;
			while(x > px && y > py) mid.push([0, s + --x, s + --y]);
			if(d > 0) {
				if(x === px) mid.push([1, -1, s + --y]);
				else mid.push([-1, s + --x, -1]);
			}
		}
		return ops.concat(mid.reverse(), tail.reverse());
	}

	function ids(listA, listB) {
		const map = new Map();
		const to = (s) => {
			let id = map.get(s);
			if(id === undefined) map.set(s, id = map.size);
			return id;
		};
		return [listA.map(to), listB.map(to)];
	}

	/* ---------- Helpers ---------- */

	function esc(s) {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function lines(text) {
		if(text === '') return [];
		const l = text.replace(/\r\n?/g, '\n').split('\n');
		if(l.length > 1 && l[l.length - 1] === '') l.pop();
		return l;
	}

	function key(line) {
		let k = line;
		if(optWs.checked) k = k.replace(/\s+/g, ' ').trim();
		if(optCase.checked) k = k.toLowerCase();
		return k;
	}

	let TOKEN;
	try {
		TOKEN = new RegExp('[\\p{L}\\p{N}_]+|\\s+|[^\\p{L}\\p{N}_\\s]', 'gu');
	} catch(e) {
		TOKEN = /\w+|\s+|[^\w\s]/g;
	}

	// Word or character highlights inside a changed line pair
	function inline(oldLine, newLine) {
		if(oldLine.length > INLINE_MAX || newLine.length > INLINE_MAX) {
			return [mark(oldLine, 'del'), mark(newLine, 'ins')];
		}
		const split = (s) => optLevel.value === 'char' ? Array.from(s) : (s.match(TOKEN) || []);
		const ta = split(oldLine),
			tb = split(newLine);
		const norm = (t) => optCase.checked ? t.toLowerCase() : t;
		const [ia, ib] = ids(ta.map(norm), tb.map(norm));
		let ops = diff(ia, ib, 2000);
		// A space sitting between two changed words joins them into one highlight
		if(optLevel.value !== 'char') {
			const merged = [];
			ops.forEach((o, i) => {
				const prev = ops[i - 1],
					next = ops[i + 1];
				if(o[0] === 0 && prev && next && prev[0] !== 0 && next[0] !== 0 && /^\s+$/.test(ta[o[1]])) {
					merged.push([-1, o[1], -1], [1, -1, o[2]]);
				} else merged.push(o);
			});
			ops = merged;
		}
		let l = '',
			r = '',
			lm = '',
			rm = '';
		const flushL = () => { if(lm) { l += mark(lm, 'del'); lm = ''; } };
		const flushR = () => { if(rm) { r += mark(rm, 'ins'); rm = ''; } };
		ops.forEach((o) => {
			if(o[0] === 0) {
				flushL();
				flushR();
				l += esc(ta[o[1]]);
				r += esc(tb[o[2]]);
			} else if(o[0] < 0) lm += ta[o[1]];
			else rm += tb[o[2]];
		});
		flushL();
		flushR();
		return [l, r];
	}

	function mark(s, cls) {
		return s ? '<mark class="dc-' + cls + '">' + esc(s) + '</mark>' : '';
	}

	/* ---------- Compare ---------- */

	function compare() {
		const a = lines(leftEl.value),
			b = lines(rightEl.value);
		const [ka, kb] = ids(a.map(key), b.map(key));
		const ops = diff(ka, kb, LINE_LIMIT);

		// Rows for display: eq, mod (paired removal + addition), del, add
		const rows = [];
		let i = 0,
			removed = 0,
			added = 0;
		while(i < ops.length) {
			if(ops[i][0] === 0) {
				rows.push({ t: 'eq', l: ops[i][1], r: ops[i][2] });
				i++;
				continue;
			}
			const dels = [],
				adds = [];
			while(i < ops.length && ops[i][0] !== 0) {
				if(ops[i][0] < 0) dels.push(ops[i][1]);
				else adds.push(ops[i][2]);
				i++;
			}
			removed += dels.length;
			added += adds.length;
			const pairs = Math.min(dels.length, adds.length);
			for(let p = 0; p < Math.max(dels.length, adds.length); p++) {
				const row = { t: p < pairs ? 'mod' : (p < dels.length ? 'del' : 'add'), l: p < dels.length ? dels[p] : -1, r: p < adds.length ? adds[p] : -1 };
				if(row.t === 'mod') {
					const h = inline(a[row.l], b[row.r]);
					row.lh = h[0];
					row.rh = h[1];
				}
				rows.push(row);
			}
		}
		return { a: a, b: b, ops: ops, rows: rows, removed: removed, added: added };
	}

	/* ---------- Render ---------- */

	function code(text) {
		return text === '' ? '&#8203;' : esc(text);
	}

	// Groups rows into visible pieces, folding long unchanged runs
	function pieces(rows) {
		const out = [];
		let k = 0;
		while(k < rows.length) {
			if(rows[k].t !== 'eq') { out.push(rows[k++]); continue; }
			let e = k;
			while(e < rows.length && rows[e].t === 'eq') e++;
			const run = rows.slice(k, e);
			const head = k === 0 ? 0 : CONTEXT,
				tailN = e === rows.length ? 0 : CONTEXT;
			const id = 'f' + k;
			if(optFold.checked && run.length > head + tailN + 2 && !openFolds[id]) {
				run.slice(0, head).forEach((r) => out.push(r));
				out.push({ t: 'fold', id: id, n: run.length - head - tailN });
				run.slice(run.length - tailN).forEach((r) => out.push(r));
			} else run.forEach((r) => out.push(r));
			k = e;
		}
		return out;
	}

	function foldRow(p, span) {
		return '<tr class="dc-fold"><td colspan="' + span + '"><button type="button" data-fold="' + p.id + '">' +
			'<i class="fa-solid fa-up-down me-2"></i>Show ' + p.n.toLocaleString() + ' unchanged line' + (p.n === 1 ? '' : 's') + '</button></td></tr>';
	}

	function renderSplit(res) {
		const { a, b } = res;
		let h = '<table class="dc-table dc-split"><colgroup><col class="dc-c-num"><col class="dc-c-sign"><col><col class="dc-c-num"><col class="dc-c-sign"><col></colgroup><tbody>';
		pieces(res.rows).forEach((p) => {
			if(p.t === 'fold') { h += foldRow(p, 6); return; }
			// side: 'l' (removed side) or 'r' (added side); a missing line leaves a grey gap
			const cells = (side, n, sign, html) => n < 0 ?
				'<td class="dc-num dc-blank"></td><td class="dc-sign dc-blank"></td><td class="dc-code dc-blank"></td>' :
				'<td class="dc-num dc-' + side + '">' + (n + 1) + '</td><td class="dc-sign dc-' + side + '">' + (p.t === 'eq' ? '' : sign) + '</td><td class="dc-code dc-' + side + '">' + html + '</td>';
			h += '<tr class="dc-' + p.t + '">' +
				cells('l', p.l, '−', p.l < 0 ? '' : p.t === 'mod' ? p.lh || '&#8203;' : code(a[p.l])) +
				cells('r', p.r, '+', p.r < 0 ? '' : p.t === 'mod' ? p.rh || '&#8203;' : code(b[p.r])) + '</tr>';
		});
		return h + '</tbody></table>';
	}

	function renderUnified(res) {
		const { a, b } = res;
		let h = '<table class="dc-table dc-unified"><colgroup><col class="dc-c-num"><col class="dc-c-num"><col class="dc-c-sign"><col></colgroup><tbody>';
		const line = (cls, ln, rn, sign, html) => '<tr class="' + cls + '"><td class="dc-num">' + ln + '</td><td class="dc-num">' + rn + '</td><td class="dc-sign">' + sign + '</td><td class="dc-code">' + html + '</td></tr>';
		const list = pieces(res.rows);
		let k = 0;
		while(k < list.length) {
			const p = list[k];
			if(p.t === 'fold') { h += foldRow(p, 4); k++; continue; }
			if(p.t === 'eq') { h += line('dc-eq', p.l + 1, p.r + 1, '', code(a[p.l])); k++; continue; }
			// A changed block: all removals first, then all additions
			const block = [];
			while(k < list.length && list[k].t !== 'eq' && list[k].t !== 'fold') block.push(list[k++]);
			block.forEach((q) => { if(q.l >= 0) h += line('dc-del dc-l', q.l + 1, '', '−', q.t === 'mod' ? q.lh || '&#8203;' : code(a[q.l])); });
			block.forEach((q) => { if(q.r >= 0) h += line('dc-add dc-r', '', q.r + 1, '+', q.t === 'mod' ? q.rh || '&#8203;' : code(b[q.r])); });
		}
		return h + '</tbody></table>';
	}

	function render() {
		if(!last) return;
		outEl.innerHTML = view === 'split' ? renderSplit(last) : renderUnified(last);
	}

	/* ---------- Unified patch for copy / download ---------- */

	function patch(res) {
		const { a, b, ops } = res;
		const out = ['--- ' + ($('dcLeftName').textContent || 'Original'), '+++ ' + ($('dcRightName').textContent || 'Changed')];
		const changed = [];
		ops.forEach((o, i) => { if(o[0] !== 0) changed.push(i); });
		let c = 0;
		while(c < changed.length) {
			let start = Math.max(0, changed[c] - CONTEXT),
				end = changed[c];
			while(c < changed.length && changed[c] <= end + 2 * CONTEXT + 1) end = changed[c++];
			end = Math.min(ops.length - 1, end + CONTEXT);
			const slice = ops.slice(start, end + 1);
			// Line positions where the hunk starts on each side
			let aStart = 0,
				bStart = 0;
			for(let i = 0; i < start; i++) {
				if(ops[i][0] <= 0) aStart++;
				if(ops[i][0] >= 0) bStart++;
			}
			const aLen = slice.filter((o) => o[0] <= 0).length,
				bLen = slice.filter((o) => o[0] >= 0).length;
			out.push('@@ -' + (aLen ? aStart + 1 : aStart) + ',' + aLen + ' +' + (bLen ? bStart + 1 : bStart) + ',' + bLen + ' @@');
			slice.forEach((o) => {
				if(o[0] === 0) out.push(' ' + a[o[1]]);
				else if(o[0] < 0) out.push('-' + a[o[1]]);
				else out.push('+' + b[o[2]]);
			});
		}
		return out.join('\n') + '\n';
	}

	/* ---------- Run ---------- */

	function run() {
		errBox.classList.remove('show');
		openFolds = {};
		const empty = !leftEl.value && !rightEl.value;
		if(empty) {
			last = null;
			outEl.innerHTML = '<div class="dc-empty">Paste or open two texts above to see what changed.</div>';
			statsEl.innerHTML = '';
			statusEl.textContent = 'Paste text in both boxes or open two files';
			copyBtn.disabled = dlBtn.disabled = true;
			return;
		}
		const t0 = performance.now();
		last = compare();
		const ms = Math.round(performance.now() - t0);
		const same = !last.removed && !last.added;
		statsEl.innerHTML = same ?
			'<span class="dc-pill dc-pill-same"><i class="fa-solid fa-check me-2"></i>The two texts are identical' + (optWs.checked || optCase.checked ? ' (with your ignore settings)' : '') + '</span>' :
			'<span class="dc-pill dc-pill-del">− ' + last.removed.toLocaleString() + ' removal' + (last.removed === 1 ? '' : 's') + '</span>' +
			'<span class="dc-pill dc-pill-add">+ ' + last.added.toLocaleString() + ' addition' + (last.added === 1 ? '' : 's') + '</span>' +
			'<span class="dc-meta">' + last.a.length.toLocaleString() + ' lines → ' + last.b.length.toLocaleString() + ' lines</span>';
		statusEl.textContent = same ? 'No differences found' : 'Compared in ' + ms + ' ms';
		copyBtn.disabled = dlBtn.disabled = same;
		render();
	}

	function schedule() {
		clearTimeout(timer);
		const size = leftEl.value.length + rightEl.value.length;
		timer = setTimeout(run, size > 200000 ? 600 : 200);
	}

	[leftEl, rightEl].forEach((el) => el.addEventListener('input', schedule));
	[optWs, optCase, optLevel].forEach((el) => el.addEventListener('change', run));
	optFold.addEventListener('change', () => { openFolds = {}; render(); });

	viewBox.addEventListener('click', (e) => {
		const btn = e.target.closest('.mode-btn');
		if(!btn) return;
		view = btn.dataset.view;
		viewBox.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === btn));
		render();
	});

	outEl.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-fold]');
		if(!btn) return;
		openFolds[btn.dataset.fold] = true;
		render();
	});

	/* ---------- Files ---------- */

	function loadFile(file, target, nameEl) {
		if(!file) return;
		if(file.size > 10 * 1024 * 1024) {
			errBox.textContent = '"' + file.name + '" is larger than 10 MB.';
			errBox.classList.add('show');
			return;
		}
		const r = new FileReader();
		r.onload = () => {
			const text = String(r.result);
			if(/\u0000/.test(text.slice(0, 8000))) {
				errBox.textContent = '"' + file.name + '" looks like a binary file. The diff checker compares text files.';
				errBox.classList.add('show');
				return;
			}
			target.value = text.replace(/^﻿/, '');
			nameEl.textContent = file.name;
			run();
		};
		r.readAsText(file);
	}

	[
		[leftEl, 'dcLeftFile', 'dcLeftOpen', 'dcLeftName', 'Original'],
		[rightEl, 'dcRightFile', 'dcRightOpen', 'dcRightName', 'Changed']
	].forEach(([area, fileId, btnId, nameId]) => {
		const input = $(fileId),
			nameEl = $(nameId),
			pane = area.closest('.bm-pane');
		$(btnId).addEventListener('click', () => input.click());
		input.addEventListener('change', (e) => {
			loadFile(e.target.files[0], area, nameEl);
			e.target.value = '';
		});
		['dragenter', 'dragover'].forEach((ev) => area.addEventListener(ev, (e) => {
			e.preventDefault();
			pane.classList.add('dc-drag');
		}));
		['dragleave', 'drop'].forEach((ev) => area.addEventListener(ev, (e) => {
			e.preventDefault();
			pane.classList.remove('dc-drag');
		}));
		area.addEventListener('drop', (e) => {
			if(e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0], area, nameEl);
		});
		area.addEventListener('keydown', (e) => {
			if(e.key === 'Tab' && !e.shiftKey) {
				e.preventDefault();
				document.execCommand('insertText', false, '\t');
			}
		});
	});

	/* ---------- Toolbar ---------- */

	$('dcSwapBtn').addEventListener('click', () => {
		const t = leftEl.value;
		leftEl.value = rightEl.value;
		rightEl.value = t;
		const n = $('dcLeftName').textContent;
		$('dcLeftName').textContent = $('dcRightName').textContent;
		$('dcRightName').textContent = n;
		run();
	});

	$('dcClearBtn').addEventListener('click', () => {
		leftEl.value = rightEl.value = '';
		$('dcLeftName').textContent = 'Original';
		$('dcRightName').textContent = 'Changed';
		run();
		leftEl.focus();
	});

	$('dcSampleBtn').addEventListener('click', () => {
		leftEl.value = [
			'Matte Tools — Release notes',
			'',
			'Version 2.3 brings faster image conversion and a cleaner editor.',
			'',
			'New:',
			'- Convert PNG to WebP in the browser',
			'- Batch resize up to 20 images',
			'- Dark mode for the PDF editor',
			'',
			'Fixed:',
			'- Upload button did not work on Safari',
			'- Long file names were cut off',
			'',
			'Thanks for using Matte Tools!'
		].join('\n');
		rightEl.value = [
			'Matte Tools — Release notes',
			'',
			'Version 2.4 brings much faster image conversion and a cleaner, simpler editor.',
			'',
			'New:',
			'- Convert PNG and JPG to WebP in the browser',
			'- Batch resize up to 50 images',
			'- Compare two texts with the new Diff Checker',
			'',
			'Fixed:',
			'- Upload button did not work on Safari',
			'',
			'Thanks for using Matte Tools!'
		].join('\n');
		$('dcLeftName').textContent = 'Original';
		$('dcRightName').textContent = 'Changed';
		run();
	});

	copyBtn.addEventListener('click', async() => {
		const text = patch(last);
		try {
			await navigator.clipboard.writeText(text);
		} catch(e) {
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			ta.remove();
		}
		copyBtn.innerHTML = '<i class="fa-solid fa-check me-2"></i>Copied';
		setTimeout(() => {
			copyBtn.innerHTML = '<i class="fa-regular fa-copy me-2"></i>Copy diff';
		}, 1200);
	});

	dlBtn.addEventListener('click', () => {
		const url = URL.createObjectURL(new Blob([patch(last)], { type: 'text/x-diff;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'changes.diff';
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	});

	run();
})();
