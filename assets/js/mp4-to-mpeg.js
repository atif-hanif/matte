(function() {
	var VENDOR = 'assets/vendors/ffmpeg/'; 
	var $ = function(i) {
		return document.getElementById(i)
	};
	var opt = {
			fmt: 'mpeg2',
			q: 'med',
			size: 'orig'
		},
		items = [],
		uid = 0,
		ff = null,
		current = null,
		busy = false,
		cancelled = false,
		lastLog = [];
	var D = {
		mpeg2: ['MPEG-2: the best choice for most uses', 'MPEG-2 is the format used on DVDs. It works in almost every player, TV and editing program, and looks better than MPEG-1 at the same size.'],
		mpeg1: ['MPEG-1: oldest and smallest', 'MPEG-1 is the original MPEG format. Files are smaller but look softer. Use it only for very old players or software that asks for it.']
	};

	function setDesc() {
		$('dtitle').textContent = D[opt.fmt][0];
		$('dtext').textContent = D[opt.fmt][1]
	}
	setDesc();

	function fmt(n) {
		return n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB'
	}

	function showErr(t) {
		var e = $('err');
		e.textContent = t || '';
		e.classList.toggle('show', !!t)
	}

	var dz = $('dropzone'),
		fi = $('fileInput');
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
	
	document.querySelectorAll('.opt .modes').forEach(function(g) {
		g.onclick = function(e) {
			var b = e.target.closest('button');
			if(!b || busy) return;
			opt[g.dataset.k] = b.dataset.v;
			[].forEach.call(g.children, function(x) {
				x.classList.toggle('on', x === b)
			});
			if(g.dataset.k === 'fmt') setDesc();
			items.forEach(function(it) {
				if(it.state === 'done') {
					clearOut(it);
					it.state = 'queued'
				}
			});
			render();
		};
	});

	function add(list) {
		showErr('');
		var arr = [].slice.call(list).filter(function(f) {
			return /^video\//.test(f.type) || /\.(mp4|m4v|mp4v|3gp|3g2|f4v)$/i.test(f.name)
		});
		if(!arr.length) {
			showErr('Please choose video files.');
			return
		}
		arr.forEach(function(f) {
			items.push({
				id: ++uid,
				file: f,
				state: 'queued',
				pct: 0
			})
		});
		render();
	}

	function clearOut(it) {
		if(it.url) {
			URL.revokeObjectURL(it.url);
			it.url = null
		}
		it.blob = null;
		it.pct = 0
	}

	function render() {
		dz.hidden = items.length > 0;
		$('tool').hidden = !items.length;
		var q = items.filter(function(i) {
			return i.state === 'queued' || i.state === 'error'
		}).length;
		$('summary').textContent = items.length + ' file' + (items.length === 1 ? '' : 's');
		$('go').disabled = busy || !q;
		// $('go').textContent = busy ? 'Converting…' : 'Convert';
		$('go').innerHTML = busy ? '<i class="fa-solid fa-rotate me-2"></i>Converting…' : '<i class="fa-solid fa-rotate me-2"></i>Convert';
		$('cancel').hidden = !busy;
		var big = items.some(function(i) {
			return i.file.size > 1073741824
		});
		var lm = $('loadmsg');
		lm.hidden = !big;
		if(big) lm.textContent = 'Files over 1 GB may run out of browser memory. If a conversion fails, try a smaller file.'
		var box = $('list');
		box.innerHTML = '';
		items.forEach(function(it, i) {
			var d = document.createElement('div');
			d.className = 'item';
			var n = document.createElement('div');
			n.className = 'num';
			n.textContent = i + 1;
			var m = document.createElement('div');
			m.className = 'meta';
			var s = document.createElement('strong');
			s.textContent = it.file.name;
			s.title = it.file.name;
			var sm = document.createElement('small');
			var txt = fmt(it.file.size);
			if(it.state === 'done') {
				sm.className = 'st ok';
				txt = 'Done · ' + fmt(it.blob.size)
			} else if(it.state === 'working') {
				sm.className = 'st';
				txt = 'Converting… ' + it.pct + '%'
			} else if(it.state === 'error') {
				sm.className = 'st bad';
				txt = it.msg || 'Failed'
			}
			sm.textContent = txt;
			m.appendChild(s);
			m.appendChild(sm);
			if(it.state === 'working') {
				var pb = document.createElement('div');
				pb.className = 'pbar';
				var pi = document.createElement('i');
				pi.style.width = it.pct + '%';
				pb.appendChild(pi);
				m.appendChild(pb);
				it.bar = pi;
				it.label = sm
			}
			var c = document.createElement('div');
			c.className = 'ctl d-flex gap-2';
			if(it.state === 'done') {
				var a = document.createElement('a');
				a.className = 'btn btn-primary-outlined';
				//a.textContent = 'Download';
				a.innerHTML = '<i class="fa-solid fa-download"></i>';
				a.href = it.url;
				a.download = it.outName;
				c.appendChild(a)
			}
			var x = document.createElement('button');
			x.className = 'btn btn-secondary-outlined';
			//x.textContent = '✕';
			x.innerHTML = '<i class="fa-solid fa-xmark"></i>';
			x.title = 'Remove';
			x.setAttribute('aria-label', 'Remove');
			x.disabled = busy && it === current;
			x.onclick = function() {
				clearOut(it);
				items.splice(items.indexOf(it), 1);
				render()
			};
			c.appendChild(x);
			d.appendChild(n);
			d.appendChild(m);
			d.appendChild(c);
			box.appendChild(d);
		});
	}

	$('clear').onclick = function() {
		if(busy) return;
		items.forEach(clearOut);
		items = [];
		showErr('');
		hideStage();
		render()
	};

	function stage(label, p) {
		$('stage').hidden = false;
		$('slabel').textContent = label;
		var ind = p == null;
		$('sbarwrap').classList.toggle('ind', ind);
		$('sbar').style.width = ind ? '' : p + '%';
		$('spct').textContent = ind ? '' : p + '%';
	}

	function hideStage() {
		$('stage').hidden = true
	}

	var batch = {
		n: 0,
		i: 0
	};

	function where(it) {
		return(batch.n > 1 ? 'File ' + batch.i + ' of ' + batch.n + ' · ' : '') + it.file.name
	}

	function setPct(it, p) {
		it.pct = p;
		if(it.bar) it.bar.style.width = p + '%';
		if(it.label) it.label.textContent = 'Converting… ' + p + '%';
		stage('Converting · ' + where(it), p)
	}

	function ensureLoaded() {
		if(ff) return Promise.resolve(ff);
		var NS = [window.FFmpegWASM, window.FFmpegWrapper].filter(function(x) {
			return x && typeof x.FFmpeg === 'function'
		})[0];

		if(!NS) {
			var why = window.__ffFail && window.__ffFail.length ? 'These files could not be loaded (wrong name or folder, or the page is not in the folder that contains "assets"): ' + window.__ffFail.join(', ') : 'ffmpeg.js loaded, but it does not contain the converter. Download @ffmpeg/ffmpeg@0.12.10 dist/umd/ffmpeg.js again.';
			return Promise.reject(new Error(why));
		}

		var f = new NS.FFmpeg();
		f.on('log', function(e) {
			lastLog.push(e.message);
			if(lastLog.length > 12) lastLog.shift()
		});

		f.on('progress', function(e) {
			if(current && e && typeof e.progress === 'number') {
				setPct(current, Math.max(0, Math.min(99, Math.round(e.progress * 100))))
			}
		});

		var files = [
				[VENDOR + 'ffmpeg-core.js', 'text/javascript', 115000],
				[VENDOR + 'ffmpeg-core.wasm', 'application/wasm', 32200000]
			],
			got = [0, 0],
			size = [files[0][2], files[1][2]];

		function overall() {
			var t = size[0] + size[1],
				g = got[0] + got[1];
			return Math.min(99, Math.round(g / t * 100))
		}

		function grab(k) {
			return fetch(files[k][0]).then(function(r) {
				if(!r.ok) throw new Error('Could not load ' + files[k][0] + ' (error ' + r.status + '). Check the file name and folder.');
				var len = +r.headers.get('Content-Length');
				if(len) size[k] = len;
				var rd = r.body.getReader(),
					parts = [];

				function pump() {
					return rd.read().then(function(x) {
						if(x.done) return URL.createObjectURL(new Blob(parts, {
							type: files[k][1]
						}));
						parts.push(x.value);
						got[k] += x.value.length;
						var mb = ((got[0] + got[1]) / 1048576).toFixed(1);
						stage('Loading the converter (first time only, about 30 MB) · ' + mb + ' MB', overall());
						return pump();
					})
				}
				return pump();
			});
		}

		stage('Loading the converter (first time only, about 30 MB)', 0);
		return grab(0).then(function(coreURL) {
			return grab(1).then(function(wasmURL) {
				stage('Starting the converter…', null);
				return f.load({
					coreURL: coreURL,
					wasmURL: wasmURL
				});
			})
		}).then(function() {
			ff = f;
			return f
		});
	}

	function args(inName, outName) {
		var h = opt.size === 'orig' ? null : opt.size;
		var vf = h ? 'scale=-2:trunc(min(' + h + '\\,ih)/2)*2' : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
		var qs = {
			high: ['2', '224k'],
			med: ['4', '192k'],
			small: ['8', '128k']
		}[opt.q];
		return ['-i', inName, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-pix_fmt', 'yuv420p', '-c:v', opt.fmt === 'mpeg1' ? 'mpeg1video' : 'mpeg2video', '-q:v', qs[0], '-c:a', 'mp2', '-b:a', qs[1], '-ar', '44100', '-ac', '2', '-f', 'mpeg', '-y', outName];
	}

	function convertOne(f, it) {
		var ext = (/\.([a-z0-9]{2,4})$/i.exec(it.file.name) || [0, 'mp4'])[1].toLowerCase(),
			inName = 'in_' + it.id + '.' + ext,
			outName = 'out_' + it.id + '.mpg';
		current = it;
		batch.i++;
		it.state = 'working';
		it.pct = 0;
		lastLog = [];
		render();
		stage('Reading video · ' + where(it), null);
		return it.file.arrayBuffer().then(function(ab) {
			return f.writeFile(inName, new Uint8Array(ab))
		}).then(function() {
			stage('Converting · ' + where(it), 0);
			return f.exec(args(inName, outName))
		}).then(function(code) {
			if(code !== 0) throw new Error('The converter could not read this video.');
			stage('Preparing your download · ' + where(it), null);
			return f.readFile(outName);
		}).then(function(data) {
			if(!data || !data.length) throw new Error('The converter produced an empty file.');
			it.blob = new Blob([data.buffer], {
				type: 'video/mpeg'
			});
			it.url = URL.createObjectURL(it.blob);
			it.outName = it.file.name.replace(/\.[^.]+$/, '') + '.mpg';
			it.state = 'done';
			it.pct = 100;
		}).catch(function(e) {
			if(cancelled) {
				it.state = 'queued';
				return
			}
			var hint = lastLog.filter(function(l) {
				return /error|unknown|not found|invalid|unsupported|encoder/i.test(l)
			}).pop();
			it.state = 'error';
			it.msg = (e && e.message || 'Failed') + (hint ? ' (' + hint.slice(0, 90) + ')' : '');
		}).then(function() {
			return Promise.all([f.deleteFile(inName).catch(function() {}), f.deleteFile(outName).catch(function() {})])
		});
	}

	$('go').onclick = function() {
		if(busy) return;
		showErr('');
		cancelled = false;
		busy = true;
		var todo = items.filter(function(i) {
			return i.state === 'queued' || i.state === 'error'
		});
		batch = {
			n: todo.length,
			i: 0
		};
		render();
		ensureLoaded().then(function(f) {
			var chain = Promise.resolve();
			todo.forEach(function(it) {
				chain = chain.then(function() {
					if(cancelled || !ff) return;
					return convertOne(f, it)
				});
			});
			return chain;
		}).then(function() {
			if(cancelled) {
				hideStage();
				return
			}
			var ok = todo.filter(function(i) {
				return i.state === 'done'
			}).length;
			if(ok) stage('All done · ' + ok + ' file' + (ok === 1 ? '' : 's') + ' converted', 100);
			else hideStage();
		}).catch(function(e) {
			showErr(e.message);
			hideStage()
		}).then(function() {
			busy = false;
			current = null;
			render()
		});
	};

	$('cancel').onclick = function() {
		cancelled = true;
		hideStage();
		if(ff) {
			try {
				ff.terminate()
			} catch(e) {}
			ff = null
		}
	};
})();