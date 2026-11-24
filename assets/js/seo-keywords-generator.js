(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);

	/* ---------- Patterns ----------
	   {k} = main keyword, {y} = year, {l} = location, {e} = extra word
	   Intent: info, commercial, transactional, local */

	const GROUPS = [{
		id: 'questions',
		name: 'Questions',
		items: [
			['what is {k}', 'info'], ['how does {k} work', 'info'], ['how to choose {k}', 'commercial'],
			['how to get started with {k}', 'info'], ['how to learn {k}', 'info'], ['how much does {k} cost', 'commercial'],
			['how long does {k} take', 'info'], ['why is {k} important', 'info'], ['why use {k}', 'info'],
			['when do you need {k}', 'info'], ['where to find {k}', 'commercial'], ['which {k} is best', 'commercial'],
			['who needs {k}', 'info'], ['is {k} worth it', 'commercial'], ['can i do {k} myself', 'info'],
			['what is the best {k}', 'commercial'], ['what to look for in {k}', 'commercial'], ['what are the benefits of {k}', 'info'],
			['what are the types of {k}', 'info'], ['how to improve {k}', 'info'], ['is {k} free', 'commercial']
		]
	}, {
		id: 'best',
		name: 'Best & top',
		items: [
			['best {k}', 'commercial'], ['top {k}', 'commercial'], ['best {k} {y}', 'commercial'], ['top 10 {k}', 'commercial'],
			['best {k} for beginners', 'commercial'], ['best {k} for small business', 'commercial'], ['best free {k}', 'commercial'],
			['most popular {k}', 'commercial'], ['{k} reviews', 'commercial'], ['top rated {k}', 'commercial'],
			['recommended {k}', 'commercial'], ['professional {k}', 'commercial'], ['best {k} examples', 'info'],
			['best {k} tools', 'commercial'], ['best {k} companies', 'commercial'], ['top {k} trends {y}', 'info']
		]
	}, {
		id: 'price',
		name: 'Price & cost',
		items: [
			['{k} price', 'transactional'], ['{k} cost', 'commercial'], ['{k} prices {y}', 'commercial'], ['{k} cost calculator', 'commercial'],
			['cheap {k}', 'transactional'], ['affordable {k}', 'transactional'], ['{k} packages', 'transactional'],
			['{k} pricing plans', 'transactional'], ['{k} rates', 'commercial'], ['free {k}', 'commercial'], ['{k} quote', 'transactional'],
			['{k} discount', 'transactional'], ['{k} deals', 'transactional'], ['low cost {k}', 'transactional'],
			['{k} cost breakdown', 'info'], ['average {k} cost', 'commercial']
		]
	}, {
		id: 'buy',
		name: 'Buy & hire',
		items: [
			['buy {k}', 'transactional'], ['{k} services', 'transactional'], ['{k} company', 'transactional'], ['{k} agency', 'transactional'],
			['hire {k} expert', 'transactional'], ['{k} expert', 'transactional'], ['{k} online', 'transactional'], ['order {k} online', 'transactional'],
			['{k} consultant', 'transactional'], ['{k} freelancer', 'transactional'], ['{k} provider', 'transactional'],
			['{k} for sale', 'transactional'], ['get {k}', 'transactional'], ['{k} service provider', 'transactional'],
			['{k} subscription', 'transactional'], ['{k} free trial', 'transactional']
		]
	}, {
		id: 'compare',
		name: 'Comparisons',
		items: [
			['{k} alternatives', 'commercial'], ['{k} comparison', 'commercial'], ['compare {k}', 'commercial'], ['{k} pros and cons', 'commercial'],
			['{k} vs diy', 'commercial'], ['free vs paid {k}', 'commercial'], ['cheap vs expensive {k}', 'commercial'],
			['in-house vs outsourced {k}', 'commercial'], ['{k} vs competitors', 'commercial'], ['{k} or do it yourself', 'commercial'],
			['{k} options', 'commercial'], ['similar to {k}', 'commercial']
		]
	}, {
		id: 'guides',
		name: 'Guides & ideas',
		items: [
			['{k} guide', 'info'], ['{k} tutorial', 'info'], ['{k} for beginners', 'info'], ['{k} tips', 'info'], ['{k} checklist', 'info'],
			['{k} step by step', 'info'], ['{k} best practices', 'info'], ['{k} mistakes to avoid', 'info'], ['{k} examples', 'info'],
			['{k} ideas', 'info'], ['{k} templates', 'info'], ['{k} trends {y}', 'info'], ['{k} statistics {y}', 'info'],
			['{k} course', 'commercial'], ['learn {k}', 'info'], ['{k} pdf', 'info'], ['{k} strategy', 'info'], ['{k} process', 'info'],
			['{k} definition', 'info'], ['{k} meaning', 'info'], ['{k} {y} guide', 'info']
		]
	}, {
		id: 'prep',
		name: 'For, with & without',
		items: [
			['{k} for small business', 'commercial'], ['{k} for startups', 'commercial'], ['{k} for ecommerce', 'commercial'],
			['{k} for beginners', 'info'], ['{k} for students', 'info'], ['{k} for agencies', 'commercial'],
			['{k} with examples', 'info'], ['{k} with no experience', 'info'], ['{k} without coding', 'info'],
			['{k} without money', 'info'], ['{k} on a budget', 'commercial'], ['{k} at home', 'info'], ['{k} from scratch', 'info'],
			['{k} to increase sales', 'commercial'], ['{k} in {y}', 'info'], ['{k} for free', 'commercial']
		]
	}];

	const LOCAL_WITH = [
		['{k} in {l}', 'local'], ['{k} {l}', 'local'], ['best {k} in {l}', 'local'], ['{k} company in {l}', 'local'],
		['{k} services in {l}', 'local'], ['affordable {k} in {l}', 'local'], ['top {k} {l}', 'local'], ['{k} near {l}', 'local'],
		['{k} price in {l}', 'local'], ['{k} agency {l}', 'local'], ['cheap {k} {l}', 'local'], ['{l} {k}', 'local'],
		['{k} near me', 'local'], ['{k} near me open now', 'local'], ['local {k}', 'local']
	];

	const LOCAL_NONE = [
		['{k} near me', 'local'], ['best {k} near me', 'local'], ['{k} near me open now', 'local'], ['local {k}', 'local'],
		['{k} in my area', 'local'], ['cheap {k} near me', 'local'], ['{k} services near me', 'local'], ['{k} company near me', 'local']
	];

	const EXTRA = [
		['{k} {e}', 'commercial'], ['{e} {k}', 'commercial'], ['{k} for {e}', 'commercial'], ['best {k} for {e}', 'commercial'],
		['{e} {k} services', 'transactional'], ['{e} {k} price', 'transactional'], ['{e} {k} examples', 'info'],
		['how to do {k} for {e}', 'info'], ['{e} {k} tips', 'info'], ['{e} {k} in {l}', 'local']
	];

	const INTENT_NAMES = { info: 'Informational', commercial: 'Commercial', transactional: 'Transactional', local: 'Local' };

	/* ---------- Elements ---------- */

	const seedIn = $('kwSeed'),
		locIn = $('kwLoc'),
		extraIn = $('kwExtra'),
		optYear = $('kwYear'),
		lengthSel = $('kwLength'),
		findIn = $('kwFind'),
		chipsBox = $('kwIntents'),
		groupsEl = $('kwGroups'),
		errBox = $('kwErr'),
		statusEl = $('kwStatus');
	const genBtn = $('kwGenerateBtn'),
		copyBtn = $('kwCopyBtn'),
		copyLabel = $('kwCopyLabel'),
		csvBtn = $('kwCsvBtn'),
		clearBtn = $('kwClearBtn');

	let all = [], // [{ kw, group, groupName, intent, words }]
		selected = new Set(),
		intent = 'all',
		seed = '';

	/* ---------- Build ---------- */

	const tidy = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

	function fill(tpl, vars) {
		return tidy(tpl.replace(/\{(\w)\}/g, (m, k) => vars[k] || ''));
	}

	function build() {
		seed = tidy(seedIn.value.replace(/[^\p{L}\p{N}\s&'+.-]/gu, ' '));
		const loc = tidy(locIn.value);
		const extras = extraIn.value.split(',').map(tidy).filter(Boolean).slice(0, 6);
		const year = String(new Date().getFullYear());
		const useYear = optYear.checked;
		const seen = new Set(),
			out = [];

		function add(tpl, intentId, groupId, groupName, vars) {
			if(!useYear && tpl.includes('{y}')) return;
			if(tpl.includes('{l}') && !vars.l) return;
			const kw = fill(tpl, vars);
			if(!kw || seen.has(kw)) return;
			seen.add(kw);
			out.push({ kw, group: groupId, groupName, intent: intentId, words: kw.split(' ').length });
		}

		const vars = { k: seed, y: year, l: loc };
		GROUPS.forEach((g) => g.items.forEach(([t, i]) => add(t, i, g.id, g.name, vars)));
		(loc ? LOCAL_WITH : LOCAL_NONE).forEach(([t, i]) => add(t, i, 'local', loc ? 'Local · ' + loc : 'Local & near me', vars));
		extras.forEach((e) => EXTRA.forEach(([t, i]) => add(t, i, 'extra', 'With your words', { k: seed, y: year, l: loc, e })));
		return out;
	}

	/* ---------- Filtering & rendering ---------- */

	function passesOther(r) {
		const len = lengthSel.value;
		if(len === 'short' && r.words > 3) return false;
		if(len === 'long' && r.words < 4) return false;
		const q = tidy(findIn.value);
		return !q || r.kw.includes(q);
	}

	function visible() {
		return all.filter((r) => passesOther(r) && (intent === 'all' || r.intent === intent));
	}

	function highlight(kw) {
		// bold the words around the main keyword so the modifiers stand out
		const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const i = seed ? kw.indexOf(seed) : -1;
		if(i < 0) return '<b>' + esc(kw) + '</b>';
		const before = kw.slice(0, i),
			after = kw.slice(i + seed.length);
		return (before ? '<b>' + esc(before) + '</b>' : '') + esc(seed) + (after ? '<b>' + esc(after) + '</b>' : '');
	}

	function updateCounts() {
		const base = all.filter(passesOther);
		chipsBox.querySelectorAll('.kw-chip').forEach((c) => {
			const n = c.dataset.intent === 'all' ? base.length : base.filter((r) => r.intent === c.dataset.intent).length;
			c.querySelector('span').textContent = all.length ? n : '';
		});
	}

	function updateActions() {
		const vis = visible().length;
		copyBtn.disabled = csvBtn.disabled = !(selected.size || vis);
		copyLabel.textContent = selected.size ? 'Copy ' + selected.size + ' selected' : 'Copy all';
	}

	function render() {
		updateCounts();
		groupsEl.innerHTML = '';
		if(!all.length) {
			groupsEl.innerHTML = '<div class="kw-empty">Your keyword ideas appear here</div>';
			updateActions();
			return;
		}
		const vis = visible();
		if(!vis.length) {
			groupsEl.innerHTML = '<div class="kw-empty">No keywords match these filters</div>';
			updateActions();
			return;
		}
		const byGroup = new Map();
		vis.forEach((r) => {
			if(!byGroup.has(r.group)) byGroup.set(r.group, { name: r.groupName, rows: [] });
			byGroup.get(r.group).rows.push(r);
		});
		const frag = document.createDocumentFragment();
		byGroup.forEach((g, id) => {
			const box = document.createElement('div');
			box.className = 'kw-group';
			const head = document.createElement('div');
			head.className = 'kw-group-head';
			head.innerHTML = '<h6></h6><button type="button" class="kw-group-copy"><i class="fa-regular fa-copy me-1"></i>Copy</button>';
			head.querySelector('h6').textContent = g.name;
			const small = document.createElement('small');
			small.textContent = g.rows.length;
			head.querySelector('h6').appendChild(small);
			head.querySelector('button').dataset.group = id;
			const ul = document.createElement('ul');
			g.rows.forEach((r) => {
				const li = document.createElement('li');
				li.dataset.kw = r.kw;
				li.title = INTENT_NAMES[r.intent] + ' · click to select';
				if(selected.has(r.kw)) li.classList.add('sel');
				li.innerHTML = '<span class="kw-tick"><i class="fa-solid fa-check"></i></span>' +
					'<i class="kw-dot kw-' + r.intent + '"></i>' +
					'<span class="kw-text">' + highlight(r.kw) + '</span>' +
					'<span class="kw-words">' + r.words + 'w</span>';
				ul.appendChild(li);
			});
			box.append(head, ul);
			frag.appendChild(box);
		});
		groupsEl.appendChild(frag);
		updateActions();
	}

	function generate() {
		errBox.classList.remove('show');
		if(!seedIn.value.trim()) {
			errBox.textContent = 'Type a main keyword, for example "website design" or "running shoes".';
			errBox.classList.add('show');
			return;
		}
		all = build();
		selected = new Set([...selected].filter((k) => all.some((r) => r.kw === k)));
		render();
		const counts = {};
		all.forEach((r) => (counts[r.intent] = (counts[r.intent] || 0) + 1));
		statusEl.textContent = all.length + ' keyword ideas for “' + seed + '” · ' +
			Object.keys(INTENT_NAMES).filter((i) => counts[i]).map((i) => counts[i] + ' ' + INTENT_NAMES[i].toLowerCase()).join(', ');
	}

	/* ---------- Copy & CSV ---------- */

	function exportRows() {
		return selected.size ? all.filter((r) => selected.has(r.kw)) : visible();
	}

	function copyText(text, msg) {
		const done = () => {
			const prev = statusEl.textContent;
			statusEl.textContent = msg;
			setTimeout(() => (statusEl.textContent = prev), 1500);
		};
		if(navigator.clipboard && window.isSecureContext) {
			navigator.clipboard.writeText(text).then(done, () => fallback(text) && done());
		} else if(fallback(text)) done();
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
			errBox.textContent = 'Your browser blocked copying. Use the CSV download instead.';
			errBox.classList.add('show');
		}
		return ok;
	}

	copyBtn.addEventListener('click', () => {
		const rows = exportRows();
		if(rows.length) copyText(rows.map((r) => r.kw).join('\n'), 'Copied ' + rows.length + ' keywords');
	});

	csvBtn.addEventListener('click', () => {
		const rows = exportRows();
		if(!rows.length) return;
		const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
		const csv = ['keyword,group,intent,words,characters']
			.concat(rows.map((r) => [r.kw, r.groupName, INTENT_NAMES[r.intent], r.words, r.kw.length].map(q).join(',')))
			.join('\r\n') + '\r\n';
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
		a.download = 'keywords-' + (seed.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ideas') + '.csv';
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	});

	clearBtn.addEventListener('click', () => {
		seedIn.value = locIn.value = extraIn.value = findIn.value = '';
		all = [];
		selected.clear();
		render();
		statusEl.textContent = 'Type a keyword and press Generate';
		seedIn.focus();
	});

	/* ---------- Events ---------- */

	groupsEl.addEventListener('click', (e) => {
		const gBtn = e.target.closest('.kw-group-copy');
		if(gBtn) {
			const rows = visible().filter((r) => r.group === gBtn.dataset.group);
			copyText(rows.map((r) => r.kw).join('\n'), 'Copied ' + rows.length + ' keywords');
			return;
		}
		const li = e.target.closest('li[data-kw]');
		if(!li) return;
		const kw = li.dataset.kw;
		if(selected.has(kw)) selected.delete(kw);
		else selected.add(kw);
		li.classList.toggle('sel');
		updateActions();
	});

	chipsBox.addEventListener('click', (e) => {
		const c = e.target.closest('.kw-chip');
		if(!c) return;
		intent = c.dataset.intent;
		chipsBox.querySelectorAll('.kw-chip').forEach((b) => b.classList.toggle('active', b === c));
		render();
	});

	lengthSel.addEventListener('change', render);
	findIn.addEventListener('input', render);

	genBtn.addEventListener('click', generate);
	optYear.addEventListener('change', generate);
	[seedIn, locIn, extraIn].forEach((el) => el.addEventListener('keydown', (e) => {
		if(e.key === 'Enter') generate();
	}));
	let typing = null;
	[seedIn, locIn, extraIn].forEach((el) => el.addEventListener('input', () => {
		clearTimeout(typing);
		typing = setTimeout(() => seedIn.value.trim() && generate(), 450);
	}));

	/* ---------- Website analysis ---------- */

	// Pages are read with MatteFetch (assets/js/fetch-page.js): directly when the
	// site allows it, otherwise through a chain of public proxies.

	const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves ' +
		'also get got may might must shall us via etc per within without across upon among around whether either neither yet ever every much many one two three new use used using make makes made like just well way ways need needs know see one ' +
		'home page menu click here read learn contact call email phone copyright rights reserved privacy policy terms cookies cookie related view more login sign signup log submit search skip content toggle navigation close open next previous back top view details share follow facebook twitter instagram linkedin youtube tiktok whatsapp www http https com net org html amp nbsp').split(' '));

	const urlIn = $('kwUrl'),
		analyzeBtn = $('kwAnalyzeBtn'),
		pasteToggle = $('kwPasteToggle'),
		pasteBox = $('kwPasteBox'),
		pasteIn = $('kwPaste'),
		pasteBtn = $('kwPasteBtn'),
		siteResult = $('kwSiteResult'),
		siteMeta = $('kwSiteMeta'),
		foundPhrases = $('kwFoundPhrases'),
		foundWords = $('kwFoundWords');

	function normaliseUrl(v) {
		v = v.trim();
		if(!v) return '';
		if(!/^https?:\/\//i.test(v)) v = 'https://' + v;
		try {
			const u = new URL(v);
			return /\./.test(u.hostname) ? u.href : '';
		} catch (e) {
			return '';
		}
	}

	function words(text) {
		return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'&+-]*/gu) || [])
			.map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))
			.filter(Boolean);
	}

	function parsePage(src) {
		const looksHtml = /<\s*(html|head|body|title|meta|div|p|h1)\b/i.test(src);
		const doc = new DOMParser().parseFromString(looksHtml ? src : '<body><p>' + src.replace(/</g, '&lt;').replace(/\n{2,}/g, '</p><p>') + '</p></body>', 'text/html');
		doc.querySelectorAll('script, style, noscript, template, svg, iframe').forEach((n) => n.remove());
		const meta = (sel) => {
			const m = doc.querySelector(sel);
			return m ? (m.getAttribute('content') || '').trim() : '';
		};
		const texts = (sel) => [...doc.querySelectorAll(sel)].map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
		const page = {
			title: (doc.querySelector('title') ? doc.querySelector('title').textContent : '').replace(/\s+/g, ' ').trim() || meta('meta[property="og:title"]'),
			description: meta('meta[name="description"]') || meta('meta[property="og:description"]'),
			metaKeywords: meta('meta[name="keywords"]'),
			h1: texts('h1'),
			h2: texts('h2, h3'),
			alts: [...doc.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt').trim()).filter(Boolean),
			lang: (doc.documentElement.getAttribute('lang') || '').slice(0, 2)
		};
		// navigation, header and footer repeat on every page, so leave them out of the body text
		const mainEl = doc.querySelector('main, article, [role=main]') || doc.body;
		[...mainEl.querySelectorAll('nav, header, footer')].forEach((n) => n.remove());
		// end every block with a full stop so phrases never join across headings, cards or buttons
		mainEl.querySelectorAll('p, div, li, td, th, h1, h2, h3, h4, h5, h6, a, button, label, figcaption, blockquote, dt, dd, br').forEach((n) => n.append(doc.createTextNode('. ')));
		page.body = mainEl ? mainEl.textContent.replace(/\s+/g, ' ').trim() : '';
		return page;
	}

	function scorePage(page) {
		const scores = new Map(),
			counts = new Map(),
			best = new Map(); // strongest place each phrase appears (title = 6 … body = 1)
		const MIDDLE_OK = new Set(['for', 'of', 'in', 'near', 'with', 'to']);
		const bump = (map, k, v) => map.set(k, (map.get(k) || 0) + v);

		function feed(text, weight) {
			// split on punctuation so phrases do not run across sentences or "|" separators
			text.split(/[.,;:!?|•·–—()\[\]{}"“”\/\\]+|\s-\s/).forEach((chunk) => {
				const w = words(chunk);
				for(let n = 1; n <= 3; n++) {
					for(let i = 0; i + n <= w.length; i++) {
						const g = w.slice(i, i + n);
						if(STOP.has(g[0]) || STOP.has(g[n - 1])) continue;
						if(n === 3 && STOP.has(g[1]) && !MIDDLE_OK.has(g[1])) continue;
						if(g.some((x) => x.length < 2 || /^\d+$/.test(x))) continue;
						const key = g.join(' ');
						bump(scores, key, weight * (n === 1 ? 1 : n === 2 ? 2.2 : 2.8));
						bump(counts, key, 1);
						best.set(key, Math.max(best.get(key) || 0, weight));
					}
				}
			});
		}

		feed(page.title, 6);
		feed(page.description, 4);
		feed(page.metaKeywords.replace(/,/g, '.'), 3);
		page.h1.forEach((t) => feed(t, 5));
		page.h2.forEach((t) => feed(t, 3));
		page.alts.forEach((t) => feed(t, 1.5));
		feed(page.body, 1);

		const rows = [...scores.entries()].map(([k, s]) => ({ k, s, c: counts.get(k), n: k.split(' ').length, w: best.get(k) }));
		// a phrase used only once is usually noise, unless it is in the title or main heading
		const phrases = rows.filter((r) => r.n > 1 && (r.c > 1 || r.w >= 5)).sort((a, b) => b.s - a.s);
		// drop phrases that are just part of a stronger longer phrase
		const keep = [];
		phrases.forEach((r) => {
			if(keep.some((x) => x.k.includes(r.k) && x.s >= r.s * 0.8)) return;
			keep.push(r);
		});
		const singles = rows.filter((r) => r.n === 1 && r.k.length > 2).sort((a, b) => b.s - a.s);
		return { phrases: keep.slice(0, 18), words: singles.slice(0, 15) };
	}

	function chip(row) {
		const b = document.createElement('button');
		b.type = 'button';
		b.dataset.kw = row.k;
		b.title = 'Use “' + row.k + '” as the main keyword · found ' + row.c + ' time' + (row.c === 1 ? '' : 's');
		b.innerHTML = '<span></span><em></em>';
		b.firstChild.textContent = row.k;
		b.lastChild.textContent = row.c + '×';
		return b;
	}

	function showSite(page, sourceLabel) {
		const res = scorePage(page);
		const wc = words(page.body).length;
		siteMeta.innerHTML = '';
		const row = (label, value) => {
			if(!value) return;
			const d = document.createElement('div');
			d.className = 'kw-meta-row';
			d.innerHTML = '<span></span><span></span>';
			d.firstChild.textContent = label;
			d.lastChild.textContent = value;
			siteMeta.appendChild(d);
		};
		row('Page', sourceLabel);
		row('Title', page.title || '(no title found)');
		row('Description', page.description || '(no meta description found)');
		if(page.h1.length) row('Main heading', page.h1.slice(0, 2).join(' · '));
		const stats = document.createElement('div');
		stats.className = 'kw-meta-stats';
		stats.textContent = wc.toLocaleString() + ' words · ' + page.h1.length + ' H1 · ' + page.h2.length + ' H2/H3 headings · ' + page.alts.length + ' image descriptions' +
			(page.lang && page.lang !== 'en' ? ' · page language: ' + page.lang : '');
		siteMeta.appendChild(stats);

		foundPhrases.innerHTML = foundWords.innerHTML = '';
		if(res.phrases.length) res.phrases.forEach((r) => foundPhrases.appendChild(chip(r)));
		else foundPhrases.innerHTML = '<span class="kw-none">No repeated phrases found. The page may have very little text.</span>';
		if(res.words.length) res.words.forEach((r) => foundWords.appendChild(chip(r)));
		else foundWords.innerHTML = '<span class="kw-none">No words found.</span>';
		siteResult.classList.remove('is-hidden');

		const best = res.phrases[0] || res.words[0];
		if(best) useKeyword(best.k);
		else {
			errBox.textContent = 'This page has too little text to find keywords. Try another page or paste its text.';
			errBox.classList.add('show');
		}
	}

	function useKeyword(k) {
		seedIn.value = k;
		siteResult.querySelectorAll('.kw-found button').forEach((b) => b.classList.toggle('used', b.dataset.kw === k));
		generate();
	}

	async function analyzeUrl() {
		errBox.classList.remove('show');
		const url = normaliseUrl(urlIn.value);
		if(!url) {
			errBox.textContent = 'Type a website link, for example https://crezialab.com';
			errBox.classList.add('show');
			urlIn.focus();
			return;
		}
		urlIn.value = url;
		analyzeBtn.disabled = true;
		analyzeBtn.lastElementChild.textContent = 'Reading…';
		statusEl.textContent = 'Reading ' + url + ' …';
		try {
			if(!window.MatteFetch) throw new Error('fetch-page.js is not loaded');
			const r = await MatteFetch.load(url, {
				onTry: (name) => (statusEl.textContent = 'Reading ' + url + (name === 'direct' ? ' …' : ' · trying ' + name + ' …'))
			});
			showSite(parsePage(r.text), url + (r.via !== 'direct' ? ' (read via ' + r.via + ')' : ''));
		} catch (e) {
			statusEl.textContent = 'Could not read that website';
			errBox.textContent = (e.status === 404 || e.status === 410 ?
				'This page was not found (error ' + e.status + '). Check the link.' :
				e.status ? 'The website answered with error ' + e.status + '. It may need a login or block automated visits.' :
				'This website could not be read. It may block other sites from reading it, or all the free reading services are busy right now. Try again in a minute, or use "Or paste the page\u2019s text or HTML source" below.') +
				(e.tried && e.tried.length ? ' [Tried: ' + e.tried.join(', ') + ']' : '');
			errBox.classList.add('show');
			pasteBox.classList.remove('is-hidden');
			if(window.console) console.warn('[SEO Keywords] ' + (e.message || e));
		} finally {
			analyzeBtn.disabled = false;
			analyzeBtn.lastElementChild.textContent = 'Analyze';
		}
	}

	analyzeBtn.addEventListener('click', analyzeUrl);
	urlIn.addEventListener('keydown', (e) => {
		if(e.key === 'Enter') analyzeUrl();
	});
	pasteToggle.addEventListener('click', () => {
		pasteBox.classList.toggle('is-hidden');
		if(!pasteBox.classList.contains('is-hidden')) pasteIn.focus();
	});
	pasteBtn.addEventListener('click', () => {
		errBox.classList.remove('show');
		if(pasteIn.value.trim().length < 30) {
			errBox.textContent = 'Paste the page source or at least a few sentences of its text.';
			errBox.classList.add('show');
			return;
		}
		showSite(parsePage(pasteIn.value), 'Pasted content');
	});
	siteResult.addEventListener('click', (e) => {
		const b = e.target.closest('.kw-found button');
		if(b) useKeyword(b.dataset.kw);
	});

	generate();
})();
