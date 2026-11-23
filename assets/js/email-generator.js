(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);

	/* ---------- Word lists ---------- */

	const ADJ = 'amber bold brave bright brisk calm clever cool cosy crisp curly daring eager early fancy fast fluffy fresh friendly gentle giant glad golden grand happy hidden honest jolly kind lively lucky lunar mellow merry mighty misty modern noble quick quiet rapid royal rustic shiny silent silver simple sleepy smart snowy solar sunny super swift tidy tiny urban vivid warm wild wise witty young zesty'.split(' ');
	const NOUN = 'acorn anchor apple arrow badger bamboo beacon berry bison breeze brook cactus canyon cedar cherry cloud comet coral cricket dolphin dragon eagle ember falcon fern finch forest fox galaxy garden gecko glacier harbor hawk heron island jaguar koala lake lantern lemon lily lotus maple meadow meteor mango moon ocean orchid otter owl panda parrot pebble pepper pine planet puffin quartz rabbit raven river robin rocket sparrow spruce star stone storm summit thunder tiger tulip valley walrus willow wolf zebra'.split(' ');
	const FIRST = 'james mary john patricia robert jennifer michael linda david elizabeth william barbara richard susan joseph jessica thomas sarah charles karen daniel lisa matthew nancy anthony sandra mark ashley steven emily paul donna andrew michelle joshua amanda kevin melissa brian laura george emma oliver sophia liam ava noah mia ethan chloe lucas grace ryan zoe adam hannah omar sara ali fatima ahmed aisha hassan zara bilal hira usman maryam'.split(' ');
	const LAST = 'smith johnson williams brown jones garcia miller davis wilson anderson taylor thomas moore martin jackson white harris clark lewis walker hall allen young king wright scott green baker adams nelson hill campbell mitchell roberts carter phillips evans turner parker collins edwards stewart morris murphy cook rogers morgan cooper peterson reed bailey bell khan ahmed malik hussain sheikh qureshi butt chaudhry raza iqbal'.split(' ');
	const DOMAINS = ['gmail.html', 'outlook.html', 'yahoo.html', 'hotmail.html', 'icloud.html'];

	/* ---------- Elements ---------- */

	const modeBox = $('egMode'),
		optStyle = $('egStyle'),
		optNumbers = $('egNumbers'),
		optFirst = $('egFirst'),
		optLast = $('egLast'),
		optDomain = $('egDomain'),
		optCustom = $('egCustom'),
		optCount = $('egCount'),
		optUser = $('egUser'),
		optVariations = $('egVariations');
	const errBox = $('egErr'),
		statusEl = $('egStatus'),
		listEl = $('egList'),
		textEl = $('egText'),
		countLabel = $('egCountLabel');
	const genBtn = $('egGenerateBtn'),
		copyBtn = $('egCopyBtn'),
		csvBtn = $('egCsvBtn'),
		dlBtn = $('egDownloadBtn'),
		clearBtn = $('egClearBtn');

	let mode = 'random',
		results = []; // [{email, pattern}]

	/* ---------- Secure random ---------- */

	function randInt(max) {
		const limit = Math.floor(0x100000000 / max) * max;
		const buf = new Uint32Array(1);
		do {
			crypto.getRandomValues(buf);
		} while(buf[0] >= limit);
		return buf[0] % max;
	}

	const pick = (arr) => arr[randInt(arr.length)];
	const num = (lo, hi) => lo + randInt(hi - lo + 1);

	/* ---------- Helpers ---------- */

	function slug(s) {
		return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
			.toLowerCase().replace(/[^a-z0-9]+/g, '');
	}

	function getDomain() {
		const v = optDomain.value;
		if(v === 'mixed') return pick(DOMAINS);
		if(v === 'custom') {
			return optCustom.value.trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
		}
		return v;
	}

	function validDomain(d) {
		return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(d);
	}

	/* ---------- Random mode ---------- */

	function randomUser(style, addNum) {
		const sep = pick(['.', '_', '', '.']);
		let u;
		switch(style) {
			case 'words':
				u = pick(ADJ) + sep + pick(NOUN);
				if(addNum) u += num(1, 999);
				break;
			case 'wordnum':
				u = pick(NOUN) + num(10, 9999);
				break;
			case 'person': {
				const f = pick(FIRST),
					l = pick(LAST);
				u = pick([f + '.' + l, f + l, f[0] + l, f + '_' + l, l + '.' + f, f + '.' + l[0]]);
				if(addNum) u += pick(['', num(1, 99), num(1970, 2008)]);
				break;
			}
			default: {
				const chars = 'abcdefghijkmnpqrstuvwxyz' + (addNum ? '23456789' : '');
				u = pick('abcdefghijkmnpqrstuvwxyz'.split(''));
				const len = num(8, 11);
				while(u.length < len) u += chars[randInt(chars.length)];
			}
		}
		return String(u);
	}

	function generateRandom() {
		const count = +optCount.value,
			style = optStyle.value,
			addNum = optNumbers.checked;
		const seen = new Set(),
			out = [];
		let guard = 0;
		while(out.length < count && guard++ < count * 50) {
			const email = randomUser(style, addNum) + '@' + getDomain();
			if(seen.has(email)) continue;
			seen.add(email);
			out.push({
				email,
				pattern: ''
			});
		}
		return out;
	}

	/* ---------- From a name ---------- */

	function namePatterns(first, last) {
		const f = first,
			l = last,
			fi = f[0],
			li = l ? l[0] : '';
		if(!l) {
			return [
				[f, 'first'],
				[f + '1', 'first + number'],
				['hello.' + f, 'hello.first'],
				['contact.' + f, 'contact.first']
			];
		}
		return [
			[f + '.' + l, 'first.last'],
			[fi + l, 'flast'],
			[f, 'first'],
			[f + l, 'firstlast'],
			[f + '_' + l, 'first_last'],
			[f + '-' + l, 'first-last'],
			[fi + '.' + l, 'f.last'],
			[f + li, 'firstl'],
			[f + '.' + li, 'first.l'],
			[l + '.' + f, 'last.first'],
			[l + f, 'lastfirst'],
			[l + fi, 'lastf'],
			[l + '.' + fi, 'last.f'],
			[l, 'last'],
			[fi + li, 'fl'],
			[l + '_' + f, 'last_first']
		];
	}

	function generateFromName() {
		const first = slug(optFirst.value),
			last = slug(optLast.value);
		if(!first) {
			showError('Type a first name to build addresses from.');
			return null;
		}
		const domain = getDomain();
		const seen = new Set();
		return namePatterns(first, last)
			.map(([u, p]) => ({
				email: u + '@' + domain,
				pattern: p
			}))
			.filter((r) => !seen.has(r.email) && seen.add(r.email));
	}

	/* ---------- My username ---------- */

	function cleanUser(s) {
		// keep characters mail providers commonly allow, lowercase, tidy dots
		return s.trim().toLowerCase()
			.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
			.replace(/\s+/g, '.')
			.replace(/[^a-z0-9._-]/g, '')
			.replace(/\.{2,}/g, '.')
			.replace(/^[._-]+|[._-]+$/g, '');
	}

	function userVariations(u) {
		const year = new Date().getFullYear();
		const base = u.replace(/[._-]/g, '');
		return [
			[u, 'as typed'],
			[u + '.official', 'official'],
			['the' + base, 'the + name'],
			['real.' + u, 'real.'],
			['iam' + base, 'iam + name'],
			['hello.' + u, 'hello.'],
			[u + '.work', 'work'],
			[u + '.mail', 'mail'],
			[u + '.hq', 'hq'],
			[u + '_' + 'pro', 'pro'],
			[u + year, 'year'],
			[u + num(10, 99), 'number'],
			[u + num(100, 999), 'number'],
			[base, 'no dots'],
			[u.replace(/\./g, '_'), 'underscore'],
			[base + '.me', '.me']
		];
	}

	function generateFromUser() {
		const raw = optUser.value;
		const u = cleanUser(raw);
		if(!u) {
			showError(raw.trim() ? 'Use letters, numbers, dots, hyphens or underscores in the username.' : 'Type the username you want, for example atif.hanif.');
			return null;
		}
		const seen = new Set(),
			out = [];
		const add = (user, domain, pattern) => {
			const email = user + '@' + domain;
			if(user.length > 64 || seen.has(email)) return;
			seen.add(email);
			out.push({ email, pattern });
		};
		if(optDomain.value === 'mixed') {
			DOMAINS.forEach((d) => add(u, d, 'as typed'));
			if(optVariations.checked) userVariations(u).slice(1).forEach(([v, p]) => add(v, pick(DOMAINS), p));
		} else {
			const d = getDomain();
			(optVariations.checked ? userVariations(u) : [[u, 'as typed']]).forEach(([v, p]) => add(v, d, p));
		}
		return { out, changed: u !== raw.trim() };
	}

	/* ---------- Render ---------- */

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function setEmpty(msg) {
		listEl.innerHTML = '';
		const li = document.createElement('li');
		li.className = 'eg-empty';
		li.textContent = msg;
		listEl.appendChild(li);
	}

	function render() {
		listEl.innerHTML = '';
		const frag = document.createDocumentFragment();
		results.forEach((r, i) => {
			const li = document.createElement('li');
			const at = r.email.lastIndexOf('@');
			const addr = document.createElement('span');
			addr.className = 'eg-addr';
			addr.innerHTML = '<span class="eg-user"></span><span class="eg-at">@</span><span class="eg-dom"></span>';
			addr.children[0].textContent = r.email.slice(0, at);
			addr.children[2].textContent = r.email.slice(at + 1);
			li.appendChild(addr);
			if(r.pattern) {
				const p = document.createElement('span');
				p.className = 'eg-pattern';
				p.textContent = r.pattern;
				li.appendChild(p);
			}
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'eg-copy';
			b.title = 'Copy ' + r.email;
			b.setAttribute('aria-label', 'Copy ' + r.email);
			b.dataset.i = i;
			b.innerHTML = '<i class="fa-regular fa-copy"></i>';
			li.appendChild(b);
			frag.appendChild(li);
		});
		listEl.appendChild(frag);
		textEl.value = results.map((r) => r.email).join('\n');
		countLabel.textContent = results.length + ' address' + (results.length === 1 ? '' : 'es');
	}

	function generate() {
		clearError();
		optCustom.classList.toggle('is-hidden', optDomain.value !== 'custom');

		if(optDomain.value === 'custom' && !validDomain(getDomain())) {
			showError(optCustom.value.trim() ? 'That domain does not look right. Use a form like company.html.' : 'Type your domain, for example company.html.');
			return;
		}

		let out, changed = false;
		if(mode === 'username') {
			const r = generateFromUser();
			if(!r) return;
			out = r.out;
			changed = r.changed;
		} else {
			out = mode === 'random' ? generateRandom() : generateFromName();
		}
		if(!out) return;
		results = out;
		render();

		statusEl.textContent = results.length + ' email address' + (results.length === 1 ? '' : 'es') + ' generated' +
			(mode === 'name' ? ' · most common pattern first' : '') +
			(changed ? ' · username tidied to ' + cleanUser(optUser.value) : '');
		copyBtn.disabled = csvBtn.disabled = dlBtn.disabled = !results.length;
	}

	function clearAll() {
		results = [];
		clearError();
		setEmpty('Your email addresses appear here');
		textEl.value = '';
		countLabel.textContent = '';
		statusEl.textContent = 'Choose your options and press Generate';
		copyBtn.disabled = csvBtn.disabled = dlBtn.disabled = true;
	}

	/* ---------- Copy & download ---------- */

	function copyText(text, onDone) {
		if(navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(text).then(onDone, () => fallbackCopy(text) && onDone());
		} else if(fallbackCopy(text)) {
			onDone();
		}
	}

	function fallbackCopy(text) {
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

	function flashStatus(msg) {
		const prev = statusEl.textContent;
		statusEl.textContent = msg;
		setTimeout(() => (statusEl.textContent = prev), 1400);
	}

	function save(content, name, type) {
		const blob = new Blob([content], {
			type
		});
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	function toCsv() {
		const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
		const head = mode !== 'random' ? 'email,username,domain,pattern' : 'email,username,domain';
		const rows = results.map((r) => {
			const at = r.email.lastIndexOf('@');
			const cols = [r.email, r.email.slice(0, at), r.email.slice(at + 1)];
			if(mode !== 'random') cols.push(r.pattern);
			return cols.map(q).join(',');
		});
		return [head].concat(rows).join('\r\n') + '\r\n';
	}

	/* ---------- Email checker ---------- */

	const checkIn = $('egCheckIn'),
		verdictEl = $('egVerdict'),
		tipsEl = $('egTips');

	const TYPOS = {
		'gmial.html': 'gmail.html', 'gmai.html': 'gmail.html', 'gmal.html': 'gmail.html', 'gmail.co': 'gmail.html', 'gmail.con': 'gmail.html', 'gnail.html': 'gmail.html', 'gamil.html': 'gmail.html', 'gmaill.html': 'gmail.html',
		'hotmial.html': 'hotmail.html', 'hotmai.html': 'hotmail.html', 'hotmail.co': 'hotmail.html', 'hotmail.con': 'hotmail.html', 'hotmal.html': 'hotmail.html',
		'yaho.html': 'yahoo.html', 'yahoo.co': 'yahoo.html', 'yahoo.con': 'yahoo.html', 'yhoo.html': 'yahoo.html',
		'outlok.html': 'outlook.html', 'outlook.co': 'outlook.html', 'outllok.html': 'outlook.html', 'outlook.con': 'outlook.html',
		'icloud.co': 'icloud.html', 'iclod.html': 'icloud.html'
	};

	function checkEmail(raw) {
		const e = raw.trim();
		const problems = [];
		const notes = [];
		const parts = e.split('@');
		if(parts.length !== 2) {
			problems.push(parts.length === 1 ? 'It needs an @ between the name and the domain.' : 'It can only contain one @.');
			return { problems, notes };
		}
		const [local, domain] = parts;
		if(!local) problems.push('There is nothing before the @.');
		if(!domain) problems.push('There is nothing after the @.');
		if(local.length > 64) problems.push('The part before the @ is longer than 64 characters.');
		if(e.length > 254) problems.push('The address is longer than 254 characters.');
		if(/\s/.test(e)) problems.push('It contains a space.');
		if(local && (/^\./.test(local) || /\.$/.test(local))) problems.push('The name cannot start or end with a dot.');
		if(/\.\./.test(e)) problems.push('It has two dots in a row.');
		if(local && /[^A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]/.test(local)) problems.push('The name has a character that is not allowed, such as a comma or bracket.');
		if(domain) {
			const d = domain.toLowerCase();
			if(!/\./.test(d)) problems.push('The domain needs a dot, as in example.html.');
			else if(!validDomain(d)) problems.push('The domain is not written correctly. Use letters, numbers, hyphens and dots, ending in something like .html.');
			if(TYPOS[d]) notes.push('Did you mean ' + local + '@' + TYPOS[d] + '? ' + d + ' looks like a typo.');
			if(/^(example|test)\.(com|org|net)$/.test(d) || /\.(test|example|invalid|localhost)$/.test(d)) notes.push('This is a reserved test domain, so mail to it is never delivered.');
		}
		if(!problems.length && /[A-Z]/.test(local)) notes.push('Capital letters usually make no difference, but most people write addresses in lowercase.');
		return { problems, notes };
	}

	function runCheck() {
		const v = checkIn.value;
		tipsEl.innerHTML = '';
		verdictEl.className = 'eg-verdict';
		if(!v.trim()) {
			verdictEl.textContent = '';
			return;
		}
		const r = checkEmail(v);
		const ok = !r.problems.length;
		const typo = ok && r.notes.some((n) => n.indexOf('Did you mean') === 0);
		verdictEl.classList.add(!ok ? 'bad' : typo ? 'warn' : 'ok');
		verdictEl.innerHTML = !ok ?
			'<i class="fa-solid fa-circle-xmark me-2"></i>This address is not valid' : typo ?
			'<i class="fa-solid fa-triangle-exclamation me-2"></i>Written correctly, but the domain may be misspelled' :
			'<i class="fa-solid fa-circle-check me-2"></i>This address is written correctly';
		r.problems.concat(r.notes).forEach((t) => {
			const li = document.createElement('li');
			li.textContent = t;
			tipsEl.appendChild(li);
		});
		if(ok) {
			const li = document.createElement('li');
			li.textContent = 'This only checks the format. It cannot tell whether the inbox exists.';
			tipsEl.appendChild(li);
		}
	}

	/* ---------- Events ---------- */

	modeBox.addEventListener('click', (e) => {
		const btn = e.target.closest('.mode-btn');
		if(!btn || btn.dataset.mode === mode) return;
		modeBox.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
		mode = btn.dataset.mode;
		document.querySelectorAll('#egSettings [data-for]').forEach((g) => g.classList.toggle('is-hidden', g.dataset.for !== mode));
		// A real username usually goes on a real provider, so leave the test domain
		if(mode === 'username' && optDomain.value === 'example.html') optDomain.value = 'gmail.html';
		if(mode === 'username' && !optUser.value.trim()) {
			clearAll();
			statusEl.textContent = 'Type the username you want';
			optUser.focus();
			return;
		}
		generate();
	});

	[optStyle, optNumbers, optDomain, optCount, optVariations].forEach((el) => el.addEventListener('change', generate));

	let typing = null;
	[optFirst, optLast, optCustom, optUser].forEach((el) => el.addEventListener('input', () => {
		clearTimeout(typing);
		typing = setTimeout(generate, 250);
	}));

	genBtn.addEventListener('click', generate);
	clearBtn.addEventListener('click', clearAll);

	copyBtn.addEventListener('click', () => results.length &&
		copyText(results.map((r) => r.email).join('\n'), () => flashStatus('Copied ' + results.length + ' addresses')));

	listEl.addEventListener('click', (e) => {
		const b = e.target.closest('.eg-copy');
		if(!b) return;
		const r = results[+b.dataset.i];
		copyText(r.email, () => {
			b.classList.add('copied');
			b.innerHTML = '<i class="fa-solid fa-check"></i>';
			flashStatus('Copied ' + r.email);
			setTimeout(() => {
				b.classList.remove('copied');
				b.innerHTML = '<i class="fa-regular fa-copy"></i>';
			}, 1400);
		});
	});

	dlBtn.addEventListener('click', () => results.length &&
		save(results.map((r) => r.email).join('\n') + '\n', 'email-addresses.txt', 'text/plain'));
	csvBtn.addEventListener('click', () => results.length &&
		save('﻿' + toCsv(), 'email-addresses.csv', 'text/csv'));

	checkIn.addEventListener('input', runCheck);

	document.addEventListener('keydown', (e) => {
		if((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
	});

	generate();
})();
