(function() {
	var $ = function(i) {
		return document.getElementById(i)
	};
	var buf = null,
		fileName = 'document',
		fileSize = 0,
		mode = 'balanced',
		out = null,
		dl = null,
		busy = false;
	try {
		if(window.claude && window.claude.use) {
			window.claude.use('downloads').then(function(d) {
				dl = d
			}).catch(function() {});
		}
	} catch(e) {}
	if(window.pdfjsLib) {
		pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
	}
	var M = {
		light: {
			t: 'Light: keeps text selectable',
			d: 'Cleans up and re-saves the file without touching its pages. Text stays selectable and sharp, but the saving is usually small. Best for PDFs that are already mostly text.'
		},
		balanced: {
			t: 'Balanced: good quality, much smaller',
			d: 'Turns each page into a 150 dpi picture. Looks good on screen and in print, and works well for scans and photo-heavy files. Text is no longer selectable.',
			dpi: 150,
			q: .75
		},
		strong: {
			t: 'Strong: smaller still',
			d: 'Turns each page into a 110 dpi picture with extra compression. Fine for reading on a screen or emailing. Text is no longer selectable.',
			dpi: 110,
			q: .6
		},
		max: {
			t: 'Maximum: smallest file',
			d: 'Turns each page into a 72 dpi picture with heavy compression. Smallest result, but fine print may look soft. Text is no longer selectable.',
			dpi: 72,
			q: .5
		}
	};

	function setDesc() {
		$('dtitle').textContent = M[mode].t;
		$('dtext').textContent = M[mode].d
	}
	
	setDesc();
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
		if(e.dataTransfer.files[0]) load(e.dataTransfer.files[0])
	});

	fi.onchange = function() {
		if(fi.files[0]) load(fi.files[0]);
		fi.value = ''
	};

	$('change').onclick = function() {
		if(!busy) fi.click()
	};

	function load(f) {
		showErr('');
		if(!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') {
			showErr('Please choose a PDF file.');
			return
		}
		f.arrayBuffer().then(function(b) {
			return PDFLib.PDFDocument.load(b).then(function(d) {
				buf = b;
				fileSize = f.size;
				fileName = f.name.replace(/\.pdf$/i, '');
				$('fname').textContent = f.name;
				$('finfo').textContent = d.getPageCount() + ' page' + (d.getPageCount() === 1 ? '' : 's') + ' · ' + fmt(f.size);
				dz.hidden = true;
				$('tool').hidden = false;
				$('res').hidden = true;
				$('prog').hidden = true;
				out = null;
				note('');
			});
		}).catch(function() {
			showErr('Could not read this PDF. It may be encrypted or damaged.')
		});
	}

	$('tabs').onclick = function(e) {
		var b = e.target.closest('button');
		if(!b || busy) return;
		mode = b.dataset.m;
		[].forEach.call($('tabs').children, function(x) {
			x.classList.toggle('on', x === b)
		});
		setDesc();
		$('res').hidden = true;
		out = null;
		showErr('');
	};

	function progress(i, n, txt) {
		$('ptext').textContent = txt;
		$('pbar').style.width = Math.round(i / n * 100) + '%'
	}

	function light() {
		progress(1, 2, 'Optimising…');
		return PDFLib.PDFDocument.load(buf, {
			updateMetadata: false
		}).then(function(d) {
			return d.save({
				useObjectStreams: true
			});
		});
	}

	function raster(cfg) {
		if(!window.pdfjsLib) return Promise.reject(new Error('The PDF reader could not load. Check your connection and try again.'));
		return pdfjsLib.getDocument({
			data: new Uint8Array(buf.slice(0))
		}).promise.then(function(pdf) {
			var n = pdf.numPages;
			return PDFLib.PDFDocument.create().then(function(o) {
				var chain = Promise.resolve();
				for(var i = 1; i <= n; i++)(function(i) {
					chain = chain.then(function() {
						progress(i - 1, n, 'Compressing page ' + i + ' of ' + n + '…');
						return pdf.getPage(i).then(function(pg) {
							var v1 = pg.getViewport({
									scale: 1
								}),
								sc = cfg.dpi / 72;
							var maxSide = 4096,
								big = Math.max(v1.width, v1.height) * sc;
							if(big > maxSide) sc *= maxSide / big;
							var vp = pg.getViewport({
									scale: sc
								}),
								c = document.createElement('canvas');
							c.width = Math.ceil(vp.width);
							c.height = Math.ceil(vp.height);
							var ctx = c.getContext('2d');
							ctx.fillStyle = '#fff';
							ctx.fillRect(0, 0, c.width, c.height);
							return pg.render({
								canvasContext: ctx,
								viewport: vp
							}).promise.then(function() {
								return new Promise(function(res, rej) {
									c.toBlob(function(b) {
										b ? res(b) : rej(new Error('Could not encode page ' + i))
									}, 'image/jpeg', cfg.q)
								});
							}).then(function(b) {
								return b.arrayBuffer()
							}).then(function(ab) {
								return o.embedJpg(ab)
							}).then(function(img) {
								var p = o.addPage([v1.width, v1.height]);
								p.drawImage(img, {
									x: 0,
									y: 0,
									width: v1.width,
									height: v1.height
								});
								c.width = c.height = 0;
								pg.cleanup();
							});
						});
					});
				})(i);
				return chain.then(function() {
					progress(n, n, 'Finishing…');
					return o.save({
						useObjectStreams: true
					})
				});
			});
		});
	}

	$('go').onclick = function() {
		if(busy || !buf) return;
		showErr('');
		note('');
		$('res').hidden = true;
		busy = true;
		$('go').disabled = true;
		$('go').textContent = 'Compressing…';
		$('prog').hidden = false;
		progress(0, 1, 'Starting…');
		(mode === 'light' ? light() : raster(M[mode])).then(function(bytes) {
			out = bytes;
			var smaller = bytes.length < fileSize;
			$('rname').textContent = fileName + '_compressed.pdf';
			$('sb').textContent = fmt(fileSize);
			$('sa').textContent = fmt(bytes.length);
			var pct = Math.round((1 - bytes.length / fileSize) * 100);
			$('ss').textContent = smaller ? pct + '%' : '0%';
			var w = $('warn');
			if(!smaller) {
				w.hidden = false;
				w.textContent = 'This file could not be made smaller with this setting. Try a stronger level, or keep your original.'
			} else if(mode === 'light' && pct < 5) {
				w.hidden = false;
				w.textContent = 'Only a small saving. This PDF is already well optimised. Try Balanced for a bigger reduction.'
			} else w.hidden = true;
			$('res').hidden = false;
			$('prog').hidden = true;
			$('res').scrollIntoView({
				behavior: 'smooth',
				block: 'nearest'
			});
		}).catch(function(e) {
			showErr('Something went wrong: ' + (e && e.message || e));
			$('prog').hidden = true
		}).then(function() {
			busy = false;
			$('go').disabled = false;
			$('go').textContent = 'Compress PDF'
		});
	};

	$('dl').onclick = function() {
		if(!out) return;
		var blob = new Blob([out], {
				type: 'application/pdf'
			}),
			name = fileName + '_compressed.pdf';
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