(function() {
	var $ = function(i) {
		return document.getElementById(i);
	};

	var items = [],
		result = null,
		uid = 0,
		dragId = null;

	var MM = 72 / 25.4;
	var PAGE_SIZES = { // portrait, in PDF points
		a4: [595.28, 841.89],
		a3: [841.89, 1190.55],
		a5: [419.53, 595.28],
		letter: [612, 792],
		legal: [612, 1008]
	};
	var MARGINS = {
		none: 0,
		small: 10 * MM,
		large: 20 * MM
	};
	var MAX_SIDE = 8000; // largest side we redraw at, to stay within browser canvas limits

	var dz = $('dropzone'),
		fi = $('fileInput');

	function fmt(n) {
		return n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
	}

	function showErr(t) {
		var e = $('err');
		e.textContent = t || '';
		e.classList.toggle('show', !!t);
	}

	function note(t) {
		var m = $('msg');
		m.textContent = t || '';
		m.hidden = !t;
	}

	function isImage(f) {
		return /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif|tiff?)$/i.test(f.name);
	}

	// ---- adding files ----

	dz.onclick = function() {
		fi.click();
	};

	dz.onkeydown = function(e) {
		if(e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			fi.click();
		}
	};

	['dragover', 'dragenter'].forEach(function(t) {
		dz.addEventListener(t, function(e) {
			e.preventDefault();
			dz.classList.add('drag');
		});
	});

	['dragleave', 'drop'].forEach(function(t) {
		dz.addEventListener(t, function(e) {
			e.preventDefault();
			dz.classList.remove('drag');
		});
	});

	dz.addEventListener('drop', function(e) {
		add(e.dataTransfer.files);
	});

	// more pictures can be dropped on the list too
	$('tool').addEventListener('dragover', function(e) {
		if(dragId === null && e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], 'Files') !== -1) e.preventDefault();
	});
	$('tool').addEventListener('drop', function(e) {
		if(dragId === null && e.dataTransfer && e.dataTransfer.files.length) {
			e.preventDefault();
			add(e.dataTransfer.files);
		}
	});

	document.addEventListener('paste', function(e) {
		var tag = (e.target.tagName || '').toLowerCase();
		if(tag === 'input' || tag === 'textarea') return;
		var files = [].slice.call((e.clipboardData && e.clipboardData.files) || []);
		if(files.length) {
			e.preventDefault();
			add(files);
		}
	});

	fi.onchange = function() {
		add(fi.files);
		fi.value = '';
	};

	$('addMore').onclick = function() {
		fi.click();
	};

	function loadImage(url) {
		return new Promise(function(res, rej) {
			var img = new Image();
			img.onload = function() {
				res(img);
			};
			img.onerror = function() {
				rej(new Error('decode'));
			};
			img.src = url;
		});
	}

	// Reads the EXIF orientation of a JPEG (1 = upright). Phones often save photos
	// sideways with this flag; the browser honours it, but the raw file in a PDF would not.
	function jpegOrientation(buf) {
		var v = new DataView(buf);
		if(v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return 0;
		var off = 2;
		while(off + 4 < v.byteLength) {
			var marker = v.getUint16(off);
			if((marker & 0xFF00) !== 0xFF00) return 0;
			var len = v.getUint16(off + 2);
			if(marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) { // "Exif"
				var t = off + 10;
				var little = v.getUint16(t) === 0x4949;
				var ifd = t + v.getUint32(t + 4, little);
				var n = v.getUint16(ifd, little);
				for(var i = 0; i < n; i++) {
					var e = ifd + 2 + i * 12;
					if(e + 10 > v.byteLength) return 0;
					if(v.getUint16(e, little) === 0x0112) return v.getUint16(e + 8, little);
				}
				return 1;
			}
			if(marker === 0xFFDA) break;
			off += 2 + len;
		}
		return 1;
	}

	function kindOf(f, buf) {
		var b = new Uint8Array(buf.slice(0, 8));
		if(b[0] === 0xFF && b[1] === 0xD8) return 'jpg';
		if(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
		return 'other';
	}

	function add(list) {
		showErr('');
		var arr = [].slice.call(list).filter(isImage);
		if(!arr.length) {
			showErr('Please choose picture files (JPG, PNG, WEBP, GIF, BMP or SVG).');
			return;
		}
		var bad = [];
		var chain = Promise.resolve();
		arr.forEach(function(f) {
			chain = chain.then(function() {
				var url = URL.createObjectURL(f);
				return Promise.all([f.arrayBuffer(), loadImage(url)]).then(function(r) {
					var buf = r[0],
						img = r[1],
						kind = kindOf(f, buf);
					var w = img.naturalWidth || img.width,
						h = img.naturalHeight || img.height;
					if(!w || !h) { // some SVGs have no size of their own
						w = 1000;
						h = 1000;
					}
					items.push({
						id: ++uid,
						name: f.name,
						size: f.size,
						url: url,
						img: img,
						buf: buf,
						kind: kind,
						exif: kind === 'jpg' ? jpegOrientation(buf) : 0,
						w: w,
						h: h,
						rot: 0
					});
				}).catch(function() {
					URL.revokeObjectURL(url);
					bad.push(f.name);
				});
			});
		});
		chain.then(function() {
			if(bad.length) showErr('Could not read: ' + bad.join(', ') + '. Your browser may not support that picture format.');
			result = null;
			render();
		});
	}

	// ---- list ----

	function render() {
		$('res').hidden = !result;
		note('');
		dz.hidden = items.length > 0;
		$('tool').hidden = !items.length;
		var total = items.reduce(function(a, it) {
			return a + it.size;
		}, 0);
		$('summary').textContent = items.length + ' picture' + (items.length === 1 ? '' : 's') + ' · ' + fmt(total);
		$('go').disabled = !items.length;
		var box = $('list');
		box.innerHTML = '';
		items.forEach(function(it, i) {
			var d = document.createElement('div');
			d.className = 'item';
			d.draggable = true;
			d.dataset.id = it.id;

			var n = document.createElement('div');
			n.className = 'num';
			n.textContent = i + 1;

			var th = document.createElement('div');
			th.className = 'thumb';
			var im = document.createElement('img');
			im.src = it.url;
			im.alt = '';
			im.style.transform = 'rotate(' + it.rot + 'deg)';
			th.appendChild(im);

			var m = document.createElement('div');
			m.className = 'meta';
			var s = document.createElement('strong');
			s.textContent = it.name;
			s.title = it.name;
			var sm = document.createElement('small');
			var sw = it.rot % 180 ? it.h : it.w,
				sh = it.rot % 180 ? it.w : it.h;
			sm.textContent = sw + ' × ' + sh + ' px · ' + fmt(it.size);
			m.appendChild(s);
			m.appendChild(sm);

			var c = document.createElement('div');
			c.className = 'ctl';

			function ib(t, label, fn, dis) {
				var b = document.createElement('button');
				b.type = 'button';
				b.className = 'ib';
				b.textContent = t;
				b.title = label;
				b.setAttribute('aria-label', label);
				b.disabled = !!dis;
				b.onclick = fn;
				c.appendChild(b);
			}
			ib('↻', 'Rotate', function() {
				it.rot = (it.rot + 90) % 360;
				result = null;
				render();
			});
			ib('↑', 'Move up', function() {
				mv(i, i - 1);
			}, i === 0);
			ib('↓', 'Move down', function() {
				mv(i, i + 1);
			}, i === items.length - 1);
			ib('✕', 'Remove', function() {
				URL.revokeObjectURL(it.url);
				items.splice(i, 1);
				result = null;
				render();
			});

			d.appendChild(n);
			d.appendChild(th);
			d.appendChild(m);
			d.appendChild(c);
			box.appendChild(d);
		});
	}

	function mv(from, to) {
		if(to < 0 || to >= items.length || from === to) return;
		var it = items.splice(from, 1)[0];
		items.splice(to, 0, it);
		result = null;
		render();
	}

	// drag rows to reorder
	var list = $('list');
	list.addEventListener('dragstart', function(e) {
		var row = e.target.closest('.item');
		if(!row) return;
		dragId = row.dataset.id;
		row.classList.add('dragging');
		if(e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			try {
				e.dataTransfer.setData('text/plain', dragId);
			} catch(x) {}
		}
	});
	list.addEventListener('dragover', function(e) {
		var row = e.target.closest('.item');
		if(!row || dragId === null) return;
		e.preventDefault();
		[].forEach.call(list.querySelectorAll('.over'), function(el) {
			if(el !== row) el.classList.remove('over');
		});
		row.classList.add('over');
	});
	list.addEventListener('drop', function(e) {
		var row = e.target.closest('.item');
		if(!row || dragId === null) return;
		e.preventDefault();
		e.stopPropagation();
		var from = items.findIndex(function(x) {
				return String(x.id) === dragId;
			}),
			to = items.findIndex(function(x) {
				return String(x.id) === row.dataset.id;
			});
		dragId = null;
		mv(from, to);
	});
	list.addEventListener('dragend', function() {
		dragId = null;
		[].forEach.call(list.querySelectorAll('.over, .dragging'), function(el) {
			el.classList.remove('over', 'dragging');
		});
	});

	$('sortName').onclick = function() {
		items.sort(function(a, b) {
			return a.name.localeCompare(b.name, undefined, {
				numeric: true
			});
		});
		result = null;
		render();
	};

	$('clear').onclick = function() {
		items.forEach(function(it) {
			URL.revokeObjectURL(it.url);
		});
		items = [];
		result = null;
		showErr('');
		render();
	};

	['pageSize', 'orient', 'margin', 'quality'].forEach(function(id) {
		$(id).addEventListener('change', function() {
			result = null;
			$('res').hidden = true;
			$('orientRow').classList.toggle('is-off', $('pageSize').value === 'fit');
		});
	});

	// ---- building the PDF ----

	function canvasBlob(c, type, q) {
		return new Promise(function(res, rej) {
			c.toBlob(function(b) {
				if(b) b.arrayBuffer().then(res, rej);
				else rej(new Error('Your browser could not encode this picture.'));
			}, type, q);
		});
	}

	// Returns {bytes, fmt, w, h} for one picture, ready for pdf-lib.
	function prepare(it, quality) {
		var asIs = quality === 'original' && it.rot === 0 &&
			((it.kind === 'png') || (it.kind === 'jpg' && it.exif <= 1));
		if(asIs) return Promise.resolve({
			bytes: it.buf,
			fmt: it.kind,
			w: it.w,
			h: it.h
		});
		var maxSide = quality === 'small' ? 1600 : (quality === 'medium' ? 2400 : MAX_SIDE);
		var k = Math.min(1, maxSide / Math.max(it.w, it.h));
		var w = Math.max(1, Math.round(it.w * k)),
			h = Math.max(1, Math.round(it.h * k));
		var turned = it.rot % 180 !== 0;
		var c = document.createElement('canvas');
		c.width = turned ? h : w;
		c.height = turned ? w : h;
		var x = c.getContext('2d');
		var jpeg = quality !== 'original' || it.kind === 'jpg';
		if(jpeg) { // JPEG has no transparency, so put the picture on white
			x.fillStyle = '#ffffff';
			x.fillRect(0, 0, c.width, c.height);
		}
		x.imageSmoothingQuality = 'high';
		x.translate(c.width / 2, c.height / 2);
		x.rotate(it.rot * Math.PI / 180);
		x.drawImage(it.img, -w / 2, -h / 2, w, h);
		var q = quality === 'small' ? 0.7 : (quality === 'medium' ? 0.82 : 0.92);
		return canvasBlob(c, jpeg ? 'image/jpeg' : 'image/png', q).then(function(bytes) {
			return {
				bytes: bytes,
				fmt: jpeg ? 'jpg' : 'png',
				w: c.width,
				h: c.height
			};
		});
	}

	function pageFor(imgW, imgH, size, orient, margin) {
		if(size === 'fit') { // page the size of the picture (at 96 pixels per inch)
			var pw = imgW * 0.75 + margin * 2,
				ph = imgH * 0.75 + margin * 2;
			var cap = 14400 / Math.max(pw, ph); // PDF page size limit (200 in)
			if(cap < 1) {
				pw *= cap;
				ph *= cap;
			}
			return [pw, ph];
		}
		var s = PAGE_SIZES[size] || PAGE_SIZES.a4;
		var land = orient === 'landscape' || (orient === 'auto' && imgW > imgH);
		return land ? [s[1], s[0]] : [s[0], s[1]];
	}

	function cleanName(s) {
		return (String(s || '').trim() || 'images').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
	}

	function setBusy(on, text) {
		var btn = $('go');
		btn.disabled = on || !items.length;
		btn.innerHTML = on ? '<i class="fa-solid fa-spinner fa-spin me-2"></i>' + text : '<i class="fa-solid fa-file-pdf me-2"></i>Convert to PDF';
	}

	$('go').onclick = function() {
		if(!items.length) return;
		showErr('');
		note('');
		var size = $('pageSize').value,
			orient = $('orient').value,
			margin = MARGINS[$('margin').value] || 0,
			quality = $('quality').value;
		var name = cleanName($('outName').value);
		setBusy(true, 'Converting…');
		var doc;
		PDFLib.PDFDocument.create().then(function(d) {
			doc = d;
			doc.setTitle(name.replace(/\.pdf$/, ''));
			doc.setCreator('Matte Image to PDF');
			doc.setProducer('Matte Tools');
			var chain = Promise.resolve();
			items.forEach(function(it, i) {
				chain = chain.then(function() {
					setBusy(true, 'Adding ' + (i + 1) + ' of ' + items.length + '…');
					return prepare(it, quality);
				}).then(function(p) {
					return (p.fmt === 'jpg' ? doc.embedJpg(p.bytes) : doc.embedPng(p.bytes)).then(function(img) {
						var pg = pageFor(p.w, p.h, size, orient, margin);
						var page = doc.addPage(pg);
						var aw = pg[0] - margin * 2,
							ah = pg[1] - margin * 2;
						var k = Math.min(aw / p.w, ah / p.h);
						var dw = p.w * k,
							dh = p.h * k;
						page.drawImage(img, {
							x: (pg[0] - dw) / 2,
							y: (pg[1] - dh) / 2,
							width: dw,
							height: dh
						});
					});
				});
			});
			return chain.then(function() {
				return doc.save();
			});
		}).then(function(bytes) {
			result = {
				name: name,
				bytes: bytes
			};
			$('rname').textContent = name;
			$('rinfo').textContent = items.length + ' page' + (items.length === 1 ? '' : 's') + ' · ' + fmt(bytes.length);
			$('res').hidden = false;
			$('res').scrollIntoView({
				behavior: 'smooth',
				block: 'nearest'
			});
		}).catch(function(e) {
			console.error(e);
			showErr('Something went wrong: ' + (e && e.message ? e.message : e));
		}).then(function() {
			setBusy(false);
		});
	};

	$('dl').onclick = function() {
		if(!result) return;
		try {
			var a = document.createElement('a');
			a.href = URL.createObjectURL(new Blob([result.bytes], {
				type: 'application/pdf'
			}));
			a.download = result.name;
			document.body.appendChild(a);
			a.click();
			setTimeout(function() {
				URL.revokeObjectURL(a.href);
				a.remove();
			}, 4000);
		} catch(e) {
			note('Downloads are unavailable in this view.');
		}
	};

	if(!window.PDFLib) showErr('The PDF library was not found. Make sure assets/vendors/pdf/pdf-lib.min.js is on your site, then reload.');
})();
