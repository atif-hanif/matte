(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const inEl = $('hbIn'),
		outEl = $('hbOut'),
		statusEl = $('hbStatus'),
		sizeEl = $('hbSize'),
		errBox = $('hbErr');
	const copyBtn = $('hbCopyBtn'),
		dlBtn = $('hbDownloadBtn'),
		modeBox = $('hbMode');
	const optIndent = $('hbIndent'),
		optWrap = $('hbWrap'),
		optAttrs = $('hbAttrs'),
		optInner = $('hbInner'),
		optBlank = $('hbBlank'),
		optComments = $('hbComments');
	let mode = 'beautify',
		fileName = 'page.html',
		timer = null;
	const lib = window.beautifier || window.html_beautify && {
		html: window.html_beautify
	};

	if(!lib || !lib.html) showError('The beautifier minifier library did not load. Check assets/vendors/beautifier-minifier/beautifier-minifier.min.js.');

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
	
	function beautify(src) {
		const tab = optIndent.value === 'tab';
		const o = {
			indent_size: tab ? 1 : parseInt(optIndent.value, 10),
			indent_char: tab ? '\t' : ' ',
			indent_with_tabs: tab,
			wrap_line_length: parseInt(optWrap.value, 10),
			wrap_attributes: optAttrs.value === 'force' ? 'force' : optAttrs.value === 'preserve' ? 'preserve' : 'auto',
			preserve_newlines: optBlank.checked,
			max_preserve_newlines: optBlank.checked ? 2 : 0,
			indent_inner_html: true,
			end_with_newline: true,
			extra_liners: [],
			unformatted: ['code', 'pre', 'textarea'],
			content_unformatted: ['pre', 'textarea']
		};
		if(!optInner.checked) {
			o.indent_scripts = 'keep';
			o.unformatted = ['code', 'pre', 'textarea', 'script', 'style'];
			o.content_unformatted = ['pre', 'textarea', 'script', 'style'];
		}
		return lib.html(src, o);
	}
	
	const BLOCK = 'address|article|aside|blockquote|body|br|dd|details|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|li|link|main|meta|nav|ol|option|p|section|select|style|script|table|tbody|td|tfoot|th|thead|title|tr|ul|!doctype';

	function minCss(css) {
		return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}').trim();
	}

	function minify(src, dropComments) {
		const keep = [];
		const hold = (m) => {
			keep.push(m);
			return '\u0001' + (keep.length - 1) + '\u0002';
		};
		let s = src;
		s = s.replace(/<(pre|textarea)\b[\s\S]*?<\/\1\s*>/gi, hold);
		s = s.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (m, a, body) => hold('<script' + a + '>' + body.trim() + '</script>'));
		s = s.replace(/<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi, (m, a, body) => hold('<style' + a + '>' + minCss(body) + '</style>'));
		if(dropComments) s = s.replace(/<!--(?!\[if|<!\[endif)[\s\S]*?-->/g, '');
		s = s.replace(/\s+/g, ' ');
		s = s.replace(new RegExp('\\s*(</?(?:' + BLOCK + ')\\b[^>]*>)\\s*', 'gi'), '$1');
		s = s.replace(/\s+\/>/g, '/>').replace(/\s+>/g, '>').trim();
		return s.replace(/\u0001(\d+)\u0002/g, (m, i) => keep[+i]);
	}
	
	function run() {
		clearError();
		const src = inEl.value;
		if(!src.trim()) {
			outEl.value = '';
			sizeEl.textContent = '';
			statusEl.textContent = 'Paste HTML below or open a file';
			copyBtn.disabled = dlBtn.disabled = true;
			return;
		}
		try {
			const out = mode === 'beautify' ? beautify(src) : minify(src, optComments.checked);
			outEl.value = out;
			const a = bytes(src),
				b = bytes(out);
			sizeEl.textContent = fmt(b) + (mode === 'minify' && a ? ' · ' + Math.round((1 - b / a) * 100) + '% smaller' : '');
			statusEl.textContent = (mode === 'beautify' ? 'Beautified' : 'Minified') + ' · ' + out.split('\n').length.toLocaleString() + ' line' + (out.indexOf('\n') < 0 ? '' : 's');
			copyBtn.disabled = dlBtn.disabled = false;
		} catch(e) {
			console.error(e);
			showError('Could not format this HTML: ' + (e && e.message ? e.message : e));
			copyBtn.disabled = dlBtn.disabled = true;
		}
	}

	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(run, 180);
	}

	inEl.addEventListener('input', schedule);
	[optIndent, optWrap, optAttrs, optInner, optBlank, optComments].forEach((el) => el.addEventListener('change', run));
	modeBox.addEventListener('click', (e) => {
		const b = e.target.closest('.mode-btn');
		if(!b) return;
		mode = b.dataset.mode;
		modeBox.querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
		document.querySelectorAll('#hbSettings [data-for]').forEach((g) => g.classList.toggle('is-hidden', g.dataset.for !== mode));
		run();
	});

	copyBtn.addEventListener('click', async() => {
		try {
			await navigator.clipboard.writeText(outEl.value);
		} catch(e) {
			outEl.select();
			document.execCommand('copy');
		}
		const t = copyBtn.textContent;
		copyBtn.textContent = 'Copied';
		setTimeout(() => {
			copyBtn.textContent = t;
		}, 1200);
	});

	dlBtn.addEventListener('click', () => {
		const stem = fileName.replace(/\.[^.]+$/, '') || 'page';
		const url = URL.createObjectURL(new Blob([outEl.value], {
			type: 'text/html;charset=utf-8'
		}));
		const a = document.createElement('a');
		a.href = url;
		a.download = stem + (mode === 'minify' ? '.min' : '') + '.html';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	});

	$('hbClearBtn').addEventListener('click', () => {
		inEl.value = '';
		fileName = 'page.html';
		run();
		inEl.focus();
	});

	$('hbSampleBtn').addEventListener('click', () => {
		inEl.value = '<!DOCTYPE html><html><head><title>Sample</title><style>body{margin:0;font-family:sans-serif}.card{padding:16px;border:1px solid #ddd}</style></head><body><!-- page header --><div class="card"><h1>Hello</h1><p>Some <b>bold</b> and <i>italic</i> text.</p><ul><li>One</li><li>Two</li></ul><a href="https://example.com" target="_blank" rel="noopener" class="button button-primary">Visit</a></div><script>function hi(){var a=1;if(a){console.log("hi")}}hi();</script></body></html>';
		fileName = 'sample.html';
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
			inEl.value = String(r.result).replace(/^\uFEFF/, '');
			fileName = f.name;
			run();
		};
		r.onerror = () => showError('The file could not be read.');
		r.readAsText(f);
	}

	$('hbOpenBtn').addEventListener('click', () => $('hbFileInput').click());
	$('hbFileInput').addEventListener('change', (e) => {
		loadFile(e.target.files[0]);
		e.target.value = '';
	});

	['dragenter', 'dragover'].forEach((ev) => inEl.addEventListener(ev, (e) => {
		e.preventDefault();
		$('hbPanes').classList.add('stage-drag');
	}));

	['dragleave', 'drop'].forEach((ev) => inEl.addEventListener(ev, (e) => {
		e.preventDefault();
		$('hbPanes').classList.remove('stage-drag');
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