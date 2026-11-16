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
        optSort = $('bmSort'),
        modeBox = $('bmMode');
    let mode = 'beautify',
        seq = 0;
    let fileName = 'data.json',
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

    function parseJson(s) {
        let i = 0;
        const fail = (m, at) => {
            at = at == null ? i : at;
            const pre = s.slice(0, at).split('\n');
            const err = new Error(m + ' (line ' + pre.length + ', column ' + (pre[pre.length - 1].length + 1) + ')');
            throw err;
        };
        const ws = () => {
            while (i < s.length && ' \t\n\r﻿'.indexOf(s[i]) >= 0) i++;
        };

        function val() {
            ws();
            const c = s[i];
            if (c === '{') {
                i++;
                const items = [];
                ws();
                if (s[i] === '}') {
                    i++;
                    return {
                        t: 'o',
                        v: items
                    };
                }
                for (;;) {
                    ws();
                    if (s[i] !== '"') fail('Expected a quoted key');
                    const k = str();
                    ws();
                    if (s[i] !== ':') fail('Expected ":"');
                    i++;
                    items.push([k, val()]);
                    ws();
                    if (s[i] === ',') {
                        i++;
                        continue;
                    }
                    if (s[i] === '}') {
                        i++;
                        return {
                            t: 'o',
                            v: items
                        };
                    }
                    fail(i >= s.length ? 'Unexpected end of input' : 'Expected "," or "}"');
                }
            }
            if (c === '[') {
                i++;
                const items = [];
                ws();
                if (s[i] === ']') {
                    i++;
                    return {
                        t: 'a',
                        v: items
                    };
                }
                for (;;) {
                    items.push(val());
                    ws();
                    if (s[i] === ',') {
                        i++;
                        continue;
                    }
                    if (s[i] === ']') {
                        i++;
                        return {
                            t: 'a',
                            v: items
                        };
                    }
                    fail(i >= s.length ? 'Unexpected end of input' : 'Expected "," or "]"');
                }
            }
            if (c === '"') return {
                t: 'p',
                v: str()
            };
            const m = /^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i, i + 400));
            if (!m) fail(i >= s.length ? 'Unexpected end of input' : 'Unexpected character "' + c + '"');
            i += m[0].length;
            return {
                t: 'p',
                v: m[0]
            };
        }

        function str() {
            const st = i;
            i++;
            while (i < s.length && s[i] !== '"') {
                if (s[i] === '\n') fail('Line break inside a string');
                if (s[i] === '\\') {
                    if (!/["\\\/bfnrtu]/.test(s[i + 1] || '')) fail('Bad escape');
                    if (s[i + 1] === 'u' && !/^[0-9a-fA-F]{4}$/.test(s.substr(i + 2, 4))) fail('Bad \\u escape');
                    i += 2;
                } else i++;
            }
            if (i >= s.length) fail('Unterminated string', st);
            i++;
            return s.slice(st, i);
        }
        const v = val();
        ws();
        if (i < s.length) fail('Unexpected text after the JSON value');
        return v;
    }

    function keyOf(k) {
        try {
            return JSON.parse(k);
        } catch (e) {
            return k;
        }
    }

    function sortTree(n) {
        if (n.t === 'o') {
            n.v.forEach((p) => sortTree(p[1]));
            n.v.sort((a, b) => {
                const x = keyOf(a[0]),
                    y = keyOf(b[0]);
                return x < y ? -1 : x > y ? 1 : 0;
            });
        } else if (n.t === 'a') n.v.forEach(sortTree);
    }

    function write(n, unit, depth) {
        if (n.t === 'p') return n.v;
        const items = n.t === 'o' ? n.v.map((p) => p[0] + (unit === null ? ':' : ': ') + write(p[1], unit, depth + 1)) : n.v.map((x) => write(x, unit, depth + 1));
        const [o, c] = n.t === 'o' ? ['{', '}'] : ['[', ']'];
        if (!items.length) return o + c;
        if (unit === null) return o + items.join(',') + c;
        const pad = unit.repeat(depth + 1);
        return o + '\n' + items.map((x) => pad + x).join(',\n') + '\n' + unit.repeat(depth) + c;
    }

    function format(src, unit) {
        const tree = parseJson(src);
        if (optSort.checked) sortTree(tree);
        return write(tree, unit, 0) + (unit === null ? '' : '\n');
    }

    const beautify = (src) => format(src, optIndent.value === 'tab' ? '\t' : ' '.repeat(parseInt(optIndent.value, 10)));

    const minify = (src) => format(src, null);

    async function run() {
        const my = ++seq;
        clearError();
        const src = inEl.value;
        if (!src.trim()) {
            outEl.value = '';
            sizeEl.textContent = '';
            statusEl.textContent = 'Paste JSON below or open a file';
            copyBtn.disabled = dlBtn.disabled = true;
            return;
        }
        try {
            const out = mode === 'beautify' ? beautify(src) : minify(src);
            if (my !== seq) return;
            outEl.value = out;
            const a = bytes(src),
                b = bytes(out);
            sizeEl.textContent = fmt(b) + (mode === 'minify' && a ? ' · ' + Math.round((1 - b / a) * 100) + '% smaller' : '');
            statusEl.textContent = (mode === 'beautify' ? 'Beautified' : 'Minified') + ' · ' + out.split('\n').length.toLocaleString() + ' line' + (out.indexOf('\n') < 0 ? '' : 's');
            copyBtn.disabled = dlBtn.disabled = false;
        } catch (e) {
            if (my !== seq) return;
            console.error(e);
            outEl.value = '';
            const loc = '';
            const msg = String(e && e.message ? e.message : e);
            showError('Could not ' + mode + ' this JSON: ' + msg + loc);
            copyBtn.disabled = dlBtn.disabled = true;
        }
    }

    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(run, 180);
    }

    inEl.addEventListener('input', schedule);

    [optIndent, optSort].forEach((el) => el.addEventListener('change', run));

    modeBox.addEventListener('click', (e) => {
        const b = e.target.closest('.mode-btn');
        if (!b) return;
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
            type: 'application/json;charset=utf-8'
        }));
        const a = document.createElement('a');
        a.href = url;
        a.download = stem + (mode === 'minify' ? '.min' : '') + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

    $('bmClearBtn').addEventListener('click', () => {
        inEl.value = '';
        fileName = 'data.json';
        run();
        inEl.focus();
    });

    $('bmSampleBtn').addEventListener('click', () => {
        inEl.value = '{"name":"Matte","version":1.10,"id":12345678901234567890,"tags":["a","b"],"nested":{"ok":true,"none":null,"list":[1,2,{"x":[]}]}}';
        fileName = 'sample.json';
        run();
    });

    function loadFile(f) {
        if (!f) return;
        if (f.size > 8 * 1024 * 1024) {
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
        if (e.dataTransfer.files.length) loadFile(e.dataTransfer.files[0]);
    });

    inEl.addEventListener('keydown', (e) => {
        if (e.key === 'Tab' && !e.shiftKey) {
            e.preventDefault();
            document.execCommand('insertText', false, '\t');
        }
    });
})();