/* Shared font picker (all Google Fonts), same list and look as the Word editor. */
(function() {
	'use strict';
	window.FontPicker = { create: function(opts) {
	const SYSTEM_FONTS = [{
		name: 'Calibri',
		stack: 'Calibri, Carlito, "Segoe UI", sans-serif'
	}, {
		name: 'Arial',
		stack: 'Arial, Helvetica, sans-serif'
	}, {
		name: 'Times New Roman',
		stack: '"Times New Roman", Times, serif'
	}, {
		name: 'Georgia',
		stack: 'Georgia, serif'
	}, {
		name: 'Verdana',
		stack: 'Verdana, Geneva, sans-serif'
	}, {
		name: 'Tahoma',
		stack: 'Tahoma, Geneva, sans-serif'
	}, {
		name: 'Trebuchet MS',
		stack: '"Trebuchet MS", sans-serif'
	}, {
		name: 'Cambria',
		stack: 'Cambria, Caladea, Georgia, serif'
	}, {
		name: 'Garamond',
		stack: 'Garamond, "EB Garamond", serif'
	}, {
		name: 'Courier New',
		stack: '"Courier New", Courier, monospace'
	}];
	const GENERIC = {
		s: 'sans-serif',
		f: 'serif',
		d: 'sans-serif',
		h: 'cursive',
		m: 'monospace',
		system: 'sans-serif'
	};

	function cssName(n) {
		return encodeURIComponent(n).replace(/%20/g, '+');
	}

	function fontStackFor(f) {
		return f.stack || ('"' + f.name + '", ' + (GENERIC[f.cat] || 'sans-serif'));
	}

	function familyCssUrl(f) { 
		const t = [
			[0, f.regW]
		];
		if(f.boldW && f.boldW !== f.regW) t.push([0, f.boldW]);
		if(f.ir) t.push([1, f.regW]);
		if(f.ib && f.boldW) t.push([1, f.boldW]);
		t.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		let spec = '';
		if(t.some((x) => x[0] === 1)) spec = ':ital,wght@' + t.map((x) => x[0] + ',' + x[1]).join(';');
		else if(t.length > 1) spec = ':wght@' + t.map((x) => x[1]).join(';');
		return 'https://fonts.googleapis.com/css2?family=' + cssName(f.name) + spec + '&display=swap';
	}

	function previewCssUrl(names) { 
		const chars = Array.from(new Set(names.join('').split(''))).join('');
		return 'https://fonts.googleapis.com/css2?' + names.map((n) => 'family=' + cssName(n)).join('&') + '&text=' + encodeURIComponent(chars) + '&display=swap';
	}

	function aliasPreviewCss(css) {
		return css.replace(/font-family:\s*(['"]?)([^;'"]+)\1\s*;/g, (m, q, n) => 'font-family: "mp ' + n.trim() + '";');
	}

	function searchFonts(list, query, cat) {
		const q = (query || '').trim().toLowerCase();
		const arr = (cat && cat !== 'all') ? list.filter((f) => f.cat === cat) : list;
		if(!q) return arr;
		const qs = q.replace(/\s+/g, '');
		const starts = [],
			inside = [];
		for(const f of arr) {
			const n = f.name.toLowerCase(),
				ns = n.replace(/\s+/g, '');
			if(n.startsWith(q) || ns.startsWith(qs)) starts.push(f);
			else if(n.indexOf(q) !== -1 || ns.indexOf(qs) !== -1) inside.push(f);
		}
		return starts.concat(inside);
	}

	const CATALOG = SYSTEM_FONTS.map((x) => ({
		name: x.name,
		cat: 'system',
		stack: x.stack,
		google: false
	})).concat((window.GOOGLE_FONTS || []).map((r) => ({
		name: r[0],
		cat: r[1],
		regW: r[2],
		boldW: r[3],
		ir: !!r[4],
		ib: !!r[5],
		google: true
	})));

	const famByName = new Map(CATALOG.map((f) => [f.name, f]));
	const familyLoads = new Map();

	function loadFamily(f) {
		if(familyLoads.has(f.name)) return familyLoads.get(f.name);
		const p = new Promise((resolve, reject) => {
			const link = document.createElement('link');
			link.rel = 'stylesheet';
			link.href = familyCssUrl(f);
			link.onload = () => resolve();
			link.onerror = () => {
				link.remove();
				reject(new Error('Could not load ' + f.name));
			};
			document.head.appendChild(link);
		});
		familyLoads.set(f.name, p);
		p.catch(() => familyLoads.delete(f.name)); // so it can be retried
		return p;
	}

	const FP = {
		btn: opts.btn,
		cur: opts.cur,
		pop: opts.pop,
		search: opts.search,
		cats: opts.cats,
		list: opts.list,
		count: opts.count
	};

	const picker = {
		cat: 'all',
		query: '',
		matches: [],
		rendered: 0,
		hi: -1,
		open: false
	};

	const RENDER_STEP = 120,
		PREVIEW_BATCH = 24;
	const CAT_LABEL = {
		s: 'Sans',
		f: 'Serif',
		d: 'Display',
		h: 'Handwriting',
		m: 'Mono',
		system: 'Word'
	};

	const preview = {
		asked: new Set(),
		queue: [],
		timer: 0,
		io: null
	};

	FP.search.placeholder = 'Search ' + CATALOG.length.toLocaleString() + ' fonts…';

	function previewStack(f) {
		return '"mp ' + f.name + '", ' + (GENERIC[f.cat] || 'sans-serif');
	}

	function watchPreview(el, f) {
		const nameEl = el.firstChild;
		if(!f.google) {
			nameEl.style.fontFamily = fontStackFor(f);
			return;
		}
		if(preview.asked.has(f.name)) {
			nameEl.style.fontFamily = previewStack(f);
			return;
		}
		if(!('IntersectionObserver' in window)) return;
		if(!preview.io) preview.io = new IntersectionObserver(onPreviewSeen, {
			root: FP.list,
			rootMargin: '160px'
		});
		preview.io.observe(el);
	}

	function onPreviewSeen(entries) {
		let queued = false;
		for(const en of entries) {
			if(!en.isIntersecting) continue;
			const el = en.target;
			preview.io.unobserve(el);
			const f = famByName.get(el.dataset.name);
			if(!f) continue;
			el.firstChild.style.fontFamily = previewStack(f);
			if(!preview.asked.has(f.name)) {
				preview.asked.add(f.name);
				preview.queue.push(f.name);
				queued = true;
			}
		}
		if(queued && !preview.timer) preview.timer = setTimeout(flushPreviews, 120);
	}

	async function flushPreviews() {
		preview.timer = 0;
		while(preview.queue.length) {
			const batch = preview.queue.splice(0, PREVIEW_BATCH);
			try {
				const res = await fetch(previewCssUrl(batch));
				if(!res.ok) continue;
				const style = document.createElement('style');
				style.textContent = aliasPreviewCss(await res.text());
				document.head.appendChild(style);
			} catch(e) { /* previews are optional */ }
		}
	}

	function renderFontItems(reset) {
		if(reset) {
			if(preview.io) preview.io.disconnect();
			FP.list.textContent = '';
			picker.rendered = 0;
			picker.hi = -1;
			FP.list.scrollTop = 0;
		}
		const end = Math.min(picker.matches.length, picker.rendered + RENDER_STEP);
		const cur = FP.cur.textContent;
		const frag = document.createDocumentFragment();
		for(let i = picker.rendered; i < end; i++) {
			const f = picker.matches[i];
			const el = document.createElement('div');
			el.className = 'ed-fontitem' + (f.name === cur ? ' is-current' : '');
			el.setAttribute('role', 'option');
			el.dataset.name = f.name;
			const nm = document.createElement('span');
			nm.className = 'ed-fontname';
			nm.textContent = f.name;
			const ct = document.createElement('span');
			ct.className = 'ed-fontcat';
			ct.textContent = CAT_LABEL[f.cat] || '';
			el.appendChild(nm);
			el.appendChild(ct);
			frag.appendChild(el);
		}
		FP.list.appendChild(frag);
		for(let i = picker.rendered; i < end; i++) watchPreview(FP.list.children[i], picker.matches[i]);
		picker.rendered = end;
		const n = picker.matches.length;
		FP.count.textContent = n ? n.toLocaleString() + (n === 1 ? ' font' : ' fonts') : 'No fonts match';
	}

	function runSearch() {
		picker.matches = searchFonts(CATALOG, picker.query, picker.cat);
		renderFontItems(true);
	}

	function setHighlight(i) {
		if(!picker.matches.length) return;
		i = Math.max(0, Math.min(picker.matches.length - 1, i));
		while(picker.rendered <= i) renderFontItems(false);
		const rows = FP.list.children;
		if(picker.hi >= 0 && rows[picker.hi]) rows[picker.hi].classList.remove('is-hi');
		picker.hi = i;
		rows[i].classList.add('is-hi');
		if(rows[i].scrollIntoView) rows[i].scrollIntoView({
			block: 'nearest'
		});
	}

	let openFontPicker = function() {
		picker.open = true;
		FP.pop.classList.remove('is-hidden');
		FP.btn.setAttribute('aria-expanded', 'true');
		picker.query = '';
		picker.cat = 'all';
		FP.search.value = '';
		FP.cats.querySelectorAll('.ed-chip').forEach((c) => c.classList.toggle('is-active', c.dataset.cat === 'all'));
		runSearch();
		const idx = picker.matches.findIndex((f) => f.name === FP.cur.textContent);
		if(idx >= 0) {
			while(picker.rendered <= idx) renderFontItems(false);
			const row = FP.list.children[idx];
			if(row && row.scrollIntoView) row.scrollIntoView({
				block: 'center'
			});
		}
		FP.search.focus();
	};

	function closeFontPicker() {
		picker.open = false;
		FP.pop.classList.add('is-hidden');
		FP.btn.setAttribute('aria-expanded', 'false');
	}

	function pickFont(name) {
		closeFontPicker();
		FP.cur.textContent = name;
		opts.onPick(name);
	}

	FP.btn.addEventListener('click', () => {
		if(picker.open) closeFontPicker();
		else openFontPicker();
	});

	FP.search.addEventListener('input', () => {
		picker.query = FP.search.value;
		runSearch();
	});

	FP.search.addEventListener('keydown', (e) => {
		if(e.key === 'ArrowDown') {
			e.preventDefault();
			setHighlight(picker.hi + 1);
		} else if(e.key === 'ArrowUp') {
			e.preventDefault();
			setHighlight(picker.hi - 1);
		} else if(e.key === 'Enter') {
			e.preventDefault();
			const f = picker.matches[picker.hi >= 0 ? picker.hi : 0];
			if(f) pickFont(f.name);
		} else if(e.key === 'Escape') {
			e.preventDefault();
			closeFontPicker();
			if(opts.onClose) opts.onClose();
		}
	});

	FP.cats.addEventListener('click', (e) => {
		const chip = e.target.closest('.ed-chip');
		if(!chip) return;
		picker.cat = chip.dataset.cat;
		FP.cats.querySelectorAll('.ed-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
		runSearch();
	});

	FP.list.addEventListener('click', (e) => {
		const row = e.target.closest('.ed-fontitem');
		if(row) pickFont(row.dataset.name);
	});

	FP.list.addEventListener('scroll', () => {
		if(picker.rendered < picker.matches.length && FP.list.scrollTop + FP.list.clientHeight >= FP.list.scrollHeight - 120) renderFontItems(false);
	});

	function place() {
		const r = FP.btn.getBoundingClientRect();
		FP.pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 330)) + 'px';
		FP.pop.style.top = (r.bottom + 6) + 'px';
	}
	const openOrig = openFontPicker;
	openFontPicker = function() { place(); openOrig(); };
	document.addEventListener('click', (e) => {
		if(picker.open && !FP.pop.contains(e.target) && !FP.btn.contains(e.target)) closeFontPicker();
	});
	window.addEventListener('resize', () => { if(picker.open) place(); });
	return { setCurrent: (n) => { FP.cur.textContent = n; }, close: closeFontPicker, family: (n) => famByName.get(n) };
	} };
})();