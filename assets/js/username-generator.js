(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);

	/* ---------- Word lists by style ---------- */

	const W = {
		cool: {
			a: 'shadow silent cosmic neon frozen hidden lunar solar crimson electric iron dark wild rogue swift mystic savage stellar urban phantom atomic blazing hyper rapid storm golden ghost velvet obsidian arctic primal toxic void binary'.split(' '),
			n: 'wolf falcon raven tiger phoenix viper fox hawk blade nova storm comet ninja knight pilot rider hunter spark flame drift echo pulse orbit vortex cipher titan ranger panther cobra lynx glitch byte'.split(' ')
		},
		gamer: {
			a: 'dark epic toxic mega ultra hyper insane savage lethal turbo cyber pro elite rage crazy salty sneaky deadly frosty noob venom alpha omega killer sniper'.split(' '),
			n: 'slayer sniper reaper gamer legend beast hunter warrior ninja demon dragon shot striker titan predator ghost wolf knight boss king queen bot raider champ'.split(' ')
		},
		pro: {
			a: 'the real its iam hello team studio official digital creative'.split(' '),
			n: 'works studio labs design media dev writes hq co online official'.split(' ')
		},
		cute: {
			a: 'little sweet tiny fluffy sunny happy cozy honey sugar bubbly peachy dreamy lovely sleepy cuddly mellow pastel candy cherry starry'.split(' '),
			n: 'bunny kitten panda bear muffin cupcake cookie peach daisy berry mochi puppy bun boba duckling cloud star bee petal latte'.split(' ')
		},
		short: {
			a: 'ax bo jet zen ace sky ivy kai rex fox max zed oz vex lux nyx ash koi ray'.split(' '),
			n: 'io x z o oo ix ex yo ka on'.split(' ')
		}
	};

	const LEET = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };

	/* ---------- Elements ---------- */

	const modeBox = $('ugMode'),
		optWords = $('ugWords'),
		optStyle = $('ugStyle'),
		optSep = $('ugSep'),
		optCase = $('ugCase'),
		optMax = $('ugMax'),
		maxVal = $('ugMaxVal'),
		optNumbers = $('ugNumbers'),
		optLeet = $('ugLeet'),
		optCount = $('ugCount');
	const errBox = $('ugErr'),
		statusEl = $('ugStatus'),
		listEl = $('ugList'),
		savedEl = $('ugSaved'),
		countLabel = $('ugCountLabel'),
		savedLabel = $('ugSavedLabel');
	const genBtn = $('ugGenerateBtn'),
		copyBtn = $('ugCopyBtn'),
		dlBtn = $('ugDownloadBtn'),
		clearBtn = $('ugClearBtn');

	let mode = 'random',
		results = [],
		saved = [];

	/* ---------- Random ---------- */

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
	const chance = (p) => randInt(1000) < p * 1000;

	/* ---------- Building ---------- */

	function cleanWord(s) {
		return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
	}

	function keywords() {
		return optWords.value.split(/[,\s]+/).map(cleanWord).filter(Boolean);
	}

	function sep() {
		const v = optSep.value;
		return v === 'mix' ? pick(['', '_', '.', '']) : v;
	}

	function caseWord(w) {
		switch(optCase.value) {
			case 'lower':
				return w.toLowerCase();
			case 'upper':
				return w.toUpperCase();
			default:
				return w.charAt(0).toUpperCase() + w.slice(1);
		}
	}

	function leet(s) {
		// swap a few letters, never the first one so it stays readable
		return s.replace(/[aeiost]/gi, (c, i) => (i > 0 && chance(0.55) ? LEET[c.toLowerCase()] : c));
	}

	function numberFor(style) {
		switch(style) {
			case 'gamer':
				return pick([num(1, 99), num(100, 999), 69, 420, 1337, 777, 99, 360]);
			case 'pro':
				return pick(['', '', num(1, 9), new Date().getFullYear()]);
			case 'cute':
				return pick([num(1, 9), num(10, 99), 'xo', '']);
			default:
				return pick([num(1, 99), num(10, 999)]);
		}
	}

	function partsFor(style) {
		const L = W[style];
		const kw = mode === 'keywords' ? keywords() : [];
		const k = kw.length ? pick(kw) : null;
		const k2w = kw.length > 1 ? pick(kw.filter((w) => w !== k)) : null;

		if(style === 'pro') {
			if(k) {
				const shapes = [
					[k],
					[L.a[randInt(L.a.length)], k],
					[k, pick(L.n)],
					k2w ? [k, k2w] : [k, pick(L.n)],
					[k.charAt(0), k2w || pick(L.n)]
				];
				return pick(shapes);
			}
			return [pick(W.cool.n), pick(L.n)];
		}

		if(style === 'short') {
			const base = k ? k.slice(0, num(3, 5)) : pick(L.a);
			return chance(0.5) ? [base + pick(L.n)] : [base, pick(W.short.a)];
		}

		if(k) {
			const shapes = [
				[pick(L.a), k],
				[k, pick(L.n)],
				k2w ? [k, k2w] : [pick(L.a), k, pick(L.n)],
				[k, pick(L.n)]
			];
			return pick(shapes);
		}
		return chance(0.85) ? [pick(L.a), pick(L.n)] : [pick(L.n), pick(L.n)];
	}

	function makeOne(style, max) {
		const parts = partsFor(style);
		let s = sep();
		let name = parts.map(caseWord).join(s);
		if(optLeet.checked) name = leet(name);
		if(optNumbers.checked && style !== 'short') {
			const n = numberFor(style);
			if(n !== '') name += (s && chance(0.5) ? s : '') + n;
		}
		if(style === 'gamer' && chance(0.18)) {
			name = pick(['xX', 'x', 'iTz', 'Its']) + (name.charAt(0).toUpperCase() + name.slice(1)) + pick(['Xx', 'x', '', 'YT', 'TV']);
		}
		if(optCase.value === 'lower') name = name.toLowerCase();
		if(optCase.value === 'upper') name = name.toUpperCase();
		name = name.replace(/^[._-]+|[._-]+$/g, '');
		return name.length >= 3 && name.length <= max ? name : null;
	}

	function generate() {
		clearError();
		maxVal.textContent = optMax.value;
		if(mode === 'keywords' && !keywords().length) {
			showError('Type your name or a few words you like, separated by commas.');
			return;
		}
		const count = +optCount.value,
			max = +optMax.value,
			style = optStyle.value;
		const seen = new Set(),
			out = [];
		let guard = 0;
		while(out.length < count && guard++ < count * 80) {
			const u = makeOne(style, max);
			if(!u || seen.has(u.toLowerCase())) continue;
			seen.add(u.toLowerCase());
			out.push(u);
		}
		results = out;
		renderList(listEl, results, 'Your usernames appear here');
		countLabel.textContent = results.length ? results.length + ' names' : '';
		statusEl.textContent = results.length ?
			results.length + ' usernames generated' + (results.length < count ? ' · raise the max length for more' : '') :
			'No usernames fit. Raise the max length or change the style.';
		copyBtn.disabled = dlBtn.disabled = !(results.length || saved.length);
	}

	/* ---------- Render ---------- */

	function renderList(el, items, emptyMsg) {
		el.innerHTML = '';
		if(!items.length) {
			const li = document.createElement('li');
			li.className = 'ug-empty';
			li.textContent = emptyMsg;
			el.appendChild(li);
			return;
		}
		const frag = document.createDocumentFragment();
		items.forEach((u) => {
			const li = document.createElement('li');
			const name = document.createElement('span');
			name.className = 'ug-name';
			name.textContent = u;
			const len = document.createElement('span');
			len.className = 'ug-len';
			len.textContent = u.length + ' chars';
			const act = document.createElement('span');
			act.className = 'ug-actions';
			const isSaved = saved.includes(u);
			act.innerHTML =
				'<button type="button" class="ug-copy ug-star' + (isSaved ? ' starred' : '') + '" title="' + (isSaved ? 'Remove from saved' : 'Save') + '" aria-label="' + (isSaved ? 'Remove from saved' : 'Save') + '"><i class="fa-' + (isSaved ? 'solid' : 'regular') + ' fa-star"></i></button>' +
				'<button type="button" class="ug-copy ug-copy-one" title="Copy" aria-label="Copy"><i class="fa-regular fa-copy"></i></button>';
			act.querySelectorAll('button').forEach((b) => (b.dataset.u = u));
			li.append(name, len, act);
			frag.appendChild(li);
		});
		el.appendChild(frag);
	}

	function renderSaved() {
		renderList(savedEl, saved, 'Click the star next to a username to keep it here while you generate more');
		savedLabel.textContent = saved.length ? saved.length + ' saved' : '';
		renderList(listEl, results, 'Your usernames appear here');
		copyBtn.disabled = dlBtn.disabled = !(results.length || saved.length);
	}

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function clearAll() {
		results = [];
		clearError();
		renderList(listEl, results, 'Your usernames appear here');
		countLabel.textContent = '';
		statusEl.textContent = saved.length ? 'Cleared. Your saved names are kept.' : 'Choose your options and press Generate';
		copyBtn.disabled = dlBtn.disabled = !saved.length;
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

	function exportList() {
		// saved names first, then the rest of the current list
		return saved.concat(results.filter((u) => !saved.includes(u)));
	}

	function download() {
		const list = exportList();
		if(!list.length) return;
		const blob = new Blob([list.join('\n') + '\n'], {
			type: 'text/plain'
		});
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'usernames.txt';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	/* ---------- Platform checker ---------- */

	const PLATFORMS = [{
		name: 'Instagram',
		min: 1,
		max: 30,
		chars: /^[A-Za-z0-9._]+$/,
		charsText: 'letters, numbers, dots and underscores',
		extra: (u) => (/^\.|\.$/.test(u) ? 'cannot start or end with a dot' : /\.\./.test(u) ? 'cannot have two dots in a row' : '')
	}, {
		name: 'TikTok',
		min: 2,
		max: 24,
		chars: /^[A-Za-z0-9._]+$/,
		charsText: 'letters, numbers, dots and underscores',
		extra: (u) => (/\.$/.test(u) ? 'cannot end with a dot' : '')
	}, {
		name: 'X (Twitter)',
		min: 4,
		max: 15,
		chars: /^[A-Za-z0-9_]+$/,
		charsText: 'letters, numbers and underscores',
		extra: (u) => (/twitter|admin/i.test(u) ? 'cannot contain "Twitter" or "Admin"' : '')
	}, {
		name: 'YouTube handle',
		min: 3,
		max: 30,
		chars: /^[A-Za-z0-9._-]+$/,
		charsText: 'letters, numbers, dots, hyphens and underscores',
		extra: () => ''
	}, {
		name: 'Discord',
		min: 2,
		max: 32,
		chars: /^[a-z0-9._]+$/,
		charsText: 'lowercase letters, numbers, dots and underscores',
		extra: (u) => (/\.\./.test(u) ? 'cannot have two dots in a row' : '')
	}, {
		name: 'Reddit',
		min: 3,
		max: 20,
		chars: /^[A-Za-z0-9_-]+$/,
		charsText: 'letters, numbers, hyphens and underscores',
		extra: () => ''
	}, {
		name: 'GitHub',
		min: 1,
		max: 39,
		chars: /^[A-Za-z0-9-]+$/,
		charsText: 'letters, numbers and hyphens',
		extra: (u) => (/^-|-$/.test(u) ? 'cannot start or end with a hyphen' : /--/.test(u) ? 'cannot have two hyphens in a row' : '')
	}, {
		name: 'Gmail',
		min: 6,
		max: 30,
		chars: /^[A-Za-z0-9.]+$/,
		charsText: 'letters, numbers and dots',
		extra: (u) => (/^\.|\.$/.test(u) ? 'cannot start or end with a dot' : /\.\./.test(u) ? 'cannot have two dots in a row' : '')
	}];

	const checkIn = $('ugCheckIn'),
		platEl = $('ugPlatforms');

	function runCheck() {
		const u = checkIn.value.trim();
		platEl.innerHTML = '';
		if(!u) return;
		PLATFORMS.forEach((p) => {
			let why = '';
			if(u.length < p.min) why = 'needs at least ' + p.min + ' characters';
			else if(u.length > p.max) why = 'allows up to ' + p.max + ' characters (this has ' + u.length + ')';
			else if(!p.chars.test(u)) why = 'allows only ' + p.charsText;
			else why = p.extra(u);
			const ok = !why;
			const div = document.createElement('div');
			div.className = 'ug-plat ' + (ok ? 'ok' : 'bad');
			div.innerHTML = '<i class="ug-ico fa-solid ' + (ok ? 'fa-circle-check' : 'fa-circle-xmark') + '"></i><div><strong></strong><small></small></div>';
			div.querySelector('strong').textContent = p.name;
			div.querySelector('small').textContent = ok ? p.min + '–' + p.max + ' characters · fits the rules' : why.charAt(0).toUpperCase() + why.slice(1);
			platEl.appendChild(div);
		});
	}

	/* ---------- Events ---------- */

	modeBox.addEventListener('click', (e) => {
		const btn = e.target.closest('.mode-btn');
		if(!btn || btn.dataset.mode === mode) return;
		modeBox.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
		mode = btn.dataset.mode;
		document.querySelectorAll('#ugSettings [data-for]').forEach((g) => g.classList.toggle('is-hidden', g.dataset.for !== mode));
		if(mode === 'keywords' && !optWords.value.trim()) {
			clearAll();
			statusEl.textContent = 'Type your name or a few words you like';
			optWords.focus();
			return;
		}
		generate();
	});

	[optStyle, optSep, optCase, optNumbers, optLeet, optCount].forEach((el) => el.addEventListener('change', generate));
	optMax.addEventListener('input', () => (maxVal.textContent = optMax.value));
	optMax.addEventListener('change', generate);

	let typing = null;
	optWords.addEventListener('input', () => {
		clearTimeout(typing);
		typing = setTimeout(generate, 300);
	});

	genBtn.addEventListener('click', generate);
	clearBtn.addEventListener('click', clearAll);

	copyBtn.addEventListener('click', () => {
		const list = exportList();
		if(list.length) copyText(list.join('\n'), () => flashStatus('Copied ' + list.length + ' usernames'));
	});
	dlBtn.addEventListener('click', download);

	function onListClick(e) {
		const b = e.target.closest('button');
		if(!b) return;
		const u = b.dataset.u;
		if(b.classList.contains('ug-star')) {
			saved = saved.includes(u) ? saved.filter((x) => x !== u) : saved.concat(u);
			renderSaved();
			return;
		}
		copyText(u, () => {
			b.classList.add('copied');
			b.innerHTML = '<i class="fa-solid fa-check"></i>';
			flashStatus('Copied ' + u);
			checkIn.value = u;
			runCheck();
			setTimeout(() => {
				b.classList.remove('copied');
				b.innerHTML = '<i class="fa-regular fa-copy"></i>';
			}, 1400);
		});
	}
	listEl.addEventListener('click', onListClick);
	savedEl.addEventListener('click', onListClick);

	checkIn.addEventListener('input', runCheck);

	document.addEventListener('keydown', (e) => {
		if((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
	});

	generate();
})();
