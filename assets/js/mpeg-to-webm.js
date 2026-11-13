(function() {
	var VENDOR = 'assets/vendors/ffmpeg/';
	var $ = function(i) {
		return document.getElementById(i)
	};
	var codecNow = 'vp9',
		opt = {
			fmt: 'vp9',
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
		lastLog = [],
		rec = null,
		vid = null,
		prep = false;
	var D = {
		vp9: ['VP9: smaller files', 'VP9 gives smaller files at the same quality and plays in all modern browsers. Conversion has two steps: the MPEG file is first prepared, then your browser records it as WebM while it plays, so allow at least the length of the video. Keep this tab open and visible.'],
		vp8: ['VP8: most compatible', 'VP8 works in almost every browser and player, including older ones. Files are somewhat larger than VP9. Conversion has two steps: the MPEG file is first prepared, then your browser records it as WebM while it plays, so allow at least the length of the video. Keep this tab open and visible.']
	};

	function setDesc() {
		$('dtitle').textContent = D[opt.fmt][0];
		$('dtext').textContent = D[opt.fmt][1]
	}

	setDesc();

	if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) showErr('This browser cannot record video, so it cannot make WebM files. Please use Chrome, Edge or Firefox.');

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
		$('loadmsg').hidden = true
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

	function setPct(it, p, label) {
		it.pct = p;
		if(it.bar) it.bar.style.width = p + '%';
		if(it.label) it.label.textContent = 'Converting… ' + p + '%';
		stage((label || 'Converting') + ' · ' + where(it), p)
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
			if(prep && current && e && typeof e.progress === 'number') setPct(current, Math.max(0, Math.min(49, Math.round(e.progress * 50))), 'Step 1 of 2 · Preparing')
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
						stage('Loading the finishing tool (first time only, about 30 MB) · ' + mb + ' MB', overall());
						return pump();
					})
				}
				return pump();
			});
		}
		stage('Loading the finishing tool (first time only, about 30 MB)', 0);
		return grab(0).then(function(coreURL) {
			return grab(1).then(function(wasmURL) {
				stage('Starting the finishing tool…', null);
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

	var CANDS = {
		vp9: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8,opus', 'video/webm'],
		vp8: ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm']
	};

	function pickMime() {
		var l = CANDS[opt.fmt];
		for(var i = 0; i < l.length; i++) {
			if(MediaRecorder.isTypeSupported(l[i])) return l[i]
		}
		return ''
	}

	var noop = function() {};

	function remux(it, raw) {
		if(!(window.FFmpegWASM || window.FFmpegWrapper)) return Promise.reject(new Error('no finishing tool'));
		stage('Finishing · adding seek information', null);
		return ensureLoaded().then(function(f) {
			var inN = 'rec_' + it.id + '.webm',
				outN = 'fix_' + it.id + '.webm';
			return raw.arrayBuffer().then(function(ab) {
				return f.writeFile(inN, new Uint8Array(ab))
			}).then(function() {
				return f.exec(['-i', inN, '-c', 'copy', '-y', outN])
			}).then(function(code) {
				if(code !== 0) throw new Error('re-wrap failed');
				return f.readFile(outN)
			}).then(function(data) {
				if(!data || !data.length) throw new Error('empty');
				f.deleteFile(inN).catch(noop);
				f.deleteFile(outN).catch(noop);
				return new Blob([data.buffer], {
					type: 'video/webm'
				});
			}, function(e) {
				try {
					f.terminate()
				} catch(x) {}
				ff = null;
				throw e
			});
		});
	}

	function record(it, srcBlob) {
		return new Promise(function(resolve) {
			var url = URL.createObjectURL(srcBlob),
				v = document.createElement('video'),
				done = false,
				chunks = [],
				ac = null,
				recorder = null,
				stopT = 0;
			v.playsInline = true;
			v.preload = 'auto';
			v.src = url;

			function cleanup() {
				clearTimeout(stopT);
				try {
					if(recorder && recorder.state !== 'inactive') recorder.stop()
				} catch(e) {}
				try {
					v.pause()
				} catch(e) {}
				try {
					if(ac) ac.close()
				} catch(e) {}
				URL.revokeObjectURL(url);
				v.removeAttribute('src');
				try {
					v.load()
				} catch(e) {}
				vid = null;
				rec = null;
			}

			function end(state, msg) {
				if(done) return;
				done = true;
				cleanup();
				it.state = state;
				if(msg) it.msg = msg;
				resolve()
			}

			v.onerror = function() {
				end('error', 'This browser could not play this video. Try Chrome or Edge, or a different MP4.')
			};

			v.onloadeddata = function() {
				if(done || recorder) return;
				var sw = v.videoWidth,
					sh = v.videoHeight;
				if(!sw || !sh) return end('error', 'This file has no picture to convert.');
				var sc = opt.size === 'orig' ? 1 : Math.min(1, (+opt.size) / sh);
				var w = Math.max(2, Math.round(sw * sc / 2) * 2),
					h = Math.max(2, Math.round(sh * sc / 2) * 2),
					fps = 30;
				var cv = document.createElement('canvas');
				cv.width = w;
				cv.height = h;
				var cx = cv.getContext('2d');
				cx.drawImage(v, 0, 0, w, h);
				var stream = cv.captureStream(fps);
				try {
					ac = new(window.AudioContext || window.webkitAudioContext)();
					var src = ac.createMediaElementSource(v),
						dest = ac.createMediaStreamDestination();
					src.connect(dest); // the sound goes into the recording only, not to the speakers
					dest.stream.getAudioTracks().forEach(function(t) {
						stream.addTrack(t)
					});
					if(ac.resume) ac.resume();
				} catch(e) {
					ac = null
				}
				var mime = pickMime();
				if(!mime) return end('error', 'This browser cannot record WebM video. Try Chrome, Edge or Firefox.');
				var bpp = {
						high: 0.16,
						med: 0.09,
						small: 0.05
					}[opt.q],
					vb = Math.max(250000, Math.min(12000000, Math.round(w * h * fps * bpp)));
				try {
					recorder = new MediaRecorder(stream, {
						mimeType: mime,
						videoBitsPerSecond: vb,
						audioBitsPerSecond: 128000
					})
				} catch(e) {
					return end('error', 'Could not start recording: ' + (e.message || e))
				}
				rec = recorder;
				vid = v;
				recorder.ondataavailable = function(e) {
					if(e.data && e.data.size) chunks.push(e.data)
				};
				recorder.onerror = function() {
					end('error', 'Recording failed.')
				};
				recorder.onstop = function() {
					if(done) return;
					if(cancelled) {
						end('queued');
						return
					}
					var raw = new Blob(chunks, {
						type: 'video/webm'
					});
					if(!raw.size) {
						end('error', 'Nothing was recorded. Keep this tab open and visible while converting.');
						return
					}
					remux(it, raw).catch(function() {
						it.note = 'Skipping ahead may be limited in some players.';
						return raw
					}).then(function(b) {
						it.blob = b;
						it.url = URL.createObjectURL(b);
						it.outName = it.file.name.replace(/\.[^.]+$/, '') + '.webm';
						it.pct = 100;
						end('done');
					});
				};

				function paint() {
					if(!done) cx.drawImage(v, 0, 0, w, h)
				}
				if(v.requestVideoFrameCallback) {
					var cb = function() {
						paint();
						if(!v.ended && !done) v.requestVideoFrameCallback(cb)
					};
					v.requestVideoFrameCallback(cb)
				} else {
					var tick = function() {
						paint();
						if(!v.ended && !done) requestAnimationFrame(tick)
					};
					tick()
				}
				v.ontimeupdate = function() {
					if(v.duration && !done) setPct(it, 50 + Math.min(49, Math.round(v.currentTime / v.duration * 50)), 'Step 2 of 2 · Recording WebM')
				};
				v.onended = function() {
					stopT = setTimeout(function() {
						if(recorder.state !== 'inactive') recorder.stop()
					}, 400)
				};
				recorder.start(1000);
				stage('Step 2 of 2 · Recording WebM · ' + where(it), 50);
				var p = v.play();
				if(p && p.catch) p.catch(function() {
					end('error', 'The browser blocked playback. Click Convert again.')
				});
			};
		});
	}

	function prepArgs(inName, outName) {
		var hgt = opt.size === 'orig' ? null : opt.size;
		var vf = (opt.deint === 'on' ? 'yadif,' : '') + 'scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1' + (hgt ? ',scale=-2:trunc(min(' + hgt + '\\,ih)/2)*2' : '');
		return ['-i', inName, '-map', '0:v:0', '-map', '0:a:0?', '-vf', vf, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', '-y', outName];
	}

	function prepare(it) {
		stage('Step 1 of 2 · Preparing · ' + where(it), 0);
		return ensureLoaded().then(function(f) {
			var ext = (/\.([a-z0-9]{2,4})$/i.exec(it.file.name) || [0, 'mpg'])[1].toLowerCase(),
				inN = 'in_' + it.id + '.' + ext,
				outN = 'mid_' + it.id + '.mp4';
			prep = true;
			return it.file.arrayBuffer().then(function(ab) {
				return f.writeFile(inN, new Uint8Array(ab))
			}).then(function() {
				return f.exec(prepArgs(inN, outN))
			}).then(function(code) {
				if(code !== 0) throw new Error('The converter could not read this video.');
				return f.readFile(outN)
			}).then(function(data) {
				if(!data || !data.length) throw new Error('The converter produced an empty file.');
				f.deleteFile(inN).catch(noop);
				f.deleteFile(outN).catch(noop);
				return new Blob([data.buffer], {
					type: 'video/mp4'
				});
			}).catch(function(e) {
				if(!(e && /^The converter (could not read|produced an empty)/.test(e.message || ''))) {
					try {
						f.terminate()
					} catch(x) {}
					if(ff === f) ff = null
				}
				throw e;
			}).then(function(b) {
				prep = false;
				return b
			}, function(e) {
				prep = false;
				throw e
			});
		});
	}

	function convertOne(it) {
		current = it;
		batch.i++;
		it.state = 'working';
		it.pct = 0;
		it.note = '';
		lastLog = [];
		render();
		return prepare(it).then(function(mid) {
			if(cancelled) {
				it.state = 'queued';
				return
			}
			return record(it, mid);
		}, function(e) {
			if(cancelled) {
				it.state = 'queued';
				return
			}
			var bad = lastLog.filter(function(l) {
				return /error|unknown|not found|invalid|unsupported|could not|cannot|failed|memory|abort/i.test(l) && !/^\s*encoder\s*:/i.test(l)
			}).pop();
			it.log = lastLog.slice();
			it.state = 'error';
			it.msg = ((e && e.message) || 'The converter stopped unexpectedly while preparing this video.') + (bad ? ' (' + bad.trim().slice(0, 110) + ')' : '');
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
		var chain = Promise.resolve();
		todo.forEach(function(it) {
			chain = chain.then(function() {
				if(cancelled) return;
				return convertOne(it)
			})
		});
		chain.then(function() {
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
		if(rec && rec.state !== 'inactive') {
			try {
				rec.stop()
			} catch(e) {}
		} else if(vid) {
			try {
				vid.pause()
			} catch(e) {}
		}
		if(ff) {
			try {
				ff.terminate()
			} catch(e) {}
			ff = null
		}
	};
})();