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
		optSel = $('bmSel'),
		optGap = $('bmGap'),
		optBlank = $('bmBlank'),
		optSpace = $('bmSpace'),
		optComments = $('bmComments');
	let mode = 'beautify',
		fileName = 'styles.css',
		timer = null;
	const lib = window.beautifier || window.css_beautify && {
		css: window.css_beautify
	};

	if(!lib || !lib.css) showError('The beautifier library did not load. Check assets/vendors/beautify/beautifier.min.js.');

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
		return lib.css(src, {
			indent_size: tab ? 1 : parseInt(optIndent.value, 10),
			indent_char: tab ? '\t' : ' ',
			indent_with_tabs: tab,
			selector_separator_newline: optSel.value === '1',
			newline_between_rules: optGap.checked,
			preserve_newlines: optBlank.checked,
			max_preserve_newlines: optBlank.checked ? 2 : 0,
			space_around_combinator: optSpace.checked,
			end_with_newline: true
		});
	}
	
	function minify(src, dropComments) {
		const keep = [];
		const hold = (m) => {
			keep.push(m);
			return '\u0001' + (keep.length - 1) + '\u0002';
		};
		let s = src;
		s = s.replace(/\/\*[\s\S]*?\*\//g, (m) => (!dropComments || m.charAt(2) === '!' ? hold(m) : ''));
		s = s.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, hold);
		s = s.replace(/url\(\s*([^)'"\s][^)]*?)\s*\)/gi, (m, u) => hold('url(' + u + ')'));
		s = s.replace(/\s+/g, ' ');
		s = s.replace(/\s*([{};,>~])\s*/g, '$1').replace(/\s*:\s*/g, ':').replace(/\s*\+\s*(?![^()]*\))/g, '+');
		s = s.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/;}/g, '}').replace(/!\s+important/gi, '!important');
		s = s.trim();
		for(let i = 0; i < 3; i++) s = s.replace(/\u0001(\d+)\u0002/g, (m, n) => keep[+n]);
		return s;
	}
	
	function run() {
		clearError();
		const src = inEl.value;
		if(!src.trim()) {
			outEl.value = '';
			sizeEl.textContent = '';
			statusEl.textContent = 'Paste CSS below or open a file';
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
			showError('Could not format this CSS: ' + (e && e.message ? e.message : e));
			copyBtn.disabled = dlBtn.disabled = true;
		}
	}

	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(run, 180);
	}

	inEl.addEventListener('input', schedule);

	[optIndent, optSel, optGap, optBlank, optSpace, optComments].forEach((el) => el.addEventListener('change', run));

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
		const t = copyBtn.textContent;
		//copyBtn.textContent = 'Copied';
		copyBtn.innerHTML = '<i class="fa-regular fa-copy me-2"></i> Copied';
		setTimeout(() => {
			copyBtn.textContent = t;
			copyBtn.innerHTML = '<i class="fa-regular fa-copy me-2"></i> Copy Result';
		}, 1200);
	});

	dlBtn.addEventListener('click', () => {
		const stem = fileName.replace(/\.[^.]+$/, '') || 'styles';
		const url = URL.createObjectURL(new Blob([outEl.value], {
			type: 'text/css;charset=utf-8'
		}));
		const a = document.createElement('a');
		a.href = url;
		a.download = stem + (mode === 'minify' ? '.min' : '') + '.css';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	});

	$('bmClearBtn').addEventListener('click', () => {
		inEl.value = '';
		fileName = 'styles.css';
		run();
		inEl.focus();
	});

	$('bmSampleBtn').addEventListener('click', () => {
		inEl.value = 'body{margin:0;font-family:Arial,sans-serif;background:#fff}/* cards */.card{padding:16px;border:1px solid #ddd;border-radius:8px}.card>h1,.card h2{font-size:1.5rem;color:red!important}a:hover,a:focus{text-decoration:underline}@media (max-width:600px){.card{padding:8px;background:url("img/a b.png") no-repeat}}';
		fileName = 'sample.css';
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