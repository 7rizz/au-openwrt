'use strict';
'require view';
'require fs';
'require ui';
'require poll';

/* ------------------------------------------------------------------
 * 认证门户探测（校园网换学校 / 换楼栋时用）
 *
 *   点「开始探测」→ 自动找出门户地址、参数、登录表单字段、认证系统指纹
 *   点「抓包 30 秒」→ 抓 HTTP 认证请求（密码自动打码）
 *   报告显示在下面，全选复制发出去即可
 *
 *   后端只有一个固定入口：/usr/libexec/portal-probe
 * ------------------------------------------------------------------ */

var HELPER = '/usr/libexec/portal-probe';

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return fs.exec(HELPER, [ 'show' ]).then(function(res) {
			return (res && res.stdout) || '';
		}, function() { return ''; });
	},

	render: function(initial) {
		var self = this;

		function notify(msg, kind) {
			ui.addNotification(null, E('p', {}, msg), kind);
		}

		var pre = E('pre', {
			'id': 'portal-probe-out',
			'style': 'white-space:pre-wrap; word-break:break-all; max-height:60vh; overflow:auto; ' +
				'background:#f7f7f7; border:1px solid #ddd; padding:10px; font-size:12px; line-height:1.5'
		}, initial || '（还没有报告，先点「开始探测」）');

		var busy = E('span', { 'style': 'margin-left:10px; color:#c93' }, '');

		function refresh() {
			return fs.exec(HELPER, [ 'show' ]).then(function(res) {
				var t = ((res && res.stdout) || '').replace(/^\s+|\s+$/g, '');
				pre.textContent = t || '（还没有报告）';
				return t;
			}, function() {});
		}

		function isRunning() {
			return fs.exec(HELPER, [ 'status' ]).then(function(res) {
				return /running=1/.test((res && res.stdout) || '');
			}, function() { return false; });
		}

		function run(args, label) {
			busy.textContent = label + '中…';
			return fs.exec(HELPER, args).then(function() {
				var n = 0;
				var timer = setInterval(function() {
					n++;
					isRunning().then(function(on) {
						if (!on || n > 40) {
							clearInterval(timer);
							busy.textContent = '';
							refresh().then(function() { notify(label + '完成'); });
						}
					});
				}, 2000);
			}, function(e) {
				busy.textContent = '';
				notify(label + '失败：' + (e.message || e), 'error');
			});
		}

		function button(text, cls, fn) {
			return E('button', {
				'type': 'button', 'class': 'cbi-button ' + cls,
				'style': 'margin-right:8px', 'click': fn
			}, text);
		}

		function row(title, nodes, descr) {
			var field = nodes || [];
			if (descr)
				field = field.concat([ E('div', { 'class': 'cbi-value-description' }, descr) ]);
			return E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, title),
				E('div', { 'class': 'cbi-value-field' }, field)
			]);
		}

		function section(title, rows) {
			return E('div', { 'class': 'cbi-section' }, [ E('h3', {}, title) ].concat(rows));
		}

		/* 一边跑一边自动刷新报告（每 3 秒） */
		poll.add(function() {
			if (!document.body.contains(pre))
				return Promise.resolve();
			return isRunning().then(function(on) {
				if (on) { busy.textContent = '正在处理…'; return; }
				if (busy.textContent)
					busy.textContent = '';
			});
		}, 3);

		var probeSection = section(_('第 1 步：探测认证门户'), [
			row(_('操作'),
				[
					button(_('开始探测'), 'cbi-button-apply', function() {
						return run([ 'probe-bg' ], _('探测'));
					}),
					button(_('刷新报告'), 'cbi-button-action', function() { return refresh(); }),
					button(_('清空报告'), 'cbi-button-reset', function() {
						return fs.exec(HELPER, [ 'clear' ]).then(function() {
							pre.textContent = '（还没有报告）';
							notify(_('已清空'));
						});
					}),
					busy
				],
				_('大约 10~25 秒。它会：探测重定向找出门户地址 → 拆出 URL 参数 → 抓门户登录页的表单字段 → 判断是哪家认证系统。')),
			row(_('什么时候用'),
				[
					E('div', {}, _('换学校、换宿舍楼、学校升级了认证系统、原来的自动登录突然不好使了 —— 先跑这一步。'))
				])
		]);

		var capSection = section(_('第 2 步：抓包分析认证请求（可选，更准）'), [
			row(_('操作'),
				[
					button(_('抓包 30 秒'), 'cbi-button-action', function() {
						return run([ 'capture-bg', '30' ], _('抓包'));
					}),
					button(_('抓包 60 秒'), 'cbi-button-neutral', function() {
						return run([ 'capture-bg', '60' ], _('抓包'));
					})
				],
				_('⚠ 点了之后，马上在那台要上网的设备（手机/电脑）上用浏览器访问任意网站，把认证页面弄出来、正常登录一次 —— 这样才能抓到认证请求。')),
			row(_('抓到的内容'),
				[ E('div', {}, _('请求行、Host、User-Agent、Referer，以及 POST 表单内容；密码会自动打码，可以安全发出去。')) ])
		]);

		var outSection = section(_('报告（全选复制发出去即可）'), [
			row(_('内容'),
				[ pre ],
				_('鼠标点进下面的框 → Ctrl+A 全选 → Ctrl+C 复制，然后发给我，我据此写/改自动登录脚本。'))
		]);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('认证门户探测')),
			E('div', { 'style': 'font-weight:bold; color:#c0392b; margin:2px 0 8px' }, '作者：au学长　V：aauuo0'),
			E('div', { 'class': 'cbi-map-descr' },
				_('给「换个学校 / 换个楼栋，认证方式变了」用的工具：跑一遍，把报告发出来，就能生成对应的自动登录插件。')),
			probeSection,
			capSection,
			outSection
		]);
	}
});
