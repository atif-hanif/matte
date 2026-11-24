/*
 * Matte — read another website's page from the browser.
 *
 * Most websites do not let other sites read them directly (CORS), so after a
 * direct try this goes through free public proxies, one after another, until
 * one answers. Free proxies go down and rate-limit often, which is why there
 * are several. Edit or reorder PROXIES below to change them.
 *
 * Usage: MatteFetch.load(url).then(({ text, via, finalUrl }) => …)
 */
(function() {
	'use strict';

	const PROXIES = [{
		name: 'allorigins',
		url: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)
	}, {
		name: 'codetabs',
		url: (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u)
	}, {
		name: 'allorigins-json',
		url: (u) => 'https://api.allorigins.win/get?url=' + encodeURIComponent(u),
		read: async (res) => {
			const data = await res.json();
			if(data && data.status && data.status.http_code >= 400) throw httpError(data.status.http_code);
			return data && data.contents;
		}
	}, {
		name: 'corsproxy',
		url: (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u)
	}, {
		// returns the page as text/markdown instead of HTML; turned back into simple HTML below
		name: 'jina',
		url: (u) => 'https://r.jina.ai/' + u,
		markdown: true
	}];

	let preferred = null; // the proxy that worked last time, tried first next time

	function httpError(status) {
		const e = new Error('HTTP ' + status);
		e.status = status;
		return e;
	}

	async function get(url, ms, read) {
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), ms);
		try {
			const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
			if(!res.ok) throw httpError(res.status);
			const text = read ? await read(res) : await res.text();
			return { text, res };
		} finally {
			clearTimeout(t);
		}
	}

	function esc(s) {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	// Jina returns "Title: …", "URL Source: …" then markdown. Turn it into basic HTML
	// so titles, headings and links can still be read.
	function markdownToHtml(md, pageUrl) {
		const titleMatch = md.match(/^Title:\s*(.+)$/m);
		const body = md.split(/^Markdown Content:\s*$/m).pop();
		const out = ['<html><head>'];
		if(titleMatch) out.push('<title>' + esc(titleMatch[1].trim()) + '</title>');
		out.push('</head><body><main>');
		body.split(/\r?\n/).forEach((line) => {
			const l = line.trim();
			if(!l) return;
			const linked = esc(l)
				.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
				.replace(/\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (m, text, href) => {
					let abs = href;
					try {
						abs = new URL(href.replace(/&amp;/g, '&'), pageUrl).href;
					} catch (e) {}
					return '<a href="' + esc(abs) + '">' + text + '</a>';
				});
			const h = l.match(/^(#{1,6})\s+/);
			if(h) out.push('<h' + h[1].length + '>' + linked.replace(/^#{1,6}\s+/, '') + '</h' + h[1].length + '>');
			else out.push('<p>' + linked.replace(/^[-*+]\s+/, '') + '</p>');
		});
		out.push('</main></body></html>');
		return out.join('\n');
	}

	function looksLikePage(text, markdown) {
		if(!text || text.trim().length < 15) return false;
		if(markdown) return /\S/.test(text);
		return /<(html|head|body|title|meta|div|p|a)\b/i.test(text);
	}

	/**
	 * @param {string} url
	 * @param {{ direct?: boolean, onTry?: (name: string) => void }} [opts]
	 */
	async function load(url, opts) {
		opts = opts || {};
		const tried = [];

		if(opts.direct !== false) {
			try {
				if(opts.onTry) opts.onTry('direct');
				const { text, res } = await get(url, 8000);
				const type = res.headers.get('content-type') || '';
				if(type && !/html|xml|text\/plain/i.test(type)) {
					const e = new Error('not a page');
					e.notHtml = true;
					throw e;
				}
				if(looksLikePage(text)) return { text, via: 'direct', finalUrl: res.url || url };
				tried.push('direct: empty');
			} catch (e) {
				// the site itself answered with an error, so a proxy will not help
				if(e.status || e.notHtml) throw e;
				tried.push('direct: blocked');
			}
		}

		const order = preferred ? [preferred].concat(PROXIES.filter((p) => p !== preferred)) : PROXIES;
		let siteStatus = 0;
		for(const p of order) {
			try {
				if(opts.onTry) opts.onTry(p.name);
				const { text } = await get(p.url(url), p.markdown ? 25000 : 15000, p.read);
				if(!looksLikePage(text, p.markdown)) {
					tried.push(p.name + ': empty');
					continue;
				}
				preferred = p;
				return { text: p.markdown ? markdownToHtml(text, url) : text, via: p.name, finalUrl: url };
			} catch (e) {
				if(e.status === 404 || e.status === 410) {
					siteStatus = e.status;
					// a proxy that worked before says the page is missing, so it really is
					if(p === preferred) {
						const missing = httpError(e.status);
						missing.tried = tried;
						throw missing;
					}
				}
				tried.push(p.name + ': ' + (e.status ? 'HTTP ' + e.status : e.name === 'AbortError' ? 'timed out' : 'failed'));
			}
		}
		const err = new Error('Could not read ' + url + ' (' + tried.join(', ') + ')');
		err.tried = tried;
		if(siteStatus) err.status = siteStatus;
		throw err;
	}

	window.MatteFetch = { load, PROXIES };
})();
