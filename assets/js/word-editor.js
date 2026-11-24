(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const doc = $('weDoc'),
		nameEl = $('weName'),
		statusEl = $('weStatus'),
		countEl = $('weCount'),
		errBox = $('weErr');
	const fileInput = $('weFileInput'),
		imgInput = $('weImgInput'),
		pageSizeEl = $('wePageSize');
	const blockSel = $('weBlock'),
		sizeSel = $('weSize'),
		colorEl = $('weColor');
	const tablePop = $('weTablePop'),
		findBar = $('weFindBar'),
		tableTools = $('weTableTools'),
		imageTools = $('weImageTools');
	let dirty = false,
		saved = null,
		selImg = null;
	if(!window.mammoth || !window.JSZip) showError('A needed library did not load. Check assets/vendors/ (jszip, mammoth).');
	
	try {
		document.execCommand('defaultParagraphSeparator', false, 'p');
	} catch(e) { /* ignore */ }

	function showError(msg) {
		errBox.textContent = msg;
		errBox.classList.add('show');
	}

	function clearError() {
		errBox.classList.remove('show');
		errBox.textContent = '';
	}

	function setStatus(text, isDirty) {
		statusEl.textContent = text;
		statusEl.classList.toggle('is-dirty', !!isDirty);
	}

	function markDirty() {
		if(!dirty) {
			dirty = true;
		}
		setStatus('Unsaved changes', true);
		updateCount();
		updateSel();
	}

	function updateCount() {
		const t = (doc.innerText || '').trim();
		const w = t ? t.split(/\s+/).length : 0;
		countEl.textContent = w + ' word' + (w === 1 ? '' : 's') + ' · ' + t.length + ' characters';
	}

	function triggerDownload(blob, filename) {
		const url = URL.createObjectURL(blob),
			a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}

	function ensureParagraph() {
		if(!doc.firstChild || (doc.childNodes.length === 1 && doc.firstChild.nodeName === 'BR')) doc.innerHTML = '<p><br></p>';
	}
	
	const KEEP_STYLE = ['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'color', 'font-size', 'font-family', 'text-align'];

	function cleanHtml(html) {
		const d = new DOMParser().parseFromString(html, 'text/html');
		d.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,svg,noscript').forEach((n) => n.remove());
		d.body.querySelectorAll('*').forEach((el) => {
			Array.from(el.attributes).forEach((a) => {
				const n = a.name.toLowerCase();
				if(n.indexOf('on') === 0) el.removeAttribute(a.name);
				else if((n === 'href' || n === 'src') && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
			});
			if(el.tagName === 'IMG') Array.from(el.attributes).forEach((at) => { if(at.name.indexOf('data-') === 0) el.removeAttribute(at.name); });
		el.removeAttribute('class');
			el.removeAttribute('id');
			const st = el.getAttribute('style');
			if(st) {
				const keep = [];
				st.split(';').forEach((rule) => {
					const i = rule.indexOf(':');
					if(i < 0) return;
					const k = rule.slice(0, i).trim().toLowerCase(),
						v = rule.slice(i + 1).trim();
					if(KEEP_STYLE.indexOf(k) > -1 && !/url\(|expression/i.test(v)) keep.push(k + ':' + v);
				});
				if(keep.length) el.setAttribute('style', keep.join(';'));
				else el.removeAttribute('style');
			}
		});
		return d.body.innerHTML;
	}

	document.addEventListener('selectionchange', () => {
		const s = window.getSelection();
		if(s.rangeCount && doc.contains(s.anchorNode)) {
			saved = s.getRangeAt(0).cloneRange();
			refreshState();
		}
	});

	function restore() {
		doc.focus();
		if(saved) {
			const s = window.getSelection();
			s.removeAllRanges();
			s.addRange(saved);
		}
	}

	function exec(cmd, val, css) {
		restore();
		try {
			document.execCommand('styleWithCSS', false, css !== false);
		} catch(e) { /* ignore */ }
		document.execCommand(cmd, false, val);
		markDirty();
		refreshState();
	}

	const STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'];

	function refreshState() {
		STATE_CMDS.forEach((c) => {
			const b = document.querySelector('[data-cmd="' + c + '"]');
			let on = false;
			try {
				on = document.queryCommandState(c);
			} catch(e) { /* ignore */ }
			if(b) b.classList.toggle('is-active', on);
		});
		let blk = '';
		try {
			blk = String(document.queryCommandValue('formatBlock')).toLowerCase().replace(/[<>]/g, '');
		} catch(e) { /* ignore */ }
		blockSel.value = /^h[1-3]$/.test(blk) ? blk : (/^h[4-6]$/.test(blk) ? 'h3' : 'p');
		const s = window.getSelection();
		let el = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
		if(el && doc.contains(el)) {
			const cs = getComputedStyle(el);
			const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
			if(fam) $('weFontCurrent').textContent = fam;
			const pt = Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2;
			Array.from(sizeSel.options).forEach((o) => {
				if(parseFloat(o.value) === pt) sizeSel.value = o.value;
			});
			tableTools.classList.toggle('is-hidden', !el.closest('td,th'));
		} else tableTools.classList.add('is-hidden');
	}

	document.getElementById('weFormat').addEventListener('mousedown', (e) => {
		if(e.target.closest('button')) e.preventDefault(); 
	});

	document.querySelectorAll('[data-cmd]').forEach((b) => b.addEventListener('click', () => {
		if(b.dataset.cmd === 'undo' && undoMove()) return;
		exec(b.dataset.cmd, null);
	}));

	blockSel.addEventListener('change', () => {
		exec('formatBlock', blockSel.value.toUpperCase());
	});

	colorEl.addEventListener('input', () => exec('foreColor', colorEl.value));

	sizeSel.addEventListener('change', () => {
		restore();
		try {
			document.execCommand('styleWithCSS', false, false);
		} catch(e) { /* ignore */ }
		document.execCommand('fontSize', false, '7'); 
		doc.querySelectorAll('font[size="7"]').forEach((f) => {
			const span = document.createElement('span');
			span.style.fontSize = sizeSel.value + 'pt';
			while(f.firstChild) span.appendChild(f.firstChild);
			f.replaceWith(span);
			span.querySelectorAll('span').forEach((inner) => {
				inner.style.fontSize = '';
				if(!inner.getAttribute('style')) inner.replaceWith(...inner.childNodes);
			});
		});
		markDirty();
	});

	$('weLinkBtn').addEventListener('click', () => {
		restore();
		const url = window.prompt('Link address (https://…)', 'https://');
		if(!url || url === 'https://') return;
		if(!/^(https?:|mailto:)/i.test(url)) {
			showError('Links must start with http://, https:// or mailto:');
			return;
		}
		clearError();
		const sel = window.getSelection();
		if(sel.isCollapsed) document.execCommand('insertHTML', false, '<a href="' + url.replace(/"/g, '&quot;') + '">' + url.replace(/</g, '&lt;') + '</a>');
		else document.execCommand('createLink', false, url);
		markDirty();
	});

	$('weImgBtn').addEventListener('click', () => imgInput.click());
	imgInput.addEventListener('change', () => {
		const f = imgInput.files[0];
		imgInput.value = '';
		if(!f || !/^image\//.test(f.type)) return;
		const r = new FileReader();
		r.onload = () => {
			restore();
			document.execCommand('insertImage', false, r.result);
			markDirty();
		};
		r.readAsDataURL(f);
	});

	function selectImage(img) {
		selImg = img;
		if(img) $('weImgWidth').value = Math.round(img.offsetWidth);
		updateSel(); // the handles on the picture replace the old picture-tools bar, so nothing above the page moves
	}

	doc.addEventListener('click', (e) => selectImage(e.target.tagName === 'IMG' ? e.target : null));

	$('weImgWidth').addEventListener('change', (e) => {
		if(!selImg) return;
		const v = Math.max(20, Math.min(2000, parseInt(e.target.value, 10) || 0));
		selImg.style.width = v + 'px';
		selImg.style.height = 'auto';
		updateSel();
		markDirty();
	});

	$('weImgRemove').addEventListener('click', () => {
		if(selImg) {
			selImg.remove();
			selectImage(null);
			ensureParagraph();
			markDirty();
		}
	});

	$('weTableBtn').addEventListener('click', () => {
		tablePop.classList.toggle('is-hidden');
	});

	$('weTableCancel').addEventListener('click', () => tablePop.classList.add('is-hidden'));

	$('weTableInsert').addEventListener('click', () => {
		const r = Math.max(1, Math.min(30, parseInt($('weRows').value, 10) || 3)),
			c = Math.max(1, Math.min(12, parseInt($('weCols').value, 10) || 3));
		let html = '<table data-new="1"><tbody>';
		for(let i = 0; i < r; i++) {
			html += '<tr>';
			for(let j = 0; j < c; j++) html += '<td><br></td>';
			html += '</tr>';
		}
		html += '</tbody></table><p><br></p>';
		restore();
		document.execCommand('insertHTML', false, html);
		const nt = doc.querySelector('table[data-new]');
		if(nt) { // put the caret in the first cell
			nt.removeAttribute('data-new');
			const rg = document.createRange();
			rg.setStart(nt.rows[0].cells[0], 0);
			rg.collapse(true);
			const sl = window.getSelection();
			sl.removeAllRanges();
			sl.addRange(rg);
		}
		tablePop.classList.add('is-hidden');
		markDirty();
	});

	function curCell() {
		const s = window.getSelection();
		const el = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
		return el && doc.contains(el) ? el.closest('td,th') : null;
	}

	tableTools.addEventListener('mousedown', (e) => {
		if(e.target.closest('button')) e.preventDefault();
	});

	tableTools.addEventListener('click', (e) => {
		const b = e.target.closest('[data-tbl]');
		if(!b) return;
		restore();
		const cell = curCell();
		if(!cell) return;
		const row = cell.parentElement,
			table = cell.closest('table'),
			idx = Array.from(row.children).indexOf(cell);
		const blank = (tag) => {
			const c = document.createElement(tag || 'td');
			c.innerHTML = '<br>';
			return c;
		};
		switch(b.dataset.tbl) {
			case 'rowAbove':
			case 'rowBelow':
				{
					const nr = document.createElement('tr');
					Array.from(row.children).forEach((c) => {
						const n = blank('td');
						if(c.colSpan > 1) n.colSpan = c.colSpan;
						nr.appendChild(n);
					});
					row.parentElement.insertBefore(nr, b.dataset.tbl === 'rowAbove' ? row : row.nextSibling);
					break;
				}
			case 'colLeft':
			case 'colRight':
				Array.from(table.rows).forEach((r) => {
					const ref = r.children[idx];
					const n = blank(ref ? ref.tagName.toLowerCase() : 'td');
					if(!ref) r.appendChild(n);
					else r.insertBefore(n, b.dataset.tbl === 'colLeft' ? ref : ref.nextSibling);
				});
				break;
			case 'delRow':
				if(table.rows.length <= 1) table.remove();
				else row.remove();
				break;
			case 'delCol':
				if(row.children.length <= 1) table.remove();
				else Array.from(table.rows).forEach((r) => {
					if(r.children[idx]) r.children[idx].remove();
				});
				break;
			case 'delTable':
				table.remove();
				break;
		}
		ensureParagraph();
		markDirty();
		refreshState();
	});

	$('weFindBtn').addEventListener('click', toggleFind);

	$('weFindClose').addEventListener('click', () => findBar.classList.add('is-hidden'));

	function toggleFind() {
		findBar.classList.toggle('is-hidden');
		if(!findBar.classList.contains('is-hidden')) {
			const s = window.getSelection().toString();
			if(s && s.length < 80) $('weFindText').value = s;
			$('weFindText').focus();
			$('weFindText').select();
		}
	}

	function findNext() {
		const t = $('weFindText').value;
		if(!t) return false;
		doc.focus();
		if(saved) {
			const s = window.getSelection();
			s.removeAllRanges();
			s.addRange(saved);
		}
		let hit = window.find(t, $('weCase').checked, false, true, false, false, false);
		const s = window.getSelection();
		if(hit && !doc.contains(s.anchorNode)) hit = false;
		$('weFindMsg').textContent = hit ? '' : 'No matches';
		return hit;
	}

	$('weFindNext').addEventListener('click', findNext);

	$('weFindText').addEventListener('keydown', (e) => {
		if(e.key === 'Enter') {
			e.preventDefault();
			findNext();
		}
	});

	$('weReplaceOne').addEventListener('click', () => {
		const t = $('weFindText').value,
			r = $('weReplaceText').value;
		if(!t) return;
		const sel = window.getSelection().toString();
		const same = $('weCase').checked ? sel === t : sel.toLowerCase() === t.toLowerCase();
		if(same && doc.contains(window.getSelection().anchorNode)) {
			document.execCommand('insertText', false, r);
			markDirty();
		}
		findNext();
	});

	$('weReplaceAll').addEventListener('click', () => {
		const t = $('weFindText').value,
			r = $('weReplaceText').value;
		if(!t) return;
		const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $('weCase').checked ? 'g' : 'gi');
		let n = 0;
		const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
		const nodes = [];
		while(walker.nextNode()) nodes.push(walker.currentNode);
		nodes.forEach((node) => {
			const v = node.nodeValue;
			const out = v.replace(re, () => {
				n++;
				return r;
			});
			if(out !== v) node.nodeValue = out;
		});
		$('weFindMsg').textContent = n ? n + ' replaced' : 'No matches';
		if(n) markDirty();
	});

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
		btn: $('weFontBtn'),
		cur: $('weFontCurrent'),
		pop: $('weFontPop'),
		search: $('weFontSearch'),
		cats: $('weFontCats'),
		list: $('weFontList'),
		count: $('weFontCount')
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

	function openFontPicker() {
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
	}

	function closeFontPicker() {
		picker.open = false;
		FP.pop.classList.add('is-hidden');
		FP.btn.setAttribute('aria-expanded', 'false');
	}

	async function pickFont(name) {
		const f = famByName.get(name) || {
			name: name,
			cat: 's',
			google: false
		};
		closeFontPicker();
		exec('fontName', fontStackFor(f)); 
		FP.cur.textContent = name;
		if(f.google) {
			try {
				await loadFamily(f);
				if(document.fonts && document.fonts.load) await document.fonts.load('16px "' + f.name + '"', 'A');
			} catch(e) {
				showError('Could not load \u201C' + name + '\u201D. Check your internet connection. A fallback font is shown for now.');
				return;
			}
			clearError();
		}
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
			doc.focus();
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

	document.addEventListener('click', (e) => {
		if(picker.open && !FP.pop.contains(e.target) && !FP.btn.contains(e.target)) closeFontPicker();
	});

	function loadUsedFonts() {
		const seen = new Set();
		doc.querySelectorAll('[style*="font-family"],font[face]').forEach((el) => {
			const raw = el.style.fontFamily || el.getAttribute('face') || '';
			const n = raw.split(',')[0].replace(/["']/g, '').trim();
			const f = famByName.get(n);
			if(f && f.google && !seen.has(n)) {
				seen.add(n);
				loadFamily(f).catch(() => {});
			}
		});
	}

	doc.addEventListener('paste', () => setTimeout(loadUsedFonts, 0));

	/* ---------------------------------------------------------------
	   Drag and drop, like Word
	   - text:     select it, then drag the selection (the browser does this natively; hold Ctrl to copy)
	   - pictures: drag the picture itself into any line of text (also native)
	   - tables:   hover a table, then drag the square handle at its top-left corner to another place
	   --------------------------------------------------------------- */
	const desk = $('weDesk');
	const handle = document.createElement('div');
	handle.className = 'we-handle';
	handle.textContent = '✥';
	handle.title = 'Drag to move this table';
	handle.setAttribute('role', 'button');
	handle.setAttribute('aria-label', 'Drag to move this table');
	const dropLine = document.createElement('div');
	dropLine.className = 'we-dropline';
	document.body.appendChild(handle);
	document.body.appendChild(dropLine);
	let hoverTable = null,
		drag = null,
		lastMoveSnapshot = null; // a table move is not in the browser's own undo list, so the page is kept here

	function snapshot() {
		lastMoveSnapshot = doc.innerHTML;
	}

	// only tables that sit directly in the page can be moved with the handle
	function pageTable(node) {
		const t = node && node.nodeType === 1 ? node.closest('table') : (node && node.parentElement ? node.parentElement.closest('table') : null);
		return t && t.parentNode === doc ? t : null;
	}

	function positionHandle(table) {
		if(!table || !doc.contains(table)) {
			handle.classList.remove('is-visible');
			hoverTable = null;
			return;
		}
		const dr = desk.getBoundingClientRect(),
			tr = table.getBoundingClientRect(),
			pr = doc.getBoundingClientRect();
		handle.style.left = Math.max(2, Math.min(tr.left, pr.left + 40) + window.scrollX - 28) + 'px';
		handle.style.top = (tr.top + window.scrollY - 4) + 'px';
		handle.classList.add('is-visible');
		hoverTable = table;
	}
	desk.addEventListener('mousemove', (e) => {
		if(drag) return;
		if(handle.contains(e.target)) return; // keep it while the pointer is on the handle itself
		const el = document.elementFromPoint(e.clientX, e.clientY);
		const t = el && doc.contains(el) ? pageTable(el) : null;
		if(t) {
			if(t !== hoverTable) positionHandle(t);
		} else if(hoverTable) {
			// leaving the table: keep the handle only while the pointer is in the gap between table and handle
			const r = hoverTable.getBoundingClientRect();
			const near = e.clientX >= r.left - 40 && e.clientX <= r.left + 6 && e.clientY >= r.top - 12 && e.clientY <= r.bottom;
			if(!near) positionHandle(null);
		}
	});
	desk.addEventListener('mouseleave', () => {
		if(!drag) positionHandle(null);
	});
	desk.addEventListener('scroll', () => positionHandle(hoverTable));
	window.addEventListener('resize', () => positionHandle(null));

	// where the table would land: before the first block whose middle is below the pointer
	function dropTarget(y) {
		const kids = Array.from(doc.children).filter((c) => c !== drag.table);
		for(const k of kids) {
			const r = k.getBoundingClientRect();
			if(y < r.top + r.height / 2) return {
				before: k,
				y: r.top
			};
		}
		const last = kids[kids.length - 1];
		return {
			before: null,
			y: last ? last.getBoundingClientRect().bottom : doc.getBoundingClientRect().top
		};
	}

	function showDropLine(y) {
		const dr = desk.getBoundingClientRect(),
			pr = doc.getBoundingClientRect();
		dropLine.style.left = (pr.left + window.scrollX + 20) + 'px';
		dropLine.style.width = Math.max(40, pr.width - 40) + 'px';
		dropLine.style.top = (y + window.scrollY - 1) + 'px';
		dropLine.classList.add('is-visible');
	}

	function endDrag() {
		document.body.classList.remove('we-dragging');
		handle.classList.remove('is-dragging');
		dropLine.classList.remove('is-visible');
		doc.classList.remove('is-moving');
		doc.querySelectorAll('.is-moving-src').forEach((n) => {
			n.classList.remove('is-moving-src');
			if(!n.getAttribute('class')) n.removeAttribute('class');
		});
		drag = null;
	}

	handle.addEventListener('pointerdown', (e) => {
		if(!hoverTable || e.button !== 0) return;
		e.preventDefault();
		drag = {
			table: hoverTable
		};
		document.body.classList.add('we-dragging');
		handle.classList.add('is-dragging');
		doc.classList.add('is-moving'); // the dragged table is shown faded with a dashed outline
		hoverTable.classList.add('is-moving-src');
	});

	// long documents: scroll the window while the drag is held near its top or bottom edge
	let dragPointerY = 0,
		scrollRaf = 0;

	function autoScroll() {
		scrollRaf = 0;
		if(!drag && !(imgOp && imgOp.type === 'move')) return;
		const edge = 70,
			h = window.innerHeight;
		if(dragPointerY < edge) window.scrollBy(0, -Math.ceil((edge - dragPointerY) / 4));
		else if(dragPointerY > h - edge) window.scrollBy(0, Math.ceil((dragPointerY - (h - edge)) / 4));
		else return;
		scrollRaf = requestAnimationFrame(autoScroll);
	}
	document.addEventListener('pointermove', (e) => {
		if(!drag) return;
		dragPointerY = e.clientY;
		if(!scrollRaf) scrollRaf = requestAnimationFrame(autoScroll);
		showDropLine(dropTarget(e.clientY).y);
	});
	document.addEventListener('pointerup', (e) => {
		if(!drag) return;
		const t = dropTarget(e.clientY),
			table = drag.table;
		endDrag();
		const alreadyThere = t.before ? t.before === table.nextElementSibling : !table.nextElementSibling;
		if(!alreadyThere) {
			snapshot();
			doc.insertBefore(table, t.before);
			markDirty();
			positionHandle(table);
		} else positionHandle(table);
	});
	document.addEventListener('keydown', (e) => {
		if(e.key === 'Escape' && drag) endDrag();
	});

	// pictures and text are moved by the browser; the page only has to notice the change
	doc.addEventListener('drop', () => {
		setTimeout(() => {
			ensureParagraph();
			markDirty();
		}, 0);
	});

	/* ---------------------------------------------------------------
	   Pictures, like Word
	   - click a picture: eight resize handles, a rotate handle and a layout button appear
	   - drag the picture to move it; drag a corner to resize (keeps the shape), a side handle to stretch
	   - layout button: "In line with text", "Square" (text wraps beside it), "In front of text" (free position)
	   A floating picture is saved into the .docx as a positioned picture (page position + paragraph anchor).
	   --------------------------------------------------------------- */
	const selBox = document.createElement('div');
	selBox.className = 'we-sel';
	['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((k) => {
		const hd = document.createElement('div');
		hd.className = 'we-sel-h we-sel-' + k;
		hd.dataset.h = k;
		selBox.appendChild(hd);
	});
	const rotStem = document.createElement('div');
	rotStem.className = 'we-sel-stem';
	const rotHandle = document.createElement('div');
	rotHandle.className = 'we-sel-rot';
	rotHandle.title = 'Rotate (hold Shift for 15° steps)';
	rotHandle.textContent = '↻';
	selBox.appendChild(rotStem);
	selBox.appendChild(rotHandle);
	const layoutBtn = document.createElement('button');
	layoutBtn.type = 'button';
	layoutBtn.className = 'we-sel-layout';
	layoutBtn.title = 'Layout options';
	layoutBtn.setAttribute('aria-label', 'Layout options');
	layoutBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="1.5" y="3" width="6" height="5" rx="1"/><path d="M10 3.5h4.5M10 6h4.5M1.5 11h13M1.5 13.5h13"/></svg>';
	const layoutMenu = document.createElement('div');
	layoutMenu.className = 'we-layoutmenu';
	[
		['inline', 'In line with text'],
		['square', 'Square (text wraps around)'],
		['front', 'In front of text (free position)']
	].forEach((m) => {
		const bt = document.createElement('button');
		bt.type = 'button';
		bt.dataset.wrap = m[0];
		bt.textContent = m[1];
		layoutMenu.appendChild(bt);
	});
	document.body.appendChild(selBox);
	document.body.appendChild(layoutBtn);
	document.body.appendChild(layoutMenu);
	let imgOp = null; // the picture action in progress: move / resize / rotate

	const rotOf = (img) => parseFloat(img.dataset.rot) || 0;
	const wrapOf = (img) => img.dataset.wrap || 'inline';

	function updateSel() {
		if(selImg && !doc.contains(selImg)) {
			selImg = null;
			imageTools.classList.add('is-hidden');
		}
		const on = !!selImg && !crop;
		selBox.classList.toggle('is-visible', on);
		layoutBtn.classList.toggle('is-visible', on);
		cropBtn.classList.toggle('is-visible', on);
		if(!on) {
			layoutMenu.classList.remove('is-visible');
			return;
		}
		const dr = desk.getBoundingClientRect(),
			ir = selImg.getBoundingClientRect();
		const w = selImg.offsetWidth,
			h = selImg.offsetHeight;
		const cx = ir.left + ir.width / 2 + window.scrollX,
			cy = ir.top + ir.height / 2 + window.scrollY;
		selBox.style.width = w + 'px';
		selBox.style.height = h + 'px';
		selBox.style.left = (cx - w / 2) + 'px';
		selBox.style.top = (cy - h / 2) + 'px';
		selBox.style.transform = 'rotate(' + rotOf(selImg) + 'deg)';
		layoutBtn.style.left = (ir.right + window.scrollX + 8) + 'px';
		layoutBtn.style.top = (ir.top + window.scrollY) + 'px';
		cropBtn.style.left = layoutBtn.style.left;
		cropBtn.style.top = (ir.top + window.scrollY + 34) + 'px';
		layoutMenu.style.left = layoutBtn.style.left;
		layoutMenu.style.top = (ir.top + window.scrollY + 68) + 'px';
		layoutMenu.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.wrap === wrapOf(selImg)));
	}
	desk.addEventListener('scroll', updateSel);
	window.addEventListener('resize', updateSel);
	window.addEventListener('load', updateSel);

	function caretFromPoint(x, y) {
		if(document.caretRangeFromPoint) return document.caretRangeFromPoint(x, y);
		if(document.caretPositionFromPoint) {
			const p = document.caretPositionFromPoint(x, y);
			if(!p) return null;
			const r = document.createRange();
			r.setStart(p.offsetNode, p.offset);
			r.collapse(true);
			return r;
		}
		return null;
	}

	// a paragraph that only held a floating picture keeps one empty line so the caret has somewhere to be
	function keepLine(p) {
		if(p && p !== doc && !p.textContent.trim() && !p.querySelector('img:not([data-wrap]),br,table')) p.appendChild(document.createElement('br'));
	}

	function blockAtY(y) {
		const kids = Array.from(doc.children);
		let best = kids[0],
			bd = Infinity;
		kids.forEach((k) => {
			const r = k.getBoundingClientRect(),
				d = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
			if(d < bd) {
				bd = d;
				best = k;
			}
		});
		return best;
	}
	// the paragraph, list item or table cell under the pointer: where a floating picture gets anchored
	function anchorBlockAt(x, y) {
		const el = document.elementFromPoint(x, y);
		let b = el && el.closest ? el.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,blockquote,div') : null;
		if(!b || b === doc || !doc.contains(b)) {
			b = blockAtY(y);
			if(b && b.tagName === 'TABLE') b = b.querySelector('td,th') || b;
			else if(b && (b.tagName === 'UL' || b.tagName === 'OL')) b = b.querySelector('li') || b;
		}
		return b && b !== doc ? b : doc.firstElementChild;
	}

	// data-x: picture's left edge from the page's left edge. data-y: its top edge from the top of its anchor paragraph.
	function recordPos(img, block) {
		const pr = doc.getBoundingClientRect(),
			br = block.getBoundingClientRect(),
			ir = img.getBoundingClientRect();
		const w = img.offsetWidth,
			h = img.offsetHeight;
		img.dataset.x = Math.round(ir.left + ir.width / 2 - w / 2 - pr.left);
		img.dataset.y = Math.round(ir.top + ir.height / 2 - h / 2 - br.top);
	}

	// mode: inline | square | front.  target (optional): {cx, cy, block} = where the picture's centre should be, in screen px
	function applyLayout(img, mode, target) {
		const old = img.parentElement,
			ir = img.getBoundingClientRect();
		const cx = target ? target.cx : ir.left + ir.width / 2,
			cy = target ? target.cy : ir.top + ir.height / 2;
		const block = target && target.block ? target.block : img.parentElement;
		const pad = parseFloat(getComputedStyle(doc).paddingLeft) || 0;
		['position', 'left', 'top', 'float', 'margin', 'zIndex', 'pointerEvents'].forEach((k) => {
			img.style[k] = '';
		});
		delete img.dataset.wrap;
		delete img.dataset.x;
		delete img.dataset.y;
		delete img.dataset.side;
		if(block !== img.parentElement) block.insertBefore(img, block.firstChild);
		if(mode === 'front') {
			block.style.position = 'relative'; // the picture is positioned inside its paragraph
			img.dataset.wrap = 'front';
			img.style.position = 'absolute';
			img.style.zIndex = '3';
			const br = block.getBoundingClientRect();
			img.style.left = Math.round(cx - img.offsetWidth / 2 - br.left - block.clientLeft) + 'px';
			img.style.top = Math.round(cy - img.offsetHeight / 2 - br.top - block.clientTop) + 'px';
			recordPos(img, block);
		} else if(mode === 'square') {
			const pr = doc.getBoundingClientRect();
			const side = cx < pr.left + pr.width / 2 ? 'left' : 'right';
			img.dataset.wrap = 'square';
			img.dataset.side = side;
			img.style.float = side;
			img.style.margin = side === 'left' ? '0 12px 6px 0' : '0 0 6px 12px';
			img.dataset.x = side === 'left' ? Math.round(pad) : Math.round(pr.width - pad - img.offsetWidth);
			img.dataset.y = 0;
		}
		if(old && old !== img.parentElement) keepLine(old);
		keepLine(img.parentElement);
		updateSel();
	}

	layoutBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		layoutMenu.classList.toggle('is-visible');
	});
	layoutMenu.addEventListener('click', (e) => {
		const b = e.target.closest('button');
		if(!b || !selImg) return;
		snapshot();
		applyLayout(selImg, b.dataset.wrap);
		layoutMenu.classList.remove('is-visible');
		markDirty();
	});
	document.addEventListener('click', (e) => {
		if(!layoutMenu.contains(e.target) && !layoutBtn.contains(e.target)) layoutMenu.classList.remove('is-visible');
	});

	/* click or drag a picture */
	doc.addEventListener('mousedown', (e) => {
		if(e.target.tagName === 'IMG') e.preventDefault(); // no native drag or text selection: the page moves it itself
	});
	doc.addEventListener('dragstart', (e) => {
		if(e.target.tagName === 'IMG') e.preventDefault();
	});
	doc.addEventListener('pointerdown', (e) => {
		if(e.target.tagName !== 'IMG' || e.button !== 0) return;
		const img = e.target;
		doc.focus();
		selectImage(img);
		const r = document.createRange(); // the picture is the selection, so Delete removes it and typing replaces it
		r.selectNode(img);
		const s = window.getSelection();
		s.removeAllRanges();
		s.addRange(r);
		const ir = img.getBoundingClientRect();
		imgOp = {
			type: 'move',
			img: img,
			x0: e.clientX,
			y0: e.clientY,
			sx: window.scrollX,
			sy: window.scrollY,
			cx0: ir.left + ir.width / 2,
			cy0: ir.top + ir.height / 2,
			left0: parseFloat(img.style.left) || 0,
			top0: parseFloat(img.style.top) || 0,
			mode: wrapOf(img),
			moved: false
		};
	});

	selBox.addEventListener('pointerdown', (e) => {
		if(!selImg || e.button !== 0) return;
		const hd = e.target.closest('.we-sel-h');
		const ir = selImg.getBoundingClientRect();
		if(hd) {
			e.preventDefault();
			imgOp = {
				type: 'resize',
				img: selImg,
				h: hd.dataset.h,
				x0: e.clientX,
				y0: e.clientY,
				w0: selImg.offsetWidth,
				h0: selImg.offsetHeight,
				rot: rotOf(selImg) * Math.PI / 180,
				left0: parseFloat(selImg.style.left) || 0,
				top0: parseFloat(selImg.style.top) || 0,
				dx0: parseFloat(selImg.dataset.x) || 0,
				dy0: parseFloat(selImg.dataset.y) || 0,
				moved: false
			};
		} else if(e.target.closest('.we-sel-rot')) {
			e.preventDefault();
			imgOp = {
				type: 'rotate',
				img: selImg,
				cx: ir.left + ir.width / 2,
				cy: ir.top + ir.height / 2,
				moved: false
			};
		}
	});

	document.addEventListener('pointermove', (e) => {
		const op = imgOp;
		if(!op) return;
		const img = op.img;
		if(op.type === 'move') {
			const dx = e.clientX - op.x0,
				dy = e.clientY - op.y0;
			if(!op.moved && Math.hypot(dx, dy) < 4) return;
			if(!op.moved) {
				op.moved = true;
				snapshot();
				document.body.classList.add('we-dragging');
				img.classList.add('is-dragging');
				img.style.pointerEvents = 'none'; // so the pointer can see what is underneath
			}
			dragPointerY = e.clientY;
			if(!scrollRaf) scrollRaf = requestAnimationFrame(autoScroll);
			const dxp = dx + (window.scrollX - op.sx),
				dyp = dy + (window.scrollY - op.sy); // movement in page coordinates, so scrolling while dragging counts
			if(op.mode === 'front') {
				img.style.left = (op.left0 + dxp) + 'px';
				img.style.top = (op.top0 + dyp) + 'px';
			} else if(op.mode === 'inline') {
				const pr = doc.getBoundingClientRect();
				if(e.clientX >= pr.left && e.clientX <= pr.right && e.clientY >= pr.top && e.clientY <= pr.bottom) {
					const rg = caretFromPoint(e.clientX, e.clientY);
					if(rg && doc.contains(rg.startContainer)) {
						const rr = rg.getBoundingClientRect();
						if(rr && (rr.height || rr.width)) showDropLine(rr.bottom);
					}
				} else dropLine.classList.remove('is-visible');
			} else {
				const b = anchorBlockAt(e.clientX, e.clientY);
				if(b) showDropLine(b.getBoundingClientRect().top);
			}
			updateSel();
		} else if(op.type === 'resize') {
			const dx = e.clientX - op.x0,
				dy = e.clientY - op.y0;
			const cos = Math.cos(op.rot),
				sin = Math.sin(op.rot);
			const lx = dx * cos + dy * sin,
				ly = -dx * sin + dy * cos; // pointer movement along the picture's own axes
			const sx = op.h.indexOf('e') > -1 ? 1 : (op.h.indexOf('w') > -1 ? -1 : 0),
				sy = op.h.indexOf('s') > -1 ? 1 : (op.h.indexOf('n') > -1 ? -1 : 0);
			if(!op.moved) {
				if(Math.hypot(dx, dy) < 2) return;
				op.moved = true;
				snapshot();
			}
			let nw = op.w0 + sx * lx,
				nh = op.h0 + sy * ly;
			if(sx && sy) { // corner: keep the picture's shape
				const k = Math.max(nw / op.w0, nh / op.h0);
				nw = op.w0 * k;
				nh = op.h0 * k;
			}
			const maxW = wrapOf(img) === 'front' ? 4000 : Math.max(40, doc.clientWidth - 2 * (parseFloat(getComputedStyle(doc).paddingLeft) || 0));
			if(nw > maxW) {
				nh = nh * maxW / nw;
				nw = maxW;
			}
			nw = Math.max(20, nw);
			nh = Math.max(20, nh);
			img.style.width = Math.round(nw) + 'px';
			img.style.height = Math.round(nh) + 'px';
			if(wrapOf(img) === 'front') { // the edge opposite the dragged handle stays where it was
				const gx = sx < 0 ? nw - op.w0 : 0,
					gy = sy < 0 ? nh - op.h0 : 0;
				img.style.left = Math.round(op.left0 - gx) + 'px';
				img.style.top = Math.round(op.top0 - gy) + 'px';
				img.dataset.x = Math.round(op.dx0 - gx);
				img.dataset.y = Math.round(op.dy0 - gy);
			}
			$('weImgWidth').value = Math.round(nw);
			updateSel();
		} else if(op.type === 'rotate') {
			if(!op.moved) {
				op.moved = true;
				snapshot();
			}
			let a = Math.atan2(e.clientY - op.cy, e.clientX - op.cx) * 180 / Math.PI + 90;
			if(e.shiftKey) a = Math.round(a / 15) * 15;
			a = ((a + 180) % 360 + 360) % 360 - 180;
			a = Math.round(a * 10) / 10;
			if(a === 0) {
				delete img.dataset.rot;
				img.style.transform = '';
			} else {
				img.dataset.rot = a;
				img.style.transform = 'rotate(' + a + 'deg)';
			}
			updateSel();
		}
	});

	document.addEventListener('pointercancel', () => {
		if(imgOp) document.dispatchEvent(new PointerEvent('pointerup', {clientX: imgOp.x0 || 0, clientY: imgOp.y0 || 0}));
	});
	document.addEventListener('pointerup', (e) => {
		const op = imgOp;
		if(!op) return;
		imgOp = null;
		const img = op.img;
		if(op.type === 'move') {
			document.body.classList.remove('we-dragging');
			img.classList.remove('is-dragging');
			if(!img.getAttribute('class')) img.removeAttribute('class');
			dropLine.classList.remove('is-visible');
			img.style.pointerEvents = '';
			if(!op.moved) return;
			const dxp = e.clientX - op.x0 + (window.scrollX - op.sx),
				dyp = e.clientY - op.y0 + (window.scrollY - op.sy);
			if(op.mode === 'front') {
				const cx = op.cx0 + dxp - (window.scrollX - op.sx),
					cy = op.cy0 + dyp - (window.scrollY - op.sy);
				img.style.pointerEvents = 'none';
				const block = anchorBlockAt(e.clientX, e.clientY);
				img.style.pointerEvents = '';
				applyLayout(img, 'front', {
					cx,
					cy,
					block
				});
			} else if(op.mode === 'square') {
				img.style.pointerEvents = 'none';
				const block = anchorBlockAt(e.clientX, e.clientY);
				img.style.pointerEvents = '';
				applyLayout(img, 'square', {
					cx: e.clientX,
					cy: e.clientY,
					block
				});
			} else {
				const pr = doc.getBoundingClientRect();
				const inside = e.clientX >= pr.left && e.clientX <= pr.right && e.clientY >= pr.top && e.clientY <= pr.bottom;
				const rg = inside ? caretFromPoint(e.clientX, e.clientY) : null;
				if(rg && doc.contains(rg.startContainer) && rg.startContainer !== doc && !img.contains(rg.startContainer)) {
					const old = img.parentElement;
					rg.insertNode(img);
					if(old && old !== img.parentElement) keepLine(old);
					if(old && old !== doc && !old.textContent.trim() && !old.querySelector('img,table,br')) old.innerHTML = '<br>';
				}
			}
			markDirty();
			updateSel();
		} else if(op.moved) {
			markDirty();
			updateSel();
		}
	});

	// Esc during a drag, or Delete on a selected picture, keep the page tidy
	document.addEventListener('keydown', (e) => {
		if(e.key === 'Escape' && layoutMenu.classList.contains('is-visible')) layoutMenu.classList.remove('is-visible');
	});

	/* ---------------------------------------------------------------
	   Crop, like Word: move the picture inside its frame
	   - the Crop button (or a double-click on the picture) shows the whole picture faded, with the frame on top
	   - drag inside the frame to slide the picture under it; drag a frame handle to crop more or less
	   - Zoom, Fill and Reset are in the small bar under the frame; Done, Enter, Esc or a click outside finishes
	   The whole picture is kept, so the crop can be changed again later.
	   --------------------------------------------------------------- */
	const cropBtn = document.createElement('button');
	cropBtn.type = 'button';
	cropBtn.className = 'we-sel-layout we-sel-crop';
	cropBtn.title = 'Crop: move the picture inside its frame';
	cropBtn.setAttribute('aria-label', 'Crop');
	cropBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 1v11h11M1 4h11v11"/></svg>';
	const cropLayer = document.createElement('div');
	cropLayer.className = 'we-crop';
	const cropGhost = document.createElement('img');
	cropGhost.className = 'we-crop-ghost';
	cropGhost.alt = '';
	const cropBright = document.createElement('img');
	cropBright.className = 'we-crop-bright';
	cropBright.alt = '';
	const cropFrame = document.createElement('div');
	cropFrame.className = 'we-crop-frame';
	['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].forEach((k) => {
		const hd = document.createElement('div');
		hd.className = 'we-crop-h we-sel-' + k;
		hd.dataset.h = k;
		cropFrame.appendChild(hd);
	});
	cropLayer.appendChild(cropGhost);
	cropLayer.appendChild(cropBright);
	cropLayer.appendChild(cropFrame);
	const cropTools = document.createElement('div');
	cropTools.className = 'we-croptools';
	cropTools.innerHTML = '<label>Zoom <input type="range" class="we-crop-zoom" min="1" max="6" step="0.01" value="1"></label>' +
		'<button type="button" data-crop="fill">Fill</button><button type="button" data-crop="reset">Reset</button><button type="button" data-crop="done" class="is-primary">Done</button>';
	document.body.appendChild(cropBtn);
	document.body.appendChild(cropLayer);
	document.body.appendChild(cropTools);
	const zoomEl = cropTools.querySelector('.we-crop-zoom');
	let crop = null,
		cropOp = null;

	const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
	const minScale = () => Math.max(crop.fw / crop.ow, crop.fh / crop.oh);

	function loadImage(src) {
		return new Promise((resolve, reject) => {
			const im = new Image();
			im.onload = () => resolve(im);
			im.onerror = () => reject(new Error('The picture could not be read.'));
			im.src = src;
		});
	}

	async function enterCrop(img) {
		if(!img || crop) return;
		const origSrc = img.dataset.orig || img.getAttribute('src') || '';
		if(!/^data:image\//i.test(origSrc)) {
			showError('This picture is linked from the web, so it cannot be cropped. Insert it with the Picture button instead.');
			return;
		}
		let oi;
		try {
			oi = await loadImage(origSrc);
		} catch(e) {
			showError(e.message);
			return;
		}
		clearError();
		snapshot();
		const ow = oi.naturalWidth,
			oh = oi.naturalHeight;
		let r = [0, 0, ow, oh];
		if(img.dataset.orig && img.dataset.crop) {
			const c = img.dataset.crop.split(',').map(Number);
			if(c.length === 6 && c[2] > 0 && c[3] > 0) r = c.slice(0, 4);
		}
		const ir = img.getBoundingClientRect(),
			fw = img.offsetWidth;
		crop = {
			img,
			oi,
			origSrc,
			ow,
			oh,
			x: r[0],
			y: r[1],
			w: r[2],
			h: r[3],
			fw,
			fh: Math.round(fw * r[3] / r[2]),
			cx: ir.left + ir.width / 2 + window.scrollX,
			cy: ir.top + ir.height / 2 + window.scrollY,
			rot: rotOf(img) * Math.PI / 180,
			mode: wrapOf(img)
		};
		cropGhost.src = origSrc;
		cropBright.src = origSrc;
		img.classList.add('is-cropping');
		layoutMenu.classList.remove('is-visible');
		updateSel();
		cropLayer.classList.add('is-visible');
		cropTools.classList.add('is-visible');
		renderCrop();
	}

	function renderCrop() {
		const c = crop;
		if(!c) return;
		const s = c.fw / c.w;
		const gw = c.ow * s,
			gh = c.oh * s,
			fx = c.x * s,
			fy = c.y * s;
		const gx = c.cx - c.fw / 2 - fx,
			gy = c.cy - c.fh / 2 - fy;
		cropLayer.style.left = gx + 'px';
		cropLayer.style.top = gy + 'px';
		cropLayer.style.width = gw + 'px';
		cropLayer.style.height = gh + 'px';
		cropLayer.style.transformOrigin = (c.cx - gx) + 'px ' + (c.cy - gy) + 'px';
		cropLayer.style.transform = 'rotate(' + (c.rot * 180 / Math.PI) + 'deg)';
		cropBright.style.clipPath = 'inset(' + fy + 'px ' + (gh - fy - c.fh) + 'px ' + (gw - fx - c.fw) + 'px ' + fx + 'px)';
		cropFrame.style.left = fx + 'px';
		cropFrame.style.top = fy + 'px';
		cropFrame.style.width = c.fw + 'px';
		cropFrame.style.height = c.fh + 'px';
		const bh = (Math.abs(c.fw * Math.sin(c.rot)) + Math.abs(c.fh * Math.cos(c.rot))) / 2; // half the height of the rotated frame
		cropTools.style.left = c.cx + 'px';
		cropTools.style.top = (c.cy + bh + 14) + 'px';
		zoomEl.value = String(clampN(s / minScale(), 1, 6));
	}

	function commitCrop() {
		const c = crop;
		if(!c) return;
		const img = c.img;
		crop = null;
		cropOp = null;
		cropLayer.classList.remove('is-visible');
		cropTools.classList.remove('is-visible');
		img.classList.remove('is-cropping');
		if(!img.getAttribute('class')) img.removeAttribute('class');
		const whole = c.x < 0.5 && c.y < 0.5 && Math.abs(c.w - c.ow) < 1 && Math.abs(c.h - c.oh) < 1;
		if(whole) { // nothing is cropped any more: back to the original picture
			img.setAttribute('src', c.origSrc);
			delete img.dataset.orig;
			delete img.dataset.crop;
		} else {
			const cw = Math.max(1, Math.round(c.w)),
				ch = Math.max(1, Math.round(c.h));
			const cv = document.createElement('canvas');
			cv.width = cw;
			cv.height = ch;
			cv.getContext('2d').drawImage(c.oi, c.x, c.y, c.w, c.h, 0, 0, cw, ch);
			const jpeg = /^data:image\/jpe?g/i.test(c.origSrc);
			img.setAttribute('src', cv.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.92));
			img.dataset.orig = c.origSrc;
			img.dataset.crop = [c.x, c.y, c.w, c.h, c.ow, c.oh].map((v) => Math.round(v * 100) / 100).join(',');
		}
		img.style.width = Math.round(c.fw) + 'px';
		img.style.height = Math.round(c.fh) + 'px';
		if(c.mode === 'front') applyLayout(img, 'front', {
			cx: c.cx - window.scrollX,
			cy: c.cy - window.scrollY,
			block: img.parentElement
		});
		else if(c.mode === 'square') applyLayout(img, 'square', {
			cx: c.cx - window.scrollX,
			cy: c.cy - window.scrollY,
			block: img.parentElement
		});
		$('weImgWidth').value = Math.round(c.fw);
		markDirty();
		selectImage(img);
	}

	function setZoom(scale) { // keeps the centre of what is shown, and the frame itself
		const c = crop;
		const s = clampN(scale, minScale(), minScale() * 6);
		const mx = c.x + c.w / 2,
			my = c.y + c.h / 2;
		c.w = c.fw / s;
		c.h = c.fh / s;
		c.x = clampN(mx - c.w / 2, 0, c.ow - c.w);
		c.y = clampN(my - c.h / 2, 0, c.oh - c.h);
		renderCrop();
	}

	cropBtn.addEventListener('click', (e) => {
		e.stopPropagation();
		enterCrop(selImg);
	});
	doc.addEventListener('dblclick', (e) => {
		if(e.target.tagName === 'IMG') enterCrop(e.target);
	});
	zoomEl.addEventListener('input', () => {
		if(crop) setZoom(minScale() * parseFloat(zoomEl.value));
	});
	cropTools.addEventListener('click', (e) => {
		const b = e.target.closest('button');
		if(!b || !crop) return;
		const c = crop;
		if(b.dataset.crop === 'done') commitCrop();
		else if(b.dataset.crop === 'fill') setZoom(minScale());
		else if(b.dataset.crop === 'reset') {
			c.x = 0;
			c.y = 0;
			c.w = c.ow;
			c.h = c.oh;
			c.fh = Math.round(c.fw * c.oh / c.ow);
			renderCrop();
		}
	});
	cropLayer.addEventListener('wheel', (e) => {
		if(!crop) return;
		e.preventDefault();
		setZoom(crop.fw / crop.w * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
	}, {
		passive: false
	});

	/* drag inside the frame: slide the picture. drag a handle: crop more or less. */
	cropFrame.addEventListener('pointerdown', (e) => {
		if(!crop || e.button !== 0) return;
		e.preventDefault();
		const hd = e.target.closest('.we-crop-h');
		cropOp = {
			type: hd ? 'edge' : 'pan',
			h: hd ? hd.dataset.h : '',
			x0: e.clientX,
			y0: e.clientY,
			start: {
				x: crop.x,
				y: crop.y,
				w: crop.w,
				h: crop.h,
				fw: crop.fw,
				fh: crop.fh,
				cx: crop.cx,
				cy: crop.cy
			}
		};
		document.body.classList.add('we-dragging');
	});
	document.addEventListener('pointermove', (e) => {
		if(!cropOp || !crop) return;
		const c = crop,
			st = cropOp.start;
		const dx = e.clientX - cropOp.x0,
			dy = e.clientY - cropOp.y0;
		const cos = Math.cos(c.rot),
			sin = Math.sin(c.rot);
		const lx = dx * cos + dy * sin,
			ly = -dx * sin + dy * cos; // pointer movement along the frame's own axes
		const s = st.fw / st.w;
		if(cropOp.type === 'pan') {
			c.x = clampN(st.x - lx / s, 0, c.ow - c.w);
			c.y = clampN(st.y - ly / s, 0, c.oh - c.h);
		} else {
			const sx = cropOp.h.indexOf('e') > -1 ? 1 : (cropOp.h.indexOf('w') > -1 ? -1 : 0),
				sy = cropOp.h.indexOf('s') > -1 ? 1 : (cropOp.h.indexOf('n') > -1 ? -1 : 0);
			let dW = 0,
				dH = 0;
			if(sx) dW = clampN(sx * lx, 20 - st.fw, (sx > 0 ? (c.ow - st.x - st.w) : st.x) * s);
			if(sy) dH = clampN(sy * ly, 20 - st.fh, (sy > 0 ? (c.oh - st.y - st.h) : st.y) * s);
			c.fw = st.fw + dW;
			c.fh = st.fh + dH;
			c.w = c.fw / s;
			c.h = c.fh / s;
			c.x = sx < 0 ? st.x - dW / s : st.x;
			c.y = sy < 0 ? st.y - dH / s : st.y;
			const ox = sx * dW / 2,
				oy = sy * dH / 2; // the centre moves, so the opposite edge stays where it was
			c.cx = st.cx + ox * cos - oy * sin;
			c.cy = st.cy + ox * sin + oy * cos;
		}
		renderCrop();
	});
	document.addEventListener('pointerup', () => {
		if(!cropOp) return;
		cropOp = null;
		document.body.classList.remove('we-dragging');
	});
	document.addEventListener('pointerdown', (e) => { // a click anywhere else finishes the crop
		if(crop && !cropLayer.contains(e.target) && !cropTools.contains(e.target) && !cropBtn.contains(e.target)) commitCrop();
	}, true);
	document.addEventListener('keydown', (e) => {
		if(crop && (e.key === 'Enter' || e.key === 'Escape')) {
			e.preventDefault();
			commitCrop();
		}
	});

	function undoMove() {
		if(lastMoveSnapshot === null) return false;
		doc.innerHTML = lastMoveSnapshot;
		lastMoveSnapshot = null;
		selectImage(null);
		positionHandle(null);
		ensureParagraph();
		markDirty();
		return true;
	}

	doc.addEventListener('beforeinput', (e) => {
		if(e.inputType === 'historyUndo' && lastMoveSnapshot !== null) {
			e.preventDefault();
			undoMove();
		} else if(e.inputType !== 'historyUndo') lastMoveSnapshot = null;
	});

	doc.addEventListener('keydown', (e) => {
		if((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && lastMoveSnapshot !== null) {
			e.preventDefault();
			undoMove();
		}
	});


	doc.addEventListener('input', () => {
		ensureParagraph();
		markDirty();
	});

	doc.addEventListener('keydown', (e) => {
		if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			save();
		} else if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
			e.preventDefault();
			toggleFind();
		} else if(e.key === 'Tab') {
			const s = window.getSelection();
			const el = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
			const cell = el && el.closest('td,th');
			if(cell && !(el.closest('li'))) { // Tab walks through table cells, and adds a row after the last one
				e.preventDefault();
				const table = cell.closest('table'),
					all = Array.from(table.querySelectorAll('td,th'));
				let i = all.indexOf(cell) + (e.shiftKey ? -1 : 1);
				if(i >= all.length) {
					const last = table.rows[table.rows.length - 1],
						nr = document.createElement('tr');
					Array.from(last.cells).forEach((c) => {
						const n = document.createElement('td');
						if(c.colSpan > 1) n.colSpan = c.colSpan;
						n.innerHTML = '<br>';
						nr.appendChild(n);
					});
					last.parentElement.appendChild(nr);
					markDirty();
					i = all.length;
				}
				const target = Array.from(table.querySelectorAll('td,th'))[Math.max(0, i)];
				const rg = document.createRange();
				rg.selectNodeContents(target);
				rg.collapse(true);
				const sl = window.getSelection();
				sl.removeAllRanges();
				sl.addRange(rg);
				return;
			}
			if(el && el.closest('li')) {
				e.preventDefault();
				document.execCommand(e.shiftKey ? 'outdent' : 'indent');
				markDirty();
			}
		}
	});

	document.addEventListener('keydown', (e) => {
		if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			save();
		}
	});

	doc.addEventListener('paste', (e) => {
		const cd = e.clipboardData;
		if(!cd) return;
		const html = cd.getData('text/html');
		e.preventDefault();
		if(html) document.execCommand('insertHTML', false, cleanHtml(html));
		else document.execCommand('insertText', false, cd.getData('text/plain'));
		markDirty();
	});

	doc.addEventListener('drop', (e) => { // dropping a .docx opens it
		const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
		if(f && /\.docx$/i.test(f.name)) {
			e.preventDefault();
			openFile(f);
		}
	});

	window.addEventListener('beforeunload', (e) => {
		if(dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	});

	function setPageSize(v) {
		pageSizeEl.value = v;
		doc.classList.toggle('is-letter', v === 'letter');
		doc.classList.toggle('is-a4', v === 'a4');
	}

	pageSizeEl.addEventListener('change', () => {
		setPageSize(pageSizeEl.value);
		markDirty();
	});

	function confirmDiscard() {
		return !dirty || window.confirm('You have unsaved changes. Continue and lose them?');
	}

	$('weNewBtn').addEventListener('click', () => {
		if(!confirmDiscard()) return;
		doc.innerHTML = '<p><br></p>';
		nameEl.value = 'document';
		dirty = false;
		selectImage(null);
		clearError();
		setStatus('New document', false);
		updateCount();
	});

	$('weOpenBtn').addEventListener('click', () => fileInput.click());
	fileInput.addEventListener('change', () => {
		const f = fileInput.files[0];
		fileInput.value = '';
		if(f) openFile(f);
	});

	async function openFile(file) {
		if(!/\.docx$/i.test(file.name)) {
			showError(/\.doc$/i.test(file.name) ? 'Old .doc files are not supported. Open it in Word and save it as .docx first.' : "That doesn't look like a .docx file.");
			return;
		}
		if(!confirmDiscard()) return;
		clearError();
		setStatus('Opening…', false);
		try {
			const buf = await file.arrayBuffer();
			const res = await mammoth.convertToHtml({
				arrayBuffer: buf
			}, {
				styleMap: ['u => u', 'strike => s', "p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
				convertImage: mammoth.images.imgElement((img) => img.read('base64').then((b) => ({
					src: 'data:' + img.contentType + ';base64,' + b
				})))
			});
			doc.innerHTML = cleanHtml(res.value) || '<p><br></p>';
			ensureParagraph();
			nameEl.value = file.name.replace(/\.docx$/i, '') || 'document';
			dirty = false;
			selectImage(null);
			const notes = res.messages.filter((m) => m.type === 'warning').length;
			setStatus('Opened ' + file.name + (notes ? ' (' + notes + ' formatting note' + (notes === 1 ? '' : 's') + ')' : ''), false);
			updateCount();
			doc.scrollIntoView({
				block: 'nearest'
			});
		} catch(e) {
			console.error(e);
			setStatus('Could not open the file', false);
			showError('Could not open that file: ' + (e && e.message ? e.message : e));
		}
	}

	const TW = 15; // CSS px -> twips
	const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HR', 'LI']);

	function rgbToHex(c) {
		const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c || '');
		if(m) return [m[1], m[2], m[3]].map((n) => ('0' + parseInt(n, 10).toString(16)).slice(-2)).join('').toUpperCase();
		const h = /^#([0-9a-f]{6})$/i.exec(c || '');
		if(h) return h[1].toUpperCase();
		const h3 = /^#([0-9a-f]{3})$/i.exec(c || '');
		if(h3) return h3[1].split('').map((x) => x + x).join('').toUpperCase();
		return null;
	}

	function sizeToHalfPts(v) {
		const m = /^([\d.]+)(pt|px)$/.exec((v || '').trim());
		if(!m) return null;
		return Math.max(2, Math.round(parseFloat(m[1]) * (m[2] === 'px' ? 0.75 : 1) * 2));
	}

	function styleState(el, st) {
		const s = Object.assign({}, st),
			tag = el.tagName,
			css = el.style || {};
		if(tag === 'B' || tag === 'STRONG' || tag === 'TH') s.b = true;
		if(tag === 'I' || tag === 'EM') s.i = true;
		if(tag === 'U') s.u = true;
		if(tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.s = true;
		if(tag === 'SUB') s.va = 'subscript';
		if(tag === 'SUP') s.va = 'superscript';
		if(tag === 'CODE' || tag === 'PRE') s.font = 'Courier New';
		if(tag === 'FONT') {
			if(el.getAttribute('face')) s.font = el.getAttribute('face').split(',')[0].replace(/["']/g, '').trim();
			const c = rgbToHex(el.getAttribute('color'));
			if(c) s.color = c;
		}
		if(css.fontWeight && (css.fontWeight === 'bold' || parseInt(css.fontWeight, 10) >= 600)) s.b = true;
		if(css.fontWeight && (css.fontWeight === 'normal' || parseInt(css.fontWeight, 10) < 600)) s.b = false;
		if(css.fontStyle === 'italic') s.i = true;
		const td = (css.textDecorationLine || css.textDecoration || '');
		if(/underline/.test(td)) s.u = true;
		if(/line-through/.test(td)) s.s = true;
		const col = rgbToHex(css.color);
		if(col) s.color = col;
		if(css.fontFamily) s.font = css.fontFamily.split(',')[0].replace(/["']/g, '').trim();
		const sz = sizeToHalfPts(css.fontSize);
		if(sz) s.sz = sz;
		return s;
	}

	function rPr(s) {
		let x = '';
		if(s.font) x += '<w:rFonts w:ascii="' + esc(s.font) + '" w:hAnsi="' + esc(s.font) + '" w:cs="' + esc(s.font) + '" w:eastAsia="' + esc(s.font) + '"/>';
		if(s.b) x += '<w:b/><w:bCs/>';
		if(s.i) x += '<w:i/><w:iCs/>';
		if(s.s) x += '<w:strike/>';
		if(s.color) x += '<w:color w:val="' + s.color + '"/>';
		if(s.sz) x += '<w:sz w:val="' + s.sz + '"/><w:szCs w:val="' + s.sz + '"/>';
		if(s.u) x += '<w:u w:val="single"/>';
		if(s.va) x += '<w:vertAlign w:val="' + s.va + '"/>';
		return x ? '<w:rPr>' + x + '</w:rPr>' : '';
	}

	function textRun(text, s) {
		const t = text.replace(/[ \t\r\n ]+/g, ' ');
		if(!t) return '';
		return '<w:r>' + rPr(s) + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
	}

	async function toPng(img) { 
		const c = document.createElement('canvas');
		c.width = img.naturalWidth || 200;
		c.height = img.naturalHeight || 100;
		c.getContext('2d').drawImage(img, 0, 0);
		const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
		return new Uint8Array(await blob.arrayBuffer());
	}

	async function imageRun(img, ctx) {
		let src = img.getAttribute('src') || '';
		let cropRect = null; // a cropped picture is saved whole, with the visible part marked, so Word can still undo the crop
		if(img.dataset.orig && img.dataset.crop && /^data:image\/(png|jpe?g|gif);base64,/i.test(img.dataset.orig)) {
			src = img.dataset.orig;
			cropRect = img.dataset.crop.split(',').map(Number);
		}
		const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(src);
		if(!m) {
			ctx.skippedImages++;
			return '';
		}
		let mime = m[1].toLowerCase(),
			bytes;
		if(mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/gif') {
			const bin = atob(m[2]);
			bytes = new Uint8Array(bin.length);
			for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			mime = mime === 'image/jpg' ? 'image/jpeg' : mime;
		} else {
			bytes = await toPng(img);
			mime = 'image/png';
		}
		const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/gif' ? 'gif' : 'png';
		const nat = {
			w: img.naturalWidth || 200,
			h: img.naturalHeight || 150
		};
		let w = parseFloat(img.style.width) || parseFloat(img.getAttribute('width')) || nat.w;
		let h = parseFloat(img.style.height) || parseFloat(img.getAttribute('height')) || 0;
		if(!h || /auto/.test(img.style.height)) h = w * nat.h / nat.w;
		const maxW = img.dataset.wrap ? ctx.pageW / TW : (ctx.pageW - 2880) / TW;
		if(w > maxW) {
			h = h * maxW / w;
			w = maxW;
		}
		const idx = ctx.media.length + 1,
			rid = 'rIdImg' + idx,
			id = ctx.drawId++;
		ctx.media.push({
			name: 'image' + idx + '.' + ext,
			bytes
		});
		ctx.rels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + idx + '.' + ext + '"/>');
		ctx.exts.add(ext);
		const cx = Math.round(w * 9525),
			cy = Math.round(h * 9525);
		let srcRectXml = '';
		if(cropRect && cropRect.length === 6 && cropRect[4] > 0 && cropRect[5] > 0) {
			const p = (v) => Math.max(0, Math.round(v * 100000));
			srcRectXml = '<a:srcRect l="' + p(cropRect[0] / cropRect[4]) + '" t="' + p(cropRect[1] / cropRect[5]) + '" r="' + p((cropRect[4] - cropRect[0] - cropRect[2]) / cropRect[4]) + '" b="' + p((cropRect[5] - cropRect[1] - cropRect[3]) / cropRect[5]) + '"/>';
		}
		const rot = parseFloat(img.dataset.rot) || 0;
		const xfrmAttr = rot ? ' rot="' + Math.round(rot * 60000) + '"' : '';
		const pic = '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="Picture ' + id + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/>' + srcRectXml + '<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm' + xfrmAttr + '><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>';
		const docPr = '<wp:docPr id="' + id + '" name="Picture ' + id + '"' + (img.alt ? ' descr="' + esc(img.alt) + '"' : '') + '/><wp:cNvGraphicFramePr/>';
		const wrap = img.dataset.wrap;
		if(wrap === 'front' || wrap === 'square') { // a floating picture: page position across, paragraph position down
			const px = Math.round((parseFloat(img.dataset.x) || 0) * 9525),
				py = Math.round((parseFloat(img.dataset.y) || 0) * 9525);
			const dist = wrap === 'square' ? 114300 : 0;
			return '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="' + dist + '" distR="' + dist + '" simplePos="0" relativeHeight="' + (251658240 + id) + '" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>' + px + '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>' + py + '</wp:posOffset></wp:positionV><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' + (wrap === 'square' ? '<wp:wrapSquare wrapText="bothSides"/>' : '<wp:wrapNone/>') + docPr + pic + '</wp:anchor></w:drawing></w:r>';
		}
		return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/>' + docPr + pic + '</wp:inline></w:drawing></w:r>';
	}
	
	async function inline(nodes, st, ctx) {
		let out = '';
		for(const n of Array.from(nodes)) {
			if(n.nodeType === 3) out += textRun(n.nodeValue, st);
			else if(n.nodeType === 1) {
				const tag = n.tagName;
				if(tag === 'BR') {
					if(n.nextSibling) out += '<w:r><w:br/></w:r>';
				}
				else if(tag === 'IMG') out += await imageRun(n, ctx);
				else if(tag === 'UL' || tag === 'OL' || tag === 'TABLE') continue;
				else if(tag === 'A' && /^(https?:|mailto:)/i.test(n.getAttribute('href') || '')) {
					const rid = 'rIdLnk' + (ctx.links.length + 1);
					ctx.links.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + esc(n.getAttribute('href')) + '" TargetMode="External"/>');
					const s2 = Object.assign({}, styleState(n, st), {
						color: '0563C1',
						u: true
					});
					out += '<w:hyperlink r:id="' + rid + '">' + await inline(n.childNodes, s2, ctx) + '</w:hyperlink>';
				} else {
					const inner = await inline(n.childNodes, styleState(n, st), ctx);
					out += inner;
					if(BLOCKS.has(tag) && n.nextSibling && inner) out += '<w:r><w:br/></w:r>';
				}
			}
		}
		return out;
	}

	function alignOf(el) {
		const a = (el.style && el.style.textAlign) || el.getAttribute('align') || '';
		return a === 'center' ? 'center' : a === 'right' ? 'right' : a === 'justify' ? 'both' : '';
	}

	function para(runs, o) {
		o = o || {};
		let ppr = '';
		if(o.style) ppr += '<w:pStyle w:val="' + o.style + '"/>';
		if(o.num) ppr += '<w:numPr><w:ilvl w:val="' + o.num.lvl + '"/><w:numId w:val="' + o.num.id + '"/></w:numPr>';
		if(o.indent) ppr += '<w:ind w:left="' + o.indent + '"/>';
		if(o.align) ppr += '<w:jc w:val="' + o.align + '"/>';
		return '<w:p>' + (ppr ? '<w:pPr>' + ppr + '</w:pPr>' : '') + runs + '</w:p>';
	}

	function hasBlockChild(el) {
		return Array.from(el.childNodes).some((c) => c.nodeType === 1 && BLOCKS.has(c.tagName));
	}

	async function blocks(nodes, st, ctx, o) {
		o = o || {};
		let out = '',
			buf = [];
		const flush = async() => {
			if(!buf.length) return;
			const runs = await inline(buf, st, ctx);
			buf = [];
			if(runs.trim() || buf.length === 0) {
				if(runs) out += para(runs, {
					indent: o.indent
				});
			}
		};
		for(const n of Array.from(nodes)) {
			if(n.nodeType === 3) {
				if(n.nodeValue.trim() || buf.length) buf.push(n);
				continue;
			}
			if(n.nodeType !== 1) continue;
			const tag = n.tagName;
			if(!BLOCKS.has(tag)) {
				buf.push(n);
				continue;
			}
			await flush();
			if(/^H[1-6]$/.test(tag)) {
				const lvl = Math.min(3, parseInt(tag[1], 10));
				out += para(await inline(n.childNodes, styleState(n, st), ctx), {
					style: 'Heading' + lvl,
					align: alignOf(n),
					indent: o.indent
				});
			} else if(tag === 'UL' || tag === 'OL') out += await list(n, 0, st, ctx, null);
			else if(tag === 'TABLE') out += await table(n, st, ctx);
			else if(tag === 'BLOCKQUOTE') out += await blocks(n.childNodes, styleState(n, st), ctx, {
				indent: (o.indent || 0) + 720
			});
			else if(tag === 'HR') out += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';
			else if(tag === 'DIV' && hasBlockChild(n)) out += await blocks(n.childNodes, styleState(n, st), ctx, o);
			else { // P, PRE, simple DIV
				const s2 = styleState(n, st);
				const runs = await inline(n.childNodes, s2, ctx);
				let ind = o.indent || 0;
				const ml = parseFloat(n.style && n.style.marginLeft);
				if(ml > 0) ind += Math.round(ml * TW);
				out += para(runs, {
					align: alignOf(n),
					indent: ind || 0
				});
			}
		}
		await flush();
		return out;
	}

	async function list(el, depth, st, ctx, olId) {
		const isOl = el.tagName === 'OL';
		let numId = 1;
		if(isOl) numId = olId || ctx.newOl();
		let out = '';
		for(const li of Array.from(el.children)) {
			if(li.tagName !== 'LI') continue;
			const s2 = styleState(li, st);
			const content = Array.from(li.childNodes).filter((c) => !(c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')));
			out += para(await inline(content, s2, ctx), {
				num: {
					id: numId,
					lvl: Math.min(8, depth)
				},
				align: alignOf(li)
			});
			for(const sub of Array.from(li.children)) {
				if(sub.tagName === 'UL' || sub.tagName === 'OL') out += await list(sub, depth + 1, st, ctx, sub.tagName === 'OL' && isOl ? numId : null);
			}
		}
		return out;
	}

	async function table(el, st, ctx) {
		const rows = Array.from(el.rows);
		if(!rows.length) return '';
		const cols = Math.max.apply(null, rows.map((r) => Array.from(r.cells).reduce((n, c) => n + (c.colSpan || 1), 0))) || 1;
		const total = ctx.pageW - 2880,
			colW = Math.floor(total / cols);
		let x = '<w:tbl><w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="9AA0A6"/>').join('') + '</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>' + new Array(cols).fill('<w:gridCol w:w="' + colW + '"/>').join('') + '</w:tblGrid>';
		const pending = new Array(cols).fill(null);
		for(const row of rows) {
			x += '<w:tr>';
			const cells = Array.from(row.cells);
			let ci = 0,
				c = 0;
			while(c < cols) {
				if(pending[c]) {
					const p = pending[c];
					x += '<w:tc><w:tcPr><w:tcW w:w="' + colW * p.span + '" w:type="dxa"/>' + (p.span > 1 ? '<w:gridSpan w:val="' + p.span + '"/>' : '') + '<w:vMerge/></w:tcPr><w:p/></w:tc>';
					p.n--;
					const span = p.span;
					if(p.n <= 0)
						for(let k = 0; k < span; k++) pending[c + k] = null;
					c += span;
					continue;
				}
				const cell = cells[ci++];
				if(!cell) break;
				const span = Math.min(cell.colSpan || 1, cols - c),
					rs = cell.rowSpan || 1;
				let inner = await blocks(cell.childNodes, styleState(cell, st), ctx);
				if(!inner || !/<\/w:p>$/.test(inner)) inner += '<w:p/>';
				x += '<w:tc><w:tcPr><w:tcW w:w="' + colW * span + '" w:type="dxa"/>' + (span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '') + (rs > 1 ? '<w:vMerge w:val="restart"/>' : '') + '</w:tcPr>' + inner + '</w:tc>';
				if(rs > 1)
					for(let k = 0; k < span; k++) pending[c + k] = {
						n: rs - 1,
						span: k === 0 ? span : 0
					};
				c += span;
			}
			x += '</w:tr>';
		}
		return x + '</w:tbl>';
	}

	function numberingXml() {
		const bullets = ['•', '○', '▪'],
			dec = ['decimal', 'lowerLetter', 'lowerRoman'];
		let lv1 = '',
			lv2 = '';
		for(let l = 0; l < 9; l++) {
			const ind = '<w:pPr><w:ind w:left="' + 720 * (l + 1) + '" w:hanging="360"/></w:pPr>';
			lv1 += '<w:lvl w:ilvl="' + l + '"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="' + bullets[l % 3] + '"/><w:lvlJc w:val="left"/>' + ind + '<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:lvl>';
			lv2 += '<w:lvl w:ilvl="' + l + '"><w:start w:val="1"/><w:numFmt w:val="' + dec[l % 3] + '"/><w:lvlText w:val="%' + (l + 1) + '."/><w:lvlJc w:val="left"/>' + ind + '</w:lvl>';
		}
		return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + lv1 + '</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + lv2 + '</w:abstractNum>';
	}

	const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' + [
		[1, 40, 360],
		[2, 32, 320],
		[3, 26, 280]
	].map((h) => '<w:style w:type="paragraph" w:styleId="Heading' + h[0] + '"><w:name w:val="heading ' + h[0] + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="' + h[2] + '" w:after="120"/><w:outlineLvl w:val="' + (h[0] - 1) + '"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="' + h[1] + '"/><w:szCs w:val="' + h[1] + '"/></w:rPr></w:style>').join('') + '</w:styles>';
	
	async function buildDocx() {
		const A4 = pageSizeEl.value === 'a4';
		const ctx = {
			pageW: A4 ? 11906 : 12240,
			pageH: A4 ? 16838 : 15840,
			media: [],
			rels: [],
			links: [],
			exts: new Set(),
			drawId: 1,
			skippedImages: 0,
			olCount: 1
		};
		let numNums = '';
		ctx.newOl = () => {
			const id = ++ctx.olCount;
			numNums += '<w:num w:numId="' + id + '"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>';
			return id;
		};
		let body = await blocks(doc.childNodes, {}, ctx);
		if(!body || /<\/w:tbl>$/.test(body)) body += '<w:p/>';
		const sect = '<w:sectPr><w:pgSz w:w="' + ctx.pageW + '" w:h="' + ctx.pageH + '"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>';
		const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
		const zip = new JSZip();
		const ctypes = {
			png: 'image/png',
			jpg: 'image/jpeg',
			gif: 'image/gif'
		};
		zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + Array.from(ctx.exts).map((e) => '<Default Extension="' + e + '" ContentType="' + ctypes[e] + '"/>').join('') + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
		zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
		zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' + ctx.rels.join('') + ctx.links.join('') + '</Relationships>');
		zip.file('word/styles.xml', STYLES);
		zip.file('word/numbering.xml', numberingXml() + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' + numNums + '</w:numbering>');
		zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + body + sect + '</w:body></w:document>');
		ctx.media.forEach((m) => zip.file('word/media/' + m.name, m.bytes));
		return {
			blob: await zip.generateAsync({
				type: 'blob',
				compression: 'DEFLATE',
				mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
			}),
			skipped: ctx.skippedImages
		};
	}

	async function save() {
		clearError();
		const btn = $('weSaveBtn');
		btn.disabled = true;
		setStatus('Saving…', false);
		try {
			const r = await buildDocx();
			const name = (nameEl.value.trim().replace(/[\\/:*?"<>|]+/g, '') || 'document') + '.docx';
			triggerDownload(r.blob, name);
			dirty = false;
			setStatus('Saved as ' + name, false);
			if(r.skipped) showError(r.skipped + ' picture' + (r.skipped === 1 ? ' was' : 's were') + ' not saved because ' + (r.skipped === 1 ? 'it was' : 'they were') + ' linked from the web. Insert them with the Picture button instead.');
		} catch(e) {
			console.error(e);
			setStatus('Could not save', true);
			showError('Could not save the file: ' + (e && e.message ? e.message : e));
		}
		btn.disabled = false;
	}
	$('weSaveBtn').addEventListener('click', save);
	window.MatteWordEditor = {
		buildDocx
	};
	updateCount();
})();