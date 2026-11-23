(function() {
	'use strict';

	const $ = (id) => document.getElementById(id);
	const rowsEl = $('fbRows'),
		fieldEl = $('fbField'),
		statusEl = $('fbStatus'),
		codeEl = $('fbCode'),
		frame = $('fbFrame'),
		errBox = $('fbErr');
	const optBp = $('fbBp'),
		optGap = $('fbGap'),
		optSubmit = $('fbSubmit'),
		optValidate = $('fbValidate'),
		optStar = $('fbStar');
	const copyBtn = $('fbCopyBtn'),
		dlBtn = $('fbDownloadBtn');

	const STORE = 'matte-form-builder-v1';
	const BOOTSTRAP_CDN = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
	const LOCAL_BOOTSTRAP = 'assets/vendors/bootstrap/css/bootstrap.min.css';

	const TYPES = {
		text: { label: 'Text', icon: 'fa-font' },
		email: { label: 'Email', icon: 'fa-at' },
		number: { label: 'Number', icon: 'fa-hashtag' },
		password: { label: 'Password', icon: 'fa-key' },
		tel: { label: 'Phone', icon: 'fa-phone' },
		textarea: { label: 'Textarea', icon: 'fa-align-left' },
		select: { label: 'Select', icon: 'fa-list' },
		checkbox: { label: 'Checkbox', icon: 'fa-square-check' },
		radio: { label: 'Radio', icon: 'fa-circle-dot' },
		file: { label: 'File', icon: 'fa-paperclip' },
		color: { label: 'Color', icon: 'fa-palette' },
		date: { label: 'Calendar', icon: 'fa-calendar-days' }
	};

	const TEXTY = ['text', 'email', 'password', 'tel', 'textarea'];
	const HAS_OPTIONS = ['select', 'checkbox', 'radio'];

	let state = { rows: [] };
	let selected = null;
	let uid = 1;
	let previewTimer = null;

	function freshLabel(type) {
		const base = (TYPES[type] || TYPES.text).label + ' field';
		const taken = {};
		(state.rows || []).forEach((r) => r.cols.forEach((c) => { taken[c.label] = true; }));
		let label = base,
			n = 2;
		while(taken[label]) label = base + ' ' + (n++);
		return label;
	}

	function newField(type, width, extra) {
		const label = extra && extra.label ? extra.label : freshLabel(type);
		return Object.assign({
			id: 'f' + (uid++),
			width: width || 12,
			type: type || 'text',
			label: label,
			name: slug(label, '_'),
			nameEdited: false,
			placeholder: '',
			help: '',
			options: 'Option 1\nOption 2\nOption 3',
			inline: false,
			required: false,
			minlength: '',
			maxlength: '',
			min: '',
			max: '',
			step: '',
			pattern: '',
			accept: '',
			multiple: false,
			rows: '4',
			value: '#ff6224',
			dateKind: 'date',
			error: ''
		}, extra || {});
	}

	function newRow(cols) {
		return { id: 'r' + (uid++), cols: cols || [newField('text', 12)] };
	}

	function slug(s, sep) {
		return String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
			.replace(/[^a-z0-9]+/g, sep).replace(new RegExp('^\\' + sep + '+|\\' + sep + '+$', 'g'), '') || 'field';
	}

	function split(n) {
		const base = Math.floor(12 / n),
			rem = 12 % n;
		return Array.from({ length: n }, (_, i) => Math.max(1, base + (i < rem ? 1 : 0)));
	}

	function total(row) {
		return row.cols.reduce((s, c) => s + (+c.width), 0);
	}

	function find(fieldId) {
		for(let r = 0; r < state.rows.length; r++) {
			const c = state.rows[r].cols.findIndex((f) => f.id === fieldId);
			if(c >= 0) return { r: r, c: c, row: state.rows[r], field: state.rows[r].cols[c] };
		}
		return null;
	}

	function sample() {
		const f = (type, width, extra) => newField(type, width, extra);
		return {
			rows: [
				newRow([
					f('text', 6, { label: 'First name', name: 'first_name', placeholder: 'Jane', required: true, minlength: '2' }),
					f('text', 6, { label: 'Last name', name: 'last_name', placeholder: 'Doe', required: true })
				]),
				newRow([
					f('email', 6, { label: 'Email', name: 'email', placeholder: 'name@example.html', required: true }),
					f('tel', 6, { label: 'Phone', name: 'phone', placeholder: '+92 300 1234567', pattern: '[0-9+()\\s-]{7,20}', help: 'Digits, spaces and + only' })
				]),
				newRow([
					f('select', 8, { label: 'Subject', name: 'subject', placeholder: 'Choose a subject…', options: 'General question\nSupport\nSales\nFeedback', required: true }),
					f('date', 4, { label: 'Preferred date', name: 'preferred_date' })
				]),
				newRow([
					f('textarea', 12, { label: 'Message', name: 'message', placeholder: 'How can we help?', required: true, minlength: '10', rows: '5' })
				]),
				newRow([
					f('radio', 6, { label: 'Contact me by', name: 'contact_by', options: 'Email\nPhone\nWhatsApp', inline: true, required: true }),
					f('checkbox', 6, { label: 'Interests', name: 'interests[]', options: 'Design\nDevelopment\nMarketing', inline: true, required: true })
				]),
				newRow([
					f('file', 8, { label: 'Attachment', name: 'attachment', accept: '.pdf,.jpg,.png', help: 'PDF, JPG or PNG' }),
					f('color', 4, { label: 'Favourite colour', name: 'favourite_colour' })
				]),
				newRow([
					f('checkbox', 12, { label: 'I agree to the terms and privacy policy', name: 'agree', options: '', required: true })
				])
			]
		};
	}

	function save() {
		try {
			localStorage.setItem(STORE, JSON.stringify({
				rows: state.rows,
				opts: { bp: optBp.value, gap: optGap.value, submit: optSubmit.value, validate: optValidate.checked, star: optStar.checked }
			}));
		} catch(e) {}
	}

	function restore() {
		try {
			const d = JSON.parse(localStorage.getItem(STORE) || 'null');
			if(!d || !Array.isArray(d.rows)) return false;
			state.rows = d.rows.map((r) => ({ id: 'r' + (uid++), cols: (r.cols || []).map((c) => newField(c.type, c.width, Object.assign({}, c, { id: 'f' + (uid++) }))) }));
			if(d.opts) {
				optBp.value = d.opts.bp;
				optGap.value = d.opts.gap;
				optSubmit.value = d.opts.submit;
				optValidate.checked = !!d.opts.validate;
				optStar.checked = !!d.opts.star;
			}
			return true;
		} catch(e) {
			return false;
		}
	}

	function esc(s) {
		return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function renderRows() {
		if(!state.rows.length) {
			rowsEl.innerHTML = '<div class="fb-empty">No rows yet.<br>Add a row to start building your form.<br>' +
				'<button type="button" class="btn btn-primary" data-act="add-row"><i class="fa-solid fa-plus me-2"></i>Add row</button></div>';
			return;
		}
		let h = '';
		state.rows.forEach((row, r) => {
			const t = total(row);
			const n = row.cols.length;
			let opts = '';
			for(let i = 1; i <= 12; i++) opts += '<option value="' + i + '"' + (i === n ? ' selected' : '') + '>' + i + '</option>';
			h += '<div class="fb-row" data-row="' + r + '">' +
				'<div class="fb-row-head">' +
				'<span class="fb-row-title">Row ' + (r + 1) + '</span>' +
				'<span class="fb-row-total' + (t > 12 ? ' over' : '') + '" title="' + (t > 12 ? 'Wider than 12 columns, so the extra columns wrap onto a new line' : 'Columns used out of 12') + '">' + t + ' / 12</span>' +
				'<label class="fb-mini">Columns <select data-act="split" aria-label="Number of columns in row ' + (r + 1) + '">' + opts + '</select></label>' +
				'<div class="fb-row-actions">' +
				'<button type="button" class="fb-icon-btn" data-act="add-col" title="Add column"><i class="fa-solid fa-plus"></i></button>' +
				'<button type="button" class="fb-icon-btn" data-act="up" title="Move row up"' + (r === 0 ? ' disabled' : '') + '><i class="fa-solid fa-arrow-up"></i></button>' +
				'<button type="button" class="fb-icon-btn" data-act="down" title="Move row down"' + (r === state.rows.length - 1 ? ' disabled' : '') + '><i class="fa-solid fa-arrow-down"></i></button>' +
				'<button type="button" class="fb-icon-btn" data-act="dup-row" title="Duplicate row"><i class="fa-regular fa-clone"></i></button>' +
				'<button type="button" class="fb-icon-btn danger" data-act="del-row" title="Delete row"><i class="fa-regular fa-trash-can"></i></button>' +
				'</div></div><div class="fb-grid">';
			row.cols.forEach((f) => {
				const T = TYPES[f.type] || TYPES.text;
				h += '<button type="button" class="fb-col' + (f.id === selected ? ' active' : '') + '" data-field="' + f.id + '" style="grid-column: span ' + Math.min(12, f.width) + '">' +
					'<span class="fb-col-type"><i class="fa-solid ' + T.icon + ' me-1"></i>' + T.label + (f.required ? ' *' : '') + '</span>' +
					'<span class="fb-col-label">' + esc(f.label || '(no label)') + '</span>' +
					'<span class="fb-col-w">' + f.width + ' / 12</span></button>';
			});
			h += '</div></div>';
		});
		h += '<button type="button" class="btn btn-primary-outlined fb-add-row" data-act="add-row"><i class="fa-solid fa-plus me-2"></i>Add row</button>';
		rowsEl.innerHTML = h;
	}

	function inputRow(items) {
		return '<div class="qr-row">' + items.map((i) => '<div>' + i + '</div>').join('') + '</div>';
	}

	function text(key, label, f, ph, type) {
		return '<label class="qr-label" for="fbk-' + key + '">' + label + '</label>' +
			'<input type="' + (type || 'text') + '" id="fbk-' + key + '" data-k="' + key + '" class="form-control qr-input" value="' + esc(f[key]) + '" placeholder="' + esc(ph || '') + '" spellcheck="false">';
	}

	function check(key, label, f) {
		return '<label class="bm-check"><input type="checkbox" data-k="' + key + '"' + (f[key] ? ' checked' : '') + '> ' + label + '</label>';
	}

	function defaultError(f) {
		const l = (f.label || 'this field').toLowerCase();
		switch(f.type) {
			case 'email': return 'Please enter a valid email address.';
			case 'select': return 'Please choose ' + l + '.';
			case 'radio': return 'Please choose an option.';
			case 'checkbox': return optionList(f).length ? 'Please choose at least one option.' : 'You must check this box to continue.';
			case 'file': return 'Please choose a file.';
			case 'date': return 'Please choose a valid date.';
			case 'number': return 'Please enter a valid number.';
			default: return 'Please enter ' + l + '.';
		}
	}

	function renderField() {
		const hit = selected && find(selected);
		if(!hit) {
			fieldEl.innerHTML = '<div class="fb-empty">Click a column in the layout to edit its field.</div>';
			return;
		}
		const f = hit.field,
			t = f.type;
		let widths = '';
		for(let i = 1; i <= 12; i++) widths += '<option value="' + i + '"' + (i === +f.width ? ' selected' : '') + '>' + i + ' of 12' + (i === 12 ? ' (full)' : i === 6 ? ' (half)' : i === 4 ? ' (third)' : i === 3 ? ' (quarter)' : '') + '</option>';
		let types = '';
		Object.keys(TYPES).forEach((k) => {
			types += '<option value="' + k + '"' + (k === t ? ' selected' : '') + '>' + TYPES[k].label + (k === 'date' ? ' (date picker)' : '') + '</option>';
		});

		let h = '<div class="fb-field-head"><span class="fb-row-title">Row ' + (hit.r + 1) + ', column ' + (hit.c + 1) + '</span>' +
			'<div class="fb-row-actions">' +
			'<button type="button" class="fb-icon-btn" data-act="col-left" title="Move left"' + (hit.c === 0 ? ' disabled' : '') + '><i class="fa-solid fa-arrow-left"></i></button>' +
			'<button type="button" class="fb-icon-btn" data-act="col-right" title="Move right"' + (hit.c === hit.row.cols.length - 1 ? ' disabled' : '') + '><i class="fa-solid fa-arrow-right"></i></button>' +
			'<button type="button" class="fb-icon-btn" data-act="dup-col" title="Duplicate field"><i class="fa-regular fa-clone"></i></button>' +
			'<button type="button" class="fb-icon-btn danger" data-act="del-col" title="Delete field"><i class="fa-regular fa-trash-can"></i></button>' +
			'</div></div>';

		h += inputRow([
			'<label class="qr-label" for="fbk-width">Column width</label><select id="fbk-width" data-k="width" class="form-select qr-input">' + widths + '</select>',
			'<label class="qr-label" for="fbk-type">Field type</label><select id="fbk-type" data-k="type" class="form-select qr-input">' + types + '</select>'
		]);
		h += inputRow([text('label', t === 'checkbox' && !optionList(f).length ? 'Checkbox text' : 'Label', f), text('name', 'Name', f)]);

		const row2 = [];
		if(TEXTY.concat(['number']).indexOf(t) >= 0) row2.push(text('placeholder', 'Placeholder', f));
		if(t === 'select') row2.push(text('placeholder', 'First option text', f, 'Choose…'));
		if(t === 'date') row2.push('<label class="qr-label" for="fbk-dateKind">Calendar type</label><select id="fbk-dateKind" data-k="dateKind" class="form-select qr-input">' +
			[['date', 'Date'], ['datetime-local', 'Date and time'], ['time', 'Time'], ['month', 'Month'], ['week', 'Week']].map((o) => '<option value="' + o[0] + '"' + (f.dateKind === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>');
		if(t === 'color') row2.push(text('value', 'Default colour', f, '#ff6224', 'color'));
		if(t === 'textarea') row2.push(text('rows', 'Height (rows)', f, '4', 'number'));
		row2.push(text('help', 'Help text', f, 'Shown under the field'));
		h += inputRow(row2.slice(0, 2));
		if(row2.length > 2) h += inputRow(row2.slice(2));

		if(HAS_OPTIONS.indexOf(t) >= 0) {
			h += '<label class="qr-label" for="fbk-options">Options</label>' +
				'<textarea id="fbk-options" data-k="options" class="form-control qr-input qr-area" rows="4" spellcheck="false">' + esc(f.options) + '</textarea>' +
				'<div class="fb-hint">One per line. Write <code>value|Text</code> to use a different value.' + (t === 'checkbox' ? ' Leave empty for a single checkbox, such as "I agree".' : '') + '</div>';
		}

		const checks = [];
		if(t === 'checkbox' || t === 'radio') checks.push(check('inline', 'Show side by side', f));
		if(t === 'select' || t === 'file') checks.push(check('multiple', 'Allow multiple', f));
		if(checks.length) h += '<div class="fb-checks">' + checks.join('') + '</div>';

		if(t !== 'color') {
			h += '<div class="fb-section">Validation</div>';
			h += '<div class="fb-checks">' + check('required', t === 'checkbox' && optionList(f).length ? 'Required (at least one)' : 'Required', f) + '</div>';
			const v = [];
			if(TEXTY.indexOf(t) >= 0) v.push(text('minlength', 'Min length', f, '', 'number'), text('maxlength', 'Max length', f, '', 'number'));
			if(t === 'number') v.push(text('min', 'Min value', f), text('max', 'Max value', f), text('step', 'Step', f, '1'));
			if(t === 'date') {
				const it = f.dateKind || 'date';
				v.push(text('min', 'Earliest', f, '', it), text('max', 'Latest', f, '', it));
			}
			if(t === 'text' || t === 'tel' || t === 'password') v.push(text('pattern', 'Pattern (regex)', f, 'e.g. [A-Za-z]{3,}'));
			if(t === 'file') v.push(text('accept', 'Allowed file types', f, '.pdf,.jpg,image/*'));
			for(let i = 0; i < v.length; i += 2) h += inputRow(v.slice(i, i + 2));
			h += text('error', 'Error message', f, defaultError(f));
		}
		fieldEl.innerHTML = h;
	}

	function optionList(f) {
		return String(f.options || '').split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
			const p = s.indexOf('|');
			return p > 0 ? { value: s.slice(0, p).trim(), text: s.slice(p + 1).trim() } : { value: s, text: s };
		});
	}

	function a(k, v) {
		if(v === '' || v == null || v === false) return '';
		if(v === true) return ' ' + k;
		return ' ' + k + '="' + esc(v) + '"';
	}

	function buildForm() {
		const ind = '    ';
		const lines = [];
		const used = {};
		const validate = optValidate.checked;
		const star = optStar.checked;
		const bp = optBp.value;
		let groups = false;
		const out = (d, s) => lines.push(ind.repeat(d) + s);
		const uniq = (base) => {
			let id = base,
				n = 2;
			while(used[id]) id = base + '-' + (n++);
			used[id] = true;
			return id;
		};
		const req = (f) => f.required && optStar.checked ? ' <span class="text-danger">*</span>' : '';

		out(0, '<form' + (validate ? ' class="needs-validation" novalidate' : '') + '>');
		state.rows.forEach((row) => {
			if(!row.cols.length) return;
			out(1, '<div class="row ' + optGap.value + ' mb-3">');
			row.cols.forEach((f) => {
				const w = +f.width;
				const cls = bp ? (w === 12 ? 'col-12' : 'col-12 col-' + bp + '-' + w) : 'col-' + w;
				const id = uniq(slug(f.name || f.label, '-'));
				const name = f.name || slug(f.label, '_');
				const helpId = f.help ? id + '-help' : '';
				const hasRules = f.required || f.type === 'email' || f.type === 'number' || f.minlength || f.maxlength || f.pattern || f.min || f.max;
				const fb = validate && hasRules && f.type !== 'color' ? '<div class="invalid-feedback">' + esc(f.error || defaultError(f)) + '</div>' : '';
				const help = f.help ? '<div class="form-text" id="' + helpId + '">' + esc(f.help) + '</div>' : '';
				const described = a('aria-describedby', helpId);
				out(2, '<div class="' + cls + '">');
				const d = 3;

				if(f.type === 'checkbox' || f.type === 'radio') {
					const opts = optionList(f);
					if(f.type === 'checkbox' && !opts.length) {
						out(d, '<div class="form-check">');
						out(d + 1, '<input class="form-check-input" type="checkbox" id="' + id + '"' + a('name', name) + ' value="yes"' + a('required', f.required) + described + '>');
						out(d + 1, '<label class="form-check-label" for="' + id + '">' + esc(f.label) + req(f) + '</label>');
						if(fb) out(d + 1, fb);
						out(d, '</div>');
					} else {
						const group = f.type === 'checkbox' && f.required;
						if(fb) groups = true;
						out(d, '<div class="form-label">' + esc(f.label) + req(f) + '</div>');
						const gd = fb ? d + 1 : d;
						if(fb) out(d, '<div class="check-group">');
						opts.forEach((o, i) => {
							const oid = uniq(id + '-' + (i + 1));
							out(gd, '<div class="form-check' + (f.inline ? ' form-check-inline' : '') + '">');
							out(gd + 1, '<input class="form-check-input" type="' + f.type + '" id="' + oid + '"' + a('name', name) + a('value', o.value) +
								(f.type === 'radio' ? a('required', f.required) : '') + (group ? a('data-required-group', name) : '') + '>');
							out(gd + 1, '<label class="form-check-label" for="' + oid + '">' + esc(o.text) + '</label>');
							out(gd, '</div>');
						});
						if(fb) {
							out(d, '</div>');
							out(d, fb);
						}
						if(help) out(d, help);
					}
					out(2, '</div>');
					return;
				}

				out(d, '<label for="' + id + '" class="form-label">' + esc(f.label) + req(f) + '</label>');
				if(f.type === 'textarea') {
					out(d, '<textarea class="form-control" id="' + id + '"' + a('name', name) + a('rows', f.rows || 4) + a('placeholder', f.placeholder) +
						a('minlength', f.minlength) + a('maxlength', f.maxlength) + a('required', f.required) + described + '></textarea>');
				} else if(f.type === 'select') {
					out(d, '<select class="form-select" id="' + id + '"' + a('name', f.multiple && !/\[\]$/.test(name) ? name + '[]' : name) + a('multiple', f.multiple) + a('required', f.required) + described + '>');
					if(!f.multiple) out(d + 1, '<option value="" selected disabled>' + esc(f.placeholder || 'Choose…') + '</option>');
					optionList(f).forEach((o) => out(d + 1, '<option' + (o.value !== o.text ? a('value', o.value) : '') + '>' + esc(o.text) + '</option>'));
					out(d, '</select>');
				} else if(f.type === 'color') {
					out(d, '<input type="color" class="form-control form-control-color" id="' + id + '"' + a('name', name) + a('value', /^#[0-9a-f]{6}$/i.test(f.value) ? f.value : '#ff6224') + ' title="Choose a colour"' + described + '>');
				} else if(f.type === 'file') {
					out(d, '<input type="file" class="form-control" id="' + id + '"' + a('name', f.multiple && !/\[\]$/.test(name) ? name + '[]' : name) + a('accept', f.accept) + a('multiple', f.multiple) + a('required', f.required) + described + '>');
				} else {
					const type = f.type === 'date' ? (f.dateKind || 'date') : f.type;
					const ranged = f.type === 'number' || f.type === 'date';
					const lengths = TEXTY.indexOf(f.type) >= 0;
					out(d, '<input type="' + type + '" class="form-control" id="' + id + '"' + a('name', name) + a('placeholder', f.type === 'date' ? '' : f.placeholder) +
						(lengths ? a('minlength', f.minlength) + a('maxlength', f.maxlength) : '') +
						(ranged ? a('min', f.min) + a('max', f.max) : '') + (f.type === 'number' ? a('step', f.step) : '') +
						(f.type === 'text' || f.type === 'tel' || f.type === 'password' ? a('pattern', f.pattern) : '') +
						a('required', f.required) + described + '>');
				}
				if(help) out(d, help);
				if(fb) out(d, fb);
				out(2, '</div>');
			});
			out(1, '</div>');
		});

		if(optSubmit.value.trim()) {
			out(1, '<button type="submit" class="btn btn-primary">' + esc(optSubmit.value.trim()) + '</button>');
		}
		out(0, '</form>');

		let script = '';
		if(validate) {
			script = [
				'<script>',
				'(() => {',
				ind + '\'use strict\';',
				ind + 'document.querySelectorAll(\'form.needs-validation\').forEach((form) => {'
			];
			if(groups) {
				script.push(
					ind + ind + '// Checkbox and radio groups: at least one choice, and show the message under the group',
					ind + ind + 'const checkGroups = () => {',
					ind + ind + ind + 'form.querySelectorAll(\'[data-required-group]\').forEach((box) => {',
					ind + ind + ind + ind + 'const group = form.querySelectorAll(\'[data-required-group="\' + box.dataset.requiredGroup + \'"]\');',
					ind + ind + ind + ind + 'const ok = Array.prototype.some.call(group, (b) => b.checked);',
					ind + ind + ind + ind + 'box.setCustomValidity(ok ? \'\' : \'Choose at least one option\');',
					ind + ind + ind + '});',
					ind + ind + ind + 'if (form.classList.contains(\'was-validated\')) {',
					ind + ind + ind + ind + 'form.querySelectorAll(\'.check-group\').forEach((g) => g.classList.toggle(\'is-invalid\', !!g.querySelector(\':invalid\')));',
					ind + ind + ind + '}',
					ind + ind + '};',
					ind + ind + 'form.addEventListener(\'change\', checkGroups);',
					ind + ind + 'checkGroups();'
				);
			}
			script.push(
				ind + ind + 'form.addEventListener(\'submit\', (event) => {',
				...(groups ? [ind + ind + ind + 'checkGroups();'] : []),
				ind + ind + ind + 'if (!form.checkValidity()) {',
				ind + ind + ind + ind + 'event.preventDefault();',
				ind + ind + ind + ind + 'event.stopPropagation();',
				ind + ind + ind + '}',
				ind + ind + ind + 'form.classList.add(\'was-validated\');',
				...(groups ? [ind + ind + ind + 'checkGroups();'] : []),
				ind + ind + '});',
				ind + '});',
				'})();',
				'</script>'
			);
			script = script.join('\n');
		}
		return { form: lines.join('\n'), script: script };
	}

	function snippet(parts) {
		return parts.form + (parts.script ? '\n\n' + parts.script : '') + '\n';
	}

	function fullPage(parts, css, extraHead, extraBody) {
		const indent = (s, n) => s.split('\n').map((l) => l ? '    '.repeat(n) + l : l).join('\n');
		return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
			'    <meta charset="UTF-8">\n' +
			'    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
			'    <title>Form</title>\n' +
			'    <link href="' + css + '" rel="stylesheet">\n' + (extraHead || '') +
			'</head>\n<body>\n' +
			'    <div class="container py-5">\n' + indent(parts.form, 2) + '\n    </div>\n' +
			(parts.script ? '\n' + indent(parts.script, 1) + '\n' : '') + (extraBody || '') +
			'</body>\n</html>\n';
	}

	const PREVIEW_HEAD = '    <style>body{background:#fff;color:#212529}.container{max-width:none;padding:20px!important}.fb-ok{display:none}</style>\n';
	const PREVIEW_BODY = '<script>\n' +
		'(() => {\n' +
		'    const fit = () => { if (window.frameElement) window.frameElement.style.height = document.documentElement.scrollHeight + "px"; };\n' +
		'    new ResizeObserver(fit).observe(document.body); fit();\n' +
		'    const form = document.querySelector("form");\n' +
		'    if (!form) return;\n' +
		'    const ok = document.createElement("div");\n' +
		'    ok.className = "alert alert-success mt-3 fb-ok";\n' +
		'    ok.textContent = "All fields are valid. This is a preview, so nothing was sent.";\n' +
		'    form.after(ok);\n' +
		'    form.addEventListener("submit", (e) => { e.preventDefault(); ok.style.display = form.checkValidity() ? "block" : "none"; });\n' +
		'    form.addEventListener("input", () => { ok.style.display = "none"; });\n' +
		'})();\n' +
		'<\/script>\n';

	function renderOutput() {
		const parts = buildForm();
		codeEl.value = snippet(parts);
		const fields = state.rows.reduce((s, r) => s + r.cols.length, 0);
		const wide = state.rows.findIndex((r) => total(r) > 12);
		statusEl.textContent = state.rows.length + ' row' + (state.rows.length === 1 ? '' : 's') + ' · ' + fields + ' field' + (fields === 1 ? '' : 's');
		if(wide >= 0) {
			errBox.textContent = 'Row ' + (wide + 1) + ' uses more than 12 columns, so its last columns will wrap onto a new line.';
			errBox.classList.add('show');
		} else {
			errBox.classList.remove('show');
			errBox.textContent = '';
		}
		copyBtn.disabled = dlBtn.disabled = !fields;
		clearTimeout(previewTimer);
		previewTimer = setTimeout(() => {
			frame.srcdoc = fullPage(parts, LOCAL_BOOTSTRAP, '    <link href="' + BOOTSTRAP_CDN + '" rel="stylesheet" media="print" onload="this.media=\'all\'">\n' + PREVIEW_HEAD, PREVIEW_BODY);
		}, 150);
		save();
	}

	function refresh(withField) {
		renderRows();
		if(withField) renderField();
		renderOutput();
	}

	function addRow() {
		const row = newRow();
		state.rows.push(row);
		selected = row.cols[0].id;
		refresh(true);
	}

	function onLayoutClick(e) {
		const col = e.target.closest('.fb-col');
		if(col) {
			selected = col.dataset.field;
			refresh(true);
			return;
		}
		const btn = e.target.closest('[data-act]');
		if(!btn || btn.tagName === 'SELECT') return;
		const act = btn.dataset.act;
		const rowEl = btn.closest('.fb-row');
		const r = rowEl ? +rowEl.dataset.row : -1;
		const rows = state.rows;

		if(act === 'add-row') {
			addRow();
			return;
		} else if(act === 'add-col') {
			const row = rows[r];
			const t = total(row);
			if(t < 12) row.cols.push(newField('text', 12 - t));
			else {
				const w = split(Math.min(12, row.cols.length + 1));
				row.cols.forEach((c, i) => { c.width = w[i] || c.width; });
				row.cols.push(newField('text', w[row.cols.length] || 12));
			}
			selected = row.cols[row.cols.length - 1].id;
		} else if(act === 'up' && r > 0) {
			rows.splice(r - 1, 0, rows.splice(r, 1)[0]);
		} else if(act === 'down' && r < rows.length - 1) {
			rows.splice(r + 1, 0, rows.splice(r, 1)[0]);
		} else if(act === 'dup-row') {
			const copy = { id: 'r' + (uid++), cols: rows[r].cols.map((c) => Object.assign({}, c, { id: 'f' + (uid++) })) };
			rows.splice(r + 1, 0, copy);
		} else if(act === 'del-row') {
			if(rows[r].cols.some((c) => c.id === selected)) selected = null;
			rows.splice(r, 1);
		} else return;
		refresh(true);
	}

	rowsEl.addEventListener('click', onLayoutClick);

	rowsEl.addEventListener('change', (e) => {
		if(e.target.dataset.act !== 'split') return;
		const row = state.rows[+e.target.closest('.fb-row').dataset.row];
		const n = +e.target.value;
		if(n < row.cols.length) {
			const lost = row.cols.slice(n).map((c) => '"' + (c.label || c.type) + '"').join(', ');
			if(!window.confirm('This removes ' + lost + ' from the row. Continue?')) {
				e.target.value = row.cols.length;
				return;
			}
			if(row.cols.slice(n).some((c) => c.id === selected)) selected = null;
			row.cols = row.cols.slice(0, n);
		}
		while(row.cols.length < n) row.cols.push(newField('text', 1));
		const w = split(n);
		row.cols.forEach((c, i) => { c.width = w[i]; });
		refresh(true);
	});

	fieldEl.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-act]');
		const hit = btn && selected && find(selected);
		if(!hit) return;
		const cols = hit.row.cols,
			c = hit.c;
		switch(btn.dataset.act) {
			case 'col-left':
				if(c > 0) cols.splice(c - 1, 0, cols.splice(c, 1)[0]);
				break;
			case 'col-right':
				if(c < cols.length - 1) cols.splice(c + 1, 0, cols.splice(c, 1)[0]);
				break;
			case 'dup-col': {
				const copy = Object.assign({}, hit.field, { id: 'f' + (uid++) });
				cols.splice(c + 1, 0, copy);
				selected = copy.id;
				break;
			}
			case 'del-col':
				cols.splice(c, 1);
				if(!cols.length) state.rows.splice(hit.r, 1);
				selected = cols.length ? cols[Math.min(c, cols.length - 1)].id : null;
				break;
			default:
				return;
		}
		refresh(true);
	});

	function onFieldInput(e) {
		const k = e.target.dataset.k;
		const hit = k && selected && find(selected);
		if(!hit) return;
		const f = hit.field;
		const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
		f[k] = k === 'width' ? +v : v;
		if(k === 'label' && !f.nameEdited) {
			f.name = slug(v, '_');
			const nameEl = $('fbk-name');
			if(nameEl) nameEl.value = f.name;
		}
		if(k === 'name') f.nameEdited = v.trim() !== '';
		if(k === 'type') {
			if(!f.nameEdited && /^(text|email|number|password|phone|textarea|select|checkbox|radio|file|color|calendar) field( \d+)?$/i.test(f.label)) {
				f.label = '';
				f.label = freshLabel(v);
				f.name = slug(f.label, '_');
			}
		}

		const rebuild = k === 'type' || k === 'dateKind' || (k === 'options' && f.type === 'checkbox' && (v.trim() === '') !== (e.target.dataset.wasEmpty === '1'));
		if(k === 'options') e.target.dataset.wasEmpty = v.trim() === '' ? '1' : '0';
		renderRows();
		if(rebuild && e.type === 'change') renderField();
		else if(k !== 'error') {
			const err = $('fbk-error');
			if(err) err.placeholder = defaultError(f);
		}
		renderOutput();
	}

	fieldEl.addEventListener('input', onFieldInput);
	fieldEl.addEventListener('change', onFieldInput);

	[optBp, optGap, optValidate, optStar].forEach((el) => el.addEventListener('change', renderOutput));
	optSubmit.addEventListener('input', renderOutput);

	$('fbView').addEventListener('click', (e) => {
		const b = e.target.closest('.mode-btn');
		if(!b) return;
		$('fbView').querySelectorAll('.mode-btn').forEach((x) => x.classList.toggle('active', x === b));
		const code = b.dataset.view === 'code';
		$('fbPreviewWrap').classList.toggle('is-hidden', code);
		codeEl.classList.toggle('is-hidden', !code);
	});

	$('fbAddRowBtn').addEventListener('click', addRow);

	$('fbSampleBtn').addEventListener('click', () => {
		state = sample();
		selected = state.rows[0].cols[0].id;
		refresh(true);
	});

	$('fbClearBtn').addEventListener('click', () => {
		const fields = state.rows.reduce((s, r) => s + r.cols.length, 0);
		if(fields && !window.confirm('Remove all rows and fields?')) return;
		state = { rows: [] };
		selected = null;
		refresh(true);
	});

	copyBtn.addEventListener('click', async() => {
		const t = codeEl.value;
		try {
			await navigator.clipboard.writeText(t);
		} catch(e) {
			const wasHidden = codeEl.classList.contains('is-hidden');
			codeEl.classList.remove('is-hidden');
			codeEl.select();
			document.execCommand('copy');
			if(wasHidden) codeEl.classList.add('is-hidden');
		}
		copyBtn.innerHTML = '<i class="fa-solid fa-check me-2"></i>Copied';
		setTimeout(() => {
			copyBtn.innerHTML = '<i class="fa-regular fa-copy me-2"></i>Copy HTML';
		}, 1200);
	});

	dlBtn.addEventListener('click', () => {
		const url = URL.createObjectURL(new Blob([fullPage(buildForm(), BOOTSTRAP_CDN)], { type: 'text/html;charset=utf-8' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'form.html';
		document.body.appendChild(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	});


	if(!restore()) state = sample();
	if(state.rows.length && state.rows[0].cols.length) selected = state.rows[0].cols[0].id;
	refresh(true);
})();