(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const inEl = $('bmIn'),
		outEl = $('bmOut'),
		statusEl = $('bmStatus'),
		sizeEl = $('bmSize'),
		errBox = $('bmErr');
	const copyBtn = $('bmCopyBtn'),
		dlBtn = $('bmDownloadBtn'),
		modeBox = $('bmMode');
	const optIndent = $('bmIndent'),
		optWrap = $('bmWrap'),
		optAttrs = $('bmAttrs'),
		optBlank = $('bmBlank'),
		optSelfClose = $('bmSelfClose'),
		optComments = $('bmComments');
	const activeBtn = modeBox.querySelector('.mode-btn.active');
	let mode = activeBtn ? activeBtn.dataset.mode : 'beautify',
		fileName = 'file.xml',
		timer = null;

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function bytes(s) {
		return new Blob([s]).size;
	}

	function fmt(n) {
		return n < 1024 ? n + ' B' : (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
	}

	function XmlError(message, pos) {
		this.message = message;
		this.pos = pos;
	}

	function where(src, pos) {
		const before = src.slice(0, pos).split('\n');
		return 'line ' + before.length + ', column ' + (before[before.length - 1].length + 1);
	}

	const NAME = /[^\s\/>=<"']+/y;
	const WS = /\s*/y;

	function parse(src) {
		const root = { type: 'root', children: [] };
		const stack = [root];
		const n = src.length;
		let i = 0;
		const top = () => stack[stack.length - 1];
		const push = (node) => top().children.push(node);
		const fail = (msg, pos) => { throw new XmlError(msg, pos); };
		const skipWs = (j) => { WS.lastIndex = j; WS.exec(src); return WS.lastIndex; };

		while(i < n) {
			const lt = src.indexOf('<', i);
			if(lt !== i) {
				const end = lt < 0 ? n : lt;
				push({ type: 'text', raw: src.slice(i, end), start: i });
				i = end;
				continue;
			}

			if(src.startsWith('<!--', i)) {
				const e = src.indexOf('-->', i + 4);
				if(e < 0) fail('A comment is never closed with -->', i);
				push({ type: 'comment', raw: src.slice(i, e + 3) });
				i = e + 3;
				continue;
			}

			if(src.startsWith('<![CDATA[', i)) {
				const e = src.indexOf(']]>', i + 9);
				if(e < 0) fail('A CDATA section is never closed with ]]>', i);
				push({ type: 'cdata', raw: src.slice(i, e + 3) });
				i = e + 3;
				continue;
			}

			if(src.startsWith('<?', i)) {
				const e = src.indexOf('?>', i + 2);
				if(e < 0) fail('A processing instruction is never closed with ?>', i);
				push({ type: 'pi', raw: src.slice(i, e + 2) });
				i = e + 2;
				continue;
			}

			if(src.startsWith('<!', i)) {
				let j = i + 2,
					depth = 0,
					q = null;
				for(; j < n; j++) {
					const c = src[j];
					if(q) {
						if(c === q) q = null;
					} else if(c === '"' || c === "'") q = c;
					else if(c === '[') depth++;
					else if(c === ']') depth--;
					else if(c === '>' && depth <= 0) break;
				}
				if(j >= n) fail('A <!DOCTYPE> or declaration is never closed', i);
				push({ type: 'decl', raw: src.slice(i, j + 1) });
				i = j + 1;
				continue;
			}

			if(src[i + 1] === '/') {
				const e = src.indexOf('>', i);
				if(e < 0) fail('A closing tag is never finished with >', i);
				const name = src.slice(i + 2, e).trim();
				const el = top();
				if(el.type !== 'element') fail('Unexpected closing tag </' + name + '> with no matching opening tag', i);
				if(el.name !== name) fail('Expected </' + el.name + '> but found </' + name + '>', i);
				el.innerEnd = i;
				stack.pop();
				i = e + 1;
				continue;
			}

			NAME.lastIndex = i + 1;
			const nm = NAME.exec(src);
			if(!nm) fail('Stray "<" character. Write &lt; for a literal less-than sign', i);
			const el = { type: 'element', name: nm[0], attrs: [], selfClose: false, children: [], start: i };
			const attrStart = NAME.lastIndex;
			let j = attrStart,
				attrEnd = -1;

			while(true) {
				j = skipWs(j);
				if(j >= n) fail('Tag <' + el.name + '> is never closed with >', i);
				if(src[j] === '>') { attrEnd = j; j++; break; }
				if(src.startsWith('/>', j)) { attrEnd = j; el.selfClose = true; j += 2; break; }
				NAME.lastIndex = j;
				const an = NAME.exec(src);
				if(!an) fail('Unexpected character "' + src[j] + '" in tag <' + el.name + '>', j);
				j = skipWs(NAME.lastIndex);
				let value = null;
				if(src[j] === '=') {
					j = skipWs(j + 1);
					const q = src[j];
					if(q === '"' || q === "'") {
						const e = src.indexOf(q, j + 1);
						if(e < 0) fail('The value of attribute "' + an[0] + '" is never closed', j);
						value = src.slice(j, e + 1);
						j = e + 1;
					} else {
						const m = /[^\s>]+/y;
						m.lastIndex = j;
						const v = m.exec(src);
						if(!v) fail('Attribute "' + an[0] + '" has no value', j);
						value = '"' + v[0].replace(/\/$/, '').replace(/"/g, '&quot;') + '"';
						j = m.lastIndex - (v[0].endsWith('/') ? 1 : 0);
					}
				}
				el.attrs.push({ name: an[0], value: value });
			}

			el.rawAttrs = src.slice(attrStart, attrEnd);
			el.innerStart = j;
			el.preserve = el.attrs.some((a) => a.name === 'xml:space' && a.value && a.value.slice(1, -1) === 'preserve');
			push(el);
			if(!el.selfClose) stack.push(el);
			i = j;
		}

		if(stack.length > 1) {
			const open = top();
			fail('<' + open.name + '> is never closed', open.start);
		}
		return root;
	}

	function attrList(el) {
		return el.attrs.map((a) => a.value == null ? a.name : a.name + '=' + a.value);
	}

	function isBlank(node) {
		return node.type === 'text' && !node.raw.trim();
	}

	function beautify(src) {
		const root = parse(src);
		const tab = optIndent.value === 'tab';
		const unit = tab ? '\t' : ' '.repeat(parseInt(optIndent.value, 10));
		const width = parseInt(optWrap.value, 10);
		const attrMode = optAttrs.value;
		const keepBlank = optBlank.checked;
		const collapse = optSelfClose.checked;
		const out = [];
		const pad = (d) => unit.repeat(d);

		function openTag(el, d, close) {
			const ind = pad(d);
			if(attrMode === 'preserve') {
				const raw = el.rawAttrs.replace(/\s+$/, '').replace(/^\s+/, ' ');
				return ind + '<' + el.name + raw + close;
			}
			const parts = attrList(el);
			const one = ind + '<' + el.name + (parts.length ? ' ' + parts.join(' ') : '') + close;
			if(parts.length < 2) return one;
			if(attrMode === 'force' || (width > 0 && one.length > width)) {
				return ind + '<' + el.name + '\n' + parts.map((p) => pad(d + 1) + p).join('\n') + close;
			}
			return one;
		}

		function textLines(t, d) {
			t.split('\n').forEach((line) => {
				line = line.trim();
				if(line || keepBlank) out.push(line ? pad(d) + line : '');
			});
		}

		function element(el, d) {
			if(el.selfClose) {
				out.push(openTag(el, d, '/>'));
				return;
			}
			if(el.preserve) {
				out.push(openTag(el, d, '>') + src.slice(el.innerStart, el.innerEnd) + '</' + el.name + '>');
				return;
			}
			const kids = el.children.filter((k) => !isBlank(k));
			const close = '</' + el.name + '>';
			if(!kids.length) {
				out.push(collapse ? openTag(el, d, '/>') : openTag(el, d, '>') + close);
				return;
			}
			if(kids.length === 1 && (kids[0].type === 'text' || kids[0].type === 'cdata')) {
				const t = kids[0].type === 'text' ? kids[0].raw.trim() : kids[0].raw;
				if(t.indexOf('\n') < 0 || kids[0].type === 'cdata') {
					out.push(openTag(el, d, '>') + t + close);
					return;
				}
			}
			if(kids.some((k) => k.type === 'text')) {
				const line = openTag(el, d, '>') + inline(el.children, src, false, collapse) + close;
				if(line.indexOf('\n') < 0 && (width === 0 || line.length <= width)) {
					out.push(line);
					return;
				}
			}
			out.push(openTag(el, d, '>'));
			emit(el.children, d + 1);
			out.push(pad(d) + close);
		}

		function emit(nodes, d) {
			let blank = false,
				started = false;
			nodes.forEach((node) => {
				if(isBlank(node)) {
					if(keepBlank && started && (node.raw.match(/\n/g) || []).length >= 2) blank = true;
					return;
				}
				if(blank) out.push('');
				blank = false;
				started = true;
				if(node.type === 'text') textLines(node.raw.trim(), d);
				else if(node.type === 'element') element(node, d);
				else out.push(pad(d) + node.raw);
			});
		}

		emit(root.children, 0);
		return out.join('\n') + '\n';
	}

	function tag(el, close) {
		const parts = attrList(el);
		return '<' + el.name + (parts.length ? ' ' + parts.join(' ') : '') + close;
	}

	function inline(nodes, src, dropComments, collapse, atRoot) {
		let s = '';
		const list = nodes.filter((k) => !isBlank(k) && !(dropComments && k.type === 'comment'));
		list.forEach((node, idx) => {
			if(node.type === 'text') {
				let t = node.raw.replace(/\s+/g, ' ');
				if(atRoot || idx === 0) t = t.replace(/^ /, '');
				if(atRoot || idx === list.length - 1) t = t.replace(/ $/, '');
				s += t;
			} else if(node.type === 'element') {
				if(node.selfClose) s += tag(node, '/>');
				else if(node.preserve) s += tag(node, '>') + src.slice(node.innerStart, node.innerEnd) + '</' + node.name + '>';
				else if(collapse && !node.children.some((k) => !isBlank(k) && !(dropComments && k.type === 'comment'))) s += tag(node, '/>');
				else s += tag(node, '>') + inline(node.children, src, dropComments, collapse, false) + '</' + node.name + '>';
			} else {
				s += node.raw;
			}
		});
		return s;
	}

	function minify(src, dropComments) {
		return inline(parse(src).children, src, dropComments, optSelfClose.checked, true);
	}

	function run() {
		clearError();
		const src = inEl.value.replace(/\r\n?/g, '\n');
		if(!src.trim()) {
			outEl.value = '';
			sizeEl.textContent = '';
			statusEl.textContent = 'Paste XML below or open a file';
			copyBtn.disabled = dlBtn.disabled = true;
			return;
		}
		try {
			const out = mode === 'beautify' ? beautify(src) : minify(src, optComments.checked);
			outEl.value = out;
			const a = bytes(src),
				b = bytes(out);
			sizeEl.textContent = fmt(b) + (mode === 'minify' && a ? ' · ' + Math.round((1 - b / a) * 100) + '% smaller' : '');
			const lines = out.replace(/\n$/, '').split('\n').length;
			statusEl.textContent = (mode === 'beautify' ? 'Beautified' : 'Minified') + ' · ' + lines.toLocaleString() + ' line' + (lines === 1 ? '' : 's');
			copyBtn.disabled = dlBtn.disabled = false;
		} catch(e) {
			if(!(e instanceof XmlError)) console.error(e);
			const msg = e instanceof XmlError ? e.message + ' (' + where(src, e.pos) + ')' : (e && e.message ? e.message : e);
			showError('Could not format this XML: ' + msg);
			outEl.value = '';
			sizeEl.textContent = '';
			statusEl.textContent = 'Fix the error above to see the result';
			copyBtn.disabled = dlBtn.disabled = true;
		}
	}

	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(run, 180);
	}

	inEl.addEventListener('input', schedule);

	[optIndent, optWrap, optAttrs, optBlank, optSelfClose, optComments].forEach((el) => el && el.addEventListener('change', run));

	modeBox.addEventListener('click', (e) => {
		const b = e.target.closest('.mode-btn');
		if(!b) return;
		mode = b.dataset.mode;
		modeBox.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
		document.querySelectorAll('#bmSettings [data-for]').forEach((g) => g.classList.toggle('is-hidden', g.dataset.for !== mode));
		run();
	});

	copyBtn.addEventListener('click', async() => {
		try {
			await navigator.clipboard.writeText(outEl.value);
		} catch(e) {
			outEl.select();
			document.execCommand('copy');
		}
		copyBtn.innerHTML = '<i class="fa-regular fa-copy me-2"></i> Copied';
		setTimeout(() => {
			copyBtn.innerHTML = '<i class="fa-regular fa-copy me-2"></i> Copy result';
		}, 1200);
	});

	dlBtn.addEventListener('click', () => {
		const m = /^(.*?)(\.[^.]+)?$/.exec(fileName);
		const stem = (m[1] || 'file').replace(/\.min$/, '');
		const ext = m[2] && m[2].toLowerCase() !== '.txt' ? m[2] : '.xml';
		const url = URL.createObjectURL(new Blob([outEl.value], {
			type: 'application/xml;charset=utf-8'
		}));
		const a = document.createElement('a');
		a.href = url;
		a.download = stem + (mode === 'minify' ? '.min' : '') + ext;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	});

	$('bmClearBtn').addEventListener('click', () => {
		inEl.value = '';
		fileName = 'file.xml';
		run();
		inEl.focus();
	});

	const SAMPLE_BEAUTIFY = '<?xml version="1.0" encoding="UTF-8"?><!-- Book catalog --><catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" updated="2026-11-16"><book id="bk101" lang="en" available="true"><author>Gambardella, Matthew</author><title>XML Developer\'s Guide</title><genre>Computer</genre><price currency="USD">44.95</price><description><![CDATA[An in-depth look at creating applications with <XML>.]]></description><tags><tag>xml</tag><tag>guide</tag></tags></book><book id="bk102" lang="en" available="false"><author>Ralls, Kim</author><title>Midnight Rain</title><genre>Fantasy</genre><price currency="USD">5.95</price><cover/><notes></notes></book></catalog>';

	const SAMPLE_MINIFY = '<?xml version="1.0" encoding="UTF-8"?>\n<!-- Book catalog -->\n<catalog updated="2026-11-16">\n\n    <book id="bk101" lang="en" available="true">\n        <author>Gambardella, Matthew</author>\n        <title>XML Developer\'s Guide</title>\n        <price currency="USD">44.95</price>\n        <description><![CDATA[An in-depth look at creating applications with <XML>.]]></description>\n    </book>\n\n    <book id="bk102" lang="en" available="false">\n        <author>Ralls, Kim</author>\n        <title>Midnight Rain</title>\n        <price currency="USD">5.95</price>\n        <!-- no cover yet -->\n        <notes></notes>\n    </book>\n\n</catalog>\n';

	$('bmSampleBtn').addEventListener('click', () => {
		inEl.value = mode === 'minify' ? SAMPLE_MINIFY : SAMPLE_BEAUTIFY;
		fileName = 'sample.xml';
		run();
	});

	function loadFile(f) {
		if(!f) return;
		if(f.size > 8 * 1024 * 1024) {
			showError('That file is larger than 8 MB.');
			return;
		}
		const r = new FileReader();
		r.onload = () => {
			inEl.value = String(r.result).replace(/^﻿/, '');
			fileName = f.name;
			run();
		};
		r.onerror = () => showError('The file could not be read.');
		r.readAsText(f);
	}

	$('bmOpenBtn').addEventListener('click', () => $('bmFileInput').click());

	$('bmFileInput').addEventListener('change', (e) => {
		loadFile(e.target.files[0]);
		e.target.value = '';
	});

	['dragenter', 'dragover'].forEach((ev) => inEl.addEventListener(ev, (e) => {
		e.preventDefault();
		$('bmPanes').classList.add('stage-drag');
	}));

	['dragleave', 'drop'].forEach((ev) => inEl.addEventListener(ev, (e) => {
		e.preventDefault();
		$('bmPanes').classList.remove('stage-drag');
	}));

	inEl.addEventListener('drop', (e) => {
		if(e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
	});

	inEl.addEventListener('keydown', (e) => {
		if(e.key === 'Tab' && !e.shiftKey) {
			e.preventDefault();
			document.execCommand('insertText', false, '\t');
		}
	});
})();