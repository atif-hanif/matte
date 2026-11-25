/*
 * Matte — read a web page and work out what it is about.
 * Needs fetch-page.js (MatteFetch) to be loaded first.
 *
 * Usage: MatteAnalyze.fromUrl(url).then((info) => …)
 *   info = { url, via, title, description, h1, headings, siteName, brand, keyword,
 *            phrases, benefits, location, type, audience, lang, words }
 */
(function() {
	'use strict';

	const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves ' +
		'also get got may might must shall us via etc per within without across upon among around whether either neither yet ever every much many one two three new use used using make makes made like just well way ways need needs know see ' +
		'home page menu click here read learn contact call email phone copyright rights reserved privacy policy terms cookies cookie related view more login sign signup log submit search skip content toggle navigation close open next previous back top details share follow facebook twitter instagram linkedin youtube tiktok whatsapp www http https com net org html amp nbsp welcome').split(' '));

	// headings that say nothing about the offer
	const GENERIC_HEADING = /^(home|about( us)?|contact( us)?|our (services|work|team|clients|blog|story|mission)|services|blog|faq|faqs|testimonials?|reviews?|get in touch|let'?s talk|why (choose )?us|how it works|latest (news|posts)|pricing|portfolio|follow us|newsletter|subscribe|quick links|useful links|menu|search|categories|recent posts|related (posts|tools)|share|tags?)\b/i;

	function words(text) {
		return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'&+-]*/gu) || [])
			.map((w) => w.replace(/^'+|'+$/g, '').replace(/'s$/, ''))
			.filter(Boolean);
	}

	function parse(src, url) {
		const looksHtml = /<\s*(html|head|body|title|meta|div|p|h1)\b/i.test(src);
		const doc = new DOMParser().parseFromString(looksHtml ? src : '<body><p>' + src.replace(/</g, '&lt;').replace(/\n{2,}/g, '</p><p>') + '</p></body>', 'text/html');

		// structured data (JSON-LD) often names the business, its type and its city
		const ld = [];
		doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
			try {
				const data = JSON.parse(s.textContent);
				const walk = (o) => {
					if(Array.isArray(o)) o.forEach(walk);
					else if(o && typeof o === 'object') {
						ld.push(o);
						if(o['@graph']) walk(o['@graph']);
					}
				};
				walk(data);
			} catch (e) {}
		});

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
			siteName: meta('meta[property="og:site_name"]') || meta('meta[name="application-name"]'),
			ogType: meta('meta[property="og:type"]'),
			h1: texts('h1'),
			h2: texts('h2, h3'),
			alts: [...doc.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt').trim()).filter(Boolean),
			lang: (doc.documentElement.getAttribute('lang') || '').slice(0, 2),
			ld,
			url
		};
		const mainEl = doc.querySelector('main, article, [role=main]') || doc.body;
		if(mainEl) {
			[...mainEl.querySelectorAll('nav, header, footer')].forEach((n) => n.remove());
			mainEl.querySelectorAll('p, div, li, td, th, h1, h2, h3, h4, h5, h6, a, button, label, figcaption, blockquote, dt, dd, br').forEach((n) => n.append(doc.createTextNode('. ')));
		}
		page.body = mainEl ? mainEl.textContent.replace(/\s+/g, ' ').trim() : '';
		return page;
	}

	function score(page, exclude) {
		const scores = new Map(),
			counts = new Map(),
			best = new Map();
		const MIDDLE_OK = new Set(['for', 'of', 'in', 'near', 'with', 'to']);
		const bump = (map, k, v) => map.set(k, (map.get(k) || 0) + v);
		function feed(text, weight) {
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

		const ex = exclude.filter(Boolean).map((s) => s.toLowerCase());
		const isBrand = (k) => ex.some((b) => b && (b.includes(k) || k.includes(b)));
		const rows = [...scores.entries()].map(([k, s]) => ({ k, s, c: counts.get(k), n: k.split(' ').length, w: best.get(k) })).filter((r) => !isBrand(r.k));
		const phrases = rows.filter((r) => r.n > 1 && (r.c > 1 || r.w >= 5)).sort((a, b) => b.s - a.s);
		const keep = [];
		phrases.forEach((r) => {
			if(keep.some((x) => x.k.includes(r.k) && x.s >= r.s * 0.8)) return;
			keep.push(r);
		});
		const singles = rows.filter((r) => r.n === 1 && r.k.length > 2).sort((a, b) => b.s - a.s);
		return { phrases: keep.slice(0, 18), words: singles.slice(0, 15) };
	}

	function hostName(url) {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch (e) {
			return '';
		}
	}

	function guessBrand(page) {
		return guessBrandRaw(page).replace(/\s+(blog|news|journal|store|shop|official site|official website|home)$/i, '').trim();
	}

	function guessBrandRaw(page) {
		if(page.siteName) return page.siteName;
		const org = page.ld.find((o) => /Organization|LocalBusiness|WebSite|Store|Corporation/i.test([].concat(o['@type'] || []).join(' ')) && typeof o.name === 'string');
		if(org) return org.name.trim();
		// "Page name | Brand" or "Brand – tagline": the short part is usually the brand
		const parts = page.title.split(/\s+[|–—·•:]\s+|\s+-\s+/).map((s) => s.trim()).filter(Boolean);
		if(parts.length > 1) {
			const host = hostName(page.url).split('.')[0].replace(/[^a-z0-9]/g, '');
			const match = parts.find((p) => p.toLowerCase().replace(/[^a-z0-9]/g, '').includes(host) || host.includes(p.toLowerCase().replace(/[^a-z0-9]/g, '')));
			if(match && match.length <= 40) return match;
			const last = parts[parts.length - 1];
			if(last.length <= 30) return last;
		}
		const host = hostName(page.url).split('.')[0];
		return host ? host.charAt(0).toUpperCase() + host.slice(1) : '';
	}

	function guessLocation(page) {
		for(const o of page.ld) {
			const a = o.address || (o.location && o.location.address);
			if(a && typeof a === 'object' && a.addressLocality) return String(a.addressLocality).trim();
			if(o.areaServed && typeof o.areaServed === 'string') return o.areaServed.trim();
		}
		// "… in Karachi" in the title, description or main heading
		const m = (page.title + ' . ' + page.description + ' . ' + page.h1.join(' . ')).match(/\b(?:in|near|based in|serving)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)\b/);
		if(m && !/^(The|Our|Your|Every|All|One|Minutes|Seconds|Business|Style|Stock)$/.test(m[1])) return m[1];
		return '';
	}

	function guessType(page) {
		let path = '/';
		try {
			path = new URL(page.url).pathname.toLowerCase();
		} catch (e) {}
		const types = page.ld.map((o) => [].concat(o['@type'] || []).join(' ')).join(' ');
		if(/Product/.test(types) || /\/(product|products|item|p)\//.test(path)) return 'product';
		if(/BlogPosting|Article|NewsArticle/.test(types) || page.ogType === 'article' || /\/(blog|news|article|articles|post|posts|guides?)\//.test(path)) return 'blog';
		if(/\/(shop|store|collections?|categor(y|ies)|product-category)\b/.test(path)) return 'category';
		if(/\/(about|about-us|contact|contact-us)\b/.test(path)) return 'about';
		if(/SoftwareApplication|WebApplication/.test(types) || /\b(online|free)\b.*\b(tool|generator|converter|calculator|checker|maker)\b/i.test(page.title)) return 'tool';
		if(/LocalBusiness|Restaurant|Store|Dentist|Physician|Plumber|Electrician|HomeAndConstructionBusiness/.test(types)) return 'local';
		if(path === '/' || /^\/(index\.(html?|php))?$/.test(path)) return 'home';
		return 'service';
	}

	function guessBenefits(page, keyword, brand, phrases) {
		const out = [];
		const seen = new Set();
		const add = (s) => {
			const t = s.replace(/[.:!?]+$/, '').replace(/\s+/g, ' ').trim();
			const low = t.toLowerCase();
			if(!t || t.length > 32 || t.split(' ').length > 4) return;
			if(GENERIC_HEADING.test(t)) return;
			if(keyword && (low === keyword || keyword.includes(low))) return;
			if(brand && low.includes(brand.toLowerCase())) return;
			if([...seen].some((x) => x.includes(low) || low.includes(x))) return;
			seen.add(low);
			// lower-case the first letter so it reads well mid-sentence, but keep SEO, UI/UX and the like
			out.push(/^[A-Z0-9]{2,}/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));
		};
		// short headings usually name services or features
		page.h2.forEach(add);
		phrases.forEach((p) => add(p.k));
		return out.slice(0, 4);
	}

	function analyze(html, url, via) {
		const page = parse(html, url);
		const brand = guessBrand(page);
		const host = hostName(url).split('.')[0];
		const res = score(page, [brand, guessBrandRaw(page), page.siteName, host]);
		let keyword = res.phrases[0] ? res.phrases[0].k : res.words[0] ? res.words[0].k : '';
		// "write meta descriptions" → "meta descriptions": a keyword is a topic, not an instruction
		const trimmed = keyword.replace(/^(how to |to )?(write|get|make|create|build|find|choose|learn|buy|start|improve|grow|boost|increase|use|hire|download|try|discover|explore|book|order)\s+/, '');
		if(trimmed.split(' ').length >= 2 || (trimmed !== keyword && trimmed.length > 3)) keyword = trimmed;
		return {
			url,
			via,
			title: page.title,
			description: page.description,
			h1: page.h1,
			headings: page.h2,
			siteName: page.siteName,
			brand,
			keyword,
			phrases: res.phrases.map((p) => p.k),
			benefits: guessBenefits(page, keyword, brand, res.phrases.slice(1)),
			location: guessLocation(page),
			type: guessType(page),
			lang: page.lang,
			words: words(page.body).length
		};
	}

	function normaliseUrl(v) {
		v = (v || '').trim();
		if(!v) return '';
		if(!/^https?:\/\//i.test(v)) v = 'https://' + v;
		try {
			const u = new URL(v);
			return /\./.test(u.hostname) ? u.href : '';
		} catch (e) {
			return '';
		}
	}

	async function fromUrl(url, opts) {
		if(!window.MatteFetch) throw new Error('fetch-page.js is not loaded');
		const r = await MatteFetch.load(url, opts);
		return analyze(r.text, url, r.via);
	}

	window.MatteAnalyze = { fromUrl, analyze, normaliseUrl };
})();
