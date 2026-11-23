(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);

	/* ---------- Templates (the main part of the title; the brand is added after) ----------
	   {K} keyword  {L} location  {A} audience  {B} benefit  {Y} year
	   [ ... ] is an optional part, dropped when a value inside it is empty or the title is too long. */

	const T = {
		service: [
			'{K}[ in {L}]', '{K} Services[ in {L}]', 'Professional {K}[ for {A}]', '{B} {K}[ in {L}]', '{K}[ in {L}]: {B}',
			'Affordable {K}[ for {A}]', 'Expert {K} Services[ for {A}]', '{K} Company[ in {L}]', 'Hire {K} Experts[ in {L}]'
		],
		home: [
			'{K}[ in {L}]', '{K}[ for {A}]', '{B} {K}', 'Your {K} Partner[ in {L}]', 'Professional {K} Services[ for {A}]',
			'{K}[ in {L}]: {B}', 'Expert {K}[ in {L}]'
		],
		product: [
			'Buy {K} Online[ in {L}]', '{K}[ for {A}]', '{K}: {B}', 'Shop {K}[ for {A}]', 'Best {K}[ for {A}]',
			'{K} at the Best Price', '{K}[ for {A}] with {B}'
		],
		category: [
			'Shop {K} Online[ in {L}]', '{K}[ for {A}]', 'Best {K}[ in {L}]', '{K}: {B}', 'Buy {K} Online', '{K} for Every Budget'
		],
		blog: [
			'{K}: A Complete Guide[ for {A}]', 'What {IS} {K}? Everything You Need to Know', 'How to Get Started With {K}',
			'{K} Guide[ for {A}]', '{K} Explained[ for {A}]', 'The Ultimate {K} Guide', '{K} Tips[ for {A}]', '{K} for Beginners: Step-by-Step Guide'
		],
		list: [
			'10 Best {K}[ for {A}]', 'Top 10 {K}[ in {L}]', '25 {K} Ideas[ for {A}]', '7 {K} Tips[ for {A}]',
			'15 {K} Examples[ to Inspire You]', '12 Best {K}[ in {L}]', '9 {K} Mistakes to Avoid'
		],
		local: [
			'{K} in {L}', 'Best {K} in {L}', '{K} Services in {L}', 'Trusted {K} Company in {L}', '{B} {K} in {L}',
			'Affordable {K} in {L}', '{K} Near You in {L}'
		],
		tool: [
			'Free {K} Online', 'Free Online {K}', '{K}: {B}', '{K} Online[ for {A}]', 'Best Free {K}[ for {A}]', 'Easy {K}[ for {A}]'
		]
	};

	const TONE = {
		clear: [],
		benefit: ['{K}[ in {L}]: {B}', '{B} {K}[ for {A}]', '{K} That Works[ for {A}]'],
		bold: ['Get {K} That Converts', 'Stand Out With {K}[ in {L}]', '{K} Done Right[ in {L}]', 'Better {K}[ for {A}], Faster']
	};

	const SMALL = new Set('a an and as at but by for from in into nor of on or per the to vs via with'.split(' '));

	/* ---------- Elements ---------- */

	const optType = $('stType'),
		optTone = $('stTone'),
		optSep = $('stSep'),
		optBrandPos = $('stBrandPos'),
		optYear = $('stYear'),
		kwIn = $('stKeyword'),
		brandIn = $('stBrand'),
		locIn = $('stLoc'),
		audIn = $('stAudience'),
		benIn = $('stBenefit'),
		urlIn = $('stUrl'),
		descIn = $('stDesc');
	const errBox = $('stErr'),
		statusEl = $('stStatus'),
		countEl = $('stCount'),
		resultsEl = $('stResults');
	const genBtn = $('stGenerateBtn'),
		copyBtn = $('stCopyBtn'),
		clearBtn = $('stClearBtn');

	/* ---------- Measuring (Google shows titles in 20px Arial, about 600px wide) ---------- */

	const ctx = document.createElement('canvas').getContext('2d');
	const pxTitle = (s) => {
		ctx.font = '20px Arial, Helvetica, sans-serif';
		return Math.round(ctx.measureText(s).width);
	};
	const pxDesc = (s) => {
		ctx.font = '14px Arial, Helvetica, sans-serif';
		return Math.round(ctx.measureText(s).width);
	};
	const MAX_PX = 600,
		MAX_CH = 60,
		MIN_CH = 30;

	/* ---------- Helpers ---------- */

	function titleCase(s) {
		return s.trim().replace(/\s+/g, ' ').split(' ').map((w, i) => {
			if(w !== w.toLowerCase()) return w; // keep SEO, iPhone, WordPress as typed
			if(i > 0 && SMALL.has(w)) return w;
			return w.charAt(0).toUpperCase() + w.slice(1);
		}).join(' ');
	}

	function fill(tpl, v, keepOptional) {
		let s = tpl.replace(/\[([^\[\]]*)\]/g, (m, inner) => {
			if(!keepOptional) return '';
			const keys = inner.match(/\{(\w+)\}/g) || [];
			return keys.every((k) => v[k.slice(1, -1)]) ? inner : '';
		});
		const keys = s.match(/\{(\w+)\}/g) || [];
		if(keys.some((k) => !v[k.slice(1, -1)])) return null;
		return s.replace(/\{(\w+)\}/g, (m, k) => v[k]).replace(/\s+/g, ' ').replace(/\s+([:?,])/g, '$1').trim();
	}

	function values() {
		return {
			K: titleCase(kwIn.value),
			L: titleCase(locIn.value),
			A: titleCase(audIn.value),
			B: titleCase(benIn.value),
			Y: String(new Date().getFullYear()),
			IS: /[^s]s$/i.test(kwIn.value.trim()) ? 'Are' : 'Is'
		};
	}

	function withBrand(main, brand) {
		const sep = optSep.value;
		const pos = optBrandPos.value;
		if(!brand || pos === 'none') return main;
		return pos === 'start' ? brand + sep + main : main + sep + brand;
	}

	function measure(text) {
		const k = kwIn.value.trim().toLowerCase();
		const lower = text.toLowerCase();
		const at = k ? lower.indexOf(k) : -1;
		const brand = brandIn.value.trim().toLowerCase();
		const count = k ? lower.split(k).length - 1 : 0;
		return {
			len: text.length,
			px: pxTitle(text),
			kwAt: at,
			kwCount: count,
			hasBrand: !!brand && lower.includes(brand)
		};
	}

	function score(m) {
		let s = 0;
		s += m.px <= MAX_PX ? 3 : -4;
		if(m.kwAt === 0) s += 3;
		else if(m.kwAt > 0 && m.kwAt <= 30) s += 2;
		else if(m.kwAt > 30) s += 0.5;
		if(m.hasBrand) s += 1;
		if(m.len >= 45 && m.len <= MAX_CH) s += 2;
		else if(m.len >= MIN_CH) s += 1;
		else s -= 1;
		if(m.kwCount > 1) s -= 2;
		return s;
	}

	/* ---------- Generate ---------- */

	function candidates() {
		const type = optType.value;
		let list = T[type].slice();
		if(type === 'local' && !locIn.value.trim()) list = T.service.slice();
		// catchy phrasings ("That Converts", "Done Right") only suit service-style pages
		if(optTone.value !== 'bold' || ['service', 'home', 'local'].includes(type)) list = list.concat(TONE[optTone.value] || []);

		const v = values();
		const brand = brandIn.value.trim();
		const year = optYear.checked;
		const seen = new Set(),
			out = [];

		list.forEach((tpl, order) => {
			// full version first, then without the optional parts, then without the brand
			const tries = [];
			[true, false].forEach((keep) => {
				let main = fill(tpl, v, keep);
				if(!main) return;
				if(year && !main.includes(v.Y)) main += ' (' + v.Y + ')';
				tries.push({ text: withBrand(main, brand), droppedBrand: false });
			});
			const mainShort = fill(tpl, v, false);
			if(mainShort && brand && optBrandPos.value !== 'none') {
				tries.push({ text: mainShort + (year && !mainShort.includes(v.Y) ? ' (' + v.Y + ')' : ''), droppedBrand: true });
			}
			if(!tries.length) return;
			let chosen = tries.find((t) => pxTitle(t.text) <= MAX_PX) || tries[0];
			const key = chosen.text.toLowerCase();
			if(seen.has(key)) return;
			seen.add(key);
			const m = measure(chosen.text);
			out.push({ text: chosen.text, m, droppedBrand: chosen.droppedBrand, score: score(m) - (chosen.droppedBrand ? 0.5 : 0), order });
		});
		return out.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 10);
	}

	/* ---------- Google preview ---------- */

	function esc(s) {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function truncate(text, limit, measureFn) {
		if(measureFn(text) <= limit) return text;
		let out = '';
		for(const w of text.split(' ')) {
			const next = out ? out + ' ' + w : w;
			if(measureFn(next + ' ...') > limit) break;
			out = next;
		}
		return out.replace(/[\s|\-–:·,]+$/, '') + ' ...';
	}

	function boldKeyword(html) {
		const k = kwIn.value.trim();
		if(!k) return html;
		const re = new RegExp('(' + esc(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
		return html.replace(re, '<b>$1</b>');
	}

	function siteParts() {
		let host = '',
			path = [];
		try {
			const raw = urlIn.value.trim();
			const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
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

	function serpHtml(title) {
		const s = siteParts();
		const desc = descIn.value.replace(/\s+/g, ' ').trim();
		return '<div class="st-serp-site"><span class="st-serp-fav">' + esc(s.letter) + '</span><div><div class="st-serp-name">' + esc(s.name) +
			'</div><div class="st-serp-url">' + esc(s.url) + '</div></div></div>' +
			'<div class="st-serp-title">' + (title ? esc(truncate(title, MAX_PX, pxTitle)) : 'Your title appears here') + '</div>' +
			'<div class="st-serp-desc">' + (desc ? boldKeyword(esc(truncate(desc, 920, pxDesc))) : 'Add a meta description to see the full result.') + '</div>';
	}

	/* ---------- Render ---------- */

	function badges(m, isBest, droppedBrand) {
		const out = [];
		if(isBest) out.push('<span class="st-badge star"><i class="fa-solid fa-star me-1"></i>Top pick</span>');
		out.push('<span class="st-badge ' + (m.len > MAX_CH ? 'bad' : m.len < MIN_CH ? 'warn' : 'good') + '">' + m.len + ' characters</span>');
		out.push('<span class="st-badge ' + (m.px > MAX_PX ? 'bad' : 'good') + '">' + m.px + ' / ' + MAX_PX + ' px</span>');
		if(kwIn.value.trim()) {
			const kw = m.kwAt === 0 ? ['good', 'Keyword first'] : m.kwAt > 0 && m.kwAt <= 30 ? ['good', 'Keyword early'] : m.kwAt > 30 ? ['warn', 'Keyword late'] : ['bad', 'No keyword'];
			out.push('<span class="st-badge ' + kw[0] + '">' + kw[1] + '</span>');
		}
		if(m.kwCount > 1) out.push('<span class="st-badge warn">Keyword repeated</span>');
		if(droppedBrand) out.push('<span class="st-badge warn">Brand left out to fit</span>');
		return out.join('');
	}

	function itemText(item) {
		return item.querySelector('.st-item-text').textContent.replace(/\s+/g, ' ').trim();
	}

	function togglePreview(item, force) {
		const serp = item.querySelector('.st-serp');
		const show = force !== undefined ? force : serp.classList.contains('is-hidden');
		serp.classList.toggle('is-hidden', !show);
		if(show) serp.innerHTML = serpHtml(itemText(item));
	}

	function refreshItem(item) {
		const t = itemText(item);
		item.querySelector('.st-badges').innerHTML = badges(measure(t), item.dataset.best === '1', false);
		const serp = item.querySelector('.st-serp');
		if(!serp.classList.contains('is-hidden')) serp.innerHTML = serpHtml(t);
	}

	function render(list) {
		resultsEl.innerHTML = '';
		list.forEach((r, i) => {
			const item = document.createElement('div');
			item.className = 'st-item' + (i === 0 ? ' best' : '');
			item.dataset.best = i === 0 ? '1' : '';
			item.innerHTML = '<div class="st-item-text" contenteditable="true" spellcheck="true"></div>' +
				'<div class="st-item-foot"><div class="st-badges"></div><div class="st-actions">' +
				'<button type="button" class="st-btn st-prev"><i class="fa-brands fa-google me-1"></i>Preview</button>' +
				'<button type="button" class="st-btn st-copy"><i class="fa-regular fa-copy me-1"></i>Copy</button></div></div>' +
				'<div class="st-serp is-hidden"></div>';
			item.querySelector('.st-item-text').textContent = r.text;
			item.querySelector('.st-badges').innerHTML = badges(r.m, i === 0, r.droppedBrand);
			resultsEl.appendChild(item);
		});
		const first = resultsEl.querySelector('.st-item');
		if(first) togglePreview(first, true);
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
			errBox.textContent = 'No titles could be made. Add a benefit or location, or choose another page type.';
			errBox.classList.add('show');
			return;
		}
		render(list);
		const fit = list.filter((r) => r.m.px <= MAX_PX).length;
		countEl.textContent = list.length + ' options';
		statusEl.textContent = list.length + ' titles ready · ' + fit + ' fit Google’s width' + (fit < list.length ? ' · shorten the brand or benefit to fit more' : '');
		copyBtn.disabled = false;
		runCheck();
	}

	/* ---------- Copy ---------- */

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
		const item = e.target.closest('.st-item');
		if(!item) return;
		if(e.target.closest('.st-copy')) copyText(itemText(item), e.target.closest('.st-copy'));
		else if(e.target.closest('.st-prev')) togglePreview(item);
	});

	resultsEl.addEventListener('input', (e) => {
		const item = e.target.closest('.st-item');
		if(item) refreshItem(item);
	});

	resultsEl.addEventListener('keydown', (e) => {
		// a title is one line
		if(e.key === 'Enter' && e.target.closest('.st-item-text')) e.preventDefault();
	});

	resultsEl.addEventListener('paste', (e) => {
		if(!e.target.closest('.st-item-text')) return;
		e.preventDefault();
		document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s+/g, ' '));
	});

	copyBtn.addEventListener('click', () => {
		const all = [...resultsEl.querySelectorAll('.st-item')].map(itemText);
		if(all.length) copyText(all.join('\n'));
	});

	clearBtn.addEventListener('click', () => {
		[kwIn, brandIn, locIn, audIn, benIn, urlIn, descIn].forEach((el) => (el.value = ''));
		resultsEl.innerHTML = '<div class="st-empty">Your titles appear here</div>';
		countEl.textContent = '';
		statusEl.textContent = 'Fill in the details and press Generate';
		copyBtn.disabled = true;
		runCheck();
		kwIn.focus();
	});

	/* ---------- Checker ---------- */

	const checkIn = $('stCheckIn'),
		checkBar = $('stCheckBar'),
		checkLen = $('stCheckLen'),
		checkPx = $('stCheckPx'),
		checkTips = $('stCheckTips'),
		checkSerp = $('stCheckSerp');

	function runCheck() {
		const t = checkIn.value.replace(/\s+/g, ' ').trim();
		const m = measure(t);
		checkLen.textContent = m.len + ' character' + (m.len === 1 ? '' : 's');
		checkPx.textContent = t ? m.px + ' / ' + MAX_PX + ' px' : '';
		checkBar.className = !t ? '' : m.px > MAX_PX ? 'long' : m.len < MIN_CH ? 'short' : 'good';
		checkBar.style.width = Math.min(100, (m.px / MAX_PX) * 100) + '%';
		checkSerp.innerHTML = serpHtml(t);

		const tips = [];
		if(t) {
			if(m.px > MAX_PX) tips.push('Too wide: Google will likely cut it off with "..." after about ' + MAX_PX + ' pixels. Shorten it or move the brand to the end.');
			else if(m.len < MIN_CH) tips.push('Short. Aim for 50–60 characters so the title says enough to win the click.');
			else tips.push('Good length.');
			const k = kwIn.value.trim();
			if(k) {
				if(m.kwAt < 0) tips.push('It does not include your main keyword “' + k + '”. Put it near the start.');
				else if(m.kwAt > 30) tips.push('Move your keyword closer to the start. Words at the start count most and are read first.');
				if(m.kwCount > 2) tips.push('The keyword appears ' + m.kwCount + ' times. Using it once is enough; repeating it can look like spam.');
			}
			const seps = (t.match(/\s[|\-–·:]\s/g) || []).length;
			if(seps > 2) tips.push('Too many separators. One or two are enough, such as “Keyword: Benefit | Brand”.');
			if(t.length > 15 && t === t.toUpperCase()) tips.push('Avoid writing in capitals. Google may rewrite titles like this.');
			if(/!{2,}|\?{2,}/.test(t)) tips.push('Avoid repeated ! or ? marks. They look like clickbait.');
			if(brandIn.value.trim() && !m.hasBrand && optType.value === 'home') tips.push('Your homepage title should include your brand name.');
			if(/^(home|untitled|new page|page \d+)\b/i.test(t)) tips.push('Replace generic words like “Home” with what the page is about.');
		}
		checkTips.innerHTML = '';
		tips.forEach((tip) => {
			const li = document.createElement('li');
			li.textContent = tip;
			checkTips.appendChild(li);
		});
	}

	checkIn.addEventListener('input', runCheck);

	/* ---------- Events ---------- */

	genBtn.addEventListener('click', generate);
	[optType, optTone, optSep, optBrandPos, optYear].forEach((el) => el.addEventListener('change', generate));
	let typing = null;
	[kwIn, brandIn, locIn, audIn, benIn, urlIn].forEach((el) => {
		el.addEventListener('input', () => {
			clearTimeout(typing);
			typing = setTimeout(() => kwIn.value.trim() && generate(), 450);
		});
		el.addEventListener('keydown', (e) => {
			if(e.key === 'Enter') generate();
		});
	});
	descIn.addEventListener('input', () => {
		resultsEl.querySelectorAll('.st-item').forEach((item) => {
			const serp = item.querySelector('.st-serp');
			if(!serp.classList.contains('is-hidden')) serp.innerHTML = serpHtml(itemText(item));
		});
		runCheck();
	});

	generate();
})();
