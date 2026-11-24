(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);

	// Pages are read with MatteFetch (assets/js/fetch-page.js): directly when the
	// site allows it, otherwise through a chain of public proxies.

	const FILE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|pdf|zip|rar|7z|gz|tar|mp4|m4v|mov|avi|webm|mkv|mp3|wav|ogg|m4a|docx?|xlsx?|pptx?|odt|ods|csv|txt|xml|json|rss|atom|css|js|mjs|map|woff2?|ttf|otf|eot|exe|dmg|apk|msi|iso)$/i;

	/* ---------- Elements ---------- */

	const modeBox = $('smMode'),
		optMax = $('smMax'),
		optFreq = $('smFreq'),
		optPriority = $('smPriority'),
		optLastmod = $('smLastmod'),
		urlIn = $('smUrl'),
		excludeIn = $('smExclude'),
		optNoQuery = $('smNoQuery'),
		optRespect = $('smRespect'),
		listIn = $('smList'),
		listInfo = $('smListInfo');
	const startBtn = $('smStartBtn'),
		clearBtn = $('smClearBtn'),
		copyBtn = $('smCopyBtn'),
		txtBtn = $('smTxtBtn'),
		dlBtn = $('smDownloadBtn');
	const errBox = $('smErr'),
		statusEl = $('smStatus'),
		countEl = $('smCount'),
		sizeEl = $('smSize'),
		urlsEl = $('smUrls'),
		xmlEl = $('smXml'),
		progress = $('smProgress'),
		bar = $('smBar'),
		progText = $('smProgText');

	let mode = 'crawl',
		pages = new Map(), // url -> { url, depth, state: queued|ok|skip|error, note }
		removed = new Set(),
		running = false,
		stopRequested = false,
		useProxy = false,
		via = '',
		origin = '',
		hostKey = '';

	/* ---------- URLs ---------- */

	function hostOf(h) {
		return h.toLowerCase().replace(/^www\./, '');
	}

	function normalise(raw, base) {
		let u;
		try {
			u = new URL(raw, base);
		} catch (e) {
			return null;
		}
		if(!/^https?:$/.test(u.protocol)) return null;
		u.hash = '';
		u.hostname = u.hostname.toLowerCase();
		if((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
		// drop tracking parameters
		[...u.searchParams.keys()].forEach((k) => {
			if(/^(utm_|fbclid$|gclid$|mc_|ref$)/i.test(k)) u.searchParams.delete(k);
		});
		if(!u.pathname) u.pathname = '/';
		// /index.html and / are the same page, so list it once
		u.pathname = u.pathname.replace(/\/index\.(html?|php)$/i, '/');
		return u;
	}

	function siteUrl(u) {
		// keep every link on the same host spelling as the start page (www or not)
		const s = new URL(u.href);
		s.protocol = new URL(origin).protocol;
		s.hostname = new URL(origin).hostname;
		return s.href;
	}

	function skipReason(u) {
		if(hostOf(u.hostname) !== hostKey) return 'other site';
		if(FILE_EXT.test(u.pathname)) return 'file';
		if(optNoQuery.checked && u.search) return 'has ?';
		const ex = excludeIn.value.split(',').map((s) => s.trim()).filter(Boolean);
		const path = u.pathname + u.search;
		if(ex.some((e) => path.includes(e))) return 'skipped by you';
		return '';
	}

	function depthOf(url) {
		return new URL(url).pathname.split('/').filter(Boolean).length;
	}

	/* ---------- Fetching ---------- */

	async function load(url) {
		if(!window.MatteFetch) throw new Error('fetch-page.js is not loaded');
		// once the site has blocked direct reading, skip that step for the other pages
		const r = await MatteFetch.load(url, { direct: !useProxy });
		if(r.via !== 'direct') {
			useProxy = true;
			via = r.via;
		}
		return { text: r.text, finalUrl: r.via === 'direct' ? r.finalUrl : url };
	}

	/* ---------- Crawl ---------- */

	function setPage(url, data) {
		const p = pages.get(url) || { url };
		Object.assign(p, data);
		pages.set(url, p);
		return p;
	}

	function okCount() {
		return [...pages.values()].filter((p) => p.state === 'ok' && !removed.has(p.url)).length;
	}

	async function crawlOne(p, max) {
		let res;
		try {
			res = await load(p.url);
		} catch (e) {
			setPage(p.url, { state: 'error', note: e.status ? 'error ' + e.status : e.notHtml ? 'not a page' : 'could not load' });
			if(p.depth === 0 && e.tried) firstError = e.tried.join(', ');
			return;
		}
		const html = res.text || '';
		if(!/<html|<body|<a\s/i.test(html)) {
			setPage(p.url, { state: 'error', note: 'not a page' });
			return;
		}
		// followed a redirect to another address
		if(res.finalUrl && res.finalUrl !== p.url) {
			const f = normalise(res.finalUrl);
			if(f && hostOf(f.hostname) === hostKey && siteUrl(f) !== p.url) {
				setPage(p.url, { state: 'skip', note: 'redirects' });
				enqueue(siteUrl(f), p.depth, max);
				return;
			}
		}
		const doc = new DOMParser().parseFromString(html, 'text/html');
		const baseEl = doc.querySelector('base[href]');
		const base = baseEl ? new URL(baseEl.getAttribute('href'), p.url).href : p.url;

		const robots = [...doc.querySelectorAll('meta[name="robots" i], meta[name="googlebot" i]')].map((m) => (m.getAttribute('content') || '').toLowerCase()).join(',');
		const canonEl = doc.querySelector('link[rel="canonical" i][href]');
		const canon = canonEl ? normalise(canonEl.getAttribute('href'), base) : null;

		// follow links even from noindex pages, so pages behind them are still found
		doc.querySelectorAll('a[href], area[href]').forEach((a) => {
			const href = a.getAttribute('href');
			if(!href || /^(mailto|tel|javascript|sms|whatsapp):/i.test(href.trim())) return;
			const u = normalise(href, base);
			if(!u) return;
			const why = skipReason(u);
			if(why) {
				if(why !== 'other site' && why !== 'file') {
					const key = hostOf(u.hostname) === hostKey ? siteUrl(u) : u.href;
					if(!pages.has(key)) setPage(key, { depth: p.depth + 1, state: 'skip', note: why });
				}
				return;
			}
			enqueue(siteUrl(u), p.depth + 1, max);
		});

		if(optRespect.checked && /noindex/.test(robots)) {
			setPage(p.url, { state: 'skip', note: 'noindex' });
			return;
		}
		if(canon && hostOf(canon.hostname) === hostKey && siteUrl(canon) !== p.url) {
			setPage(p.url, { state: 'skip', note: 'canonical elsewhere' });
			enqueue(siteUrl(canon), p.depth, max);
			return;
		}
		setPage(p.url, { state: 'ok', note: '' });
	}

	let queue = [],
		firstError = '';

	function enqueue(url, depth, max) {
		const existing = pages.get(url);
		if(existing) {
			// a "skipped" entry for the same page found via a filtered link should not block it
			if(existing.state !== 'skip' || existing.note === 'noindex' || existing.note === 'canonical elsewhere' || existing.note === 'redirects') return;
		}
		const planned = [...pages.values()].filter((p) => p.state === 'queued' || p.state === 'loading' || p.state === 'ok').length;
		if(planned >= max) return;
		setPage(url, { depth, state: 'queued', note: '' });
		queue.push(url);
	}

	async function crawl() {
		clearError();
		const raw = urlIn.value.trim();
		const start = normalise(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
		if(!raw || !start || !/\./.test(start.hostname)) {
			showError('Type your website link, for example https://example.com');
			urlIn.focus();
			return;
		}
		urlIn.value = start.href;
		origin = start.origin;
		hostKey = hostOf(start.hostname);
		pages = new Map();
		removed = new Set();
		queue = [];
		firstError = '';
		useProxy = false;
		via = '';
		stopRequested = false;
		running = true;
		setRunning(true);

		const max = +optMax.value;
		enqueue(start.href, 0, max);
		const started = performance.now();
		let lastPaint = 0;

		async function worker() {
			while(queue.length && !stopRequested) {
				const url = queue.shift();
				const p = pages.get(url);
				if(!p || p.state !== 'queued') continue;
				p.state = 'loading';
				await crawlOne(p, max);
				if(performance.now() - lastPaint > 250) {
					lastPaint = performance.now();
					paintProgress(url, max);
				}
				if(useProxy) await new Promise((r) => setTimeout(r, 250)); // be gentle with the free proxy
			}
		}

		// read the start page on its own first, to find out whether the site can be read directly
		const first = pages.get(queue.shift());
		first.state = 'loading';
		await crawlOne(first, max);
		paintProgress(first.url, max);
		while(queue.length && !stopRequested) {
			await Promise.all(Array.from({ length: useProxy ? 2 : 4 }, worker));
		}

		running = false;
		setRunning(false);
		const ok = okCount();
		const errors = [...pages.values()].filter((p) => p.state === 'error').length;
		paintProgress('', max, true);
		render();
		if(!ok) {
			const first = pages.get(start.href);
			showError('No pages could be read from this website' + (first && first.note ? ' (' + first.note + ')' : '') + '. It may block other sites from reading it, the free reading services may be busy (try again in a minute), or it builds its links with JavaScript. You can also switch to "Paste links" and paste your page links.' + (firstError ? ' [Tried: ' + firstError + ']' : ''));
			statusEl.textContent = 'Could not crawl the website';
			return;
		}
		statusEl.textContent = (stopRequested ? 'Stopped · ' : '') + ok + ' page' + (ok === 1 ? '' : 's') + ' in your sitemap' +
			(errors ? ' · ' + errors + ' could not load' : '') + ' · ' + ((performance.now() - started) / 1000).toFixed(1) + ' s' +
			(useProxy ? ' · read through ' + (via || 'a proxy') : '') +
			(ok >= max ? ' · page limit reached' : '');
	}

	function paintProgress(url, max, done) {
		const ok = okCount();
		const all = [...pages.values()];
		const queued = all.filter((p) => p.state === 'queued' || p.state === 'loading').length;
		const total = Math.min(max, ok + queued) || 1;
		bar.style.width = (done ? 100 : Math.min(98, (ok / total) * 100)) + '%';
		bar.classList.toggle('done', !!done);
		progText.textContent = done ? 'Finished · ' + ok + ' pages found' : 'Found ' + ok + ' pages · ' + queued + ' waiting · ' + url.replace(origin, '');
		countEl.textContent = ok + ' pages';
		render();
	}

	function setRunning(on) {
		startBtn.classList.toggle('btn-primary', !on);
		startBtn.classList.toggle('btn-secondary', on);
		startBtn.innerHTML = on ? '<i class="fa-solid fa-stop me-2"></i><span>Stop</span>' : '<i class="fa-solid fa-play me-2"></i><span>Start</span>';
		progress.classList.remove('is-hidden');
		[optMax, urlIn, excludeIn, optNoQuery, optRespect].forEach((el) => (el.disabled = on));
		if(on) {
			bar.style.width = '2%';
			bar.classList.remove('done');
			progText.textContent = 'Reading ' + urlIn.value + ' …';
			statusEl.textContent = 'Crawling your website…';
		}
	}

	/* ---------- Paste links ---------- */

	function fromList() {
		clearError();
		const lines = listIn.value.split(/[\r\n,\s]+/).map((s) => s.trim()).filter(Boolean);
		pages = new Map();
		let bad = 0,
			hosts = new Set();
		lines.forEach((l) => {
			const u = normalise(/^https?:\/\//i.test(l) ? l : 'https://' + l);
			if(!u || !/\./.test(u.hostname)) {
				bad++;
				return;
			}
			hosts.add(u.hostname);
			if(!pages.has(u.href)) pages.set(u.href, { url: u.href, depth: depthOf(u.href), state: 'ok', note: '' });
		});
		const first = pages.values().next().value;
		origin = first ? new URL(first.url).origin : '';
		listInfo.textContent = lines.length ? pages.size + ' unique links' + (bad ? ' · ' + bad + ' not valid' : '') +
			(hosts.size > 1 ? ' · links from ' + hosts.size + ' different domains: a sitemap should only list pages from its own domain' : '') : '';
		render();
		const ok = okCount();
		statusEl.textContent = ok ? ok + ' page' + (ok === 1 ? '' : 's') + ' in your sitemap' : 'Paste your page links, one per line';
		countEl.textContent = ok ? ok + ' pages' : '';
	}

	/* ---------- Output ---------- */

	function xmlEscape(s) {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
	}

	function priorityFor(p) {
		if(optPriority.value === 'auto') {
			const d = mode === 'crawl' ? p.depth : depthOf(p.url);
			return ['1.0', '0.8', '0.6'][d] || '0.5';
		}
		return optPriority.value;
	}

	function includedPages() {
		const list = [...pages.values()].filter((p) => p.state === 'ok' && !removed.has(p.url));
		return list.sort((a, b) => (mode === 'crawl' ? a.depth - b.depth : 0) || (mode === 'crawl' ? a.url.localeCompare(b.url) : 0));
	}

	function buildXml(list) {
		const today = new Date().toISOString().slice(0, 10);
		const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
		list.forEach((p) => {
			out.push('  <url>');
			out.push('    <loc>' + xmlEscape(p.url) + '</loc>');
			if(optLastmod.value === 'today') out.push('    <lastmod>' + today + '</lastmod>');
			if(optFreq.value) out.push('    <changefreq>' + optFreq.value + '</changefreq>');
			const pr = priorityFor(p);
			if(pr) out.push('    <priority>' + pr + '</priority>');
			out.push('  </url>');
		});
		out.push('</urlset>');
		return out.join('\n') + '\n';
	}

	function render() {
		const list = includedPages();
		const xml = list.length ? buildXml(list) : '';
		xmlEl.value = xml;
		sizeEl.textContent = xml ? list.length + ' URLs · ' + (new Blob([xml]).size / 1024).toFixed(1) + ' KB' : '';
		copyBtn.disabled = txtBtn.disabled = dlBtn.disabled = !list.length;

		const site = origin || 'https://example.com';
		$('smWhere').textContent = site + '/sitemap.xml';
		$('smRobots').textContent = 'Sitemap: ' + site + '/sitemap.xml';

		urlsEl.innerHTML = '';
		const all = [...pages.values()];
		if(!all.length) {
			urlsEl.innerHTML = '<li class="sm-empty">The pages found appear here</li>';
			return;
		}
		const order = { ok: 0, loading: 1, queued: 2, skip: 3, error: 4 };
		all.sort((a, b) => order[a.state] - order[b.state] || (a.depth || 0) - (b.depth || 0));
		const frag = document.createDocumentFragment();
		all.slice(0, 800).forEach((p) => {
			const li = document.createElement('li');
			const isRemoved = removed.has(p.url);
			if(p.state !== 'ok' || isRemoved) li.className = 'skipped';
			const u = document.createElement('span');
			u.className = 'sm-u';
			u.textContent = origin && p.url.startsWith(origin) ? p.url.slice(origin.length) || '/' : p.url;
			u.title = p.url;
			li.appendChild(u);
			const tag = document.createElement('span');
			tag.className = 'sm-tag' + (p.state === 'error' ? ' err' : p.state === 'skip' || isRemoved ? ' skip' : '');
			tag.textContent = isRemoved ? 'removed' : p.state === 'ok' ? priorityFor(p) || 'ok' : p.state === 'queued' ? 'waiting' : p.state === 'loading' ? 'reading…' : p.note;
			li.appendChild(tag);
			if(p.state === 'ok') {
				const x = document.createElement('button');
				x.type = 'button';
				x.className = 'sm-x';
				x.dataset.url = p.url;
				x.title = isRemoved ? 'Add back to the sitemap' : 'Remove from the sitemap';
				x.innerHTML = isRemoved ? '<i class="fa-solid fa-rotate-left"></i>' : '<i class="fa-solid fa-xmark"></i>';
				li.appendChild(x);
			}
			frag.appendChild(li);
		});
		urlsEl.appendChild(frag);
	}

	/* ---------- Helpers ---------- */

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function save(text, name, type) {
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([text], { type }));
		a.download = name;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
		if(!ok) showError('Your browser blocked copying. Use Download instead.');
		return ok;
	}

	/* ---------- Events ---------- */

	modeBox.addEventListener('click', (e) => {
		const btn = e.target.closest('.mode-btn');
		if(!btn || btn.dataset.mode === mode || running) return;
		modeBox.querySelectorAll('.mode-btn').forEach((b) => b.classList.toggle('active', b === btn));
		mode = btn.dataset.mode;
		document.querySelectorAll('[data-for]').forEach((g) => g.classList.toggle('is-hidden', g.dataset.for !== mode));
		clearError();
		const carried = includedPages().map((p) => p.url);
		pages = new Map();
		removed = new Set();
		origin = '';
		countEl.textContent = '';
		if(mode === 'list') {
			if(!listIn.value.trim() && carried.length) listIn.value = carried.join('\n');
			// carry the crawled links over so they can be edited by hand
			fromList();
			listIn.focus();
		} else {
			statusEl.textContent = 'Enter your website and press Start';
			render();
		}
	});

	startBtn.addEventListener('click', () => {
		if(running) {
			stopRequested = true;
			startBtn.disabled = true;
			setTimeout(() => (startBtn.disabled = false), 400);
			statusEl.textContent = 'Stopping…';
		} else crawl();
	});
	urlIn.addEventListener('keydown', (e) => {
		if(e.key === 'Enter' && !running) crawl();
	});

	let typing = null;
	listIn.addEventListener('input', () => {
		clearTimeout(typing);
		typing = setTimeout(fromList, 250);
	});

	[optFreq, optPriority, optLastmod].forEach((el) => el.addEventListener('change', render));

	urlsEl.addEventListener('click', (e) => {
		const x = e.target.closest('.sm-x');
		if(!x) return;
		const u = x.dataset.url;
		if(removed.has(u)) removed.delete(u);
		else removed.add(u);
		render();
		const ok = okCount();
		countEl.textContent = ok + ' pages';
		statusEl.textContent = ok + ' page' + (ok === 1 ? '' : 's') + ' in your sitemap';
	});

	copyBtn.addEventListener('click', () => xmlEl.value && copyText(xmlEl.value, 'Sitemap copied'));
	dlBtn.addEventListener('click', () => xmlEl.value && save(xmlEl.value, 'sitemap.xml', 'application/xml'));
	txtBtn.addEventListener('click', () => {
		const list = includedPages();
		if(list.length) save(list.map((p) => p.url).join('\n') + '\n', 'urls.txt', 'text/plain');
	});

	clearBtn.addEventListener('click', () => {
		if(running) stopRequested = true;
		pages = new Map();
		removed = new Set();
		origin = '';
		urlIn.value = listIn.value = '';
		listInfo.textContent = '';
		countEl.textContent = '';
		progress.classList.add('is-hidden');
		clearError();
		render();
		statusEl.textContent = mode === 'crawl' ? 'Enter your website and press Start' : 'Paste your page links, one per line';
		(mode === 'crawl' ? urlIn : listIn).focus();
	});

	render();
})();
