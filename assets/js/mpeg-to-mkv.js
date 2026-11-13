(function() {
	var VENDOR = 'assets/vendors/ffmpeg/';
	var $ = function(i) {
		return document.getElementById(i)
	};
	var codecNow = 'x264',
		opt = {
			mode: 'copy',
			q: 'med',
			size: 'orig',
			deint: 'off'
		},
		items = [],
		uid = 0,
		ff = null,
		current = null,
		busy = false,
		cancelled = false,
		lastLog = [];
	var D = {
		copy: ['Fast: keeps the original quality', 'Repackages the MPEG video as an MKV file without re-encoding it. It takes seconds and loses no quality. The file stays about the same size, because MPEG is not compressed as efficiently as newer formats.'],
		enc: ['Re-encode: much smaller files', 'Re-compresses the video as H.264 with AAC audio, which usually makes the file far smaller than the MPEG original. It is slower, but you can choose quality and size, and remove interlaced lines from DVD and TV recordings.']
	};

	function setDesc() {
		$('encopts').hidden = opt.mode !== 'enc';
		$('dtitle').textContent = D[opt.mode][0];
		$('dtext').textContent = D[opt.mode][1]
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
			if(g.dataset.k === 'mode') setDesc();
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
			return /^video\//.test(f.type) || /\.(mpg|mpeg|mpe|m1v|m2v|m4v|vob|ts|m2ts|mts|mod|tod)$/i.test(f.name)
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
				txt = 'Done · ' + fmt(it.blob.size) + (it.note ? ' · ' + it.note : '')
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
			if(it.state === 'error' && it.log && it.log.length) {
				var det = document.createElement('button');
				det.className = 'dlb';
				det.style.padding = '0';
				det.textContent = it.showLog ? 'Hide details' : 'Show details';
				det.onclick = function() {
					it.showLog = !it.showLog;
					render()
				};
				m.appendChild(det);
				if(it.showLog) {
					var pre = document.createElement('pre');
					pre.style.cssText = 'font-size:11.5px;white-space:pre-wrap;word-break:break-word;background:var(--surface-2);border-radius:8px;padding:8px;margin:6px 0 0;max-height:180px;overflow:auto';
					pre.textContent = it.log.join('\n');
					m.appendChild(pre)
				}
			}
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
			if(lastLog.length > 40) lastLog.shift()
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
		if(opt.mode === 'copy') return ['-i', inName, '-map', '0:v', '-map', '0:a?', '-c', 'copy', '-f', 'matroska', '-y', outName];
		var base = ['-i', inName, '-map', '0:v:0', '-map', '0:a:0?'],
			hgt = opt.size === 'orig' ? null : opt.size;
		var vf = (opt.deint === 'on' ? 'yadif,' : '') + (hgt ? 'scale=-2:trunc(min(' + hgt + '\\,ih)/2)*2' : 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
		var qs = {
			high: ['18', '224k', '2'],
			med: ['23', '192k', '4'],
			small: ['28', '128k', '7']
		}[opt.q];
		var tail = ['-c:a', 'aac', '-b:a', qs[1], '-ac', '2', '-f', 'matroska', '-y', outName];
		if(codecNow === 'x264') return base.concat(['-vf', vf, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', qs[0]], tail);
		return base.concat(['-vf', vf, '-pix_fmt', 'yuv420p', '-c:v', 'mpeg4', '-q:v', qs[2]], tail); // fallback if the H.264 encoder crashes
	}

	function convertOne(f, it, retry) {
		var ext = (/\.([a-z0-9]{2,4})$/i.exec(it.file.name) || [0, 'mp4'])[1].toLowerCase(),
			inName = 'in_' + it.id + '.' + ext,
			outName = 'out_' + it.id + '.mkv';
		current = it;
		if(!retry) {
			batch.i++;
			codecNow = 'x264';
			it.note = ''
		}
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
				type: 'video/x-matroska'
			});
			it.url = URL.createObjectURL(it.blob);
			it.outName = it.file.name.replace(/\.[^.]+$/, '') + '.mkv';
			it.state = 'done';
			it.pct = 100;
		}).catch(function(e) {
			if(cancelled) {
				it.state = 'queued';
				return
			}
			var bad = lastLog.filter(function(l) {
				return /error|unknown|not found|invalid|unsupported|could not|cannot|failed|memory|abort/i.test(l) && !/^\s*encoder\s*:/i.test(l)
			}).pop();
			it.log = lastLog.slice();
			var crashed = !(e && e.message === 'The converter could not read this video.');
			if(crashed) {
				try {
					f.terminate()
				} catch(x) {}
				if(ff === f) ff = null
			}
			if(crashed && opt.mode === 'enc' && codecNow === 'x264') {
				codecNow = 'mpeg4';
				it.note = 'H.264 was not available in this converter, so MPEG-4 video was used.';
				return ensureLoaded().then(function(f2) {
					return convertOne(f2, it, true)
				})
			}
			it.state = 'error';
			it.msg = ((e && e.message) || 'The converter stopped unexpectedly. This can happen with very large videos, or if the converter build has a fault. Use Show details and send me the log.') + (bad ? ' (' + bad.trim().slice(0, 110) + ')' : '');
		}).then(function() {
			if(ff !== f) return;
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
					if(cancelled) return;
					return ensureLoaded().then(function(f2) {
						return convertOne(f2, it)
					})
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
		} // the converter reloads on the next run
	};
})();