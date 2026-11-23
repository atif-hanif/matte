(function() {
    var VENDOR = 'assets/vendors/ffmpeg/';

    var $ = function(i) {
        return document.getElementById(i)
    };

    var items = [],
        uid = 0,
        ff = null,
        busy = false,
        cancelled = false,
        lastLog = [],
        onProg = null,
        out = null,
        fallbackNote = '';
    var opt = {
        mode: 'auto',
        q: 'med',
        size: 'first'
    };

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
        auto: ['Automatic (recommended)', 'Joins the clips instantly without re-encoding when they match, which is usual for clips from the same camera or app, so quality is kept. If they differ in size, frame rate or format, they are re-encoded to match, which takes longer. Quality and Size only apply then.'],
        enc: ['Always re-encode', 'Converts every clip to the same size and frame rate and saves the result as MP4 (H.264 with AAC audio). It takes longer, but works with any mix of clips.']
    };

    function setDesc() {
        $('dtitle').textContent = D[opt.mode][0];
        $('dtext').textContent = D[opt.mode][1]
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
            s = Math.round(t % 60);
        if (s === 60) {
            s = 0;
            m++
        }
        return (h ? h + ':' + pad(m, 2) : m) + ':' + pad(s, 2)
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

    function parseProbe(txt) {
        var p = {
                dur: 0,
                vcodec: '',
                w: 0,
                h: 0,
                fps: 0,
                rot: 0,
                hasA: false,
                acodec: '',
                ar: 0,
                ch: ''
            },
            m;
        m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(txt);
        if (m) p.dur = +m[1] * 3600 + +m[2] * 60 + +m[3];
        m = /Video:\s*([a-z0-9_]+)[^\n]*?[, ](\d{2,5})x(\d{2,5})[, \[]/.exec(txt);
        if (m) {
            p.vcodec = m[1];
            p.w = +m[2];
            p.h = +m[3]
        }
        m = /,\s*([\d.]+)\s*fps/.exec(txt);
        if (m) p.fps = +m[1];
        m = /rotation of (-?[\d.]+) degrees/.exec(txt);
        if (m) p.rot = Math.round(+m[1]);
        m = /Audio:\s*([a-z0-9_]+)[^\n]*?,\s*(\d+) Hz,\s*([a-z0-9. ]+?),/.exec(txt);
        if (m) {
            p.hasA = true;
            p.acodec = m[1];
            p.ar = +m[2];
            p.ch = m[3].trim()
        }
        return p;
    }

    function sig(p) {
        return [p.vcodec, p.w, p.h, p.fps, p.rot, p.hasA, p.acodec, p.ar, p.ch].join('|')
    }

    function even(n) {
        return Math.max(2, Math.round(n / 2) * 2)
    }

    function seen(p) {
        return Math.abs(p.rot) % 180 === 90 ? {
            w: p.h,
            h: p.w
        } : {
            w: p.w,
            h: p.h
        }
    } 

    function targetSize(first, choice) {
        var s = seen(first);
        if (choice === 'first') return {
            w: even(s.w),
            h: even(s.h)
        };
        var n = +choice;
        return s.h <= s.w ? {
            w: even(s.w / s.h * n),
            h: even(n)
        } : {
            w: even(n),
            h: even(s.h / s.w * n)
        };
    }

    function buildFilter(infos, W, H, F) {
        var parts = [],
            cat = '';
        infos.forEach(function(p, i) {
            parts.push('[' + i + ':v]scale=' + W + ':' + H + ':force_original_aspect_ratio=decrease,pad=' + W + ':' + H + ':(ow-iw)/2:(oh-ih)/2,setsar=1,fps=' + F + ',format=yuv420p[v' + i + ']');
            if (p.hasA) parts.push('[' + i + ':a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a' + i + ']');
            else parts.push('anullsrc=r=44100:cl=stereo,atrim=duration=' + p.dur.toFixed(3) + '[a' + i + ']'); // silence for clips without sound
            cat += '[v' + i + '][a' + i + ']';
        });
        parts.push(cat + 'concat=n=' + infos.length + ':v=1:a=1[v][a]');
        return parts.join(';');
    }

    var dz = $('dropzone'),
        fi = $('fileInput');
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
        add(e.dataTransfer.files)
    });

    fi.onchange = function() {
        add(fi.files);
        fi.value = ''
    };

    $('addMore').onclick = function() {
        if (!busy) fi.click()
    };

    function clearOut() {
        if (out) {
            URL.revokeObjectURL(out.url);
            out = null
        }
        $('res').hidden = true;
        $('rvwrap').hidden = true;
        $('rvid').removeAttribute('src')
    }

    function loadMeta(it) { 
        var v = document.createElement('video'),
            u = URL.createObjectURL(it.file);
        v.preload = 'metadata';
        v.onloadedmetadata = function() {
            it.dur = v.duration;
            it.w = v.videoWidth;
            it.h = v.videoHeight;
            URL.revokeObjectURL(u);
            render()
        };
        v.onerror = function() {
            URL.revokeObjectURL(u)
        };
        v.src = u;
    }

    function add(list) {
        if (busy) return;
        showErr('');
        var arr = [].slice.call(list).filter(function(f) {
            return /^video\//.test(f.type) || /\.(mp4|m4v|mov|webm|mkv|mpg|mpeg|avi|ts)$/i.test(f.name)
        });
        if (!arr.length) {
            showErr('Please choose video files.');
            return
        }
        arr.forEach(function(f) {
            var it = {
                id: ++uid,
                file: f
            };
            items.push(it);
            loadMeta(it)
        });
        clearOut();
        render();
    }

    function render() {
        dz.hidden = items.length > 0;
        $('tool').hidden = !items.length;
        var td = 0,
            ts = 0;
        items.forEach(function(i) {
            td += i.dur || 0;
            ts += i.file.size
        });

        $('summary').textContent = items.length + ' clip' + (items.length === 1 ? '' : 's') + (td ? ' · ' + fmtTime(td) : '') + ' · ' + fmt(ts);
        $('go').disabled = busy || items.length < 2;
        //$('go').textContent = items.length < 2 ? 'Add at least 2 videos' : 'Merge videos';
        $('go').innerHTML = items.length < 2 ? '<i class="fa-solid fa-add me-2"></i>Add at least 2 videos' : '<i class="fa-solid fa-merge me-2"></i>Merge videos';
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
            sm.textContent = [it.dur ? fmtTime(it.dur) : '', it.w ? it.w + '×' + it.h : '', fmt(it.file.size)].filter(Boolean).join(' · ');
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
                b.disabled = !!dis || busy;
                b.onclick = fn;
                c.appendChild(b)
            }
            ib('↑', 'Move up', function() {
                mv(i, -1)
            }, i === 0);
            ib('↓', 'Move down', function() {
                mv(i, 1)
            }, i === items.length - 1);
            ib('✕', 'Remove', function() {
                items.splice(i, 1);
                clearOut();
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
        if (j < 0 || j >= items.length) return;
        var t = items[i];
        items[i] = items[j];
        items[j] = t;
        clearOut();
        render()
    }

    $('sortName').onclick = function() {
        if (busy) return;
        items.sort(function(a, b) {
            return a.file.name.localeCompare(b.file.name, undefined, {
                numeric: true
            })
        });
        clearOut();
        render()
    };

    $('clear').onclick = function() {
        if (busy) return;
        items = [];
        clearOut();
        hideStage();
        showErr('');
        render()
    };

    document.querySelectorAll('.opt .modes').forEach(function(g) {
        g.onclick = function(e) {
            var b = e.target.closest('button');
            if (!b || busy) return;
            opt[g.dataset.k] = b.dataset.v;
            [].forEach.call(g.children, function(x) {
                x.classList.toggle('on', x === b)
            });
            if (g.dataset.k === 'mode') setDesc();
            clearOut();
        };
    });

    function own(msg) {
        var e = new Error(msg);
        e.own = true;
        return e
    }
    async function merge(codec) {
        var f = await ensureLoaded(),
            n = items.length,
            names = [],
            infos = [],
            ext0 = 'mp4';
        for (var i = 0; i < n; i++) {
            if (cancelled) throw own('cancelled');
            var it = items[i],
                ext = (/\.([a-z0-9]{2,4})$/i.exec(it.file.name) || [0, 'mp4'])[1].toLowerCase(),
                name = 'in_' + i + '.' + ext;
            if (i === 0) ext0 = ext;
            stage('Loading clips · ' + (i + 1) + ' of ' + n, Math.round(i / n * 100));
            await f.writeFile(name, new Uint8Array(await it.file.arrayBuffer()));
            names.push(name);
            lastLog = [];
            await f.exec(['-hide_banner', '-i', name]);
            var p = parseProbe(lastLog.join('\n'));
            if (!p.vcodec) throw own('"' + it.file.name + '" has no picture that the converter can read.');
            infos.push(p);
        }
        var totalDur = infos.reduce(function(a, p) {
            return a + p.dur
        }, 0) || 1;
        var progress = function(label) {
            onProg = function(e) {
                var q = typeof e.time === 'number' && e.time > 0 ? e.time / 1e6 / totalDur : e.progress;
                if (typeof q === 'number') stage(label, clamp(Math.round(q * 100), 0, 99))
            }
        };
        var matching = infos.every(function(p) {
                return sig(p) === sig(infos[0])
            }),
            result = null,
            note = '';
        try {
            if (opt.mode === 'auto' && matching) {
                await f.writeFile('list.txt', new TextEncoder().encode(names.map(function(x) {
                    return "file '" + x + "'"
                }).join('\n')));
                var outF = 'merged_out.' + ext0,
                    args = ['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-map', '0:v:0?', '-map', '0:a:0?', '-c', 'copy'];
                if (/^(mp4|mov|m4v)$/.test(ext0)) args.push('-movflags', '+faststart');
                args.push('-y', outF);
                stage('Joining clips', 0);
                progress('Joining clips');
                var code = await f.exec(args);
                onProg = null;
                if (code === 0) {
                    var data = await f.readFile(outF);
                    if (data && data.length) result = {
                        blob: new Blob([data.buffer], {
                            type: MIME[ext0] || 'video/mp4'
                        }),
                        ext: ext0,
                        note: 'Joined without re-encoding, so the quality is unchanged.'
                    }
                }
                if (!result) note = 'The clips could not be joined without re-encoding, so they were re-encoded to match.';
            } else if (opt.mode === 'auto') {
                note = 'The clips differ in size, frame rate or format, so they were re-encoded to match.'
            }
            if (!result) {
                if (cancelled) throw own('cancelled');
                var sz = targetSize(infos[0], opt.size),
                    F = clamp(Math.round(infos[0].fps) || 30, 15, 60);
                var crf = {
                        high: '18',
                        med: '23',
                        small: '28'
                    } [opt.q],
                    ab = {
                        high: '224k',
                        med: '192k',
                        small: '128k'
                    } [opt.q];
                var args2 = [];
                names.forEach(function(x) {
                    args2.push('-i', x)
                });
                args2.push('-filter_complex', buildFilter(infos, sz.w, sz.h, F), '-map', '[v]', '-map', '[a]');
                args2 = args2.concat(codec === 'x264' ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf] : ['-c:v', 'mpeg4', '-q:v', {
                    high: '2',
                    med: '4',
                    small: '7'
                } [opt.q]], ['-c:a', 'aac', '-b:a', ab, '-movflags', '+faststart', '-f', 'mp4', '-y', 'merged_out.mp4']);
                stage('Re-encoding clips', 0);
                progress('Re-encoding clips');
                var code2 = await f.exec(args2);
                onProg = null;
                if (code2 !== 0) throw own('The converter could not join these videos.');
                var data2 = await f.readFile('merged_out.mp4');
                if (!data2 || !data2.length) throw own('The converter produced an empty file.');
                result = {
                    blob: new Blob([data2.buffer], {
                        type: 'video/mp4'
                    }),
                    ext: 'mp4',
                    note: (note ? note + ' ' : '') + (fallbackNote || '')
                };
            }
        } finally {
            onProg = null;
            if (ff === f) {
                names.concat(['list.txt', 'merged_out.' + ext0, 'merged_out.mp4']).forEach(function(x) {
                    f.deleteFile(x).catch(noop)
                })
            }
        }
        return result;
    }

    async function runMerge(codec) {
        try {
            return await merge(codec)
        } catch (e) {
            onProg = null;
            if (cancelled) throw e;
            if (!e.own) {
                if (ff) {
                    try {
                        ff.terminate()
                    } catch (x) {}
                    ff = null
                }
                if (codec === 'x264') {
                    fallbackNote = 'H.264 was not available in this converter, so MPEG-4 video was used.';
                    return runMerge('mpeg4')
                }
            }
            throw e;
        }
    }

    $('go').onclick = async function() {
        if (busy || items.length < 2) return;
        showErr('');
        clearOut();
        fallbackNote = '';
        cancelled = false;
        busy = true;
        render();
        $('go').textContent = 'Merging…';
        $('cancel').hidden = false;
        try {
            var r = await runMerge('x264');
            var base = ($('outName').value.trim() || 'merged').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[\\/:*?"<>|]/g, '_'),
                name = base + '.' + r.ext;
            out = {
                blob: r.blob,
                url: URL.createObjectURL(r.blob),
                name: name
            };
            var td = items.reduce(function(a, i) {
                return a + (i.dur || 0)
            }, 0);
            $('rname').textContent = name;
            $('rinfo').textContent = [td ? fmtTime(td) : '', fmt(r.blob.size), r.note].filter(Boolean).join(' · ');
            $('dl').href = out.url;
            $('dl').download = name;
            $('rvid').src = out.url;
            $('rvwrap').hidden = false;
            $('res').hidden = false;
            stage('Done · your video is ready', 100);
        } catch (e) {
            if (cancelled) {
                hideStage()
            } else {
                var bad = lastLog.filter(function(l) {
                    return /error|unknown|not found|invalid|unsupported|could not|cannot|failed|memory|abort/i.test(l) && !/^\s*encoder\s*:/i.test(l)
                }).pop();
                showErr(((e && e.message) || 'The converter stopped unexpectedly. This can happen with very large videos, or if the converter build has a fault.') + (bad && !e.own ? ' (' + bad.trim().slice(0, 110) + ')' : ''));
                hideStage();
            }
        }
        busy = false;
        $('cancel').hidden = true;
        render();
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