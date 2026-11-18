(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);

	const SETS = {
		upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
		lower: 'abcdefghijklmnopqrstuvwxyz',
		digit: '0123456789',
		symbol: '!@#$%^&*()-_=+[]{};:,.?/~'
	};

	const LOOK_ALIKES = /[Il1O0o|]/g;

	const WORDS = ('able acid aged also arch area army atom aunt away axis baby back bake ball band bank barn base bath beam bean bear beef bell belt bend best bike bird bite blue boat body bold bolt bone book boot bowl brag brew bush busy cake calm camp cane cape card care cart case cash cast cave cell chef chip city clam clay clip club coal coat code coin cold cone cook cool copy cord core corn cost crab crew crop crow cube cups cure dark dart dash data dawn deal deck deep deer desk dial dice dish dock dome door dose dove down draw drum duck dune dust duty each east easy echo edge epic even exit face fact fair fall fame farm fast fern film fire fish five flag flat flip folk food foot fork form fort fowl free frog fuel full fund gain game gate gear gift glad glow glue goal goat gold golf good gown grab gram gray grid grin grip gulf hair half hall halo hand harp hawk heat herb hero hike hill hint hive hold hole home hood hook hope horn host hour huge hunt idea inch iron isle item jade jail jazz jeep jest join joke jump just keen kept kick kind king kite knee knot lace lake lamb lamp land lane last lava lawn leaf lean left lens lily lime line link lion list load loaf loan lock loft logo long loop lord lose loud luck lung mail main make mall malt many mask mast math maze meal mild milk mill mind mint mist mode mole moon moss moth move much mule muse nail name navy neat neck nest news next nice nine node noon nose note oak oath oval oven over pace pack page pail pain palm park part pass path peak pear peel pine pink pipe plan play plot plum poem poet pole pond pony pool port pose post pour puma pump pure quiz race rack raft rail rain ramp rank rare rest rice rich ride ring rise road roam robe rock roof room root rope rose ruby rule safe sage sail salt sand save scan seal seat seed shed ship shoe shop silk sing site size skip slab sled slim slot snow soap sock sofa soft soil song soup spin spot star stem step stew stop suit sung surf swan swim tail tale talk tank tape task team tent term text tide tile time tiny toad tone tool tour town trap tray tree trim trip tube tuna tune twig undo unit upon vase vast verb vest view vine visa void volt vote wade wage wait walk wall wand warm wave weed well west whip wide wild wind wing wire wise wolf wood wool word work worm yard yarn year yell yoga zero zinc zone acorn actor adapt agent alarm album alert alley amber anchor angle ankle apple apron arrow aspen atlas attic award bacon badge baker banjo basil beach berry blade blaze bloom board brave bread brick brook brush cabin cable camel candy canoe cargo cedar chain chair chalk charm chess chili cider cliff clock cloud clove coast cobra comet coral couch crane crisp crown cubic curry daisy delta dingo diner donut dozen drift eagle earth easel elbow ember fable feast fence ferry field flame flora flute focus forge fresh frost fruit gecko ghost giant glass globe grape grass gravy guide habit happy hazel heart hedge honey horse hotel humor igloo image inlet ivory jelly jewel juice kayak kettle koala label lemon level lilac linen llama lodge lotus lucky lunar magic mango maple march medal melon mercy metal mocha model money motor mouse music noble north novel ocean olive opera orbit otter owner paint panda paper pasta peach pearl pedal penny piano pilot pizza plaza poppy pouch press prism proud pulse quail quilt radar radio raven rebel ridge river robin rodeo royal rumba salad salsa scarf scout shade shell shine skate slope smile solar spark spice spoon squid stamp steam stone storm sugar sunny swift table tango thumb tiger toast topaz torch tower trail train trend tulip ultra umbra union urban value vapor velvet venue vigor vinyl viola vivid waltz watch water whale wheat wheel world yacht yeast zebra').split(' ');

	const modeBox = $('pgMode'),
		lenRange = $('pgLength'),
		lenNum = $('pgLengthNum'),
		wordsRange = $('pgWords'),
		wordsNum = $('pgWordsNum'),
		optUpper = $('pgUpper'),
		optLower = $('pgLower'),
		optDigits = $('pgDigits'),
		optSymbols = $('pgSymbols'),
		optSimilar = $('pgSimilar'),
		optSep = $('pgSep'),
		optCap = $('pgCap'),
		optAddNum = $('pgAddNum'),
		optCount = $('pgCount');
	const errBox = $('pgErr'),
		statusEl = $('pgStatus'),
		valueEl = $('pgValue'),
		lenEl = $('pgLen'),
		listEl = $('pgList'),
		countLabel = $('pgCountLabel'),
		barEl = $('pgBar'),
		strengthEl = $('pgStrength'),
		entropyEl = $('pgEntropy'),
		crackEl = $('pgCrack');
	const genBtn = $('pgGenerateBtn'),
		copyBtn = $('pgCopyBtn'),
		copyOneBtn = $('pgCopyOne'),
		dlBtn = $('pgDownloadBtn'),
		clearBtn = $('pgClearBtn');

	let mode = 'password',
		results = [];

	function randInt(max) {
		const limit = Math.floor(0x100000000 / max) * max;
		const buf = new Uint32Array(1);
		do {
			crypto.getRandomValues(buf);
		} while(buf[0] >= limit);
		return buf[0] % max;
	}

	function pick(str) {
		return str[randInt(str.length)];
	}

	function shuffle(arr) {
		for(let i = arr.length - 1; i > 0; i--) {
			const j = randInt(i + 1);
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}

	function activeSets() {
		const list = [];
		if(optUpper.checked) list.push(SETS.upper);
		if(optLower.checked) list.push(SETS.lower);
		if(optDigits.checked) list.push(SETS.digit);
		if(optSymbols.checked) list.push(SETS.symbol);
		return optSimilar.checked ? list.map((s) => s.replace(LOOK_ALIKES, '')) : list;
	}

	function makePassword(len, sets) {
		const all = sets.join('');
	
		const chars = sets.map(pick);
		while(chars.length < len) chars.push(pick(all));
		return shuffle(chars).join('');
	}

	function makePassphrase(n, sep, cap, addNum) {
		const words = [];
		for(let i = 0; i < n; i++) {
			let w = WORDS[randInt(WORDS.length)];
			if(cap) w = w[0].toUpperCase() + w.slice(1);
			words.push(w);
		}
		if(addNum) {
			const i = randInt(n);
			words[i] += randInt(10);
		}
		return words.join(sep);
	}

	const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

	function scoreFromBits(bits) {
		return bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 90 ? 3 : 4;
	}

	function generatedBits(pw) {
		if(mode === 'passphrase') {
			const n = +wordsNum.value;
			let bits = n * Math.log2(WORDS.length);
			if(optAddNum.checked) bits += Math.log2(10) + Math.log2(n);
			return bits;
		}
		const pool = activeSets().join('').length;
		return pw.length * Math.log2(pool);
	}

	function crackTime(bits) {
		const secs = Math.pow(2, bits - 1) / 1e10;
		if(secs < 1) return 'instantly';
		const units = [
			['century', 3153600000],
			['year', 31536000],
			['month', 2592000],
			['day', 86400],
			['hour', 3600],
			['minute', 60],
			['second', 1]
		];

		if(secs > 3153600000 * 1e6) return 'millions of centuries or more';
		for(const [name, size] of units) {
			if(secs >= size) {
				const v = Math.round(secs / size);
				const plural = name === 'century' ? 'centuries' : name + 's';
				return 'about ' + v.toLocaleString() + ' ' + (v === 1 ? name : plural);
			}
		}
		return 'instantly';
	}

	function paintMeter(bar, label, bits, score) {
		bar.className = 'pg-s' + score;
		bar.style.width = Math.max(8, Math.min(100, (bits / 100) * 100)) + '%';
		label.textContent = LABELS[score];
	}

	function resetMeter(bar, label, extra) {
		bar.className = '';
		bar.style.width = '0';
		label.textContent = '—';
		extra.forEach((el) => (el.textContent = ''));
	}

	function charClass(c) {
		if(SETS.upper.includes(c)) return 'pg-c-upper';
		if(SETS.lower.includes(c)) return 'pg-c-lower';
		if(SETS.digit.includes(c)) return 'pg-c-digit';
		return mode === 'passphrase' ? 'pg-c-sep' : 'pg-c-symbol';
	}

	function render(pw) {
		valueEl.textContent = '';
		const frag = document.createDocumentFragment();
		for(const c of pw) {
			const s = document.createElement('span');
			s.className = charClass(c);
			s.textContent = c;
			frag.appendChild(s);
		}
		valueEl.appendChild(frag);
	}

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function generate() {
		clearError();
		const count = +optCount.value;
		results = [];

		if(mode === 'password') {
			const sets = activeSets();
			if(!sets.length) {
				showError('Pick at least one character type: A–Z, a–z, 0–9 or symbols.');
				return;
			}
			const len = clamp(+lenNum.value || 16, Math.max(4, sets.length), 128);
			lenNum.value = len;
			lenRange.value = Math.min(len, +lenRange.max);
			for(let i = 0; i < count; i++) results.push(makePassword(len, sets));
		} else {
			const n = clamp(+wordsNum.value || 5, 3, 12);
			wordsNum.value = wordsRange.value = n;
			for(let i = 0; i < count; i++) results.push(makePassphrase(n, optSep.value, optCap.checked, optAddNum.checked));
		}

		const first = results[0];
		render(first);
		lenEl.textContent = first.length + ' characters';

		const bits = generatedBits(first);
		const score = scoreFromBits(bits);
		paintMeter(barEl, strengthEl, bits, score);
		entropyEl.textContent = Math.round(bits) + ' bits of randomness';
		crackEl.textContent = 'Time to guess at 10 billion tries a second: ' + crackTime(bits);

		listEl.value = count > 1 ? results.join('\n') : '';
		countLabel.textContent = count > 1 ? count + (mode === 'password' ? ' passwords' : ' passphrases') : '';

		statusEl.textContent = (count > 1 ? count + ' ' + (mode === 'password' ? 'passwords' : 'passphrases') : (mode === 'password' ? 'Password' : 'Passphrase')) + ' generated · ' + LABELS[score];
		copyBtn.disabled = dlBtn.disabled = copyOneBtn.disabled = false;
	}

	function clamp(v, lo, hi) {
		return Math.min(hi, Math.max(lo, Math.round(v)));
	}

	function clearAll() {
		results = [];
		clearError();
		valueEl.innerHTML = '<span class="pg-placeholder">Your password appears here</span>';
		lenEl.textContent = countLabel.textContent = '';
		listEl.value = '';
		resetMeter(barEl, strengthEl, [entropyEl, crackEl]);
		statusEl.textContent = 'Choose your options and press Generate';
		copyBtn.disabled = dlBtn.disabled = copyOneBtn.disabled = true;
	}

	function copyText(text, btn) {
		const done = () => flash(btn);
		if(navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text) && done());
		} else if(fallbackCopy(text)) {
			done();
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
		if(!ok) showError('Your browser blocked copying. Select the password and press Ctrl+C (Cmd+C on Mac).');
		return ok;
	}

	function flash(btn) {
		const prevStatus = statusEl.textContent;
		statusEl.textContent = 'Copied to clipboard';
		if(btn === copyOneBtn) {
			btn.classList.add('copied');
			btn.innerHTML = '<i class="fa-solid fa-check"></i>';
		}
		setTimeout(() => {
			statusEl.textContent = prevStatus;
			if(btn === copyOneBtn) {
				btn.classList.remove('copied');
				btn.innerHTML = '<i class="fa-regular fa-copy"></i>';
			}
		}, 1400);
	}

	function download() {
		if(!results.length) return;
		const blob = new Blob([results.join('\n') + '\n'], {
			type: 'text/plain'
		});
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = (mode === 'password' ? 'passwords' : 'passphrases') + '.txt';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	const checkIn = $('pgCheckIn'),
		checkEye = $('pgCheckEye'),
		checkBar = $('pgCheckBar'),
		checkStrength = $('pgCheckStrength'),
		checkEntropy = $('pgCheckEntropy'),
		checkTips = $('pgCheckTips');

	const COMMON = ['password', 'qwerty', 'letmein', 'welcome', 'admin', 'iloveyou', 'monkey', 'dragon', 'football', 'baseball', 'master', 'login', 'abc123', 'sunshine', 'princess', 'shadow', 'superman', 'trustno1', 'passw0rd', 'starwars'];

	function checkPassword(pw) {
		const tips = [];
		let pool = 0;
		if(/[a-z]/.test(pw)) pool += 26;
		else tips.push('Add lowercase letters');
		if(/[A-Z]/.test(pw)) pool += 26;
		else tips.push('Add uppercase letters');
		if(/[0-9]/.test(pw)) pool += 10;
		else tips.push('Add numbers');
		if(/[^A-Za-z0-9]/.test(pw)) pool += 33;
		else tips.push('Add symbols such as ! # $ or %');

		let effective = 0;
		for(let i = 0; i < pw.length; i++) {
			const c = pw.charCodeAt(i),
				p = pw.charCodeAt(i - 1),
				pp = pw.charCodeAt(i - 2);
			const repeat = i > 0 && c === p;
			const seq = i > 1 && c - p === p - pp && Math.abs(c - p) === 1;
			effective += repeat || seq ? 0.25 : 1;
		}
		if(/(.)\1\1/.test(pw)) tips.push('Avoid repeating the same character');
		if(/(abc|bcd|cde|123|234|345|456|567|678|789|qwe|asd|zxc)/i.test(pw)) tips.push('Avoid sequences like abc, 123 or qwerty');

		let bits = effective * Math.log2(Math.max(pool, 1));
		const lowered = pw.toLowerCase().replace(/[^a-z]/g, '');
		if(COMMON.some((w) => lowered.includes(w))) {
			bits = Math.min(bits, 20);
			tips.unshift('It contains a very common password');
		}
		if(/^(19|20)\d{2}$/.test(pw.slice(-4))) tips.push('Avoid ending with a year');
		if(pw.length < 12) tips.unshift('Use at least 12 characters (16 or more is better)');
		return {
			bits,
			tips: tips.slice(0, 4)
		};
	}

	function runCheck() {
		const pw = checkIn.value;
		checkTips.innerHTML = '';
		if(!pw) {
			resetMeter(checkBar, checkStrength, [checkEntropy]);
			return;
		}
		const r = checkPassword(pw);
		const score = scoreFromBits(r.bits);
		paintMeter(checkBar, checkStrength, r.bits, score);
		checkEntropy.textContent = 'About ' + Math.round(r.bits) + ' bits · guessed ' + crackTime(r.bits);
		(r.tips.length ? r.tips : ['Looks good. Use it for one account only.']).forEach((t) => {
			const li = document.createElement('li');
			li.textContent = t;
			checkTips.appendChild(li);
		});
	}

	modeBox.addEventListener('click', (e) => {
		const btn = e.target.closest('.mode-btn');
		if(!btn || btn.dataset.mode === mode) return;
		modeBox.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
		mode = btn.dataset.mode;
		document.querySelectorAll('#pgSettings [data-for]').forEach((g) => g.classList.toggle('is-hidden', g.dataset.for !== mode));
		$('pgLen').previousSibling.textContent = mode === 'password' ? 'Your password ' : 'Your passphrase ';
		countLabel.previousSibling.textContent = mode === 'password' ? 'All passwords ' : 'All passphrases ';
		generate();
	});

	function pair(range, num) {
		range.addEventListener('input', () => {
			num.value = range.value;
			generate();
		});
		num.addEventListener('change', generate);
	}
	
	pair(lenRange, lenNum);
	pair(wordsRange, wordsNum);

	[optUpper, optLower, optDigits, optSymbols, optSimilar, optSep, optCap, optAddNum, optCount].forEach((el) => el.addEventListener('change', generate));

	genBtn.addEventListener('click', generate);
	clearBtn.addEventListener('click', clearAll);
	copyBtn.addEventListener('click', () => results.length && copyText(results.join('\n'), copyBtn));
	copyOneBtn.addEventListener('click', () => results.length && copyText(results[0], copyOneBtn));
	dlBtn.addEventListener('click', download);

	checkIn.addEventListener('input', runCheck);
	checkEye.addEventListener('click', () => {
		const show = checkIn.type === 'password';
		checkIn.type = show ? 'text' : 'password';
		checkEye.innerHTML = show ? '<i class="fa-regular fa-eye-slash"></i>' : '<i class="fa-regular fa-eye"></i>';
		checkEye.title = show ? 'Hide password' : 'Show password';
	});

	document.addEventListener('keydown', (e) => {
		if((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
	});

	generate();
})();
