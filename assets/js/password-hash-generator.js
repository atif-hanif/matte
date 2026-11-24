(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const H = window.hashwasm;
	const enc = new TextEncoder();

	const modeBox = $('phMode'),
		optAlgo = $('phAlgo'),
		optCost = $('phCost'),
		optPrefix = $('phPrefix'),
		optMem = $('phMem'),
		optIter = $('phIter'),
		optPar = $('phPar'),
		optPbIter = $('phPbIter');
	const passIn = $('phPass'),
		passInfo = $('phPassInfo'),
		hashIn = $('phHashIn'),
		detectEl = $('phDetect'),
		outEl = $('phOut'),
		warnEl = $('phWarn'),
		partsEl = $('phParts'),
		verdictEl = $('phVerdict'),
		infoEl = $('phInfo'),
		outTitle = $('phOutTitle');
	const errBox = $('phErr'),
		statusEl = $('phStatus'),
		goBtn = $('phGoBtn'),
		goLabel = $('phGoLabel'),
		copyBtn = $('phCopyBtn'),
		clearBtn = $('phClearBtn'),
		codeEl = $('phCode'),
		tabsBox = $('phTabs');

	let mode = 'hash',
		lang = 'php',
		lastHash = '',
		busy = false;

	const UNSAFE = ['sha256', 'sha512', 'md5'];
	const NAMES = { bcrypt: 'bcrypt', argon2id: 'Argon2id', pbkdf2: 'PBKDF2-SHA256', sha256: 'SHA-256', sha512: 'SHA-512', md5: 'MD5' };

	function randomBytes(n) {
		const b = new Uint8Array(n);
		crypto.getRandomValues(b);
		return b;
	}

	function randomString(n, chars) {
		const out = [];
		const limit = 256 - (256 % chars.length);
		while(out.length < n) {
			for(const x of randomBytes(n * 2)) {
				if(x < limit && out.length < n) out.push(chars[x % chars.length]);
			}
		}
		return out.join('');
	}

	function toBase64(bytes) {
		let s = '';
		bytes.forEach((b) => (s += String.fromCharCode(b)));
		return btoa(s);
	}

	function equalTime(a, b) {
		if(a.length !== b.length) return false;
		let r = 0;
		for(let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
		return r === 0;
	}

	const ms = (t) => (t < 1000 ? Math.round(t) + ' ms' : (t / 1000).toFixed(2) + ' s');

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function setBusy(on, label) {
		busy = on;
		goBtn.disabled = on;
		goLabel.textContent = on ? label : mode === 'hash' ? 'Generate hash' : 'Verify';
	}

	async function pbkdf2(password, salt, iterations) {
		const bytes = await H.pbkdf2({
			password: enc.encode(password),
			salt: enc.encode(salt),
			iterations,
			hashLength: 32,
			hashFunction: H.createSHA256(),
			outputType: 'binary'
		});
		return toBase64(bytes);
	}

	async function makeHash(algo, password) {
		switch(algo) {
			case 'bcrypt': {
				const h = await H.bcrypt({ password: enc.encode(password).slice(0, 72), salt: randomBytes(16), costFactor: +optCost.value, outputType: 'encoded' });
				return h.replace(/^\$2[aby]\$/, '$' + optPrefix.value + '$');
			}
			case 'argon2id':
				return H.argon2id({
					password: enc.encode(password),
					salt: randomBytes(16),
					parallelism: +optPar.value,
					iterations: +optIter.value,
					memorySize: +optMem.value,
					hashLength: 32,
					outputType: 'encoded'
				});
			case 'pbkdf2': {
				const iterations = +optPbIter.value;
				const salt = randomString(22, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
				return 'pbkdf2_sha256$' + iterations + '$' + salt + '$' + (await pbkdf2(password, salt, iterations));
			}
			case 'sha256':
				return H.sha256(password);
			case 'sha512':
				return H.sha512(password);
			case 'md5':
				return H.md5(password);
		}
		throw new Error('Unknown algorithm');
	}

	function detect(hash) {
		const h = hash.trim();
		let m;
		if((m = h.match(/^\$(2[aby])\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/))) {
			return { algo: 'bcrypt', parts: [['Algorithm', 'bcrypt ($' + m[1] + '$)'], ['Cost', m[2] + ' (' + Math.pow(2, +m[2]).toLocaleString() + ' rounds)'], ['Salt', m[3]], ['Hash', m[4]]] };
		}
		if((m = h.match(/^\$(argon2(?:id|i|d))\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/))) {
			return {
				algo: 'argon2',
				parts: [['Algorithm', m[1] === 'argon2id' ? 'Argon2id' : m[1]], ['Version', m[2] === '19' ? '1.3 (19)' : m[2]], ['Memory', (+m[3]).toLocaleString() + ' KiB (' + Math.round(+m[3] / 1024) + ' MiB)'],
					['Iterations', m[4]], ['Parallelism', m[5]], ['Salt', m[6]], ['Hash', m[7]]
				]
			};
		}
		if((m = h.match(/^pbkdf2_sha256\$(\d+)\$([^$]+)\$([A-Za-z0-9+\/=]+)$/))) {
			return { algo: 'pbkdf2', iterations: +m[1], salt: m[2], hash: m[3], parts: [['Algorithm', 'PBKDF2-SHA256 (Django format)'], ['Iterations', (+m[1]).toLocaleString()], ['Salt', m[2]], ['Hash', m[3]]] };
		}
		if(/^[a-f0-9]{32}$/i.test(h)) return { algo: 'md5', parts: [['Algorithm', 'MD5 (no salt)']] };
		if(/^[a-f0-9]{64}$/i.test(h)) return { algo: 'sha256', parts: [['Algorithm', 'SHA-256 (no salt)']] };
		if(/^[a-f0-9]{128}$/i.test(h)) return { algo: 'sha512', parts: [['Algorithm', 'SHA-512 (no salt)']] };
		return null;
	}

	async function verify(password, hash) {
		const d = detect(hash);
		if(!d) return null;
		const h = hash.trim();
		switch(d.algo) {
			case 'bcrypt':
				return H.bcryptVerify({ password: enc.encode(password).slice(0, 72), hash: h });
			case 'argon2':
				return H.argon2Verify({ password: enc.encode(password), hash: h });
			case 'pbkdf2':
				return equalTime(await pbkdf2(password, d.salt, d.iterations), d.hash);
			case 'md5':
				return equalTime(await H.md5(password), h.toLowerCase());
			case 'sha256':
				return equalTime(await H.sha256(password), h.toLowerCase());
			case 'sha512':
				return equalTime(await H.sha512(password), h.toLowerCase());
		}
		return null;
	}

	function renderParts(hash) {
		partsEl.innerHTML = '';
		const d = detect(hash);
		const rows = d ? d.parts.slice() : [];
		rows.push(['Length', hash.length + ' characters']);
		rows.forEach(([k, v], i) => {
			const row = document.createElement('div');
			row.className = 'ph-part';
			row.innerHTML = '<span></span><span></span>';
			row.firstChild.textContent = k;
			row.lastChild.textContent = v;
			if(/^(Algorithm|Cost|Version|Memory|Iterations|Parallelism|Length)$/.test(k)) row.lastChild.classList.add('plain');
			partsEl.appendChild(row);
		});
	}

	function updatePassInfo() {
		const p = passIn.value;
		const bytes = enc.encode(p).length;
		passInfo.className = 'ph-sub';
		if(!p) {
			passInfo.textContent = '';
			return;
		}
		let t = p.length + ' characters · ' + bytes + ' bytes';
		if(mode === 'hash' && optAlgo.value === 'bcrypt' && bytes > 72) {
			t += ' · bcrypt only uses the first 72 bytes, so the rest is ignored. Use Argon2id for longer passwords.';
			passInfo.classList.add('warn');
		}
		if(/^\s|\s$/.test(p)) {
			t += ' · starts or ends with a space';
			passInfo.classList.add('warn');
		}
		passInfo.textContent = t;
	}

	async function doHash() {
		clearError();
		const p = passIn.value;
		if(!p) {
			showError('Type the password you want to hash.');
			passIn.focus();
			return;
		}
		const algo = optAlgo.value;
		setBusy(true, 'Hashing…');
		statusEl.textContent = 'Hashing with ' + NAMES[algo] + '…';
		await new Promise((r) => setTimeout(r, 20)); // let the button update first
		try {
			const t0 = performance.now();
			const hash = await makeHash(algo, p);
			const took = performance.now() - t0;
			lastHash = hash;
			outEl.value = hash;
			renderParts(hash);
			infoEl.textContent = NAMES[algo] + ' · ' + ms(took);
			statusEl.textContent = 'Hash ready in ' + ms(took) + (UNSAFE.includes(algo) ? '' : ' · a new random salt is used every time');
			copyBtn.disabled = false;
			warnEl.classList.toggle('show', UNSAFE.includes(algo));
			warnEl.textContent = UNSAFE.includes(algo) ?
				NAMES[algo] + ' is fast and has no salt, so attackers can test billions of guesses per second and look up common passwords instantly. Only use it to check old systems. For new passwords, choose bcrypt or Argon2id.' : '';
			renderCode();
		} catch (e) {
			showError('The hash could not be made: ' + (e && e.message ? e.message : 'unknown error') + '.');
			statusEl.textContent = 'Something went wrong';
		} finally {
			setBusy(false);
		}
	}

	function setVerdict(cls, icon, title, sub) {
		verdictEl.className = 'ph-verdict' + (cls ? ' ' + cls : '');
		verdictEl.innerHTML = '<i class="fa-solid ' + icon + '"></i><strong></strong><small></small>';
		verdictEl.querySelector('strong').textContent = title;
		verdictEl.querySelector('small').textContent = sub || '';
	}

	function updateDetect() {
		const h = hashIn.value.trim();
		detectEl.className = 'ph-sub';
		if(!h) {
			detectEl.textContent = '';
			return;
		}
		const d = detect(h);
		if(d) {
			detectEl.classList.add('ok');
			detectEl.textContent = 'Recognised: ' + d.parts[0][1] + (d.parts[1] ? ' · ' + d.parts[1][0].toLowerCase() + ' ' + d.parts[1][1] : '');
		} else {
			detectEl.classList.add('warn');
			detectEl.textContent = 'Not recognised. Supported: bcrypt ($2y$, $2b$, $2a$), Argon2 ($argon2id$), Django PBKDF2 (pbkdf2_sha256$) and plain MD5, SHA-256 or SHA-512.';
		}
	}

	async function doVerify() {
		clearError();
		const p = passIn.value,
			h = hashIn.value.trim();
		if(!p || !h) {
			showError(!p ? 'Type the password to check.' : 'Paste the hash from your database.');
			(!p ? passIn : hashIn).focus();
			return;
		}
		if(!detect(h)) {
			showError('This hash format is not recognised. Check that you copied all of it.');
			return;
		}
		setBusy(true, 'Checking…');
		statusEl.textContent = 'Checking the password…';
		await new Promise((r) => setTimeout(r, 20));
		try {
			const t0 = performance.now();
			const ok = await verify(p, h);
			const took = performance.now() - t0;
			const weak = ['md5', 'sha256', 'sha512'].includes(detect(h).algo);
			if(ok) setVerdict('match', 'fa-circle-check', 'Password matches', 'This password is correct for this hash · checked in ' + ms(took) + (weak ? '. This hash has no salt and is easy to crack: re-hash the password with bcrypt or Argon2id when the user next logs in.' : ''));
			else setVerdict('nomatch', 'fa-circle-xmark', 'Password does not match', 'Check for typing mistakes, extra spaces or a hash that was cut short');
			statusEl.textContent = ok ? 'Match' : 'No match';
			infoEl.textContent = ms(took);
		} catch (e) {
			setVerdict('nomatch', 'fa-triangle-exclamation', 'This hash could not be checked', 'It may be damaged or use settings this tool does not support');
			statusEl.textContent = 'Could not check';
		} finally {
			setBusy(false);
		}
	}

	function snippets() {
		const algo = UNSAFE.includes(optAlgo.value) ? 'bcrypt' : optAlgo.value;
		const unsafeNote = UNSAFE.includes(optAlgo.value) ? '# ' + NAMES[optAlgo.value] + ' is not safe for passwords. Use bcrypt instead:\n\n' : '';
		const cost = optCost.value,
			mem = optMem.value,
			t = optIter.value,
			p = optPar.value,
			it = optPbIter.value;
		const S = {
			bcrypt: {
				php: '<?php\n// Sign up: hash the password\n$hash = password_hash($password, PASSWORD_BCRYPT, [\'cost\' => ' + cost + ']);\n// save $hash in the users.password column\n\n// Log in: check the password\nif (password_verify($password, $user[\'password\'])) {\n    // correct password\n}',
				laravel: '// Sign up\nuse Illuminate\\Support\\Facades\\Hash;\n\n$user->password = Hash::make($request->password, [\'rounds\' => ' + cost + ']);\n$user->save();\n\n// Log in\nif (Hash::check($request->password, $user->password)) {\n    // correct password\n}\n\n// Or set it for the whole app in .env\n// BCRYPT_ROUNDS=' + cost,
				node: '// npm install bcrypt\nconst bcrypt = require(\'bcrypt\');\n\n// Sign up\nconst hash = await bcrypt.hash(password, ' + cost + ');\n\n// Log in\nconst ok = await bcrypt.compare(password, user.password);',
				python: '# pip install bcrypt\nimport bcrypt\n\n# Sign up\nhashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=' + cost + ')).decode()\n\n# Log in\nok = bcrypt.checkpw(password.encode(), user.password.encode())'
			},
			argon2id: {
				php: '<?php\n// Sign up\n$hash = password_hash($password, PASSWORD_ARGON2ID, [\n    \'memory_cost\' => ' + mem + ',\n    \'time_cost\'   => ' + t + ',\n    \'threads\'     => ' + p + ',\n]);\n\n// Log in\nif (password_verify($password, $user[\'password\'])) {\n    // correct password\n}',
				laravel: '// config/hashing.php\n\'driver\' => \'argon2id\',\n\'argon\' => [\n    \'memory\'  => ' + mem + ',\n    \'time\'    => ' + t + ',\n    \'threads\' => ' + p + ',\n],\n\n// Sign up\n$user->password = Hash::make($request->password);\n\n// Log in\nif (Hash::check($request->password, $user->password)) {\n    // correct password\n}',
				node: '// npm install argon2\nconst argon2 = require(\'argon2\');\n\n// Sign up\nconst hash = await argon2.hash(password, {\n  type: argon2.argon2id,\n  memoryCost: ' + mem + ',\n  timeCost: ' + t + ',\n  parallelism: ' + p + ',\n});\n\n// Log in\nconst ok = await argon2.verify(user.password, password);',
				python: '# pip install argon2-cffi\nfrom argon2 import PasswordHasher\nfrom argon2.exceptions import VerifyMismatchError\n\nph = PasswordHasher(time_cost=' + t + ', memory_cost=' + mem + ', parallelism=' + p + ')\n\n# Sign up\nhashed = ph.hash(password)\n\n# Log in\ntry:\n    ph.verify(user.password, password)\n    ok = True\nexcept VerifyMismatchError:\n    ok = False'
			},
			pbkdf2: {
				php: '<?php\n// Sign up (Django-compatible format)\n$salt = bin2hex(random_bytes(11));\n$hash = base64_encode(hash_pbkdf2(\'sha256\', $password, $salt, ' + it + ', 32, true));\n$stored = \'pbkdf2_sha256$' + it + '$\' . $salt . \'$\' . $hash;\n\n// Log in\n[$algo, $iter, $salt, $hash] = explode(\'$\', $user[\'password\']);\n$check = base64_encode(hash_pbkdf2(\'sha256\', $password, $salt, (int) $iter, 32, true));\n$ok = hash_equals($hash, $check);',
				laravel: '// Laravel has no PBKDF2 driver. Use bcrypt or Argon2id:\n$user->password = Hash::make($request->password);\n\n// To check old Django hashes during a migration, use the PHP example\n// and re-save the password with Hash::make() after a successful login.',
				node: 'const crypto = require(\'crypto\');\n\n// Sign up (Django-compatible format)\nconst salt = crypto.randomBytes(16).toString(\'base64url\').slice(0, 22);\nconst hash = crypto.pbkdf2Sync(password, salt, ' + it + ', 32, \'sha256\').toString(\'base64\');\nconst stored = `pbkdf2_sha256$' + it + '$${salt}$${hash}`;\n\n// Log in\nconst [, iter, s, h] = user.password.split(\'$\');\nconst check = crypto.pbkdf2Sync(password, s, Number(iter), 32, \'sha256\');\nconst ok = crypto.timingSafeEqual(check, Buffer.from(h, \'base64\'));',
				python: '# Django uses this format by default\nfrom django.contrib.auth.hashers import make_password, check_password\n\n# Sign up\nhashed = make_password(password)\n\n# Log in\nok = check_password(password, user.password)'
			}
		};
		const set = S[algo];
		const sample = lastHash && !UNSAFE.includes(optAlgo.value) ? lastHash : '<paste the hash here>';
		const sql = '-- Store the hash, never the password.\n-- Hashes are up to about 100 characters, so leave room for future algorithms.\nALTER TABLE users ADD password VARCHAR(255) NOT NULL;\n\n-- Set a password by hand, e.g. for an admin user\nUPDATE users\nSET password = \'' + sample.replace(/'/g, "''") + '\'\nWHERE email = \'admin@example.com\';';
		const map = { php: set.php, laravel: set.laravel, node: set.node, python: set.python, sql };
		let code = map[lang];
		if(unsafeNote && lang !== 'sql') code = (lang === 'python' ? unsafeNote : unsafeNote.replace(/^#/, '//')) + code;
		return code;
	}

	function renderCode() {
		const code = snippets();
		codeEl.textContent = code;
		
		codeEl.innerHTML = codeEl.innerHTML.split('\n').map((l) => (/^\s*(\/\/|#|--)/.test(l) ? '<span class="c">' + l + '</span>' : l)).join('\n');
	}

	function copyText(text, msg) {
		const done = () => {
			const prev = statusEl.textContent;
			statusEl.textContent = msg;
			setTimeout(() => (statusEl.textContent = prev), 1400);
		};
		if(navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback(text) && done());
		else if(fallback(text)) done();
	}

	function fallback(text) {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch (e) {}
		ta.remove();
		if(!ok) showError('Your browser blocked copying. Select the text and press Ctrl+C (Cmd+C on Mac).');
		return ok;
	}

	function showAlgoOptions() {
		document.querySelectorAll('#phSettings [data-algo]').forEach((g) => g.classList.toggle('is-hidden', mode !== 'hash' || g.dataset.algo !== optAlgo.value));
	}

	modeBox.addEventListener('click', (e) => {
		const btn = e.target.closest('.mode-btn');
		if(!btn || btn.dataset.mode === mode) return;
		modeBox.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
		mode = btn.dataset.mode;
		document.querySelectorAll('[data-for]').forEach((g) => g.classList.toggle('is-hidden', g.dataset.for !== mode));
		showAlgoOptions();
		clearError();
		goLabel.textContent = mode === 'hash' ? 'Generate hash' : 'Verify';
		goBtn.firstElementChild.className = 'fa-solid ' + (mode === 'hash' ? 'fa-lock' : 'fa-check-double') + ' me-2';
		outTitle.textContent = mode === 'hash' ? 'Hash' : 'Result';
		infoEl.textContent = '';
		copyBtn.classList.toggle('is-hidden', mode !== 'hash');
		statusEl.textContent = mode === 'hash' ? 'Type a password and press Generate' : 'Type a password and paste a hash to check it';
		if(mode === 'verify' && !hashIn.value && lastHash) {
			hashIn.value = lastHash;
			updateDetect();
		}
		updatePassInfo();
	});

	[optAlgo, optCost, optPrefix, optMem, optIter, optPar, optPbIter].forEach((el) => el.addEventListener('change', () => {
		showAlgoOptions();
		updatePassInfo();
		renderCode();
		if(passIn.value && mode === 'hash' && !busy) doHash();
	}));

	goBtn.addEventListener('click', () => (mode === 'hash' ? doHash() : doVerify()));
	[passIn, hashIn].forEach((el) => el.addEventListener('keydown', (e) => {
		if(e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			if(!busy) mode === 'hash' ? doHash() : doVerify();
		}
	}));

	passIn.addEventListener('input', () => {
		updatePassInfo();
		if(mode === 'verify') setVerdict('', 'fa-scale-balanced', 'Ready to check', 'Press Verify');
	});

	hashIn.addEventListener('input', () => {
		updateDetect();
		setVerdict('', 'fa-scale-balanced', 'Ready to check', 'Press Verify');
	});

	$('phEye').addEventListener('click', (e) => {
		const show = passIn.type === 'password';
		passIn.type = show ? 'text' : 'password';
		e.currentTarget.innerHTML = '<i class="fa-regular ' + (show ? 'fa-eye-slash' : 'fa-eye') + '"></i>';
	});

	$('phRandom').addEventListener('click', () => {
		passIn.value = randomString(16, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%^&*-_=+');
		passIn.type = 'text';
		$('phEye').innerHTML = '<i class="fa-regular fa-eye-slash"></i>';
		updatePassInfo();
		if(mode === 'hash') doHash();
	});

	copyBtn.addEventListener('click', () => lastHash && copyText(lastHash, 'Hash copied'));
	$('phCodeCopy').addEventListener('click', () => copyText(codeEl.textContent, 'Code copied'));

	tabsBox.addEventListener('click', (e) => {
		const t = e.target.closest('.ph-tab');
		if(!t) return;
		lang = t.dataset.lang;
		tabsBox.querySelectorAll('.ph-tab').forEach((b) => b.classList.toggle('active', b === t));
		renderCode();
	});

	clearBtn.addEventListener('click', () => {
		passIn.value = hashIn.value = outEl.value = '';
		lastHash = '';
		partsEl.innerHTML = '';
		warnEl.classList.remove('show');
		infoEl.textContent = '';
		copyBtn.disabled = true;
		updatePassInfo();
		updateDetect();
		setVerdict('', 'fa-scale-balanced', 'Type a password and paste a hash, then press Verify');
		statusEl.textContent = mode === 'hash' ? 'Type a password and press Generate' : 'Type a password and paste a hash to check it';
		renderCode();
		passIn.focus();
	});

	if(!H) {
		showError('The hashing library did not load. Refresh the page and try again.');
		goBtn.disabled = true;
	}
	showAlgoOptions();
	renderCode();
})();