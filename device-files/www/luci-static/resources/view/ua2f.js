'use strict';
'require view';
'require fs';
'require poll';
'require ui';

/*
 * 「服务 → UA2F 防检测」原生 JS 页面        by au学长 V：aauuo0
 *
 * 原来的实现是一个 iframe 套 /cgi-bin/ua2f；这里改成直接调 /usr/libexec/ua2f-web
 * （白名单动作，ACL 早已授权），界面统一成和「防检测引擎」一样的卡片风格。
 *
 * 只做展示和转发：不改配置格式、不绕过 ua2f-web，动作和旧页面完全一一对应。
 */

var HELPER = '/usr/libexec/ua2f-web';
var LOAD_ERR = null;
var WM = '作者：au学长 V：aauuo0';

var PERSONAS = [
	{ id: 'windows', label: '电脑 Windows', ttl: 128 },
	{ id: 'iphone',  label: '手机 iPhone',  ttl: 64 },
	{ id: 'android', label: '安卓 Android', ttl: 64 },
	{ id: 'mac',     label: 'Mac',          ttl: 64 }
];

var CSS = [
	'.u2{max-width:1040px;margin:0 auto}',
	'.u2 h2{display:flex;align-items:center;gap:10px;margin:2px 0 6px}',
	'.u2 .sub{font-size:12.5px;opacity:.65;margin:0 0 16px;line-height:1.7}',
	'.u2 .tag{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(94,114,228,.18);color:#8f9ff0;border:1px solid rgba(94,114,228,.35)}',
	'.u2 .msg{display:none;margin:0 0 14px;padding:10px 14px;border-radius:10px;font-size:13px;line-height:1.6;border:1px solid rgba(128,146,184,.25)}',
	'.u2 .msg.show{display:block}',
	'.u2 .msg.ok{background:rgba(60,204,153,.10);border-color:rgba(60,204,153,.35);color:#5ede9f}',
	'.u2 .msg.err{background:rgba(224,96,96,.10);border-color:rgba(224,96,96,.35);color:#f08a8a}',
	'.u2 .card{border:1px solid rgba(128,146,184,.22);border-radius:14px;padding:16px 18px;margin:0 0 14px;background:rgba(127,140,170,.07);box-shadow:0 6px 22px rgba(0,0,0,.07)}',
	'.u2 .card.on{border-color:rgba(94,114,228,.6);box-shadow:0 6px 22px rgba(94,114,228,.16)}',
	'.u2 .head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}',
	'.u2 .name{font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px}',
	'.u2 .pill{font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;white-space:nowrap}',
	'.u2 .pill.on{background:rgba(60,204,153,.16);color:#4ede9f;border:1px solid rgba(60,204,153,.4)}',
	'.u2 .pill.off{background:rgba(140,150,170,.14);color:#a9b3c6;border:1px solid rgba(140,150,170,.3)}',
	'.u2 .rows{border-top:1px dashed rgba(128,146,184,.2);padding-top:10px;margin-bottom:14px}',
	'.u2 .row{display:flex;gap:10px;font-size:12.5px;padding:3px 0}',
	'.u2 .row .k{width:104px;flex:none;opacity:.55}',
	'.u2 .row .v{flex:1;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:12px}',
	'.u2 .acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
	'.u2 .acts .cbi-button{min-width:72px}',
	'.u2 .opts{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}',
	'.u2 .opts button{border:1px solid rgba(128,146,184,.28);background:rgba(127,140,170,.10);color:inherit;border-radius:10px;padding:8px 14px;font-size:12.5px;cursor:pointer;transition:all .15s}',
	'.u2 .opts button:hover{background:rgba(127,140,170,.2)}',
	'.u2 .opts button.on{background:linear-gradient(135deg,#5e72e4,#483d8b);border-color:transparent;color:#fff;box-shadow:0 3px 12px rgba(94,114,228,.3)}',
	'.u2 .opts button[disabled]{opacity:.45;cursor:not-allowed}',
	'.u2 .lab{font-size:13px;font-weight:700;margin:0 0 8px;display:flex;align-items:center;gap:8px}',
	'.u2 .lab small{font-weight:400;opacity:.55;font-size:11.5px}',
	'.u2 input[type=text]{flex:1 1 260px;padding:7px 10px;border-radius:9px;border:1px solid rgba(128,146,184,.28);background:#0d1016;color:inherit;font-size:12.5px;min-width:200px}',
	'.u2 input[type=text]:focus{outline:none;border-color:#5e72e4}',
	'.u2 label.chk{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;margin:0 14px 8px 0;cursor:pointer}',
	'.u2 pre{margin:10px 0 0;padding:12px;border-radius:10px;background:#0d1016;border:1px solid rgba(128,146,184,.22);color:#b9c4d6;font-size:12px;line-height:1.6;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-all}',
	'.u2 .wm{position:fixed;left:0;right:0;top:38%;z-index:0;text-align:center;white-space:nowrap;pointer-events:none;user-select:none;transform:rotate(-22deg);font-size:clamp(26px,5.5vw,62px);font-weight:700;letter-spacing:.08em;color:rgba(128,140,168,.085)}',
	'.u2 .wmc{position:fixed;right:14px;bottom:8px;z-index:9;font-size:12px;pointer-events:none;user-select:none;color:rgba(128,140,168,.55)}'
].join('');

function parseKV(t) {
	var o = {};
	(t || '').split('\n').forEach(function (l) {
		var i = l.indexOf('=');
		if (i > 0) { o[l.slice(0, i).trim()] = l.slice(i + 1); }
	});
	return o;
}

function run(action, arg) {
	var args = arg ? [action, arg] : [action];
	return fs.exec(HELPER, args).then(function (r) {
		var out = ((r && r.stdout) || '') + ((r && r.stderr) || '');
		if (r && r.code !== 0 && !out) { throw new Error('ua2f-web 返回 ' + r.code); }
		return out;
	});
}

function callStatus() {
	return fs.exec(HELPER, ['status']).then(function (r) { return parseKV(r && r.stdout); });
}

return view.extend({
	load: function () {
		LOAD_ERR = null;
		return callStatus().catch(function (e) {
			LOAD_ERR = (e && e.message) ? e.message : String(e);
			return {};
		});
	},

	render: function (data) {
		var self = this;
		this.st = data || {};
		this.busy = false;

		var msg = E('div', { 'class': 'msg', 'id': 'u2-msg' }, '');

		/* ---- 状态卡片 ---- */
		var card = E('div', { 'class': 'card', 'id': 'u2-card' }, [
			E('div', { 'class': 'head' }, [
				E('div', { 'class': 'name' }, ['UA2F', E('span', { 'class': 'tag' }, '备引擎 · 只改 UA')]),
				E('span', { 'class': 'pill off', 'id': 'u2-state' }, '读取中…')
			]),
			E('div', { 'class': 'rows' }, [
				E('div', { 'class': 'row' }, [E('span', { 'class': 'k' }, '模式 / 端口'), E('span', { 'class': 'v', 'id': 'u2-mode' }, '—')]),
				E('div', { 'class': 'row' }, [E('span', { 'class': 'k' }, '进程 PID'), E('span', { 'class': 'v', 'id': 'u2-pid' }, '—')]),
				E('div', { 'class': 'row' }, [E('span', { 'class': 'k' }, 'NFQUEUE 规则'), E('span', { 'class': 'v', 'id': 'u2-rules' }, '—')]),
				E('div', { 'class': 'row' }, [E('span', { 'class': 'k' }, '固定 TTL'), E('span', { 'class': 'v', 'id': 'u2-ttl' }, '—')]),
				E('div', { 'class': 'row' }, [E('span', { 'class': 'k' }, '当前 UA'), E('span', { 'class': 'v', 'id': 'u2-ua' }, '—')])
			]),
			E('div', { 'class': 'acts' }, [
				E('button', { 'class': 'cbi-button cbi-button-apply', 'id': 'u2-start', 'click': function () { self.act('start', null, '已启动'); } }, '启动'),
				E('button', { 'class': 'cbi-button cbi-button-reset', 'id': 'u2-stop', 'click': function () { self.act('stop', null, '已停止'); } }, '停止'),
				E('button', { 'class': 'cbi-button', 'id': 'u2-restart', 'click': function () { self.act('restart', null, '已重启'); } }, '重启'),
				E('button', { 'class': 'cbi-button', 'id': 'u2-ttl-on', 'click': function () { self.act('ttl_on', null, '已固定 TTL'); } }, '固定 TTL'),
				E('button', { 'class': 'cbi-button', 'id': 'u2-ttl-off', 'click': function () { self.act('ttl_off', null, '已关闭 TTL 固定'); } }, '关闭 TTL')
			])
		]);

		/* ---- 人格 ---- */
		var opts = PERSONAS.map(function (p) {
			return E('button', {
				'type': 'button', 'id': 'u2-p-' + p.id, 'data-p': p.id,
				'click': function () { self.act('persona_' + p.id, null, '人格已切到 ' + p.label); }
			}, p.label + ' · TTL ' + p.ttl);
		});
		var persona = E('div', { 'class': 'card' }, [
			E('div', { 'class': 'lab' }, ['认证人格', E('small', {}, 'UA 和 TTL 一起换，切完自动重启')]),
			E('div', { 'class': 'opts', 'id': 'u2-opts' }, opts)
		]);

		/* ---- 自定义 UA ---- */
		var uaBox = E('div', { 'class': 'card' }, [
			E('div', { 'class': 'lab' }, ['自定义 UA', E('small', {}, '留空保存会失败，只允许常见 UA 字符')]),
			E('div', { 'class': 'acts' }, [
				E('input', { 'type': 'text', 'id': 'u2-ua-in', 'placeholder': 'Mozilla/5.0 …' }),
				E('button', { 'class': 'cbi-button cbi-button-apply', 'id': 'u2-ua-save', 'click': function () {
					var v = document.getElementById('u2-ua-in').value.trim();
					if (!v) { self.notify('UA 不能为空', 'err'); return; }
					self.act('ua_save', v, '自定义 UA 已保存');
				} }, '保存')
			])
		]);

		/* ---- 防火墙开关 ---- */
		function chk(id, label, key) {
			var el = E('input', { 'type': 'checkbox', 'id': 'u2-' + id, 'change': function () {
				self.act('set_' + id, el.checked ? '1' : '0', '已更新 ' + label);
			} });
			return E('label', { 'class': 'chk' }, [el, label]);
		}
		var fw = E('div', { 'class': 'card' }, [
			E('div', { 'class': 'lab' }, ['过滤范围', E('small', {}, '改完自动重启生效')]),
			chk('fw', '处理出站 HTTP', 'handle_fw'),
			chk('lan', '处理内网流量', 'handle_intranet'),
			chk('tls', '处理 TLS（443）', 'handle_tls')
		]);

		/* ---- 诊断 ---- */
		var diag = E('div', { 'class': 'card' }, [
			E('div', { 'class': 'lab' }, ['自检 / 日志']),
			E('div', { 'class': 'acts' }, [
				E('button', { 'class': 'cbi-button', 'id': 'u2-check', 'click': function () { self.diag('check'); } }, '跑一次自检'),
				E('button', { 'class': 'cbi-button', 'id': 'u2-log', 'click': function () { self.diag('log'); } }, '看最近日志')
			]),
			E('pre', { 'id': 'u2-out', 'style': 'display:none' }, '')
		]);

		var root = E('div', { 'class': 'u2' }, [
			E('style', {}, CSS),
			E('div', { 'class': 'wm', 'id': 'u2-wm' }, WM),
			E('div', { 'class': 'wmc', 'id': 'u2-wmc' }, WM),
			E('h2', {}, ['UA2F 防检测', E('span', { 'class': 'tag' }, '只改 UA')]),
			E('p', { 'class': 'sub' }, '与 UA3F 互斥：同时只能跑一个。'),
			msg, card, persona, uaBox, fw, diag
		]);

		this.root = root;
		this.applyStatus(this.st);
		this.startPolling();

		if (LOAD_ERR) {
			this.notify('读不到状态：' + LOAD_ERR + '（SSH 里 /etc/init.d/rpcd restart 再刷新）', 'err');
		}
		return root;
	},

	applyStatus: function (st) {
		st = st || {};
		this.st = st;
		var $ = function (id) { return document.getElementById(id); };
		var set = function (id, v) { var n = $(id); if (n) { n.textContent = v; } };

		var run = st.running === '1';
		var p = $('u2-state');
		if (p) {
			p.textContent = run ? '运行中' : (st.enabled === '1' ? '已停止（开机自启）' : '已停止');
			p.className = 'pill ' + (run ? 'on' : 'off');
		}
		var c = $('u2-card');
		if (c) { c.className = 'card' + (run ? ' on' : ''); }

		set('u2-mode', (st.mode || '—') + ' / ' + (st.port || '—'));
		set('u2-pid', st.pid || '—');
		set('u2-rules', st.rules === '1' ? '已下发' : (run ? '没有（可能启动失败）' : '没有'));
		set('u2-ttl', st.ttl_on === '1' ? ('固定 ' + (st.ttl || '?')) : '未开启');
		set('u2-ua', st.ua_full || '—');
		var ua = $('u2-ua'); if (ua && st.ua_full) { ua.title = st.ua_full; }

		var inp = $('u2-ua-in');
		if (inp && !inp.value && st.ua_full) { inp.value = st.ua_full; }

		/* 人格高亮 */
		var cur = st.persona || '';
		PERSONAS.forEach(function (x) {
			var b = $('u2-p-' + x.id);
			if (b) { b.className = (cur === x.id ? 'on' : ''); b.disabled = !!this.busy; }
		}, this);

		['u2-start', 'u2-stop', 'u2-restart', 'u2-ttl-on', 'u2-ttl-off', 'u2-ua-save', 'u2-check', 'u2-log'].forEach(function (id) {
			var b = $(id); if (!b) { return; }
			if (id === 'u2-start') { b.disabled = !!this.busy || run; }
			else if (id === 'u2-stop') { b.disabled = !!this.busy || !run; }
			else { b.disabled = !!this.busy; }
		}, this);

		[['u2-fw', st.handle_fw], ['u2-lan', st.intranet], ['u2-tls', st.handle_tls]].forEach(function (kv) {
			var el = $(kv[0]);
			if (el) { el.checked = kv[1] === '1'; }
		});
	},

	notify: function (text, kind) {
		var b = document.getElementById('u2-msg');
		if (!b) { return; }
		b.textContent = text;
		b.className = 'msg show ' + (kind === 'err' ? 'err' : 'ok');
		if (this.t) { window.clearTimeout(this.t); }
		this.t = window.setTimeout(function () { b.className = 'msg'; }, 7000);
	},

	setBusy: function (on) {
		this.busy = on;
		if (!on) { this.applyStatus(this.st); return; }
		PERSONAS.forEach(function (x) {
			var b = document.getElementById('u2-p-' + x.id);
			if (b) { b.disabled = true; }
		});
		['u2-start', 'u2-stop', 'u2-restart', 'u2-ttl-on', 'u2-ttl-off', 'u2-ua-save'].forEach(function (id) {
			var b = document.getElementById(id); if (b) { b.disabled = true; }
		});
	},

	act: function (action, arg, okText) {
		var self = this;
		if (this.busy) { return Promise.resolve(); }
		this.setBusy(true);
		return run(action, arg)
			.then(function () { return callStatus(); })
			.then(function (st) {
				self.applyStatus(st);
				self.notify(okText || (action + ' 完成'), 'ok');
			})
			.catch(function (e) {
				self.notify('操作失败：' + ((e && e.message) ? e.message : e), 'err');
			})
			.then(function () { self.setBusy(false); });
	},

	diag: function (which) {
		var self = this;
		var pre = document.getElementById('u2-out');
		if (!pre) { return; }
		pre.style.display = 'block';
		pre.textContent = '读取中…';
		run(which).then(function (txt) {
			pre.textContent = txt || '（没有输出）';
		}).catch(function (e) {
			pre.textContent = '失败：' + ((e && e.message) ? e.message : e);
		});
	},

	startPolling: function () {
		var self = this;
		try {
			poll.add(function () {
				if (self.busy) { return Promise.resolve(); }
				if (!document.getElementById('u2-state')) { return Promise.resolve(); }
				return callStatus().then(function (st) { self.applyStatus(st); }).catch(function () {});
			}, 10);
		} catch (e) {
			window.setInterval(function () {
				if (self.busy || !document.getElementById('u2-state')) { return; }
				callStatus().then(function (st) { self.applyStatus(st); }).catch(function () {});
			}, 10000);
		}
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});