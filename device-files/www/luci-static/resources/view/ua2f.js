'use strict';
'require view';
'require fs';
'require ui';
'require poll';

var HELPER = '/usr/libexec/ua2f-web';

function parseKV(t) {
	var o = {};
	(t || '').split(/\n/).forEach(function (l) {
		var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(l);
		if (m) o[m[1]] = m[2];
	});
	return o;
}

function run(action, label) {
	return fs.exec(HELPER, [ action ]).then(function () {
		ui.addNotification(null, E('p', _('已执行：%s，界面会自动刷新').format(label)));
	}, function (e) {
		ui.addNotification(null, E('p', _('执行失败：%s').format(e.message || e)));
	});
}

var PRESETS = [ 'windows', 'iphone', 'android', 'mac' ];

/* UA 是否真的被改写了，用这几个站验证（走路由器出去，所以看到的就是改写后的 UA） */
var CHECK_SITES = [
	{ label: 'ua-check.stagoh.com', url: 'http://ua-check.stagoh.com/' },
	{ label: 'ua.233996.xyz',       url: 'http://ua.233996.xyz/' },
	{ label: 'useragent.buyaocha.com', url: 'https://useragent.buyaocha.com/' }
];

function personaOf(ua) {
	if (!ua) return 'windows';                     /* 默认 Windows 人格 */
	return PRESETS.filter(function (p) {
		return (ua || '').indexOf(p === 'windows' ? 'Windows NT' :
			p === 'iphone' ? 'iPhone' : p === 'android' ? 'Android' : 'Macintosh') >= 0;
	})[0] || 'custom';
}

return view.extend({
	load: function () {
		return fs.exec(HELPER, [ 'status' ]).then(function (r) { return parseKV(r.stdout); });
	},

	render: function (st) {
		var self = this;

		function statusText() {
			if (st.running === '1')
				return E('span', { style: 'color:#3c9' },
					_('正在运行') + '（pid ' + (st.pid || '-') + '，' + (st.mode || '?') +
					'，端口 ' + (st.port || '?') + '）');
			return E('span', { style: 'color:#c93' }, _('没有运行'));
		}

		var page = E([
			E('h2', {}, _('UA2F 防检测')),
			E('p', { 'class': 'cbi-section-descr' },
				_('UA2F 通过 NFQUEUE 改掉 HTTP 请求里的 User-Agent，让校园网看到的是统一的一台设备。')),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('运行状态')),
				E('p', {}, [ E('strong', {}, _('状态：')), statusText() ]),
				E('p', {}, [ E('strong', {}, _('开机自启：')), E('span', {}, st.enabled === '1' ? _('是') : _('否')) ]),
				E('p', {}, [ E('strong', {}, _('内核规则：')), E('span', {}, st.rules === '1' ? _('已下发（NFQUEUE 生效中）') : _('未下发')) ]),
				E('p', {}, [ E('strong', {}, _('伪装 UA：')), E('span', {}, st.ua || _('（内置：Fwords）')) ])
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('操控')),
				E('p', {}, [ E('strong', {}, _('检测 UA2F 是否生效：')) ]),
				E('p', { 'class': 'cbi-section-descr' },
					_('在连着这台路由器的手机/电脑上打开下面的站，显示的 UA 应该是你上面选的人格（默认 Windows），不是设备的真实 UA。')),
				E('div', {}, CHECK_SITES.map(function (s) {
					return E('a', {
						'href': s.url, 'target': '_blank', 'rel': 'noopener noreferrer',
						'class': 'btn cbi-button', 'style': 'margin-right:6px'
					}, s.label + ' ↗');
				})),
				E('p', {}, [ E('strong', {}, _('伪装人格：')) ]),
				E('div', {}, PRESETS.map(function (p) {
					return E('button', {
						'class': 'btn cbi-button' + (personaOf(st.ua) === p ? ' cbi-button-apply' : ''),
						'click': ui.createHandlerFn(self, function () {
							return fs.exec(HELPER, [ 'ua_' + p ]).then(function (r) {
								return fs.exec(HELPER, [ 'set', 'custom_ua', (r.stdout || '').trim() ]);
							}).then(function () {
								ui.addNotification(null, E('p', _('人格已切换为 %s（已重启 UA2F）').format(p)));
							});
						})
					}, p === 'windows' ? _('Windows（默认）') : p);
				})),
				E('p', {}, [ E('strong', {}, _('自定义 UA：')) ]),
				E('input', { 'id': 'ua2f-ua', 'type': 'text', 'style': 'width:80%',
					'value': st.ua || '', 'placeholder': _('留空 = Windows 人格') }),
				E('button', { 'class': 'btn cbi-button cbi-button-save', 'click': ui.createHandlerFn(self, function () {
					return fs.exec(HELPER, [ 'set', 'custom_ua', document.getElementById('ua2f-ua').value ]);
				}) }, _('保存 UA')),
				E('hr'),
				E('p', {}, [ E('strong', {}, _('开关：')) ]),
				E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(self, function () { return run('ttl_on', _('固定 TTL=64')); }) }, _('固定 TTL')),
				E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(self, function () { return run('ttl_off', _('取消固定 TTL')); }) }, _('取消 TTL')),
				E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(self, function () {
					return fs.exec(HELPER, [ 'set', 'handle_fw', st.handle_fw === '1' ? '0' : '1' ]).then(function () {
						ui.addNotification(null, E('p', _('已切换「管转发流量」并重启 UA2F')));
					});
				}) }, _('管转发（点一下切换）')),
				E('button', { 'class': 'btn cbi-button', 'click': ui.createHandlerFn(self, function () {
					return fs.exec(HELPER, [ 'set', 'intranet', st.intranet === '1' ? '0' : '1' ]).then(function () {
						ui.addNotification(null, E('p', _('已切换「管内网设备」并重启 UA2F')));
					});
				}) }, _('管内网（点一下切换）')),
				E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': ui.createHandlerFn(self, function () {
					return fs.exec(HELPER, [ 'check' ]).then(function (r) {
						ui.addNotification(null, E('pre', {}, (r.stdout || '')), _('自检结果'));
					});
				}) }, _('一键自检')),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', { 'class': 'btn cbi-button cbi-button-apply', 'click': ui.createHandlerFn(self, function () { return run('start', _('启动 UA2F')); }) }, _('启动')),
					E('button', { 'class': 'btn cbi-button cbi-button-reset', 'click': ui.createHandlerFn(self, function () { return run('restart', _('重启 UA2F')); }) }, _('重启')),
					E('button', { 'class': 'btn cbi-button cbi-button-negative', 'click': ui.createHandlerFn(self, function () { return run('stop', _('停止 UA2F')); }) }, _('停止')),
					E('button', { 'class': 'btn cbi-button cbi-button-action', 'click': ui.createHandlerFn(self, function () { return run('disable', _('停用并取消自启')); }) }, _('停用'))
				])
			]),

			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('最近日志')),
				E('pre', { 'id': 'ua2f-log', style: 'max-height:220px;overflow:auto' },
					E('em', {}, _('正在读取…')))
			])
		]);

		function refreshLog() {
			return fs.exec(HELPER, [ 'log' ]).then(function (r) {
				var el = document.getElementById('ua2f-log');
				if (el) { el.textContent = (r.stdout || '').trim() || _('（没有日志）'); el.scrollTop = el.scrollHeight; }
			});
		}

		refreshLog();
		poll.add(function () {
			return Promise.all([
				fs.exec(HELPER, [ 'status' ]).then(function (r) {
					st = parseKV(r.stdout);
					var el = document.querySelector('#ua2f-status');
					if (el) el.innerHTML = '';
				}),
				refreshLog()
			]);
		}, 5);

		return page;
	}
});
