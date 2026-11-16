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
        optQuote = $('bmQuote'),
        optComma = $('bmComma'),
        optComments = $('bmComments'),
        optHtml = $('bmHtml'),
        modeBox = $('bmMode');
    let mode = 'beautify',
        seq = 0;
    let fileName = 'script.php',
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

    async function beautify(src) {
        if (!window.prettier || !window.prettierPlugins || !prettierPlugins.php) throw new Error('The PHP formatter did not load. Check assets/vendors/prettier-php.');
        const tab = optIndent.value === 'tab';
        let code = src,
            added = false;
        if (!/<\?(php|=)?/i.test(code)) {
            code = '<?php\n' + code;
            added = true;
        }
        let out = await prettier.format(code, {
            parser: 'php',
            plugins: [prettierPlugins.php],
            printWidth: parseInt(optWrap.value, 10),
            tabWidth: tab ? 4 : parseInt(optIndent.value, 10),
            useTabs: tab,
            singleQuote: optQuote.value === 'single',
            trailingCommaPHP: optComma.checked,
            braceStyle: optBrace.value
        });
        if (added) out = out.replace(/^<\?php\s*\n?/, '').replace(/\s*\?>\s*$/, '\n');
        return out;
    }

    const WORD = /[A-Za-z0-9_$\\\u0080-\uffff]/,
        OPS = '+-.&|<>=!*/%^?:~';

    function needSpace(prev, cur) {
        if (WORD.test(prev) && WORD.test(cur)) return true;
        if (OPS.indexOf(prev) >= 0 && OPS.indexOf(cur) >= 0) return true;
        if ((prev === '.' && /\d/.test(cur)) || (/\d/.test(prev) && cur === '.')) return true;
        return false;
    }

    function minPhp(code, dropComments) { // code = text after the opening tag, up to (not including) ?>
        let out = '',
            i = 0,
            space = false;
        const n = code.length;
        const emit = (s) => {
            if (space && out && needSpace(out.charAt(out.length - 1), s.charAt(0))) out += ' ';
            space = false;
            out += s;
        };
        while (i < n) {
            const c = code[i],
                two = code.substr(i, 2);
            if (/\s/.test(c)) {
                space = true;
                i++;
                continue;
            }
            if ((two === '//' || (c === '#' && code[i + 1] !== '['))) { // line comment, ends at a newline or ?>
                let j = i;
                while (j < n && code[j] !== '\n' && code.substr(j, 2) !== '?>') j++;
                if (!dropComments) {
                    emit(code.slice(i, j));
                    out += '\n';
                }
                space = true;
                i = j;
                continue;
            }
            if (two === '/*') {
                let j = code.indexOf('*/', i + 2);
                j = j < 0 ? n : j + 2;
                if (!dropComments) emit(code.slice(i, j));
                space = true;
                i = j;
                continue;
            }
            if (c === "'" || c === '"' || c === '`') {
                let j = i + 1;
                while (j < n && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
                emit(code.slice(i, j + 1));
                i = j + 1;
                continue;
            }
            if (two === '<<' && code[i + 2] === '<') { // heredoc / nowdoc
                const m = /^<<<[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/.exec(code.slice(i));
                if (m) {
                    const re = new RegExp('\\n[ \\t]*' + m[2] + '(?![A-Za-z0-9_])');
                    const rest = code.slice(i + m[0].length),
                        f = re.exec(rest);
                    const end = f ? i + m[0].length + f.index + f[0].length : n;
                    emit(code.slice(i, end));
                    out += '\n';
                    i = end;
                    continue;
                }
            }
            emit(c);
            i++;
        }
        return out.replace(/\s+$/, '');
    }

    function tightenHtml(s) {
        return s.split(/(<(pre|textarea|script|style)\b[\s\S]*?<\/\2\s*>)/i).map((p, k) => (k % 3 === 0 ? p.replace(/\s+/g, ' ') : k % 3 === 1 ? p : '')).join('');
    }

    function minify(src) {
        const dropC = optComments.checked,
            tight = optHtml.checked;
        let out = '',
            i = 0;
        const re = /<\?(php\b|=)?/ig;
        while (i < src.length) {
            re.lastIndex = i;
            const m = re.exec(src);
            if (!m) {
                out += tight ? tightenHtml(src.slice(i)) : src.slice(i);
                break;
            }

            out += tight ? tightenHtml(src.slice(i, m.index)) : src.slice(i, m.index);
            const open = m[1] === '=' ? '<?=' : '<?php ';
            let j = m.index + m[0].length,
                k = j,
                endAt = -1;
            
            let q = j;
            while (q < src.length) {
                const c = src[q],
                    two = src.substr(q, 2);
                if (two === '?>') {
                    endAt = q;
                    break;
                }
                if (two === '//' || (c === '#' && src[q + 1] !== '[')) {
                    while (q < src.length && src[q] !== '\n' && src.substr(q, 2) !== '?>') q++;
                    continue;
                }
                if (two === '/*') {
                    const e = src.indexOf('*/', q + 2);
                    q = e < 0 ? src.length : e + 2;
                    continue;
                }
                if (c === "'" || c === '"' || c === '`') {
                    q++;
                    while (q < src.length && src[q] !== c) q += src[q] === '\\' ? 2 : 1;
                    q++;
                    continue;
                }
                if (two === '<<' && src[q + 2] === '<') {
                    const h = /^<<<[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/.exec(src.slice(q));
                    if (h) {
                        const f = new RegExp('\\n[ \\t]*' + h[2] + '(?![A-Za-z0-9_])').exec(src.slice(q + h[0].length));
                        q = f ? q + h[0].length + f.index + f[0].length : src.length;
                        continue;
                    }
                }
                q++;
            }
            const body = src.slice(j, endAt < 0 ? src.length : endAt);
            let min = minPhp(body, dropC);
            if (open === '<?=') out += '<?=' + (/^[A-Za-z0-9_$\\]/.test(min) ? ' ' : '') + min.replace(/;$/, '') + (endAt < 0 ? '' : ' ');
            else out += open + min + (min && !/[;{}:]$/.test(min) && endAt >= 0 ? ';' : '');
            if (endAt < 0) {
                i = src.length;
                break;
            }
            out += '?>';
            i = endAt + 2;
            if (src[i] === '\n') {
                out += '\n';
                i++;
            } // PHP swallows one newline right after ?>
        }
        return out.trim();
    }

    async function run() {
        const my = ++seq;
        clearError();
        const src = inEl.value;
        if (!src.trim()) {
            outEl.value = '';
            sizeEl.textContent = '';
            statusEl.textContent = 'Paste PHP below or open a file';
            copyBtn.disabled = dlBtn.disabled = true;
            return;
        }
        try {
            const out = mode === 'beautify' ? await beautify(src) : minify(src);
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
            const loc = e && e.loc && e.loc.start ? ' (line ' + e.loc.start.line + ', column ' + e.loc.start.column + ')' : '';
            const msg = String(e && e.message ? e.message : e).split('\n')[0].replace(/\s*\(\d+:\d+\)\s*$/, '');
            showError('Could not ' + mode + ' this PHP: ' + msg + loc);
            copyBtn.disabled = dlBtn.disabled = true;
        }
    }

    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(run, 180);
    }

    inEl.addEventListener('input', schedule);

    [optIndent, optBrace, optWrap, optQuote, optComma, optComments, optHtml].forEach((el) => el.addEventListener('change', run));

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
            type: 'application/x-httpd-php;charset=utf-8'
        }));
        const a = document.createElement('a');
        a.href = url;
        a.download = stem + (mode === 'minify' ? '.min' : '') + '.php';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    });

    $('bmClearBtn').addEventListener('click', () => {
        inEl.value = '';
        fileName = 'script.php';
        run();
        inEl.focus();
    });

    $('bmSampleBtn').addEventListener('click', () => {
        inEl.value = "<?php\n// user helper\nnamespace App;\n/** Greets. */\nfunction greet($name, $greeting = \"Hello\"){\nif(!$name){return $greeting;}\n$parts = [$greeting, $name];\nforeach($parts as $k=>$p){ echo trim($p).\"\\n\"; }\nreturn implode(', ', $parts).\"!\";\n}\n$text = <<<EOT\n  Hi $name\nEOT;\n?>\n<ul>\n    <li><?= greet('World') ?></li>\n</ul>\n";
        fileName = 'sample.php';
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