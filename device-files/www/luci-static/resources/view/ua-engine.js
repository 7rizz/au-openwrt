'use strict';
'require view';
'require fs';
'require poll';
'require ui';

/*
 * 「服务 → 防检测引擎」控制台                by au学长 V：aauuo0
 *
 * 干三件事：看状态、启停 UA3F/UA2F、一键换认证人格（UA + TTL 成套换）。
 * 互斥和人格同步全在后端 /usr/libexec/ua-engine-web 里，这里只管按按钮和显示。
 */

var HELPER = '/usr/libexec/ua-engine-web';
var LOAD_ERR = null;

var PERSONAS = [
	{ id: 'windows', label: '电脑 Windows', ttl: 128 },
	{ id: 'iphone',  label: '手机 iPhone',  ttl: 64  },
	{ id: 'android', label: '安卓 Android', ttl: 64  },
	{ id: 'mac',     label: 'Mac',          ttl: 64  }
];

var CSS = [
	'.ua-engine-page{max-width:1080px;margin:0 auto}',
	'.ua-engine-page h2{display:flex;align-items:center;gap:10px;margin:2px 0 6px}',
	'.ua-engine-sub{font-size:12.5px;opacity:.65;margin:0 0 16px;line-height:1.7}',
	'.ua-engine-msg{display:none;margin:0 0 14px;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.6;border:1px solid rgba(128,146,184,.25)}',
	'.ua-engine-msg.show{display:block}',
	'.ua-engine-msg.ok{background:rgba(60,204,153,.10);border-color:rgba(60,204,153,.35);color:#5ede9f}',
	'.ua-engine-msg.err{background:rgba(224,96,96,.10);border-color:rgba(224,96,96,.35);color:#f08a8a}',
	'.ua-engine-warn{display:none;margin:0 0 14px;padding:12px 14px;border-radius:10px;font-size:13px;background:rgba(224,96,96,.12);border:1px solid rgba(224,96,96,.4);color:#f3a0a0}',
	'.ua-engine-warn.show{display:block}',
	'.ua-engine-persona{border:1px solid rgba(128,146,184,.22);border-radius:14px;padding:14px 16px;margin:0 0 14px;background:rgba(127,140,170,.07)}',
	'.ua-engine-persona .lab{font-size:13px;font-weight:700;margin-bottom:10px;display:flex;align-items:center;gap:8px}',
	'.ua-engine-persona .lab small{font-weight:400;opacity:.55;font-size:11.5px}',
	'.ua-engine-persona .opts{display:flex;flex-wrap:wrap;gap:8px}',
	'.ua-engine-persona button{border:1px solid rgba(128,146,184,.28);background:rgba(127,140,170,.10);color:inherit;border-radius:10px;padding:8px 14px;font-size:12.5px;cursor:pointer;transition:all .15s ease}',
	'.ua-engine-persona button:hover{background:rgba(127,140,170,.2)}',
	'.ua-engine-persona button.on{background:linear-gradient(135deg,#5e72e4,#483d8b);border-color:transparent;color:#fff;box-shadow:0 3px 12px rgba(94,114,228,.3)}',
	'.ua-engine-persona button[disabled]{opacity:.45;cursor:not-allowed}',
	'.ua-engine-persona .hint{margin-top:10px;font-size:12px;opacity:.6}',
	'.ua-engine-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(330px,100%),1fr));gap:14px}',
	'.ua-engine-card{border:1px solid rgba(128,146,184,.22);border-radius:14px;padding:16px 18px;background:rgba(127,140,170,.07);box-shadow:0 6px 22px rgba(0,0,0,.07)}',
	'.ua-engine-card.active{border-color:rgba(94,114,228,.6);box-shadow:0 6px 22px rgba(94,114,228,.16)}',
	'.ua-engine-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px}',
	'.ua-engine-name{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}',
	'.ua-engine-tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(94,114,228,.18);color:#8f9ff0;border:1px solid rgba(94,114,228,.35)}',
	'.ua-engine-pill{font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}',
	'.ua-engine-pill.on{background:rgba(60,204,153,.16);color:#4ede9f;border:1px solid rgba(60,204,153,.4)}',
	'.ua-engine-pill.off{background:rgba(140,150,170,.14);color:#a9b3c6;border:1px solid rgba(140,150,170,.3)}',
	'.ua-engine-desc{font-size:12px;opacity:.6;margin:0 0 12px;line-height:1.6}',
	'.ua-engine-rows{border-top:1px dashed rgba(128,146,184,.2);padding-top:10px;margin-bottom:14px}',
	'.ua-engine-row{display:flex;gap:10px;font-size:12.5px;padding:3px 0}',
	'.ua-engine-row .k{width:92px;flex:none;opacity:.55}',
	'.ua-engine-row .v{flex:1;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:12px}',
	'.ua-engine-actions{display:flex;flex-wrap:wrap;gap:8px}',
	'.ua-engine-actions .cbi-button{min-width:76px}',
	'.ua-engine-foot{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:18px;padding-top:14px;border-top:1px solid rgba(128,146,184,.18)}',
	'.ua-engine-foot .note{font-size:12px;opacity:.55}',
	'.ua-engine-page button[disabled]{opacity:.45;cursor:not-allowed;transform:none!important}',
	'.ue-wm{position:fixed;left:0;right:0;top:38%;z-index:0;text-align:center;white-space:nowrap;pointer-events:none;user-select:none;transform:rotate(-22deg);font-size:clamp(26px,5.5vw,62px);font-weight:700;letter-spacing:.08em;color:rgba(128,140,168,.085)}',
	'.ue-wm-corner{position:fixed;right:14px;bottom:8px;z-index:9;font-size:12px;pointer-events:none;user-select:none;color:rgba(128,140,168,.55)}',
	'@media (max-width:560px){.ua-engine-row .k{width:78px}}'
].join('');

function parseKV(text) {
	var out = {};
	(text || '').split('\n').forEach(function (line) {
		var i = line.indexOf('=');
		if (i > 0) { out[line.slice(0, i).trim()] = line.slice(i + 1); }
	});
	return out;
}

function call(action, arg) {
	var args = arg ? [action, arg] : [action];
	return fs.exec(HELPER, args).then(function (res) {
		var st = parseKV(res && res.stdout);
		if (!st.ua3f_running && res && res.code !== 0) {
			throw new Error((res.stderr || '后端没返回状态（helper 可能没装好）').trim());
		}
		return st;
	});
}

function shortUA(ua) {
	ua = ua || '';
	if (ua.length <= 58) { return ua || '—'; }
	return ua.slice(0, 58) + '…';
}

/* 水印：和其它页面同款（斜排大字 + 右下角小字），只挂在本页 */
var WM_TEXT = '作者：au学长 V：aauuo0';

function ensureWatermark(host) {
	var parent = host || document.body;
	if (!document.getElementById('ue-wm')) {
		parent.appendChild(E('div', { 'class': 'ue-wm', 'id': 'ue-wm' }, WM_TEXT));
	}
	if (!document.getElementById('ue-wm-corner')) {
		parent.appendChild(E('div', { 'class': 'ue-wm-corner', 'id': 'ue-wm-corner' }, WM_TEXT));
	}
}

function dropWatermark() {
	var a = document.getElementById('ue-wm');
	if (a && a.parentNode) { a.parentNode.removeChild(a); }
	var b = document.getElementById('ue-wm-corner');
	if (b && b.parentNode) { b.parentNode.removeChild(b); }
}

function personaLabel(id) {
	for (var i = 0; i < PERSONAS.length; i++) {
		if (PERSONAS[i].id === id) { return PERSONAS[i].label; }
	}
	return '自定义 UA';
}

return view.extend({
	load: function () {
		LOAD_ERR = null;
		return call('status').catch(function (e) {
			LOAD_ERR = (e && e.message) ? e.message : String(e);
			return {};
		});
	},

	buildCard: function (id, name, tag, desc, rows) {
		var rowNodes = rows.map(function (r) {
			return E('div', { 'class': 'ua-engine-row' }, [
				E('span', { 'class': 'k' }, r[0]),
				E('span', { 'class': 'v', 'id': 'ue-' + id + '-' + r[1] }, '—')
			]);
		});
		return E('div', { 'class': 'ua-engine-card', 'id': 'ue-card-' + id }, [
			E('div', { 'class': 'ua-engine-head' }, [
				E('div', { 'class': 'ua-engine-name' }, [name, E('span', { 'class': 'ua-engine-tag' }, tag)]),
				E('span', { 'class': 'ua-engine-pill off', 'id': 'ue-' + id + '-state' }, '已停止')
			]),
			E('p', { 'class': 'ua-engine-desc' }, desc),
			E('div', { 'class': 'ua-engine-rows' }, rowNodes),
			E('div', { 'class': 'ua-engine-actions', 'id': 'ue-' + id + '-actions' }, [])
		]);
	},

	buildPersona: function () {
		var self = this;
		var opts = PERSONAS.map(function (p) {
			return E('button', {
				'type': 'button',
				'id': 'ue-persona-' + p.id,
				'data-persona': p.id,
				'click': function () { self.doAction('persona', p.id); }
			}, p.label + ' · TTL ' + p.ttl);
		});
		return E('div', { 'class': 'ua-engine-persona', 'id': 'ue-persona-box' }, [
			E('div', { 'class': 'lab' }, ['认证人格', E('small', {}, 'UA 和 TTL 成套切换，两个引擎同时同步')]),
			E('div', { 'class': 'opts' }, opts),
			E('div', { 'class': 'hint', 'id': 'ue-persona-hint' }, '正在读取…')
		]);
	},

	render: function (data) {
		var self = this;
		this.st = data || {};
		this.busy = false;

		var ua3fCard = this.buildCard('ua3f', 'UA3F', '主引擎 · 改 UA + TTL',
			'TPROXY 透明代理，把所有设备的浏览器 UA 统一、固定出站 TTL。规则和详细参数在「服务 → UA3F 防检测」。',
			[['模式', 'mode'], ['端口', 'port'], ['TTL', 'ttl'], ['L3 附加', 'l3'], ['当前 UA', 'ua']]);

		var ua2fCard = this.buildCard('ua2f', 'UA2F', '备引擎 · 只改 UA',
			'内核态 NFQUEUE，只处理 HTTP，开销小；不做 IPID / TCP 时间戳。人格跟着上面一起变。',
			[['模式', 'mode'], ['端口', 'port'], ['TTL', 'ttl'], ['当前 UA', 'ua']]);

		var msg = E('div', { 'class': 'ua-engine-msg', 'id': 'ue-msg' }, '');
		var warn = E('div', { 'class': 'ua-engine-warn', 'id': 'ue-warn' },
			'检测到两个引擎同时在跑，这一定会互相抢流量。点下面「全部停止」，再只启动一个。');

		var root = E('div', { 'class': 'ua-engine-page' }, [
			E('style', {}, CSS),
			E('h2', {}, ['防检测引擎', E('span', { 'class': 'ua-engine-tag' }, '互斥控制')]),
			E('p', { 'class': 'ua-engine-sub' },
				'两个引擎互斥：启动一个会自动停掉另一个。'),
			warn,
			msg,
			this.buildPersona(),
			E('div', { 'class': 'ua-engine-cards' }, [ua3fCard, ua2fCard]),
			E('div', { 'class': 'ua-engine-foot' }, [
				E('button', {
					'class': 'cbi-button cbi-button-negative', 'id': 'ue-stop-all',
					'click': function () { self.doAction('stop', 'all', true); }
				}, '全部停止'),
				E('button', {
					'class': 'cbi-button', 'id': 'ue-refresh',
					'click': function () { self.refresh(true); }
				}, '刷新状态'),
				E('span', { 'class': 'note' }, '状态每 10 秒自动刷新')
			])
		]);

		this.root = root;

		var a3 = root.querySelector('#ue-ua3f-actions');
		if (a3) {
			a3.appendChild(E('button', {
				'class': 'cbi-button cbi-button-apply', 'id': 'ue-ua3f-start',
				'click': function () { self.doAction('start', 'ua3f'); }
			}, '启动 UA3F'));
			a3.appendChild(E('button', {
				'class': 'cbi-button cbi-button-reset', 'id': 'ue-ua3f-stop',
				'click': function () { self.doAction('stop', 'ua3f'); }
			}, '停止'));
			a3.appendChild(E('button', {
				'class': 'cbi-button', 'id': 'ue-ua3f-fast',
				'click': function () { self.doAction('mode', 'fast'); }
			}, '速度档（默认）'));
		}

		var a2 = root.querySelector('#ue-ua2f-actions');
		if (a2) {
			a2.appendChild(E('button', {
				'class': 'cbi-button cbi-button-apply', 'id': 'ue-ua2f-start',
				'click': function () { self.doAction('start', 'ua2f'); }
			}, '启动 UA2F'));
			a2.appendChild(E('button', {
				'class': 'cbi-button cbi-button-reset', 'id': 'ue-ua2f-stop',
				'click': function () { self.doAction('stop', 'ua2f'); }
			}, '停止'));
		}

		this.applyStatus(this.st);
		this.startPolling();
		ensureWatermark(root);

		if (LOAD_ERR) {
			this.notify('读不到状态：' + LOAD_ERR + '　（SSH 里执行 /etc/init.d/rpcd restart 再刷新）', 'err');
		}

		return root;
	},

	applyStatus: function (st) {
		st = st || {};
		this.st = st;
		var $ = function (id) { return document.getElementById(id); };
		var set = function (id, txt) { var n = $(id); if (n) { n.textContent = txt; } };

		var run3 = st.ua3f_running === '1';
		var run2 = st.ua2f_running === '1';

		var p3 = $('ue-ua3f-state');
		if (p3) {
			p3.textContent = run3 ? '运行中' : (st.ua3f_enabled === '1' ? '已停止（开机自启）' : '已停止');
			p3.className = 'ua-engine-pill ' + (run3 ? 'on' : 'off');
		}
		var p2 = $('ue-ua2f-state');
		if (p2) {
			p2.textContent = run2 ? '运行中' : (st.ua2f_enabled === '1' ? '已停止（开机自启）' : '已停止');
			p2.className = 'ua-engine-pill ' + (run2 ? 'on' : 'off');
		}

		var c3 = $('ue-card-ua3f'); if (c3) { c3.className = 'ua-engine-card' + (run3 ? ' active' : ''); }
		var c2 = $('ue-card-ua2f'); if (c2) { c2.className = 'ua-engine-card' + (run2 ? ' active' : ''); }

		set('ue-ua3f-mode', st.ua3f_mode || '—');
		set('ue-ua3f-port', st.ua3f_port || '—');
		set('ue-ua3f-ttl', (st.ua3f_ttl_on === '1' ? ('固定 ' + (st.ua3f_ttl || '?')) : '未启用'));
		var l3 = [];
		if (st.ua3f_tcpts === '1') { l3.push('TCPts'); }
		if (st.ua3f_ipid === '1') { l3.push('IPID'); }
		var profile, profileNote;
		if (l3.length) {
			profile = '非默认';
			profileNote = '手动开了 ' + l3.join(' + ') + '（逐包走 NFQUEUE，会掉速），点「速度档（默认）」可复位';
		} else {
			profile = '速度档';
			profileNote = '只固定 TTL（nft 内核态，不启用 NFQUEUE）';
		}
		set('ue-ua3f-l3', profile + '：' + profileNote);
		this.profile = profile;

		var bf = $('ue-ua3f-fast');
		if (bf) {
			bf.className = 'cbi-button' + (l3.length ? '' : ' cbi-button-action');
			bf.disabled = !!this.busy;
		}
		set('ue-ua3f-ua', shortUA(st.ua3f_ua));
		var n3 = $('ue-ua3f-ua'); if (n3 && st.ua3f_ua) { n3.title = st.ua3f_ua; }

		set('ue-ua2f-mode', st.ua2f_mode || '—');
		set('ue-ua2f-port', st.ua2f_port || '—');
		set('ue-ua2f-ttl', st.ua2f_persona === 'windows' ? '跟随人格（128）' : (st.ua2f_persona ? '跟随人格（64）' : '跟随人格'));
		set('ue-ua2f-ua', shortUA(st.ua2f_ua));
		var n2 = $('ue-ua2f-ua'); if (n2 && st.ua2f_ua) { n2.title = st.ua2f_ua; }

		/* 人格按钮：高亮当前那个 */
		var cur = st.ua3f_persona || '';
		var busy = this.busy;
		PERSONAS.forEach(function (p) {
			var b = $('ue-persona-' + p.id);
			if (!b) { return; }
			if (cur === p.id) { b.className = 'on'; } else { b.className = ''; }
			b.disabled = !!busy;
		});

		var hint = $('ue-persona-hint');
		if (hint) {
			if (cur && cur !== 'custom') {
				hint.textContent = '当前：' + personaLabel(cur) + '（TTL ' + (st.ua3f_ttl || '?') + '）　切换会自动重启正在跑的引擎';
			} else if (cur === 'custom') {
				hint.textContent = '当前：自定义 UA（TTL ' + (st.ua3f_ttl || '?') + '）　点上面任一按钮可回到预设人格';
			} else {
				hint.textContent = '正在读取…';
			}
		}

		var warn = $('ue-warn');
		if (warn) { warn.className = 'ua-engine-warn' + (st.conflict === '1' ? ' show' : ''); }

		var b3s = $('ue-ua3f-start'); if (b3s) { b3s.disabled = this.busy || run3; }
		var b3t = $('ue-ua3f-stop'); if (b3t) { b3t.disabled = this.busy || !run3; }
		var b2s = $('ue-ua2f-start'); if (b2s) { b2s.disabled = this.busy || run2; }
		var b2t = $('ue-ua2f-stop'); if (b2t) { b2t.disabled = this.busy || !run2; }
	},

	notify: function (text, kind) {
		var box = document.getElementById('ue-msg');
		if (!box) { return; }
		box.textContent = text;
		box.className = 'ua-engine-msg show ' + (kind === 'err' ? 'err' : 'ok');
		if (this.msgTimer) { window.clearTimeout(this.msgTimer); }
		this.msgTimer = window.setTimeout(function () {
			box.className = 'ua-engine-msg';
		}, 7000);
	},

	setBusy: function (on) {
		this.busy = on;
		var ids = ['ue-ua3f-start', 'ue-ua3f-stop', 'ue-ua2f-start', 'ue-ua2f-stop',
			'ue-stop-all', 'ue-ua3f-fast'];
		ids.forEach(function (id) {
			var n = document.getElementById(id);
			if (n) { n.disabled = on; }
		});
		PERSONAS.forEach(function (p) {
			var n = document.getElementById('ue-persona-' + p.id);
			if (n) { n.disabled = on; }
		});
		if (!on) { this.applyStatus(this.st); }
	},

	doAction: function (action, arg, confirmFirst) {
		var self = this;
		if (this.busy) { return Promise.resolve(); }

		if (confirmFirst) {
			try {
				if (!window.confirm('确定要把两个引擎都停掉吗？停掉后防检测就完全失效了。')) { return Promise.resolve(); }
			} catch (e) { /* 没有 confirm 就继续 */ }
		}

		this.setBusy(true);
		return call(action, arg)
			.then(function (st) {
				self.applyStatus(st);
				self.notify(st.msg || '已执行', 'ok');
				if (st.conflict === '1') { self.notify('两个引擎都在跑，请点「全部停止」再启动一个。', 'err'); }
			})
			.catch(function (e) {
				self.notify('操作失败：' + (e && e.message ? e.message : e), 'err');
			})
			.then(function () {
				self.setBusy(false);
			});
	},

	refresh: function (manual) {
		var self = this;
		if (this.busy) { return Promise.resolve(); }
		return call('status').then(function (st) {
			self.applyStatus(st);
			if (manual) { self.notify('状态已刷新', 'ok'); }
		}).catch(function (e) {
			if (manual) { self.notify('读取状态失败：' + (e && e.message ? e.message : e), 'err'); }
		});
	},

	startPolling: function () {
		var self = this;
		try {
			poll.add(function () {
				if (self.busy) { return Promise.resolve(); }
				if (!document.getElementById('ue-ua3f-state')) { dropWatermark(); return Promise.resolve(); }
				return call('status').then(function (st) { self.applyStatus(st); }).catch(function () {});
			}, 10);
		} catch (e) {
			if (!window.__uaEngineTimer) {
				window.__uaEngineTimer = window.setInterval(function () {
					if (self.busy) { return; }
					if (!document.getElementById('ue-ua3f-state')) { dropWatermark(); return; }
					call('status').then(function (st) { self.applyStatus(st); }).catch(function () {});
				}, 10000);
			}
		}
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});