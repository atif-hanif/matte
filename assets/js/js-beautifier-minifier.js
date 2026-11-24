(function() {
	'use strict';
	
	const $ = (id) => document.getElementById(id);
	const inEl = $('bmIn'),
		outEl = $('bmOut'),
		statusEl = $('bmStatus'),
		sizeEl = $('bmSize'),
		errBox = $('bmErr');
	const copyBtn = $('bmCopyBtn'),
		dlBtn = $('bmDownloadBtn');
	const optIndent = $('bmIndent'),
		optBrace = $('bmBrace'),
		optWrap = $('bmWrap'),
		optBlank = $('bmBlank'),
		optFnSpace = $('bmFnSpace'),
		optChain = $('bmChain'),
		optCompress = $('bmCompress'),
		optMangle = $('bmMangle'),
		optLicense = $('bmLicense'),
		modeBox = $('bmMode');
	let mode = 'beautify',
		seq = 0;
	let fileName = 'script.js',
		timer = null;
	const lib = window.beautifier || window.js_beautify && {
		js: window.js_beautify
	};

	if(!lib || !lib.js) showError('The beautifier library did not load. Check assets/vendors/js-beautify/beautifier.min.js.');

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
		return lib.js(src, {
			indent_size: tab ? 1 : parseInt(optIndent.value, 10),
			indent_char: tab ? '\t' : ' ',
			indent_with_tabs: tab,
			brace_style: optBrace.value,
			wrap_line_length: parseInt(optWrap.value, 10),
			preserve_newlines: optBlank.checked,
			max_preserve_newlines: optBlank.checked ? 2 : 0,
			space_after_anon_function: optFnSpace.checked,
			space_after_named_function: optFnSpace.checked,
			break_chained_methods: optChain.checked,
			end_with_newline: true
		});
	}

	async function minify(src) {
		if(!window.Terser) throw new Error('The minifier library did not load. Check assets/vendors/terser/terser.min.js.');
		const base = {
			compress: optCompress.checked ? {
				passes: 2
			} : false,
			mangle: optMangle.checked,
			format: {
				comments: optLicense.checked ? /^!|@license|@preserve/i : false
			}
		};
		let r;
		try {
			r = await Terser.minify(src, base);
		} catch(e) { // import / export need module mode
			if(/import|export/.test(src)) r = await Terser.minify(src, Object.assign({
				module: true
			}, base));
			else throw e;
		}
		if(r.error) throw r.error;
		return r.code || '';
	}

	async function run() {
		const my = ++seq;
		clearError();
		const src = inEl.value;
		if(!src.trim()) {
			outEl.value = '';
			sizeEl.textContent = '';
			statusEl.textContent = 'Paste JavaScript below or open a file';
			copyBtn.disabled = dlBtn.disabled = true;
			return;
		}
		try {
			const out = mode === 'beautify' ? beautify(src) : await minify(src);
			if(my !== seq) return;
			outEl.value = out;
			const a = bytes(src),
				b = bytes(out);
			sizeEl.textContent = fmt(b) + (mode === 'minify' && a ? ' · ' + Math.round((1 - b / a) * 100) + '% smaller' : '');
			statusEl.textContent = (mode === 'beautify' ? 'Beautified' : 'Minified') + ' · ' + out.split('\n').length.toLocaleString() + ' line' + (out.indexOf('\n') < 0 ? '' : 's');
			copyBtn.disabled = dlBtn.disabled = false;
		} catch(e) {
			if(my !== seq) return;
			console.error(e);
			outEl.value = '';
			const where = e && e.line ? ' (line ' + e.line + ', column ' + e.col + ')' : '';
			showError('Could not ' + mode + ' this code: ' + (e && e.message ? e.message : e) + where);
			copyBtn.disabled = dlBtn.disabled = true;
		}
	}

	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(run, 180);
	}

	inEl.addEventListener('input', schedule);
	[optIndent, optBrace, optWrap, optBlank, optFnSpace, optChain, optCompress, optMangle, optLicense].forEach((el) => el.addEventListener('change', run));
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
		const stem = fileName.replace(/\.[^.]+$/, '') || 'script';
		const url = URL.createObjectURL(new Blob([outEl.value], {
			type: 'text/javascript;charset=utf-8'
		}));
		const a = document.createElement('a');
		a.href = url;
		a.download = stem + (mode === 'minify' ? '.min' : '') + '.js';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	});

	$('bmClearBtn').addEventListener('click', () => {
		inEl.value = '';
		fileName = 'script.js';
		run();
		inEl.focus();
	});

	$('bmSampleBtn').addEventListener('click', () => {
		inEl.value = 'function greet(name){if(!name){return "Hello"}const parts=["Hello",name].map(function(x){return x.trim()});return parts.join(", ")+"!"}const user={id:1,tags:["a","b"],active:true};for(let i=0;i<3;i++){console.log(greet("World"+i))}';
		fileName = 'sample.js';
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