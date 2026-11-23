(function() {
    var VENDOR = 'assets/vendors/ffmpeg/';
    var $ = function(i) {
        return document.getElementById(i)
    };
    var file = null,
        fileUrl = null,
        dur = 0,
        start = 0,
        end = 0,
        mode = 'fast',
        out = null,
        ff = null,
        busy = false,
        cancelled = false,
        lastLog = [],
        onProg = null,
        playHandler = null,
        fallbackNote = '';
    var MIME = {
        mp4: 'video/mp4',
        m4v: 'video/mp4',
        mov: 'video/quicktime',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        mpg: 'video/mpeg',
        mpeg: 'video/mpeg'
    };
    var D = {
        fast: ['Fast: no quality loss', 'Cuts the video without re-encoding it, so it takes seconds and keeps the original quality and format. The clip may start up to a few seconds before the point you chose, because the cut happens at the nearest earlier keyframe.'],
        precise: ['Precise: exact cut', 'Cuts at exactly the start and end you chose by re-encoding the clip as MP4 (H.264 with AAC audio). It is slower and the clip is saved as MP4, whatever the original format.']
    };

    function setDesc() {
        $('dtitle').textContent = D[mode][0];
        $('dtext').textContent = D[mode][1]
    }
    setDesc();

    function fmt(n) {
        return n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB'
    }

    function clamp(v, a, b) {
        return Math.max(a, Math.min(b, v))
    }

    function pad(n, l) {
        n = String(n);
        while (n.length < l) n = '0' + n;
        return n
    }

    function fmtTime(t) {
        t = Math.max(0, t);
        var h = Math.floor(t / 3600),
            m = Math.floor(t % 3600 / 60),
            s = t % 60;
        return (h ? h + ':' + pad(m, 2) : m) + ':' + pad(s.toFixed(2), 5)
    }

    function parseTime(str) {
        var p = String(str).trim().split(':');
        if (!p.length || p.length > 3) return NaN;
        var n = 0;
        for (var i = 0; i < p.length; i++) {
            if (!/^\d+(\.\d+)?$/.test(p[i].trim())) return NaN;
            n = n * 60 + parseFloat(p[i])
        }
        return n;
    }

    function showErr(t) {
        var e = $('err');
        e.textContent = t || '';
        e.classList.toggle('show', !!t)
    }

    function noop() {}


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

    function ensureLoaded() {
        if (ff) return Promise.resolve(ff);
        
        var NS = [window.FFmpegWASM, window.FFmpegWrapper].filter(function(x) {
            return x && typeof x.FFmpeg === 'function'
        })[0];
        if (!NS) {
            var why = window.__ffFail && window.__ffFail.length ?
                'These files could not be loaded (wrong name or folder, or the page is not in the folder that contains "assets"): ' + window.__ffFail.join(', ') :
                'ffmpeg.js loaded, but it does not contain the converter. Download @ffmpeg/ffmpeg@0.12.10 dist/umd/ffmpeg.js again.';
            return Promise.reject(new Error(why));
        }

        var f = new NS.FFmpeg();
        f.on('log', function(e) {
            lastLog.push(e.message);
            if (lastLog.length > 40) lastLog.shift()
        });

        f.on('progress', function(e) {
            if (onProg) onProg(e)
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
                if (!r.ok) throw new Error('Could not load ' + files[k][0] + ' (error ' + r.status + '). Check the file name and folder.');
                var len = +r.headers.get('Content-Length');
                if (len) size[k] = len;
                var rd = r.body.getReader(),
                    parts = [];

                function pump() {
                    return rd.read().then(function(x) {
                        if (x.done) return URL.createObjectURL(new Blob(parts, {
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

    var dz = $('dropzone'),
        fi = $('fileInput'),
        vid = $('vid');
    dz.onclick = function() {
        fi.click()
    };
    
    dz.onkeydown = function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
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
        if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0])
    });

    fi.onchange = function() {
        if (fi.files[0]) load(fi.files[0]);
        fi.value = ''
    };

    $('change').onclick = function() {
        if (!busy) fi.click()
    };

    function clearOut() {
        if (out) {
            URL.revokeObjectURL(out.url);
            out = null
        }
        $('res').hidden = true;
        $('rvwrap').hidden = true;
        $('rvid').removeAttribute('src');
    }

    function load(f) {
        showErr('');
        if (busy) return;
        if (!/^video\//.test(f.type) && !/\.(mp4|m4v|mov|webm|mkv|mpg|mpeg|avi|ts)$/i.test(f.name)) {
            showErr('Please choose a video file.');
            return
        }
        clearOut();
        hideStage();
        if (fileUrl) URL.revokeObjectURL(fileUrl);
        file = f;
        fileUrl = URL.createObjectURL(f);
        vid.onloadedmetadata = function() {
            if (!isFinite(vid.duration) || vid.duration <= 0) {
                showErr('Could not read the length of this video.');
                return
            }
            dur = vid.duration;
            start = 0;
            end = dur;
            var step = dur < 120 ? 0.01 : 0.1;
            $('rs').max = $('re').max = dur;
            $('rs').step = $('re').step = step;
            $('fname').textContent = f.name;
            $('finfo').textContent = fmtTime(dur) + ' · ' + fmt(f.size);
            dz.hidden = true;
            $('tool').hidden = false;
            sync();
        };
        vid.onerror = function() {
            showErr('This browser cannot play this file, so it cannot show a preview. Try an MP4, MOV or WebM file.');
            dz.hidden = false;
            $('tool').hidden = true
        };
        vid.src = fileUrl;
    }

    function sync() {
        $('rs').value = start;
        $('re').value = end;
        if (document.activeElement !== $('ts')) $('ts').value = fmtTime(start);
        if (document.activeElement !== $('te')) $('te').value = fmtTime(end);
        $('sel').textContent = 'Selected: ' + fmtTime(start) + ' to ' + fmtTime(end) + ' · length ' + fmtTime(end - start);
        clearOutIfStale();
    }

    function clearOutIfStale() {
        if (out && !busy) clearOut()
    }

    function setStart(v, seek) {
        start = clamp(v, 0, end - 0.1);
        if (seek) vid.currentTime = start;
        sync()
    }

    function setEnd(v, seek) {
        end = clamp(v, start + 0.1, dur);
        if (seek) vid.currentTime = end;
        sync()
    }

    $('rs').oninput = function() {
        setStart(+this.value, true)
    };

    $('re').oninput = function() {
        setEnd(+this.value, true)
    };

    $('ts').onchange = function() {
        var t = parseTime(this.value);
        if (isNaN(t)) {
            sync();
            return
        }
        setStart(t, true);
        this.blur()
    };

    $('te').onchange = function() {
        var t = parseTime(this.value);
        if (isNaN(t)) {
            sync();
            return
        }
        setEnd(t, true);
        this.blur()
    };

    $('ts').onblur = $('te').onblur = sync;
    $('useS').onclick = function() {
        setStart(vid.currentTime, false)
    };

    $('useE').onclick = function() {
        setEnd(vid.currentTime, false)
    };

    $('playsel').onclick = function() {
        if (playHandler) vid.removeEventListener('timeupdate', playHandler);
        vid.currentTime = start;
        vid.play();
        playHandler = function() {
            if (vid.currentTime >= end) {
                vid.pause();
                vid.removeEventListener('timeupdate', playHandler);
                playHandler = null
            }
        };
        vid.addEventListener('timeupdate', playHandler);
    };

    $('tabs').onclick = function(e) {
        var b = e.target.closest('button');
        if (!b || busy) return;
        mode = b.dataset.m;
        [].forEach.call($('tabs').children, function(x) {
            x.classList.toggle('on', x === b)
        });
        setDesc();
        clearOut();
    };

    
    function run(f, codec) {
        var ext = (/\.([a-z0-9]{2,4})$/i.exec(file.name) || [0, 'mp4'])[1].toLowerCase(),
            fast = mode === 'fast';
        var outExt = fast ? ext : 'mp4',
            inN = 'in_trim.' + ext,
            outN = 'out_trim.' + outExt,
            ss = start.toFixed(3),
            t = (end - start).toFixed(3),
            args;
        if (fast) {
            args = ['-ss', ss, '-i', inN, '-t', t, '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero'];
            if (/^(mp4|mov|m4v)$/.test(ext)) args.push('-movflags', '+faststart');
            args.push('-y', outN);
        } else {
            args = ['-ss', ss, '-i', inN, '-t', t, '-map', '0:v:0?', '-map', '0:a:0?', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p']
                .concat(codec === 'x264' ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20'] : ['-c:v', 'mpeg4', '-q:v', '3'], ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', outN]);
        }
        lastLog = [];
        stage('Reading video', null);
        return file.arrayBuffer().then(function(ab) {
                return f.writeFile(inN, new Uint8Array(ab))
            })
            .then(function() {
                stage('Trimming', 0);
                onProg = function(e) {
                    var p = typeof e.time === 'number' && e.time > 0 ? e.time / 1e6 / (end - start) : e.progress;
                    if (typeof p === 'number') stage('Trimming', clamp(Math.round(p * 100), 0, 99))
                };
                return f.exec(args);
            }).then(function(code) {
                onProg = null;
                if (code !== 0) throw new Error('The converter could not trim this video.');
                stage('Preparing your download', null);
                return f.readFile(outN);
            }).then(function(data) {
                f.deleteFile(inN).catch(noop);
                f.deleteFile(outN).catch(noop);
                if (!data || !data.length) throw new Error('The converter produced an empty file.');
                return {
                    blob: new Blob([data.buffer], {
                        type: MIME[outExt] || 'video/mp4'
                    }),
                    ext: outExt
                };
            }).catch(function(e) {
                onProg = null;
                if (cancelled) throw e;
                var normal = /^The converter (could not|produced)/.test((e && e.message) || '');
                if (!normal) {
                    try {
                        f.terminate()
                    } catch (x) {}
                    if (ff === f) ff = null;
                    if (!fast && codec === 'x264') {
                        fallbackNote = 'H.264 was not available in this converter, so MPEG-4 video was used.';
                        return ensureLoaded().then(function(f2) {
                            return run(f2, 'mpeg4')
                        })
                    }
                }
                throw e;
            });
    }

    $('go').onclick = function() {
        if (busy || !file) return;
        if (end - start < 0.1) {
            showErr('Choose a start that is before the end.');
            return
        }
        showErr('');
        clearOut();
        fallbackNote = '';
        cancelled = false;
        busy = true;
        $('go').disabled = true;
        $('go').textContent = 'Trimming…';
        $('cancel').hidden = false;
        ensureLoaded().then(function(f) {
            return run(f, 'x264')
        }).then(function(r) {
            var base = file.name.replace(/\.[^.]+$/, ''),
                name = base + '_trimmed.' + r.ext;
            out = {
                blob: r.blob,
                url: URL.createObjectURL(r.blob),
                name: name
            };
            $('rname').textContent = name;
            $('rinfo').textContent = fmtTime(end - start) + ' · ' + fmt(r.blob.size) + (fallbackNote ? ' · ' + fallbackNote : '');
            $('dl').href = out.url;
            $('dl').download = name;
            $('rvid').src = out.url;
            $('rvwrap').hidden = false;
            $('res').hidden = false;
            stage('Done · your clip is ready', 100);
        }).catch(function(e) {
            if (cancelled) {
                hideStage();
                return
            }
            var bad = lastLog.filter(function(l) {
                return /error|unknown|not found|invalid|unsupported|could not|cannot|failed|memory|abort/i.test(l) && !/^\s*encoder\s*:/i.test(l)
            }).pop();
            showErr(((e && e.message) || 'The converter stopped unexpectedly. This can happen with very large videos, or if the converter build has a fault.') + (bad ? ' (' + bad.trim().slice(0, 110) + ')' : ''));
            hideStage();
        }).then(function() {
            busy = false;
            $('go').disabled = false;
            $('go').textContent = 'Trim video';
            $('cancel').hidden = true
        });
    };

    $('cancel').onclick = function() {
        cancelled = true;
        hideStage();
        onProg = null;
        if (ff) {
            try {
                ff.terminate()
            } catch (e) {}
            ff = null
        }
    };
})();