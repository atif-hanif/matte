(function() {
	var $ = function(i) {
		return document.getElementById(i)
	};

	var files = [],
		merged = null,
		dl = null,
		uid = 0;
	try {
		if(window.claude && window.claude.use) {
			window.claude.use('downloads').then(function(d) {
				dl = d
			}).catch(function() {});
		}
	} catch(e) {}
	var dz = $('dropzone'),
		fi = $('fileInput');

	function fmt(n) {
		return n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'
	}

	function showErr(t) {
		var e = $('err');
		e.textContent = t || '';
		e.classList.toggle('show', !!t)
	}

	function note(t) {
		var m = $('msg');
		m.textContent = t;
		m.hidden = !t
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
		add(e.dataTransfer.files)
	});

	fi.onchange = function() {
		add(fi.files);
		fi.value = ''
	};

	$('addMore').onclick = function() {
		fi.click()
	};

	function add(list) {
		showErr('');
		var arr = [].slice.call(list).filter(function(f) {
			return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'
		});
		if(!arr.length) {
			showErr('Please choose PDF files.');
			return
		}
		var bad = [];
		var chain = Promise.resolve();
		arr.forEach(function(f) {
			chain = chain.then(function() {
				return f.arrayBuffer().then(function(buf) {
					return PDFLib.PDFDocument.load(buf).then(function(d) {
						files.push({
							id: ++uid,
							name: f.name,
							size: f.size,
							buf: buf,
							pages: d.getPageCount()
						});
					});
				}).catch(function() {
					bad.push(f.name)
				});
			});
		});
		chain.then(function() {
			if(bad.length) showErr('Could not read: ' + bad.join(', ') + '. They may be encrypted or damaged.');
			merged = null;
			render();
		});
	}

	function render() {
		$('res').hidden = !merged;
		note('');
		dz.hidden = files.length > 0;
		$('tool').hidden = !files.length;
		var tp = files.reduce(function(a, f) {
			return a + f.pages
		}, 0);
		$('summary').textContent = files.length + ' file' + (files.length === 1 ? '' : 's') + ' · ' + tp + ' page' + (tp === 1 ? '' : 's');
		$('go').disabled = files.length < 2;
		$('go').textContent = files.length < 2 ? 'Add at least 2 PDFs' : 'Merge PDFs';
		var box = $('list');
		box.innerHTML = '';
		files.forEach(function(f, i) {
			var d = document.createElement('div');
			d.className = 'item';
			var n = document.createElement('div');
			n.className = 'num';
			n.textContent = i + 1;
			var m = document.createElement('div');
			m.className = 'meta';
			var s = document.createElement('strong');
			s.textContent = f.name;
			s.title = f.name;
			var sm = document.createElement('small');
			sm.textContent = f.pages + ' page' + (f.pages === 1 ? '' : 's') + ' · ' + fmt(f.size);
			m.appendChild(s);
			m.appendChild(sm);
			var c = document.createElement('div');
			c.className = 'ctl';

			function ib(t, label, fn, dis) {
				var b = document.createElement('button');
				b.className = 'ib';
				b.textContent = t;
				b.title = label;
				b.setAttribute('aria-label', label);
				b.disabled = !!dis;
				b.onclick = fn;
				c.appendChild(b)
			}
			ib('↑', 'Move up', function() {
				mv(i, -1)
			}, i === 0);
			ib('↓', 'Move down', function() {
				mv(i, 1)
			}, i === files.length - 1);
			ib('✕', 'Remove', function() {
				files.splice(i, 1);
				merged = null;
				render()
			});
			d.appendChild(n);
			d.appendChild(m);
			d.appendChild(c);
			box.appendChild(d);
		});
	}

	function mv(i, d) {
		var j = i + d;
		if(j < 0 || j >= files.length) return;
		var t = files[i];
		files[i] = files[j];
		files[j] = t;
		merged = null;
		render()
	}

	$('sortName').onclick = function() {
		files.sort(function(a, b) {
			return a.name.localeCompare(b.name, undefined, {
				numeric: true
			})
		});
		merged = null;
		render()
	};

	$('clear').onclick = function() {
		files = [];
		merged = null;
		showErr('');
		render()
	};

	$('go').onclick = function() {
		showErr('');
		var btn = $('go');
		btn.disabled = true;
		btn.textContent = 'Merging…';
		PDFLib.PDFDocument.create().then(function(out) {
			var chain = Promise.resolve();
			files.forEach(function(f) {
				chain = chain.then(function() {
					return PDFLib.PDFDocument.load(f.buf).then(function(d) {
						return out.copyPages(d, d.getPageIndices());
					}).then(function(pgs) {
						pgs.forEach(function(p) {
							out.addPage(p)
						})
					});
				});
			});
			return chain.then(function() {
				return out.save()
			});
		}).then(function(bytes) {
			var nm = ($('outName').value.trim() || 'matte').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '_') + '.pdf';
			merged = {
				name: nm,
				bytes: bytes
			};
			var tp = files.reduce(function(a, f) {
				return a + f.pages
			}, 0);
			$('rname').textContent = nm;
			$('rinfo').textContent = tp + ' pages · ' + fmt(bytes.length);
			$('res').hidden = false;
			$('res').scrollIntoView({
				behavior: 'smooth',
				block: 'nearest'
			});
		}).catch(function(e) {
			showErr('Something went wrong: ' + e.message)
		}).then(function() {
			btn.disabled = files.length < 2;
			btn.textContent = files.length < 2 ? 'Add at least 2 PDFs' : 'Merge PDFs'
		});
	};

	$('dl').onclick = function() {
		if(!merged) return;
		var blob = new Blob([merged.bytes], {
				type: 'application/pdf'
			}),
			name = merged.name;
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
				a.remove()
			} catch(e) {
				note('Downloads are unavailable in this view.')
			}
		}
	};
})();