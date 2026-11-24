(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);

	const T = {
		service: [
			'Professional {k}[ in {l}][ for {a}]. {Pts}. [Built by {b}. ]{cta}',
			'Looking for expert {k}[ in {l}]? [{b} provides ]{pts} {k} services[ for {a}]. {cta}',
			'[{b}: ]{K} services[ in {l}][ for {a}]. {Pts}. {cta}',
			'Grow your business with {k}[ in {l}]. {Pts}[, from the team at {b}]. {cta}',
			'[{b} offers ]affordable {k}[ in {l}][ for {a}]. {Pts}. {cta}',
			'Expert {k}[ for {a}][ in {l}]. {Pts}. [Work with {b}. ]{cta}',
			'Get {k} that works[ for {a}]. {Pts}. {cta}'
		],
		home: [
			'{b} offers {k}[ in {l}][ for {a}]. {Pts}. {cta}',
			'[{b} | ]{K}[ in {l}]. {Pts}. {cta}',
			'Welcome to {b}, your partner for {k}[ in {l}]. {Pts}. {cta}',
			'Discover {k}[ for {a}][ at {b}]. {Pts}. {cta}',
			'{b} helps {a} with {k}[ in {l}]. {Pts}. {cta}',
			'Looking for {k}[ in {l}]? [{b} has you covered. ]{Pts}. {cta}'
		],
		product: [
			'Buy {k} online[ in {l}]. {Pts}. [Only at {b}. ]{cta}',
			'Shop {k}[ for {a}]. {Pts}. {cta}',
			'{K}[ by {b}]: {pts}. [Perfect for {a}. ]{cta}',
			'Get the best {k} at a great price. {Pts}. {cta}',
			'Discover {k}[ made for {a}]. {Pts}. [Only at {b}. ]{cta}',
			'[{b} ]{k}[ for {a}]: {pts}. {cta}'
		],
		category: [
			'Shop {k}[ in {l}] at {b}. {Pts}. {cta}',
			'Browse our range of {k}[ for {a}]. {Pts}. {cta}',
			'Find the best {k} online[ in {l}]. {Pts}[ at {b}]. {cta}',
			'Explore {k}[ from {b}]: {pts}. {cta}',
			'{K} for every need[ and budget][ at {b}]. {Pts}. {cta}'
		],
		blog: [
			'Learn everything about {k}[ for {a}]: {pts}. {cta}',
			'A complete guide to {k}[ for {a}], covering {pts}. {cta}',
			'Want to master {k}? This step-by-step guide covers {pts}[ for {a}]. {cta}',
			'{K} explained[ for {a}]: {pts}, with practical tips. {cta}',
			'Discover expert tips on {k}[ for {a}], including {pts}. {cta}',
			'Everything you need to know about {k} in {y}: {pts}. {cta}'
		],
		local: [
			'Trusted {k} in {l}[ from {b}]. {Pts}. {cta}',
			'Looking for {k} in {l}? {Pts}. [Visit {b}. ]{cta}',
			'{b} is a leading {k} provider in {l}. {Pts}. {cta}',
			'Best {k} in {l}[ for {a}]. {Pts}. {cta}',
			'Local {k} in {l}[ for {a}]. {Pts}. [{b}, here to help. ]{cta}'
		],
		tool: [
			'Free online {k}[ for {a}]. {Pts}. No sign-up needed. {cta}',
			'{K} online[ by {b}]. {Pts}. Works in your browser. {cta}',
			'Try the [{b} ]{k}: {pts}. Fast, free and easy to use. {cta}',
			'The easy {k}[ for {a}]. {Pts}. {cta}',
			'Use our free {k} in seconds. {Pts}. {cta}'
		],
		about: [
			'Learn about {b}, a {k} company[ in {l}][ serving {a}]. {Pts}. {cta}',
			'Meet the team behind {b}. We provide {k}[ in {l}]: {pts}. {cta}',
			'Contact {b} for {k}[ in {l}]. {Pts}. {cta}',
			'{b} has helped {a} with {k}[ in {l}]. {Pts}. {cta}'
		]
	};

	const TONE = {
		pro: ['Reliable {k}[ for {a}][ in {l}]. {Pts}. {cta}'],
		friendly: ['Need {k}[ in {l}]? We make it simple[ for {a}]. {Pts}. {cta}', 'Say hello to stress-free {k}[ in {l}]. {Pts}. {cta}'],
		bold: ['Stand out with {k}[ in {l}] that gets results. {Pts}. {cta}', 'Stop losing customers. Get {k}[ in {l}] built to convert. {Pts}. {cta}']
	};

	const CTA = {
		service: 'Get a free quote today.',
		home: 'Get in touch today.',
		product: 'Order online today.',
		category: 'Shop now.',
		blog: 'Read the full guide.',
		local: 'Call us today.',
		tool: 'Try it free.',
		about: 'Get in touch today.'
	};
	const FRIENDLY_CTA = {
		'Get a free quote today.': "Let's talk!",
		'Get in touch today.': 'Say hello today!',
		'Call us today.': 'Give us a call!'
	};
	const BOLD_CTA = {
		'Get a free quote today.': 'Get your free quote now!',
		'Shop now.': 'Shop now before it sells out!',
		'Order online today.': 'Order yours today!',
		'Try it free.': 'Try it free now!'
	};

	const optType = $('sdType'),
		optTone = $('sdTone'),
		optCta = $('sdCta'),
		kwIn = $('sdKeyword'),
		brandIn = $('sdBrand'),
		locIn = $('sdLoc'),
		audIn = $('sdAudience'),
		ptsIn = $('sdPoints'),
		urlIn = $('sdUrl');
	const errBox = $('sdErr'),
		statusEl = $('sdStatus'),
		countEl = $('sdCount'),
		resultsEl = $('sdResults');
	const genBtn = $('sdGenerateBtn'),
		copyBtn = $('sdCopyBtn'),
		clearBtn = $('sdClearBtn');

	const ctx = document.createElement('canvas').getContext('2d');
	ctx.font = '14px Arial, Helvetica, sans-serif';
	const px = (s) => Math.round(ctx.measureText(s).width);
	const MAX_PX = 920,
		MIN_CH = 120,
		MAX_CH = 160;

	const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

	function joinList(arr) {
		if(arr.length <= 1) return arr.join('');
		return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
	}

	function fill(tpl, v) {
		
		let s = tpl.replace(/\[([^\[\]]*)\]/g, (m, inner) => {
			const keys = inner.match(/\{(\w+)\}/g) || [];
			return keys.every((k) => v[k.slice(1, -1)]) ? inner : '';
		});
		const keys = s.match(/\{(\w+)\}/g) || [];
		if(keys.some((k) => !v[k.slice(1, -1)] && k !== '{cta}')) return null;
		s = s.replace(/\{(\w+)\}/g, (m, k) => v[k] || '');
		s = s.replace(/\s+/g, ' ').replace(/\s+([.,:?!])/g, '$1').replace(/\.\./g, '.').replace(/,\./g, '.').trim();
		
		s = s.replace(/(^|[.?!]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase());
		return s;
	}

	function context(points, dropAudience, dropLocation) {
		const k = kwIn.value.trim().replace(/\s+/g, ' ');
		const type = optType.value;
		let cta = optCta.value === 'auto' ? CTA[type] : optCta.value;
		if(optCta.value === 'auto' && optTone.value === 'friendly' && FRIENDLY_CTA[cta]) cta = FRIENDLY_CTA[cta];
		if(optCta.value === 'auto' && optTone.value === 'bold' && BOLD_CTA[cta]) cta = BOLD_CTA[cta];
		const pts = joinList(points);
		return {
			k,
			K: cap(k),
			b: brandIn.value.trim(),
			l: dropLocation ? '' : locIn.value.trim(),
			a: dropAudience ? '' : audIn.value.trim(),
			pts,
			Pts: cap(pts),
			y: String(new Date().getFullYear()),
			cta
		};
	}

	function points() {
		return ptsIn.value.split(/[,;\n]+/).map((s) => s.trim().replace(/\.$/, '')).filter(Boolean).slice(0, 4);
	}

	function measure(text) {
		const k = kwIn.value.trim().toLowerCase();
		const lower = text.toLowerCase();
		const at = k ? lower.indexOf(k) : -1;
		return {
			len: text.length,
			px: px(text),
			hasKw: at >= 0,
			kwEarly: at >= 0 && at < 70,
			hasBrand: !!brandIn.value.trim() && lower.includes(brandIn.value.trim().toLowerCase())
		};
	}

	function score(m, hasCta) {
		let s = 0;
		if(m.len >= 140 && m.len <= 158) s += 3;
		else if(m.len >= MIN_CH && m.len <= MAX_CH) s += 2;
		else if(m.len < MIN_CH) s -= (MIN_CH - m.len) / 15;
		if(m.px > MAX_PX) s -= 4;
		if(m.kwEarly) s += 2;
		else if(m.hasKw) s += 1;
		if(m.hasBrand) s += 1;
		if(hasCta) s += 0.5;
		return s;
	}

	function candidates() {
		const type = optType.value;
		const isLocal = type === 'local';
		let list = T[type].slice();
		if(isLocal && !locIn.value.trim()) list = T.service.slice();

		const serviceLike = ['service', 'home', 'local'].includes(type);
		if(serviceLike) list = list.concat(TONE[optTone.value] || []);
		if(serviceLike && type !== 'service') list = list.concat(T.service.slice(0, 3));

		const pts = points();
		const seen = new Set(),
			out = [];
		list.forEach((tpl, order) => {
			
			const tries = [];
			for(let n = Math.max(pts.length, 1); n >= 1; n--) tries.push([n, false, false]);
			tries.push([1, true, false]);
			if(!isLocal) tries.push([1, true, true]);
			let chosen = null;
			for(const [n, dropA, dropL] of tries) {
				const v = context(pts.slice(0, n), dropA, dropL);
				const text = fill(tpl, v);
				if(!text) continue;
				const m = measure(text);
				if(!chosen) chosen = { text, m, cta: !!v.cta };
				if(m.len <= MAX_CH && m.px <= MAX_PX) {
					chosen = { text, m, cta: !!v.cta };
					break;
				}
			}
			if(!chosen) return;
			const key = chosen.text.toLowerCase();
			if(seen.has(key)) return;
			seen.add(key);
			chosen.score = score(chosen.m, chosen.cta);
			chosen.order = order;
			out.push(chosen);
		});
		return out.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 10);
	}

	function esc(s) {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function truncatePx(text) {
		if(px(text) <= MAX_PX) return text;
		const words = text.split(' ');
		let out = '';
		for(const w of words) {
			const next = out ? out + ' ' + w : w;
			if(px(next + ' ...') > MAX_PX) break;
			out = next;
		}
		return out.replace(/[,.;:]$/, '') + ' ...';
	}

	function boldKeyword(htmlText, kw) {
		if(!kw) return htmlText;
		const re = new RegExp('(' + esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
		return htmlText.replace(re, '<b>$1</b>');
	}

	function siteParts() {
		let host = '',
			path = [];
		try {
			const u = new URL(/^https?:\/\//i.test(urlIn.value.trim()) ? urlIn.value.trim() : 'https://' + urlIn.value.trim());
			if(/\./.test(u.hostname)) {
				host = u.hostname.replace(/^www\./, '');
				path = u.pathname.split('/').filter(Boolean);
			}
		} catch (e) {}
		const brand = brandIn.value.trim();
		host = host || (brand ? brand.toLowerCase().replace(/[^a-z0-9]+/g, '') + '.html' : 'example.html');
		return {
			name: brand || host,
			url: 'https://' + host + (path.length ? ' › ' + path.join(' › ') : ''),
			letter: (brand || host).charAt(0).toUpperCase()
		};
	}

	function defaultTitle() {
		const k = kwIn.value.trim().replace(/\b\w/g, (c) => c.toUpperCase());
		const l = locIn.value.trim();
		const b = brandIn.value.trim();
		return (k || 'Page title') + (l ? ' in ' + l : '') + (b ? ' | ' + b : '');
	}

	function serpHtml(desc, title) {
		const s = siteParts();
		return '<div class="sd-serp-site"><span class="sd-serp-fav">' + esc(s.letter) + '</span><div><div class="sd-serp-name">' + esc(s.name) +
			'</div><div class="sd-serp-url">' + esc(s.url) + '</div></div></div>' +
			'<div class="sd-serp-title">' + esc(title || defaultTitle()) + '</div>' +
			'<div class="sd-serp-desc">' + (desc ? boldKeyword(esc(truncatePx(desc)), kwIn.value.trim()) : '<span style="color:#9aa0a6">Your description appears here</span>') + '</div>';
	}

	function badges(m, isBest) {
		const out = [];
		if(isBest) out.push('<span class="sd-badge star"><i class="fa-solid fa-star me-1"></i>Top pick</span>');
		const lenCls = m.len > MAX_CH ? 'bad' : m.len < MIN_CH ? 'warns' : 'good';
		out.push('<span class="sd-badge ' + lenCls + '">' + m.len + ' characters</span>');
		out.push('<span class="sd-badge ' + (m.px > MAX_PX ? 'bad' : 'good') + '">' + m.px + ' / ' + MAX_PX + ' px</span>');
		if(kwIn.value.trim()) out.push('<span class="sd-badge ' + (m.kwEarly ? 'good' : m.hasKw ? 'warns' : 'bad') + '">' + (m.kwEarly ? 'Keyword near start' : m.hasKw ? 'Keyword late' : 'No keyword') + '</span>');
		return out.join('');
	}

	function render(list) {
		resultsEl.innerHTML = '';
		list.forEach((r, i) => {
			const item = document.createElement('div');
			item.className = 'sd-item' + (i === 0 ? ' best' : '');
			item.innerHTML = '<div class="sd-item-text" contenteditable="true" spellcheck="true"></div>' +
				'<div class="sd-item-foot"><div class="sd-badges"></div><div class="sd-actions">' +
				'<button type="button" class="sd-btn sd-prev"><i class="fa-brands fa-google me-1"></i>Preview</button>' +
				'<button type="button" class="sd-btn sd-copy"><i class="fa-regular fa-copy me-1"></i>Copy</button></div></div>' +
				'<div class="sd-serp is-hidden"></div>';
			item.querySelector('.sd-item-text').textContent = r.text;
			item.querySelector('.sd-badges').innerHTML = badges(r.m, i === 0);
			item.dataset.best = i === 0 ? '1' : '';
			resultsEl.appendChild(item);
		});

		const first = resultsEl.querySelector('.sd-item');
		if(first) togglePreview(first, true);
	}

	function itemText(item) {
		return item.querySelector('.sd-item-text').textContent.replace(/\s+/g, ' ').trim();
	}

	function refreshItem(item) {
		const t = itemText(item);
		item.querySelector('.sd-badges').innerHTML = badges(measure(t), item.dataset.best === '1');
		const serp = item.querySelector('.sd-serp');
		if(!serp.classList.contains('is-hidden')) serp.innerHTML = serpHtml(t);
	}

	function togglePreview(item, force) {
		const serp = item.querySelector('.sd-serp');
		const show = force !== undefined ? force : serp.classList.contains('is-hidden');
		serp.classList.toggle('is-hidden', !show);
		if(show) serp.innerHTML = serpHtml(itemText(item));
	}

	function generate() {
		errBox.classList.remove('show');
		if(!kwIn.value.trim()) {
			errBox.textContent = 'Type the main keyword for the page, for example "website design".';
			errBox.classList.add('show');
			kwIn.focus();
			return;
		}
		const list = candidates();
		if(!list.length) {
			errBox.textContent = 'Add a brand name or a few benefits so the descriptions have something to say.';
			errBox.classList.add('show');
			return;
		}
		render(list);
		const fit = list.filter((r) => r.m.len <= MAX_CH && r.m.px <= MAX_PX).length;
		countEl.textContent = list.length + ' options';
		statusEl.textContent = list.length + ' descriptions ready · ' + fit + ' fit Google’s length' + (fit < list.length ? ' · shorten the benefits to fit more' : '');
		copyBtn.disabled = false;
		runCheck();
	}

	function copyText(text, btn) {
		const done = () => {
			if(btn) {
				const old = btn.innerHTML;
				btn.classList.add('done');
				btn.innerHTML = '<i class="fa-solid fa-check me-1"></i>Copied';
				setTimeout(() => {
					btn.classList.remove('done');
					btn.innerHTML = old;
				}, 1400);
			}
			const prev = statusEl.textContent;
			statusEl.textContent = 'Copied to clipboard';
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
		if(!ok) {
			errBox.textContent = 'Your browser blocked copying. Select the text and press Ctrl+C (Cmd+C on Mac).';
			errBox.classList.add('show');
		}
		return ok;
	}

	resultsEl.addEventListener('click', (e) => {
		const item = e.target.closest('.sd-item');
		if(!item) return;
		if(e.target.closest('.sd-copy')) copyText(itemText(item), e.target.closest('.sd-copy'));
		else if(e.target.closest('.sd-prev')) togglePreview(item);
	});

	resultsEl.addEventListener('input', (e) => {
		const item = e.target.closest('.sd-item');
		if(item) refreshItem(item);
	});

	resultsEl.addEventListener('paste', (e) => {
		if(!e.target.closest('.sd-item-text')) return;
		e.preventDefault();
		document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
	});

	copyBtn.addEventListener('click', () => {
		const all = [...resultsEl.querySelectorAll('.sd-item')].map(itemText);
		if(all.length) copyText(all.join('\n\n'));
	});

	clearBtn.addEventListener('click', () => {
		[kwIn, brandIn, locIn, audIn, ptsIn, urlIn].forEach((el) => (el.value = ''));
		resultsEl.innerHTML = '<div class="sd-empty">Your descriptions appear here</div>';
		countEl.textContent = '';
		statusEl.textContent = 'Fill in the details and press Generate';
		copyBtn.disabled = true;
		runCheck();
		kwIn.focus();
	});

	const checkIn = $('sdCheckIn'),
		checkTitle = $('sdCheckTitle'),
		checkBar = $('sdCheckBar'),
		checkLen = $('sdCheckLen'),
		checkPx = $('sdCheckPx'),
		checkTips = $('sdCheckTips'),
		checkSerp = $('sdCheckSerp');

	const ACTION = /\b(get|buy|shop|order|book|call|contact|learn|discover|find|try|start|read|explore|see|join|download|request|visit|sign up|subscribe|compare)\b/i;

	function runCheck() {
		const t = checkIn.value.replace(/\s+/g, ' ').trim();
		const m = measure(t);
		checkLen.textContent = m.len + ' character' + (m.len === 1 ? '' : 's');
		checkPx.textContent = t ? m.px + ' / ' + MAX_PX + ' px' : '';
		checkBar.className = !t ? '' : m.len > MAX_CH || m.px > MAX_PX ? 'long' : m.len < MIN_CH ? 'short' : 'good';
		checkBar.style.width = Math.min(100, (m.px / MAX_PX) * 100) + '%';
		checkSerp.innerHTML = serpHtml(t, checkTitle.value.trim());

		const tips = [];
		if(t) {
			if(m.px > MAX_PX || m.len > MAX_CH) tips.push('Too long: Google will likely cut it off after about ' + MAX_CH + ' characters. Shorten it so the end is not lost.');
			else if(m.len < 70) tips.push('Very short. Aim for 120–160 characters to use the space Google gives you.');
			else if(m.len < MIN_CH) tips.push('A little short. Add a benefit or a call to action to reach 120–160 characters.');
			else tips.push('Good length.');
			const k = kwIn.value.trim();
			if(k) {
				if(!m.hasKw) tips.push('It does not include your main keyword “' + k + '”. Google bolds the searched words, which helps your result stand out.');
				else if(!m.kwEarly) tips.push('Move your keyword closer to the start.');
			}
			if(!ACTION.test(t)) tips.push('Add a call to action, such as “Get a free quote” or “Shop now”.');
			if(/"/.test(t)) tips.push('Avoid double quotes ("). They end the description early in your HTML. Use single quotes instead.');
			if(t.length > 20 && t === t.toUpperCase()) tips.push('Avoid writing in capitals. It looks like shouting in search results.');
			const words = t.toLowerCase().match(/[a-z]{4,}/g) || [];
			const repeated = [...new Set(words.filter((w, i) => words.indexOf(w) !== i))].filter((w) => !kwIn.value.toLowerCase().includes(w));
			if(repeated.length > 2) tips.push('Some words are repeated (' + repeated.slice(0, 3).join(', ') + '). Each word should earn its place.');
		}
		checkTips.innerHTML = '';
		tips.forEach((tip) => {
			const li = document.createElement('li');
			li.textContent = tip;
			checkTips.appendChild(li);
		});
	}

	checkIn.addEventListener('input', runCheck);
	checkTitle.addEventListener('input', runCheck);

	genBtn.addEventListener('click', generate);
	[optType, optTone, optCta].forEach((el) => el.addEventListener('change', generate));
	let typing = null;
	[kwIn, brandIn, locIn, audIn, ptsIn, urlIn].forEach((el) => {
		el.addEventListener('input', () => {
			clearTimeout(typing);
			typing = setTimeout(() => kwIn.value.trim() && generate(), 500);
		});
		el.addEventListener('keydown', (e) => {
			if(e.key === 'Enter') generate();
		});
	});

	generate();
})();