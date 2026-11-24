(function(root) {
	'use strict';
	const XE = {};
	class XErr {
		constructor(c) {
			this.code = c;
		}
		toString() {
			return this.code;
		}
	}

	const ERR = {};
	['#DIV/0!', '#N/A', '#NAME?', '#NULL!', '#NUM!', '#REF!', '#VALUE!', '#CIRC!'].forEach((c) => {
		ERR[c] = new XErr(c);
	});

	const isErr = (v) => v instanceof XErr;
	XE.ERR = ERR;
	XE.isErr = isErr;
	XE.XErr = XErr;

	function colName(c) {
		let s = '';
		c++;
		while(c > 0) {
			const m = (c - 1) % 26;
			s = String.fromCharCode(65 + m) + s;
			c = Math.floor((c - 1) / 26);
		}
		return s;
	}

	function colIdx(s) {
		let n = 0;
		s = s.toUpperCase();
		for(let i = 0; i < s.length; i++) n = n * 26 + s.charCodeAt(i) - 64;
		return n - 1;
	}

	const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;

	function parseCell(s) {
		const m = CELL_RE.exec(s);
		return m ? {
			c: colIdx(m[2]),
			r: +m[4] - 1,
			ac: !!m[1],
			ar: !!m[3]
		} : null;
	}
	const cellStr = (r, c, ar, ac) => (ac ? '$' : '') + colName(c) + (ar ? '$' : '') + (r + 1);
	XE.colName = colName;
	XE.colIdx = colIdx;
	XE.parseCell = parseCell;
	XE.cellStr = cellStr;
	XE.addr = (r, c) => colName(c) + (r + 1);
	XE.parseRange = function(s) { // 'A1:B3' or 'A1'
		const p = String(s).replace(/\$/g, '').split(':');
		const a = parseCell(p[0]),
			b = p[1] ? parseCell(p[1]) : a;
		if(!a || !b) return null;
		return {
			r1: Math.min(a.r, b.r),
			c1: Math.min(a.c, b.c),
			r2: Math.max(a.r, b.r),
			c2: Math.max(a.c, b.c)
		};
	};

	const TOKENS = [
		['ws', /^\s+/],
		['str', /^"(?:[^"]|"")*"/],
		['err', /^#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|CIRC!)/i],
		['ref', /^(?:(?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(?:\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+)(?![A-Za-z0-9_(.])/],
		['num', /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/],
		['fn', /^[A-Za-z_][A-Za-z0-9_.]*(?=\()/],
		['bool', /^(?:TRUE|FALSE)(?![A-Za-z0-9_(])/i],
		['op', /^(?:<>|<=|>=|[-+*\/^&=<>%])/],
		['lp', /^\(/],
		['rp', /^\)/],
		['comma', /^[,;]/],
		['name', /^[A-Za-z_][A-Za-z0-9_.]*/]
	];

	function tokenize(f) {
		const out = [];
		let s = f;
		while(s.length) {
			let hit = false;
			for(let i = 0; i < TOKENS.length; i++) {
				const m = TOKENS[i][1].exec(s);
				if(m) {
					out.push({
						type: TOKENS[i][0],
						raw: m[0]
					});
					s = s.slice(m[0].length);
					hit = true;
					break;
				}
			}
			if(!hit) throw new Error('syntax');
		}
		return out;
	}
	const BIN = {
		'=': 1,
		'<>': 1,
		'<': 1,
		'>': 1,
		'<=': 1,
		'>=': 1,
		'&': 2,
		'+': 3,
		'-': 3,
		'*': 4,
		'/': 4,
		'^': 5
	};

	function splitSheet(raw) {
		const m = /^(?:('(?:[^']|'')+'|[^!]+)!)?(.*)$/.exec(raw);
		let sh = m[1] || null;
		if(sh && sh.charAt(0) === "'") sh = sh.slice(1, -1).replace(/''/g, "'");
		return {
			sheet: sh,
			rest: m[2]
		};
	}

	function refNode(raw) {
		const sp = splitSheet(raw),
			rest = sp.rest;
		if(rest.indexOf(':') < 0) {
			const c = parseCell(rest);
			return Object.assign({
				t: 'ref',
				sheet: sp.sheet
			}, c);
		}
		const parts = rest.split(':');
		const a = parseCell(parts[0]),
			b = parseCell(parts[1]);
		if(a && b) return {
			t: 'range',
			sheet: sp.sheet,
			r1: Math.min(a.r, b.r),
			c1: Math.min(a.c, b.c),
			r2: Math.max(a.r, b.r),
			c2: Math.max(a.c, b.c)
		};
		if(/^\$?[A-Za-z]+$/.test(parts[0])) {
			const x = colIdx(parts[0].replace('$', '')),
				y = colIdx(parts[1].replace('$', ''));
			return {
				t: 'range',
				sheet: sp.sheet,
				r1: 0,
				c1: Math.min(x, y),
				r2: Infinity,
				c2: Math.max(x, y)
			};
		}
		const x = +parts[0].replace('$', '') - 1,
			y = +parts[1].replace('$', '') - 1;
		return {
			t: 'range',
			sheet: sp.sheet,
			r1: Math.min(x, y),
			c1: 0,
			r2: Math.max(x, y),
			c2: Infinity
		};
	}

	function parseTokens(toks) {
		const t = toks.filter((x) => x.type !== 'ws');
		let i = 0;
		const peek = () => t[i],
			next = () => t[i++];

		function expect(type) {
			const x = next();
			if(!x || x.type !== type) throw new Error('syntax');
			return x;
		}

		function primary() {
			const x = next();
			if(!x) throw new Error('syntax');
			switch(x.type) {
				case 'num':
					return {
						t: 'num',
						v: parseFloat(x.raw)
					};
				case 'str':
					return {
						t: 'str',
						v: x.raw.slice(1, -1).replace(/""/g, '"')
					};
				case 'bool':
					return {
						t: 'bool',
						v: x.raw.toUpperCase() === 'TRUE'
					};
				case 'err':
					return {
						t: 'err',
						v: ERR[x.raw.toUpperCase()]
					};
				case 'ref':
					return refNode(x.raw);
				case 'name':
					return {
						t: 'name',
						v: x.raw
					};
				case 'lp':
					{
						const e = expr(0);
						expect('rp');
						return e;
					}
				case 'fn':
					{
						expect('lp');
						const args = [];
						if(peek() && peek().type === 'rp') {
							next();
							return {
								t: 'fn',
								name: x.raw.toUpperCase(),
								args
							};
						}
						for(;;) {
							const p = peek();
							args.push(p && (p.type === 'comma' || p.type === 'rp') ? {
								t: 'empty'
							} : expr(0));
							const s = next();
							if(!s) throw new Error('syntax');
							if(s.type === 'rp') break;
							if(s.type !== 'comma') throw new Error('syntax');
						}
						return {
							t: 'fn',
							name: x.raw.toUpperCase(),
							args
						};
					}
				default:
					throw new Error('syntax');
			}
		}

		function prefix() {
			const p = peek();
			if(p && p.type === 'op' && (p.raw === '-' || p.raw === '+')) {
				next();
				const x = prefix();
				return p.raw === '-' ? {
					t: 'un',
					x
				} : x;
			}
			let n = primary();
			while(peek() && peek().type === 'op' && peek().raw === '%') {
				next();
				n = {
					t: 'pct',
					x: n
				};
			}
			return n;
		}

		function expr(minp) {
			let left = prefix();
			for(;;) {
				const p = peek();
				if(!p || p.type !== 'op' || !BIN[p.raw] || BIN[p.raw] < minp) break;
				next();
				const right = expr(BIN[p.raw] + 1);
				left = {
					t: 'bin',
					op: p.raw,
					l: left,
					r: right
				};
			}
			return left;
		}
		const ast = expr(0);
		if(i < t.length) throw new Error('syntax');
		return ast;
	}

	const cache = new Map();

	function compile(f) {
		let c = cache.get(f);
		if(c) return c;
		try {
			c = {
				ast: parseTokens(tokenize(f))
			};
		} catch(e) {
			c = {
				bad: true
			};
		}
		if(cache.size > 20000) cache.clear();
		cache.set(f, c);
		return c;
	}

	XE.compile = compile;
	XE.tokenize = tokenize;

	const mkArr = (rows) => ({
		arr: true,
		rows
	});
	const isArr = (v) => v && v.arr === true;
	const first = (v) => (isArr(v) ? (v.rows.length && v.rows[0].length ? v.rows[0][0] : null) : v);

	function toNum(v) {
		v = first(v);
		if(isErr(v)) return v;
		if(v === null || v === undefined || v === '') return 0;
		if(typeof v === 'number') return v;
		if(typeof v === 'boolean') return v ? 1 : 0;
		const s = String(v).trim();
		if(s === '') return ERR['#VALUE!'];
		const n = Number(s.replace(/^\$/, '').replace(/,/g, ''));
		if(!isNaN(n) && /^[-+]?[\d.,$]+(e[-+]?\d+)?%?$/i.test(s.replace(/%$/, ''))) return /%$/.test(s) ? n / 100 : n;
		const d = XE.parseDate(s);
		return d !== null ? d : ERR['#VALUE!'];
	}

	function toStr(v) {
		v = first(v);
		if(isErr(v)) return v;
		if(v === null || v === undefined) return '';
		if(typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
		if(typeof v === 'number') return numToStr(v);
		return String(v);
	}

	function toBool(v) {
		v = first(v);
		if(isErr(v)) return v;
		if(typeof v === 'boolean') return v;
		if(v === null || v === '') return false;
		if(typeof v === 'number') return v !== 0;
		const s = String(v).toUpperCase();
		if(s === 'TRUE') return true;
		if(s === 'FALSE') return false;
		return ERR['#VALUE!'];
	}

	function numToStr(n) {
		if(!isFinite(n)) return String(n);
		if(n === 0) return '0';
		const a = Math.abs(n);
		if(a >= 1e15 || a < 1e-9) return n.toExponential(9).replace(/\.?0+e/, 'E').replace('e', 'E').replace('E+', 'E+');
		return String(+n.toPrecision(15));
	}

	XE.numToStr = numToStr;
	const typeRank = (v) => (v === null ? 0 : typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3);

	function compare(a, b) { // -1, 0, 1 following Excel's ordering
		if(a === null) a = typeof b === 'string' ? '' : (typeof b === 'boolean' ? false : 0);
		if(b === null) b = typeof a === 'string' ? '' : (typeof a === 'boolean' ? false : 0);
		const ra = typeRank(a),
			rb = typeRank(b);
		if(ra !== rb) return ra < rb ? -1 : 1;
		if(typeof a === 'string') {
			const x = a.toLowerCase(),
				y = b.toLowerCase();
			return x < y ? -1 : x > y ? 1 : 0;
		}
		return a < b ? -1 : a > b ? 1 : 0;
	}

	XE.compare = compare;

	function rangeValues(n, ctx) {
		const sh = n.sheet ? ctx.host.sheetByName(n.sheet) : ctx.sheet;
		if(!sh) return ERR['#REF!'];
		const b = ctx.host.bounds(sh);
		const r2 = Math.min(n.r2, Math.max(b.maxR, n.r1)),
			c2 = Math.min(n.c2, Math.max(b.maxC, n.c1));
		const rows = [];
		for(let r = n.r1; r <= r2; r++) {
			const row = [];
			for(let c = n.c1; c <= c2; c++) row.push(ctx.host.value(sh, r, c, ctx));
			rows.push(row);
		}
		const a = mkArr(rows);
		a.sheet = sh;
		a.r1 = n.r1;
		a.c1 = n.c1;
		return a;
	}

	function mapPair(a, b, fn) { // element-wise operation, broadcasting single values
		if(!isArr(a) && !isArr(b)) return fn(a, b);
		const A = isArr(a) ? a.rows : [
				[a]
			],
			B = isArr(b) ? b.rows : [
				[b]
			];
		const R = Math.max(A.length, B.length),
			C = Math.max(A[0].length, B[0].length);
		const out = [];
		for(let r = 0; r < R; r++) {
			const row = [];
			for(let c = 0; c < C; c++) {
				const x = A.length === 1 ? A[0][A[0].length === 1 ? 0 : c] : (A[r] ? A[r][A[0].length === 1 ? 0 : c] : ERR['#N/A']);
				const y = B.length === 1 ? B[0][B[0].length === 1 ? 0 : c] : (B[r] ? B[r][B[0].length === 1 ? 0 : c] : ERR['#N/A']);
				row.push(x === undefined || y === undefined ? ERR['#N/A'] : fn(x, y));
			}
			out.push(row);
		}
		return mkArr(out);
	}

	function binop(op, a, b) {
		if(isErr(a)) return a;
		if(isErr(b)) return b;
		switch(op) {
			case '&':
				return toStr(a) + toStr(b);
			case '=':
				return compare(a, b) === 0;
			case '<>':
				return compare(a, b) !== 0;
			case '<':
				return compare(a, b) < 0;
			case '>':
				return compare(a, b) > 0;
			case '<=':
				return compare(a, b) <= 0;
			case '>=':
				return compare(a, b) >= 0;
		}
		const x = toNum(a),
			y = toNum(b);
		if(isErr(x)) return x;
		if(isErr(y)) return y;
		switch(op) {
			case '+':
				return x + y;
			case '-':
				return x - y;
			case '*':
				return x * y;
			case '/':
				return y === 0 ? ERR['#DIV/0!'] : x / y;
			case '^':
				{
					const r = Math.pow(x, y);
					return isNaN(r) ? ERR['#NUM!'] : r;
				}
		}
		return ERR['#VALUE!'];
	}

	const LAZY = {
		IF(args, ctx) {
				const c = toBool(evalNode(args[0], ctx));
				if(isErr(c)) return c;
				if(c) return args.length > 1 ? evalNode(args[1], ctx) : true;
				return args.length > 2 ? evalNode(args[2], ctx) : false;
			},
			IFERROR(args, ctx) {
				const v = first(evalNode(args[0], ctx));
				return isErr(v) ? evalNode(args[1], ctx) : v;
			},
			IFNA(args, ctx) {
				const v = first(evalNode(args[0], ctx));
				return isErr(v) && v === ERR['#N/A'] ? evalNode(args[1], ctx) : v;
			},
			IFS(args, ctx) {
				for(let i = 0; i + 1 < args.length; i += 2) {
					const c = toBool(evalNode(args[i], ctx));
					if(isErr(c)) return c;
					if(c) return evalNode(args[i + 1], ctx);
				}
				return ERR['#N/A'];
			},
			CHOOSE(args, ctx) {
				const i = toNum(evalNode(args[0], ctx));
				if(isErr(i)) return i;
				const k = Math.floor(i);
				return k >= 1 && k < args.length ? evalNode(args[k], ctx) : ERR['#VALUE!'];
			},
			ROW(args, ctx) {
				const n = args[0];
				return n ? (n.t === 'ref' ? n.r + 1 : (n.t === 'range' ? n.r1 + 1 : ERR['#VALUE!'])) : ctx.r + 1;
			},
			COLUMN(args, ctx) {
				const n = args[0];
				return n ? (n.t === 'ref' ? n.c + 1 : (n.t === 'range' ? n.c1 + 1 : ERR['#VALUE!'])) : ctx.c + 1;
			}
	};

	function evalNode(n, ctx) {
		switch(n.t) {
			case 'num':
			case 'str':
			case 'bool':
			case 'err':
				return n.v;
			case 'empty':
				return null;
			case 'ref':
				{
					const sh = n.sheet ? ctx.host.sheetByName(n.sheet) : ctx.sheet;
					if(!sh) return ERR['#REF!'];
					if(n.r < 0 || n.c < 0) return ERR['#REF!'];
					return ctx.host.value(sh, n.r, n.c, ctx);
				}
			case 'range':
				return rangeValues(n, ctx);
			case 'name':
				return ERR['#NAME?'];
			case 'un':
				{
					const v = evalNode(n.x, ctx);
					return mapPair(v, 0, (a) => {
						const x = toNum(a);
						return isErr(x) ? x : -x;
					});
				}
			case 'pct':
				{
					const v = evalNode(n.x, ctx);
					return mapPair(v, 0, (a) => {
						const x = toNum(a);
						return isErr(x) ? x : x / 100;
					});
				}
			case 'bin':
				{
					const a = evalNode(n.l, ctx),
						b = evalNode(n.r, ctx);
					return mapPair(a, b, (x, y) => binop(n.op, x, y));
				}
			case 'fn':
				{
					if(LAZY[n.name]) return LAZY[n.name](n.args, ctx);
					const f = FN[n.name];
					if(!f) return ERR['#NAME?'];
					const args = n.args.map((a) => evalNode(a, ctx));
					try {
						return f(args, ctx);
					} catch(e) {
						return ERR['#VALUE!'];
					}
				}
		}
		return ERR['#VALUE!'];
	}

	XE.evalFormula = function(formula, ctx) {
		const c = compile(formula);
		if(c.bad) return ERR['#NAME?'];
		const v = evalNode(c.ast, ctx);
		return first(v);
	};

	function flatNums(args, strict) { // numbers from arguments; cells with text are skipped, direct text is converted
		const out = [];
		for(const a of args) {
			if(isArr(a)) {
				for(const row of a.rows)
					for(const v of row) {
						if(isErr(v)) return v;
						if(typeof v === 'number') out.push(v);
						else if(typeof v === 'boolean' && strict) out.push(v ? 1 : 0);
					}
			} else {
				if(isErr(a)) return a;
				if(a === null) continue;
				const x = toNum(a);
				if(isErr(x)) return x;
				out.push(x);
			}
		}
		return out;
	}

	function flatAll(args) {
		const out = [];
		for(const a of args) {
			if(isArr(a)) a.rows.forEach((r) => r.forEach((v) => out.push(v)));
			else out.push(a);
		}
		return out;
	}
	const num = (a, d) => {
		if(a === undefined || a === null) return d;
		const x = toNum(a);
		return x;
	};

	const sx = (a) => toStr(a);
	const roundTo = (x, d, mode) => {
		const k = Math.pow(10, d);
		const y = x * k;
		let r;
		if(mode === 'up') r = y < 0 ? -Math.ceil(-y - 1e-12) : Math.ceil(y - 1e-12);
		else if(mode === 'down') r = y < 0 ? -Math.floor(-y + 1e-12) : Math.floor(y + 1e-12);
		else r = y < 0 ? -Math.round(-y + 1e-9) : Math.round(y + 1e-9);
		return r / k;
	};

	function critFn(crit) { // SUMIF / COUNTIF criteria
		if(isArr(crit)) crit = first(crit);
		let op = '=',
			val = crit;
		if(typeof crit === 'string') {
			const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(crit);
			op = m[1] || '=';
			val = m[2];
			const n = Number(val);
			if(val !== '' && !isNaN(n)) val = n;
			else if(/^(true|false)$/i.test(val)) val = val.toUpperCase() === 'TRUE';
		}

		if(typeof val === 'string' && /[*?]/.test(val) && (op === '=' || op === '<>')) {
			const re = new RegExp('^' + val.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*') + '$', 'i');
			return(v) => {
				const hit = typeof v === 'string' && re.test(v);
				return op === '=' ? hit : !hit;
			};
		}

		return(v) => {
			if(isErr(v)) return false;
			if(typeof val === 'number' && typeof v !== 'number') {
				if(op === '<>') return true;
				return false;
			}
			if(typeof val === 'string' && typeof v === 'number') return op === '<>';
			if(v === null) {
				if(val === '') return op === '=';
				return op === '<>';
			}
			const c = compare(v, val);
			return op === '=' ? c === 0 : op === '<>' ? c !== 0 : op === '<' ? c < 0 : op === '>' ? c > 0 : op === '<=' ? c <= 0 : c >= 0;
		};
	}

	function condRows(pairs) { // pairs of (range, criteria) -> list of matching row/col positions
		const first0 = pairs[0][0];
		const R = first0.rows.length,
			C = first0.rows[0].length;
		const fns = pairs.map((p) => critFn(p[1]));
		const hits = [];
		for(let r = 0; r < R; r++)
			for(let c = 0; c < C; c++) {
				let ok = true;
				for(let k = 0; k < pairs.length && ok; k++) {
					const row = pairs[k][0].rows[r];
					ok = !!row && fns[k](row[c]);
				}
				if(ok) hits.push([r, c]);
			}
		return hits;
	}

	const asArr = (v) => (isArr(v) ? v : mkArr([
		[v]
	]));

	function lookupCmp(a, b) {
		return compare(a, b);
	}
	const DAY = 86400000;

	function serialToDate(n) {
		const base = n < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
		return new Date(base + Math.floor(n) * DAY + Math.round((n % 1) * DAY));
	}

	function dateToSerial(d) {
		const ms = d.getTime();
		let n = (ms - Date.UTC(1899, 11, 30)) / DAY;
		if(n < 60) n -= 1;
		return n;
	}

	XE.serialToDate = serialToDate;
	XE.dateToSerial = dateToSerial;
	XE.parseDate = function(s) {
		let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
		let y, mo, d, hh = 0,
			mi = 0,
			ss = 0;
		if(m) {
			y = +m[1];
			mo = +m[2];
			d = +m[3];
			hh = +(m[4] || 0);
			mi = +(m[5] || 0);
			ss = +(m[6] || 0);
		} else if((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s))) {
			mo = +m[1];
			d = +m[2];
			y = +m[3];
			if(y < 100) y += y < 30 ? 2000 : 1900;
		} else if((m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s))) return(+m[1] * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400;
		else return null;
		if(mo < 1 || mo > 12 || d < 1 || d > 31) return null;
		return dateToSerial(new Date(Date.UTC(y, mo - 1, d))) + (hh * 3600 + mi * 60 + ss) / 86400;
	};

	const wrapNum = (fn) => (a) => {
		const x = toNum(a[0]);
		return isErr(x) ? x : fn(x);
	};

	const FN = {
		SUM: (a) => {
			const n = flatNums(a);
			return isErr(n) ? n : n.reduce((x, y) => x + y, 0);
		},

		AVERAGE: (a) => {
			const n = flatNums(a);
			if(isErr(n)) return n;
			return n.length ? n.reduce((x, y) => x + y, 0) / n.length : ERR['#DIV/0!'];
		},

		MIN: (a) => {
			const n = flatNums(a);
			return isErr(n) ? n : (n.length ? Math.min.apply(null, n) : 0);
		},

		MAX: (a) => {
			const n = flatNums(a);
			return isErr(n) ? n : (n.length ? Math.max.apply(null, n) : 0);
		},

		COUNT: (a) => {
			let k = 0;
			for(const v of flatAll(a))
				if(typeof v === 'number') k++;
			return k;
		},

		COUNTA: (a) => {
			let k = 0;
			for(const v of flatAll(a))
				if(v !== null && v !== '') k++;
			return k;
		},

		COUNTBLANK: (a) => {
			let k = 0;
			for(const v of flatAll(a))
				if(v === null || v === '') k++;
			return k;
		},

		PRODUCT: (a) => {
			const n = flatNums(a);
			return isErr(n) ? n : n.reduce((x, y) => x * y, 1);
		},

		MEDIAN: (a) => {
			const n = flatNums(a);
			if(isErr(n)) return n;
			if(!n.length) return ERR['#NUM!'];
			n.sort((x, y) => x - y);
			const m = n.length >> 1;
			return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
		},

		VAR: (a) => {
			const n = flatNums(a);
			if(isErr(n)) return n;
			if(n.length < 2) return ERR['#DIV/0!'];
			const m = n.reduce((x, y) => x + y, 0) / n.length;
			return n.reduce((s, x) => s + (x - m) * (x - m), 0) / (n.length - 1);
		},

		STDEV: (a) => {
			const v = FN.VAR(a);
			return isErr(v) ? v : Math.sqrt(v);
		},

		LARGE: (a) => {
			const n = flatNums([a[0]]);
			const k = toNum(a[1]);
			if(isErr(n)) return n;
			if(isErr(k)) return k;
			n.sort((x, y) => y - x);
			return k >= 1 && k <= n.length ? n[k - 1] : ERR['#NUM!'];
		},

		SMALL: (a) => {
			const n = flatNums([a[0]]);
			const k = toNum(a[1]);
			if(isErr(n)) return n;
			if(isErr(k)) return k;
			n.sort((x, y) => x - y);
			return k >= 1 && k <= n.length ? n[k - 1] : ERR['#NUM!'];
		},

		RANK: (a) => {
			const x = toNum(a[0]);
			const n = flatNums([a[1]]);
			if(isErr(x)) return x;
			if(isErr(n)) return n;
			const asc = a[2] !== undefined && toNum(a[2]) !== 0;
			if(n.indexOf(x) < 0) return ERR['#N/A'];
			return 1 + n.filter((v) => (asc ? v < x : v > x)).length;
		},

		SUMPRODUCT: (a) => {
			const arrs = a.map(asArr);
			const R = arrs[0].rows.length,
				C = arrs[0].rows[0].length;
			let s = 0;
			for(let r = 0; r < R; r++)
				for(let c = 0; c < C; c++) {
					let p = 1;
					for(const A of arrs) {
						if(!A.rows[r] || A.rows[r][c] === undefined) return ERR['#VALUE!'];
						const v = A.rows[r][c];
						if(isErr(v)) return v;
						p *= typeof v === 'number' ? v : (typeof v === 'boolean' ? (v ? 1 : 0) : 0);
					}
					s += p;
				}
			return s;
		},

		ABS: wrapNum(Math.abs),
		SQRT: wrapNum((x) => (x < 0 ? ERR['#NUM!'] : Math.sqrt(x))),
		INT: wrapNum(Math.floor),
		EXP: wrapNum(Math.exp),
		LN: wrapNum((x) => (x <= 0 ? ERR['#NUM!'] : Math.log(x))),
		LOG10: wrapNum((x) => (x <= 0 ? ERR['#NUM!'] : Math.log10(x))),
		LOG: (a) => {
			const x = toNum(a[0]),
				b = a[1] === undefined ? 10 : toNum(a[1]);
			if(isErr(x)) return x;
			if(isErr(b)) return b;
			return x <= 0 || b <= 0 || b === 1 ? ERR['#NUM!'] : Math.log(x) / Math.log(b);
		},

		SIGN: wrapNum(Math.sign),
		TRUNC: (a) => {
			const x = toNum(a[0]),
				d = num(a[1], 0);
			if(isErr(x)) return x;
			return roundTo(x, d, 'down');
		},

		PI: () => Math.PI,
		POWER: (a) => binop('^', a[0], a[1]),
		MOD: (a) => {
			const x = toNum(a[0]),
				y = toNum(a[1]);
			if(isErr(x)) return x;
			if(isErr(y)) return y;
			return y === 0 ? ERR['#DIV/0!'] : x - y * Math.floor(x / y);
		},

		ROUND: (a) => {
			const x = toNum(a[0]),
				d = num(a[1], 0);
			return isErr(x) ? x : (isErr(d) ? d : roundTo(x, d));
		},

		ROUNDUP: (a) => {
			const x = toNum(a[0]),
				d = num(a[1], 0);
			return isErr(x) ? x : roundTo(x, d, 'up');
		},

		ROUNDDOWN: (a) => {
			const x = toNum(a[0]),
				d = num(a[1], 0);
			return isErr(x) ? x : roundTo(x, d, 'down');
		},

		CEILING: (a) => {
			const x = toNum(a[0]),
				s = num(a[1], 1);
			if(isErr(x)) return x;
			return s === 0 ? 0 : Math.ceil(x / s) * s;
		},

		FLOOR: (a) => {
			const x = toNum(a[0]),
				s = num(a[1], 1);
			if(isErr(x)) return x;
			return s === 0 ? ERR['#DIV/0!'] : Math.floor(x / s) * s;
		},

		RAND: () => Math.random(),
		RANDBETWEEN: (a) => {
			const lo = toNum(a[0]),
				hi = toNum(a[1]);
			return Math.floor(Math.random() * (hi - lo + 1)) + lo;
		},

		AND: (a) => {
			let r = true,
				any = false;
			for(const v of flatAll(a)) {
				if(isErr(v)) return v;
				if(v === null || typeof v === 'string') continue;
				any = true;
				if(!toBool(v)) r = false;
			}
			return any ? r : ERR['#VALUE!'];
		},

		OR: (a) => {
			let r = false,
				any = false;
			for(const v of flatAll(a)) {
				if(isErr(v)) return v;
				if(v === null || typeof v === 'string') continue;
				any = true;
				if(toBool(v)) r = true;
			}
			return any ? r : ERR['#VALUE!'];
		},

		NOT: (a) => {
			const b = toBool(a[0]);
			return isErr(b) ? b : !b;
		},

		XOR: (a) => {
			let k = 0;
			for(const v of flatAll(a)) {
				const b = toBool(v);
				if(isErr(b)) return b;
				if(b) k++;
			}
			return k % 2 === 1;
		},

		TRUE: () => true,
		FALSE: () => false,
		ISNUMBER: (a) => typeof first(a[0]) === 'number',
		ISTEXT: (a) => typeof first(a[0]) === 'string',
		ISBLANK: (a) => first(a[0]) === null,
		ISERROR: (a) => isErr(first(a[0])),
		ISERR: (a) => isErr(first(a[0])) && first(a[0]) !== ERR['#N/A'],
		ISNA: (a) => first(a[0]) === ERR['#N/A'],
		ISLOGICAL: (a) => typeof first(a[0]) === 'boolean',
		NA: () => ERR['#N/A'],
		LEN: (a) => {
			const s = sx(a[0]);
			return isErr(s) ? s : s.length;
		},

		UPPER: (a) => {
			const s = sx(a[0]);
			return isErr(s) ? s : s.toUpperCase();
		},

		LOWER: (a) => {
			const s = sx(a[0]);
			return isErr(s) ? s : s.toLowerCase();
		},

		PROPER: (a) => {
			const s = sx(a[0]);
			return isErr(s) ? s : s.toLowerCase().replace(/(^|[^a-z0-9'])([a-z])/g, (m, p, c) => p + c.toUpperCase());
		},

		TRIM: (a) => {
			const s = sx(a[0]);
			return isErr(s) ? s : s.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ');
		},

		CLEAN: (a) => {
			const s = sx(a[0]);
			return isErr(s) ? s : s.replace(/[\x00-\x1f]/g, '');
		},

		LEFT: (a) => {
			const s = sx(a[0]),
				n = num(a[1], 1);
			if(isErr(s)) return s;
			if(isErr(n)) return n;
			return n < 0 ? ERR['#VALUE!'] : s.slice(0, n);
		},

		RIGHT: (a) => {
			const s = sx(a[0]),
				n = num(a[1], 1);
			if(isErr(s)) return s;
			if(isErr(n)) return n;
			return n < 0 ? ERR['#VALUE!'] : (n === 0 ? '' : s.slice(-n));
		},

		MID: (a) => {
			const s = sx(a[0]),
				st = toNum(a[1]),
				n = toNum(a[2]);
			if(isErr(s)) return s;
			if(isErr(st)) return st;
			if(isErr(n)) return n;
			return st < 1 || n < 0 ? ERR['#VALUE!'] : s.substr(st - 1, n);
		},

		CONCATENATE: (a) => {
			let o = '';
			for(const v of a) {
				const s = sx(v);
				if(isErr(s)) return s;
				o += s;
			}
			return o;
		},

		CONCAT: (a) => {
			let o = '';
			for(const v of flatAll(a)) {
				const s = sx(v);
				if(isErr(s)) return s;
				o += s;
			}
			return o;
		},

		TEXTJOIN: (a) => {
			const d = sx(a[0]),
				ig = toBool(a[1]);
			const parts = [];
			for(const v of flatAll(a.slice(2))) {
				if(isErr(v)) return v;
				const s = sx(v);
				if(ig === true && s === '') continue;
				parts.push(s);
			}
			return parts.join(d);
		},

		FIND: (a) => {
			const f = sx(a[0]),
				s = sx(a[1]),
				st = num(a[2], 1);
			const i = s.indexOf(f, st - 1);
			return i < 0 ? ERR['#VALUE!'] : i + 1;
		},

		SEARCH: (a) => {
			const f = sx(a[0]).toLowerCase(),
				s = sx(a[1]).toLowerCase(),
				st = num(a[2], 1);
			const re = new RegExp(f.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.'));
			const m = re.exec(s.slice(st - 1));
			return m ? m.index + st : ERR['#VALUE!'];
		},

		SUBSTITUTE: (a) => {
			const s = sx(a[0]),
				f = sx(a[1]),
				t = sx(a[2]);
			if(f === '') return s;
			if(a[3] === undefined) return s.split(f).join(t);
			let k = toNum(a[3]),
				i = -1,
				pos = 0;
			while(k-- > 0) {
				i = s.indexOf(f, pos);
				if(i < 0) return s;
				pos = i + f.length;
			}
			return s.slice(0, i) + t + s.slice(i + f.length);
		},

		REPLACE: (a) => {
			const s = sx(a[0]),
				st = toNum(a[1]),
				n = toNum(a[2]),
				t = sx(a[3]);
			return s.slice(0, st - 1) + t + s.slice(st - 1 + n);
		},

		REPT: (a) => {
			const s = sx(a[0]),
				n = toNum(a[1]);
			return isErr(n) || n < 0 ? ERR['#VALUE!'] : s.repeat(n);
		},

		EXACT: (a) => sx(a[0]) === sx(a[1]),
		VALUE: (a) => {
			const v = first(a[0]);
			if(typeof v === 'number') return v;
			return toNum(v);
		},

		TEXT: (a) => {
			const v = first(a[0]);
			if(isErr(v)) return v;
			return XE.format(typeof v === 'string' && !isNaN(Number(v)) && v.trim() !== '' ? Number(v) : v, sx(a[1]));
		},

		CHAR: (a) => String.fromCharCode(toNum(a[0])),
		CODE: (a) => sx(a[0]).charCodeAt(0),
		SUMIF: (a) => {
			const rng = asArr(a[0]),
				f = critFn(a[1]);
			const sr = a[2] ? asArr(a[2]) : rng;
			let s = 0;
			for(let r = 0; r < rng.rows.length; r++)
				for(let c = 0; c < rng.rows[0].length; c++)
					if(f(rng.rows[r][c])) {
						const v = sr.rows[r] ? sr.rows[r][c] : null;
						if(typeof v === 'number') s += v;
					}
			return s;
		},

		COUNTIF: (a) => {
			const rng = asArr(a[0]),
				f = critFn(a[1]);
			let k = 0;
			rng.rows.forEach((row) => row.forEach((v) => {
				if(f(v)) k++;
			}));
			return k;
		},

		SUMIFS: (a) => {
			const sr = asArr(a[0]);
			const pairs = [];
			for(let i = 1; i + 1 < a.length; i += 2) pairs.push([asArr(a[i]), a[i + 1]]);
			let s = 0;
			condRows(pairs).forEach(([r, c]) => {
				const v = sr.rows[r] && sr.rows[r][c];
				if(typeof v === 'number') s += v;
			});
			return s;
		},

		COUNTIFS: (a) => {
			const pairs = [];
			for(let i = 0; i + 1 < a.length; i += 2) pairs.push([asArr(a[i]), a[i + 1]]);
			return condRows(pairs).length;
		},

		AVERAGEIF: (a) => {
			const rng = asArr(a[0]),
				f = critFn(a[1]),
				sr = a[2] ? asArr(a[2]) : rng;
			let s = 0,
				k = 0;
			for(let r = 0; r < rng.rows.length; r++)
				for(let c = 0; c < rng.rows[0].length; c++)
					if(f(rng.rows[r][c])) {
						const v = sr.rows[r] ? sr.rows[r][c] : null;
						if(typeof v === 'number') {
							s += v;
							k++;
						}
					}
			return k ? s / k : ERR['#DIV/0!'];
		},

		AVERAGEIFS: (a) => {
			const sr = asArr(a[0]);
			const pairs = [];
			for(let i = 1; i + 1 < a.length; i += 2) pairs.push([asArr(a[i]), a[i + 1]]);
			let s = 0,
				k = 0;
			condRows(pairs).forEach(([r, c]) => {
				const v = sr.rows[r] && sr.rows[r][c];
				if(typeof v === 'number') {
					s += v;
					k++;
				}
			});
			return k ? s / k : ERR['#DIV/0!'];
		},

		VLOOKUP: (a) => {
			const key = first(a[0]),
				t = asArr(a[1]),
				ci = toNum(a[2]);
			const approx = a[3] === undefined ? true : toBool(a[3]);
			if(isErr(key)) return key;
			if(isErr(ci)) return ci;
			if(ci < 1 || ci > t.rows[0].length) return ERR['#REF!'];
			let hit = -1;
			if(approx) {
				for(let r = 0; r < t.rows.length; r++) {
					if(lookupCmp(t.rows[r][0], key) <= 0 && t.rows[r][0] !== null) hit = r;
					else if(lookupCmp(t.rows[r][0], key) > 0) break;
				}
			} else
				for(let r = 0; r < t.rows.length; r++)
					if(typeRank(t.rows[r][0]) === typeRank(key) && compare(t.rows[r][0], key) === 0) {
						hit = r;
						break;
					}
			return hit < 0 ? ERR['#N/A'] : t.rows[hit][ci - 1];
		},

		HLOOKUP: (a) => {
			const key = first(a[0]),
				t = asArr(a[1]),
				ri = toNum(a[2]);
			const approx = a[3] === undefined ? true : toBool(a[3]);
			if(ri < 1 || ri > t.rows.length) return ERR['#REF!'];
			let hit = -1;
			for(let c = 0; c < t.rows[0].length; c++) {
				const v = t.rows[0][c];
				if(approx ? (v !== null && lookupCmp(v, key) <= 0) : (typeRank(v) === typeRank(key) && compare(v, key) === 0)) {
					hit = c;
					if(!approx) break;
				} else if(approx && lookupCmp(v, key) > 0) break;
			}
			return hit < 0 ? ERR['#N/A'] : t.rows[ri - 1][hit];
		},

		XLOOKUP: (a) => {
			const key = first(a[0]),
				L = asArr(a[1]),
				R = asArr(a[2]);
			const flat = L.rows.length === 1 ? L.rows[0] : L.rows.map((r) => r[0]);
			const i = flat.findIndex((v) => typeRank(v) === typeRank(key) && compare(v, key) === 0);
			if(i < 0) return a[3] !== undefined ? a[3] : ERR['#N/A'];
			return L.rows.length === 1 ? R.rows[0][i] : R.rows[i][0];
		},

		MATCH: (a) => {
			const key = first(a[0]),
				t = asArr(a[1]),
				type = a[2] === undefined ? 1 : toNum(a[2]);
			const flat = t.rows.length === 1 ? t.rows[0] : t.rows.map((r) => r[0]);
			if(type === 0) {
				const i = flat.findIndex((v) => typeRank(v) === typeRank(key) && compare(v, key) === 0);
				return i < 0 ? ERR['#N/A'] : i + 1;
			}
			let hit = -1;
			for(let i = 0; i < flat.length; i++) {
				const c = lookupCmp(flat[i], key);
				if(type > 0 ? c <= 0 : c >= 0) hit = i;
				else break;
			}
			return hit < 0 ? ERR['#N/A'] : hit + 1;
		},

		INDEX: (a) => {
			const t = asArr(a[0]);
			let r = a[1] === undefined ? 0 : toNum(a[1]),
				c = a[2] === undefined ? 0 : toNum(a[2]);
			if(t.rows.length === 1 && a[2] === undefined) {
				c = r;
				r = 1;
			}
			if(r === 0 && c === 0) return t;
			if(r < 0 || c < 0 || r > t.rows.length || c > t.rows[0].length) return ERR['#REF!'];
			if(r === 0) return mkArr(t.rows.map((row) => [row[c - 1]]));
			if(c === 0) return mkArr([t.rows[r - 1]]);
			return t.rows[r - 1][c - 1];
		},

		ROWS: (a) => asArr(a[0]).rows.length,
		COLUMNS: (a) => asArr(a[0]).rows[0].length,
		TODAY: () => Math.floor(dateToSerial(new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())))),
		NOW: () => {
			const d = new Date();
			return dateToSerial(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())));
		},

		DATE: (a) => {
			const y = toNum(a[0]),
				m = toNum(a[1]),
				d = toNum(a[2]);
			if(isErr(y)) return y;
			return dateToSerial(new Date(Date.UTC(y < 1900 ? y + 1900 : y, m - 1, d)));
		},

		YEAR: (a) => {
			const n = toNum(a[0]);
			return isErr(n) ? n : serialToDate(n).getUTCFullYear();
		},

		MONTH: (a) => {
			const n = toNum(a[0]);
			return isErr(n) ? n : serialToDate(n).getUTCMonth() + 1;
		},

		DAY: (a) => {
			const n = toNum(a[0]);
			return isErr(n) ? n : serialToDate(n).getUTCDate();
		},

		HOUR: (a) => {
			const n = toNum(a[0]);
			return Math.floor(((n % 1) * 24) + 1e-9);
		},

		MINUTE: (a) => {
			const n = toNum(a[0]);
			return Math.floor(((n * 1440) % 60) + 1e-6);
		},

		SECOND: (a) => {
			const n = toNum(a[0]);
			return Math.round((n * 86400) % 60);
		},

		WEEKDAY: (a) => {
			const n = toNum(a[0]),
				t = num(a[1], 1);
			if(isErr(n)) return n;
			const d = serialToDate(n).getUTCDay();
			return t === 2 ? (d + 6) % 7 + 1 : (t === 3 ? (d + 6) % 7 : d + 1);
		},

		EDATE: (a) => {
			const n = toNum(a[0]),
				m = toNum(a[1]);
			const d = serialToDate(n);
			return dateToSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate())));
		},

		EOMONTH: (a) => {
			const n = toNum(a[0]),
				m = toNum(a[1]);
			const d = serialToDate(n);
			return dateToSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m + 1, 0)));
		},

		DATEDIF: (a) => {
			const s = toNum(a[0]),
				e = toNum(a[1]),
				u = sx(a[2]).toUpperCase();
			if(e < s) return ERR['#NUM!'];
			const d1 = serialToDate(s),
				d2 = serialToDate(e);
			let m = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + d2.getUTCMonth() - d1.getUTCMonth();
			if(d2.getUTCDate() < d1.getUTCDate()) m--;
			return u === 'D' ? Math.floor(e - s) : u === 'M' ? m : u === 'Y' ? Math.floor(m / 12) : ERR['#NUM!'];
		},

		DAYS: (a) => toNum(a[0]) - toNum(a[1])
	};
	FN.STDEV_S = FN.STDEV;
	FN['STDEV.S'] = FN.STDEV;
	FN.VAR_S = FN.VAR;
	FN['VAR.S'] = FN.VAR;
	FN.AVERAGEA = FN.AVERAGE;
	FN['_xlfn.CONCAT'] = FN.CONCAT;
	FN['_xlfn.TEXTJOIN'] = FN.TEXTJOIN;
	FN['_xlfn.IFS'] = LAZY.IFS;
	FN['_xlfn.XLOOKUP'] = FN.XLOOKUP;
	XE.functionNames = Object.keys(FN).concat(Object.keys(LAZY)).filter((n) => n.charAt(0) !== '_').sort();

	const BUILTIN = {
		0: 'General',
		1: '0',
		2: '0.00',
		3: '#,##0',
		4: '#,##0.00',
		9: '0%',
		10: '0.00%',
		11: '0.00E+00',
		12: '# ?/?',
		13: '# ??/??',
		14: 'm/d/yyyy',
		15: 'd-mmm-yy',
		16: 'd-mmm',
		17: 'mmm-yy',
		18: 'h:mm AM/PM',
		19: 'h:mm:ss AM/PM',
		20: 'h:mm',
		21: 'h:mm:ss',
		22: 'm/d/yyyy h:mm',
		37: '#,##0 ;(#,##0)',
		38: '#,##0 ;[Red](#,##0)',
		39: '#,##0.00;(#,##0.00)',
		40: '#,##0.00;[Red](#,##0.00)',
		45: 'mm:ss',
		46: '[h]:mm:ss',
		47: 'mmss.0',
		48: '##0.0E+0',
		49: '@'
	};

	XE.BUILTIN_FMT = BUILTIN;
	const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
	const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const fmtCache = {};

	function isDateCode(code) {
		const c = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
		return /[ymdhs]|AM\/PM/i.test(c.replace(/General/i, '')) && !/^[#0?,.%E+\-() ]*$/.test(c);
	}

	XE.isDateFormat = (code) => !!code && code !== 'General' && isDateCode(code.split(';')[0]);

	function sections(code) {
		if(fmtCache[code]) return fmtCache[code];
		const parts = [];
		let cur = '',
			q = false;
		for(let i = 0; i < code.length; i++) {
			const ch = code[i];
			if(ch === '"') q = !q;
			if(ch === ';' && !q) {
				parts.push(cur);
				cur = '';
			} else cur += ch;
		}
		parts.push(cur);
		return(fmtCache[code] = parts.map((p) => {
			let color = null,
				cond = null;
			p = p.replace(/\[(Red|Black|Blue|Green|Magenta|Cyan|Yellow|White)\]/i, (m, c) => {
				color = c.toLowerCase();
				return '';
			});
			p = p.replace(/\[([<>=]+)([-\d.]+)\]/, (m, o, v) => {
				cond = {
					o, v: +v
				};
				return '';
			});
			return {
				code: p.replace(/\[\$-?[^\]]*\]/g, '').replace(/\[\$([^\]-]*)[^\]]*\]/g, '$1'),
				color,
				cond
			};
		}));
	}

	function fmtNumber(abs, code, neg, pct) {
		
		let c = code,
			scale = 0;
		const lit = [];
		c = c.replace(/"([^"]*)"|\\(.)|_(.)|\*(.)/g, (m, a, b, u, s) => {
			lit.push(a !== undefined ? a : (b !== undefined ? b : (u !== undefined ? ' ' : '')));
			return String.fromCharCode(0xE000 + lit.length - 1);
		});
		if(/%/.test(c)) abs *= 100;
		const sci = /E[+-]/i.exec(c);
		let expPart = '';
		if(sci) {
			const idx = sci.index,
				mant = c.slice(0, idx),
				ex = c.slice(idx + 2);
			const dec = (mant.split('.')[1] || '').replace(/[^0#?]/g, '').length;
			const intDigits = (mant.split('.')[0] || '').replace(/[^0#?]/g, '').length || 1;
			let e = abs === 0 ? 0 : Math.floor(Math.log10(abs)) - (intDigits - 1);
			let m = abs / Math.pow(10, e);
			let ms = m.toFixed(dec);
			if(parseFloat(ms) >= Math.pow(10, intDigits)) {
				e++;
				ms = (abs / Math.pow(10, e)).toFixed(dec);
			}
			const es = String(Math.abs(e)).padStart(ex.replace(/[^0#?]/g, '').length || 1, '0');
			return finishLits(ms + 'E' + (e < 0 ? '-' : (sci[0].charAt(1) === '+' ? '+' : '')) + es, lit);
		}
		const dotAt = c.indexOf('.');
		const intPart = dotAt < 0 ? c : c.slice(0, dotAt),
			decPart = dotAt < 0 ? '' : c.slice(dotAt + 1);
		const decDigits = (decPart.match(/[0#?]/g) || []).length;
		const comma = /[0#?],[0#?]/.test(intPart);
		const trailingCommas = (/[0#?](,+)(?![0#?])/.exec(intPart) || [, ''])[1].length;
		if(trailingCommas && !comma) abs /= Math.pow(1000, trailingCommas);
		else if(trailingCommas) abs /= Math.pow(1000, trailingCommas);
		let s = abs.toFixed(Math.min(decDigits, 20));
		if(!isFinite(abs)) s = String(abs);
		let [ip, dp = ''] = s.split('.');
		const minInt = (intPart.match(/0/g) || []).length;
		if(ip === '0' && minInt === 0 && decDigits > 0) ip = '';
		while(ip.length < minInt) ip = '0' + ip;
		if(comma) ip = ip.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		
		const minDec = (decPart.match(/0/g) || []).length;
		while(dp.length > minDec && dp.charAt(dp.length - 1) === '0') dp = dp.slice(0, -1);
		
		let out = '',
			ipDone = false;
		const patInt = intPart.replace(/[0#?,]/g, '\u0001');
		
		out = patInt.replace(/\u0001+/, () => {
			ipDone = true;
			return ip;
		});
		if(!ipDone) out = ip + out;
		if(decDigits > 0) out += '.' + dp + decPart.replace(/[0#?]/g, '');
		else if(dotAt >= 0) out += decPart.replace(/[0#?]/g, '');
		return finishLits(out, lit);
	}

	function finishLits(s, lit) {
		return s.replace(/[\uE000-\uE0FF]/g, (ch) => lit[ch.charCodeAt(0) - 0xE000]);
	}

	function fmtDate(n, code) {
		let ms = Math.round(n * 86400000) / 1;
		let days = Math.floor(n),
			frac = n - days;
		let secs = Math.round(frac * 86400);
		if(secs >= 86400) {
			secs -= 86400;
			days += 1;
		}

		const d = serialToDate(days);
		const Y = d.getUTCFullYear(),
			M = d.getUTCMonth(),
			D = d.getUTCDate(),
			W = d.getUTCDay();
		const hh = Math.floor(secs / 3600),
			mi = Math.floor(secs / 60) % 60,
			ss = secs % 60;
		const ampm = /AM\/PM|A\/P/i.test(code);
		const h12 = hh % 12 === 0 ? 12 : hh % 12;
		let out = '',
			i = 0;
		const c = code.replace(/\[\$-?[^\]]*\]/g, '');
		while(i < c.length) {
			const rest = c.slice(i);
			let m;

			if((m = /^"([^"]*)"/.exec(rest))) {
				out += m[1];
				i += m[0].length;
				continue;
			}

			if((m = /^\\(.)/.exec(rest))) {
				out += m[1];
				i += 2;
				continue;
			}

			if((m = /^\[(h+|m+|s+)\]/i.exec(rest))) {
				const t = m[1][0].toLowerCase();
				const tot = t === 'h' ? Math.floor(n * 24) : t === 'm' ? Math.floor(n * 1440) : Math.floor(n * 86400);
				out += String(tot).padStart(m[1].length, '0');
				i += m[0].length;
				continue;
			}

			if((m = /^(AM\/PM|A\/P)/i.exec(rest))) {
				out += hh < 12 ? (m[1].length > 3 ? 'AM' : 'A') : (m[1].length > 3 ? 'PM' : 'P');
				i += m[0].length;
				continue;
			}

			if((m = /^y{1,4}/i.exec(rest))) {
				out += m[0].length <= 2 ? String(Y % 100).padStart(2, '0') : String(Y);
				i += m[0].length;
				continue;
			}

			if((m = /^m{1,5}/i.exec(rest))) {
				
				const before = out,
					after = c.slice(i + m[0].length);
				const asMin = /h[^a-z]*$/i.test(c.slice(0, i).replace(/"[^"]*"/g, '')) || /^[^a-z]*s/i.test(after);
				const L = m[0].length;
				if(asMin && L <= 2) out += L === 2 ? String(mi).padStart(2, '0') : String(mi);
				else out += L === 1 ? String(M + 1) : L === 2 ? String(M + 1).padStart(2, '0') : L === 3 ? MONTHS[M].slice(0, 3) : L === 4 ? MONTHS[M] : MONTHS[M][0];
				i += L;
				continue;
			}

			if((m = /^d{1,4}/i.exec(rest))) {
				const L = m[0].length;
				out += L === 1 ? String(D) : L === 2 ? String(D).padStart(2, '0') : L === 3 ? DAYS[W].slice(0, 3) : DAYS[W];
				i += L;
				continue;
			}

			if((m = /^h{1,2}/i.exec(rest))) {
				out += (ampm ? String(h12) : String(hh)).padStart(m[0].length, '0');
				i += m[0].length;
				continue;
			}

			if((m = /^s{1,2}/i.exec(rest))) {
				out += String(ss).padStart(m[0].length, '0');
				i += m[0].length;
				if(/^\.0+/.test(c.slice(i))) {
					const z = /^\.(0+)/.exec(c.slice(i))[1].length;
					out += '.' + String(Math.round((n * 86400 % 1) * Math.pow(10, z))).padStart(z, '0');
					i += z + 1;
				}
				continue;
			}

			out += c[i];
			i++;
		}
		return out;
	}

	XE.format = function(v, code) { 
		if(isErr(v)) return v.code;
		if(v === null || v === undefined) return '';
		if(!code || /^general$/i.test(code)) {
			if(typeof v === 'number') return fmtGeneral(v);
			if(typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
			return String(v);
		}
		const secs = sections(code);
		if(typeof v === 'string' || typeof v === 'boolean') {
			const tx = secs.length >= 4 ? secs[3] : secs.find((s) => /@/.test(s.code));
			const sv = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v;
			return tx ? finishLits(tx.code.replace(/"([^"]*)"/g, '$1').replace(/@/g, sv), []) : sv;
		}
		let sec, val = v;
		if(secs.length === 1) {
			sec = secs[0];
			if(sec.cond) { /* conditional single section */ }
		} else {
			const cond = secs.slice(0, 2).some((s) => s.cond);
			if(cond) {
				sec = secs.find((s) => s.cond && cmpCond(v, s.cond)) || secs[secs.length > 2 ? 2 : 1];
			} else sec = v > 0 ? secs[0] : (v < 0 ? secs[1] : (secs[2] || secs[0]));
			if(!cond && v < 0 && secs.length >= 2) val = -v;
		}
		if(isDateCode(sec.code)) return v < 0 ? '#####' : fmtDate(val, sec.code);
		const neg = v < 0 && secs.length === 1;
		let text = fmtNumber(Math.abs(val), sec.code.replace(/@/g, ''), neg);
		if(neg && text !== '' && !/^[0.,]*$/.test(text.replace(/[^0-9.,]/g, ''))) text = '-' + text;
		else if(neg && parseFloat(text.replace(/[^0-9.]/g, '')) !== 0) text = '-' + text;
		return text;
	};

	function cmpCond(v, c) {
		return c.o === '>' ? v > c.v : c.o === '<' ? v < c.v : c.o === '>=' ? v >= c.v : c.o === '<=' ? v <= c.v : c.o === '=' ? v === c.v : v !== c.v;
	}

	function fmtGeneral(n) {
		if(n === 0) return '0';
		if(!isFinite(n)) return String(n);
		const a = Math.abs(n);
		if(a >= 1e11 || a < 1e-9) {
			let s = n.toExponential(5).replace(/\.?0+e/, 'e');
			return s.replace('e', 'E').replace(/E(\d)/, 'E+$1').replace(/E([+-])(\d)$/, 'E$10$2');
		}
		return String(+n.toPrecision(10));
	}

	XE.fmtGeneral = fmtGeneral;
	XE.formatColor = function(v, code) {
		if(typeof v !== 'number' || !code) return null;
		const s = sections(code);
		const sec = s.length < 2 ? s[0] : (v > 0 ? s[0] : v < 0 ? s[1] : (s[2] || s[0]));
		return sec.color || null;
	};

	XE.shiftFormula = function(f, dr, dc) {
		return XE.rewrite(f, (sheet, n) => ({
			r: n.ar ? n.r : n.r + dr,
			c: n.ac ? n.c : n.c + dc
		}), true);
	};

	XE.rewrite = function(f, fn, plain) {
		let toks;
		try {
			toks = tokenize(f);
		} catch(e) {
			return f;
		}
		return toks.map((t) => {
			if(t.type !== 'ref') return t.raw;
			const sp = splitSheet(t.raw);
			const prefix = t.raw.slice(0, t.raw.length - sp.rest.length);
			const parts = sp.rest.split(':');
			const conv = (p, isEnd) => {
				const c = parseCell(p);
				if(!c) return p;
				const r = fn(sp.sheet, c, isEnd, parts.length > 1);
				if(!r || r.r < 0 || r.c < 0) return null;
				return cellStr(r.r, r.c, c.ar, c.ac);
			};
			if(parts.length === 2 && (!parseCell(parts[0]) || !parseCell(parts[1]))) return t.raw;
			const out = parts.map((p, i) => conv(p, i === 1));
			if(out.some((x) => x === null)) return '#REF!';
			return prefix + out.join(':');
		}).join('');
	};
	if(typeof module !== 'undefined' && module.exports) module.exports = XE;
	root.XE = XE;
})(typeof window !== 'undefined' ? window : globalThis);