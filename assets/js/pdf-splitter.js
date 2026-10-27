(function() {
	var $ = function(i) {
		return document.getElementById(i)
	};
	var src = null,
		total = 0,
		base = 'document',
		mode = 'range',
		outputs = [],
		dl = null;
	var dz = $('dropzone'),
		fi = $('fileInput');
	claude_init();

	function claude_init() {
		try {
			if(window.claude && window.claude.use) {
				window.claude.use('downloads').then(function(d) {
					dl = d
				}).catch(function() {});
			}
		} catch(e) {}
	}
	dz.onclick = function() {
		fi.click()
	};
	dz.onkeydown = function(e) {
		if(e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			fi.click()
		}
	};
	['dragover', 'dragenter'].forEach(function(t) {
		dz.addEventListener(t, function(e) {
			e.preventDefault();
			dz.classList.add('drag')
		})
	});
	['dragleave', 'drop'].forEach(function(t) {
		dz.addEventListener(t, function(e) {
			e.preventDefault();
			dz.classList.remove('drag')
		})
	});
	dz.addEventListener('drop', function(e) {
		var f = e.dataTransfer.files[0];
		if(f) load(f)
	});
	fi.onchange = function() {
		if(fi.files[0]) load(fi.files[0])
	};
	$('change').onclick = function() {
		fi.value = '';
		fi.click()
	};

	function fmt(n) {
		return n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'
	}

	function showErr(t) {
		var e = $('err');
		e.textContent = t || '';
		e.classList.toggle('show', !!t)
	}

	function load(f) {
		showErr('');
		if(!/pdf$/i.test(f.name) && f.type !== 'application/pdf') {
			alert('Please choose a PDF file.');
			return
		}
		f.arrayBuffer().then(function(buf) {
			return PDFLib.PDFDocument.load(buf, {
				ignoreEncryption: false
			}).then(function(doc) {
				src = doc;
				total = doc.getPageCount();
				base = f.name.replace(/\.pdf$/i, '');
				$('fname').textContent = f.name;
				$('finfo').textContent = total + ' page' + (total === 1 ? '' : 's') + ' · ' + fmt(f.size);
				$('ranges').placeholder = 'e.g. 1-' + Math.max(1, Math.ceil(total / 2)) + (total > 1 ? ', ' + (Math.ceil(total / 2) + 1) + '-' + total : '');
				dz.hidden = true;
				$('tool').hidden = false;
				$('result').hidden = true;
				outputs = [];
			});
		}).catch(function() {
			alert('Could not read this PDF. It may be encrypted or damaged.')
		});
	}
	var D = {
		range: ['Split by page ranges', 'Pick exactly which pages you want. Each range you enter, such as 1-3 or 7, is saved as its own PDF, which makes it easy to pull chapters or sections out of a long document.'],
		every: ['Split every N pages', 'Cut the document into equal chunks. Choose how many pages each file should hold and the last file simply takes whatever pages remain.'],
		single: ['Split into single pages', 'Turn every page into a separate one-page PDF. Handy for separating scanned sheets, invoices or slides.']
	};

	function setDesc() {
		$('dtitle').textContent = D[mode][0];
		$('dtext').textContent = D[mode][1]
	}
	setDesc();
	$('tabs').onclick = function(e) {
		var b = e.target.closest('button');
		if(!b) return;
		mode = b.dataset.m;
		[].forEach.call($('tabs').children, function(x) {
			x.classList.toggle('on', x === b)
		});
		['range', 'every', 'single'].forEach(function(m) {
			$('p-' + m).hidden = m !== mode
		});
		setDesc();
		showErr('');
	};

	function parseRanges(s) {
		var out = [];
		var parts = s.split(',').map(function(x) {
			return x.trim()
		}).filter(Boolean);
		if(!parts.length) throw new Error('Enter at least one page range.');
		parts.forEach(function(p) {
			var m = p.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
			if(!m) throw new Error('Invalid range: “' + p + '”.');
			var a = +m[1],
				b = m[2] ? +m[2] : a;
			if(a < 1 || b < a || b > total) throw new Error('Range “' + p + '” is outside 1–' + total + '.');
			out.push([a, b]);
		});
		return out;
	}

	function buildPlan() {
		if(mode === 'range') return parseRanges($('ranges').value);
		var n = mode === 'single' ? 1 : parseInt($('every').value, 10);
		if(!n || n < 1) throw new Error('Pages per file must be 1 or more.');
		var out = [];
		for(var i = 1; i <= total; i += n) out.push([i, Math.min(total, i + n - 1)]);
		return out;
	}

	function label(r) {
		return r[0] === r[1] ? 'page ' + r[0] : 'pages ' + r[0] + '–' + r[1]
	}

	function fname(r, i, len) {
		var pad = String(len).length;
		var idx = String(i + 1);
		while(idx.length < pad) idx = '0' + idx;
		return base + '_part' + idx + '_p' + (r[0] === r[1] ? r[0] : r[0] + '-' + r[1]) + '.pdf';
	}
	$('go').onclick = function() {
		showErr('');
		var plan;
		try {
			plan = buildPlan()
		} catch(e) {
			showErr(e.message);
			return
		}
		var btn = $('go');
		btn.disabled = true;
		btn.textContent = 'Splitting…';
		outputs = [];
		var chain = Promise.resolve();
		plan.forEach(function(r, i) {
			chain = chain.then(function() {
				return PDFLib.PDFDocument.create().then(function(nd) {
					var idx = [];
					for(var p = r[0] - 1; p <= r[1] - 1; p++) idx.push(p);
					return nd.copyPages(src, idx).then(function(pgs) {
						pgs.forEach(function(pg) {
							nd.addPage(pg)
						});
						return nd.save();
					});
				}).then(function(bytes) {
					outputs.push({
						name: fname(r, i, plan.length),
						label: label(r),
						bytes: bytes
					})
				});
			});
		});
		chain.then(render).catch(function(e) {
			showErr('Something went wrong: ' + e.message)
		}).then(function() {
			btn.disabled = false;
			btn.textContent = 'Split PDF'
		});
	};

	function render() {
		var box = $('parts');
		box.innerHTML = '';
		$('rtitle').textContent = outputs.length + ' file' + (outputs.length === 1 ? '' : 's') + ' ready';
		$('zipAll').hidden = outputs.length < 2;
		outputs.forEach(function(o, i) {
			var c = document.createElement('div');
			c.className = 'card';
			var t = document.createElement('div');
			t.className = 'thumb';
			t.textContent = String(i + 1);
			var f = document.createElement('div');
			f.className = 'foot';
			var r1 = document.createElement('div');
			r1.className = 'row';
			var n = document.createElement('span');
			n.className = 'name';
			n.textContent = o.name;
			n.title = o.name;
			var s = document.createElement('span');
			s.className = 'st';
			s.textContent = 'Done';
			r1.appendChild(n);
			r1.appendChild(s);
			var r2 = document.createElement('div');
			r2.className = 'row';
			var sm = document.createElement('small');
			sm.textContent = o.label + ' · ' + fmt(o.bytes.length);
			var b = document.createElement('button');
			b.className = 'dl';
			b.textContent = 'Download';
			b.onclick = function() {
				save(o.name, new Blob([o.bytes], {
					type: 'application/pdf'
				}))
			};
			r2.appendChild(sm);
			r2.appendChild(b);
			f.appendChild(r1);
			f.appendChild(r2);
			c.appendChild(t);
			c.appendChild(f);
			box.appendChild(c);
		});
		$('result').hidden = false;
		$('result').scrollIntoView({
			behavior: 'smooth',
			block: 'nearest'
		});
	}
	$('zipAll').onclick = function() {
		var z = new JSZip();
		outputs.forEach(function(o) {
			z.file(o.name, o.bytes)
		});
		z.generateAsync({
			type: 'blob'
		}).then(function(b) {
			save(base + '_split.zip', b)
		});
	};

	function note(t) {
		var m = $('msg');
		m.textContent = t;
		m.hidden = !t
	}

	function save(name, blob) {
		note('');
		if(dl) {
			dl.save({
				filename: name,
				data: blob
			}).then(function() {
				note('Saved ' + name)
			}).catch(function(e) {
				if(e && e.code === 'declined') return;
				note('Could not save the file here. Open the page in a regular browser tab and try again.');
			});
		} else {
			try {
				var a = document.createElement('a');
				a.href = URL.createObjectURL(blob);
				a.download = name;
				document.body.appendChild(a);
				a.click();
				a.remove();
			} catch(e) {
				note('Downloads are unavailable in this view.')
			}
		}
	}
})();