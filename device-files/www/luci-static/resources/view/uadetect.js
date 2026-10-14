'use strict';
'require view';
'require fs';
'require ui';
'require poll';

/* ------------------------------------------------------------------
 * UA 防检测中心（JS 版，排版和「顺枫公寓自动登录」保持一致）
 *
 *   - 引擎：UA2F（UA2F 已弃用并从固件里移除）
 *   - 伪装人格（统一 UA + TTL）、检测对策、进阶开关
 *   - UA 自检入口
 *
 *   后端只有一个固定入口：/usr/libexec/uadetect-web
 *   （网页拿不到 shell，只能调它暴露的那几个动作）
 * ------------------------------------------------------------------ */

var HELPER = '/usr/libexec/uadetect-web';

var BRAND = '破解校园网专用固件 by au私人定制 微信：aauuo0';

var CHECK_SITES = [
	{ 'label': 'ua-check.stagoh.com', 'url': 'http://ua-check.stagoh.com/' },
	{ 'label': 'ua.233996.xyz',       'url': 'http://ua.233996.xyz/' }
];

/* 把 "KEY=value" 输出读成对象 */
function parseKV(text) {
	var out = {};

	(text || '').split(/\n/).forEach(function(line) {
		if (/^\s*#/.test(line))
			return;

		var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);

		if (m)
			out[m[1]] = m[2];
	});

	return out;
}

return view.extend({
	/* 本页每个开关都是点一下立即生效，所以不要 LuCI 自带的那排
	   Save & Apply / 保存 / Reset 底部按钮 */
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return fs.exec(HELPER, [ 'status' ]).then(function(res) {
			return parseKV((res && res.stdout) || '');
		}, function() {
			return {};
		});
	},

	render: function(st) {
		st = st || {};

		function notify(msg) {
			ui.addNotification(null, E('p', {}, msg));
		}

		/* ------------------------------------------------ 后端交互 */
		function refresh() {
			return fs.exec(HELPER, [ 'status' ]).then(function(res) {
				st = parseKV((res && res.stdout) || '');
				paint();
			}, function() {});
		}

		/* verify：动作执行后再读一次状态，检查是不是真的变了。
		   如果命令返回成功但状态没变，直接弹红字提示，避免"点了没反应"却看不出来。 */
		function run(args, label, verify) {
			return fs.exec(HELPER, args).then(function(res) {
				var out = ((res && res.stdout) || '') + ((res && res.stderr) || '');
				var tail = out ? ' ｜ ' + out.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') : '';

				if (res && res.code !== 0) {
					ui.addNotification(null, E('p', {},
						_('%s失败（退出码 %s）%s').format(label, res.code, tail)), 'error');
					return refresh();
				}

				return refresh().then(function() {
					if (verify && !verify()) {
						ui.addNotification(null, E('p', {},
							_('%s：命令跑完了，但状态没变成预期值%s。请在 SSH 里执行 ' +
							  'ua-detect-ctl status 和 uci show uadetect 看原因').format(label, tail)), 'error');
						return;
					}

					notify(_('%s完成').format(label));
				});
			}).catch(function(e) {
				ui.addNotification(null, E('p', {}, _('%s出错：%s').format(label, e.message)), 'error');
			});
		}

		/* ------------------------------------------------ 小组件 */
		function button(text, cls, fn) {
			return E('button', {
				'type': 'button', 'class': 'cbi-button ' + cls, 'click': fn
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

		/* ------------------------------------------------ 引擎状态 */
		/* UA2F 已弃用（24.10 上跑不通），面板只保留 UA2F */
		var ENG = [ 'ua2f' ];
		var engState = {}, engBtn = {};

		ENG.forEach(function(k) {
			engState[k] = E('strong', { 'style': 'margin-left:10px' }, '…');
			engBtn[k]   = E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-neutral' }, '…');
		});

		var allBtn   = E('button', { 'type': 'button', 'class': 'cbi-button cbi-button-neutral' }, '…');
		var allState = E('strong', { 'style': 'margin-left:10px' }, '…');

		/* 选择类（人格 / TTL） */
		var choiceBtn = { 'persona': {}, 'ttl': {} };
		var PERSONA = [
			{ 'k': 'iphone',  'label': 'iPhone（TTL 64）' },
			{ 'k': 'android', 'label': 'Android（TTL 64）' },
			{ 'k': 'windows', 'label': 'Windows（TTL 128）' }
		];
		var TTL = [ '64', '128' ];

		PERSONA.forEach(function(p) {
			choiceBtn.persona[p.k] = button(p.label, 'cbi-button-neutral', function() {
				return run([ 'persona', p.k ], _('切换人格'),
					function() { return st.persona === p.k; });
			});
		});

		TTL.forEach(function(v) {
			choiceBtn.ttl[v] = button(v, 'cbi-button-neutral', function() {
				return run([ 'ttl', v ], _('设置 TTL'),
					function() { return st.ttl === v; });
			});
		});

		var ttlNow = E('span', { 'style': 'margin-left:10px; color:#888' }, '');
		var personaNow = E('span', { 'style': 'margin-left:10px; color:#888' }, '');

		/* 开关类 */
		var SWITCHES = [
			{ 'k': 'handle_firewall', 'title': _('自动配置防火墙'),     'descr': _('固定 TTL + 劫持 NTP 统一时钟，建议开启') },
			{ 'k': 'l3_tcpts',        'title': _('清除 TCP 时间戳'),    'descr': _('防时钟偏移检测（仅 UA2F 生效）') },
			{ 'k': 'l3_ipid',         'title': _('IPID 归零'),          'descr': _('（仅 UA2F 生效）') },
			{ 'k': 'block_quic',      'title': _('阻断 QUIC'),          'descr': _('重武器，可能拖慢网络，默认关闭（仅 UA2F 生效）') }
		];

		var swBtn = {}, swState = {};

		SWITCHES.forEach(function(s) {
			swState[s.k] = E('strong', { 'style': 'margin-left:10px' }, '…');
			swBtn[s.k]   = button(_('启用'), 'cbi-button-apply', function() {
				var on = (st[s.k] === '1');
				return run([ 'set', s.k, on ? '0' : '1' ],
					on ? _('关闭「%s」').format(s.title) : _('开启「%s」').format(s.title),
					function() { return (st[s.k] === '1') === !on; });
			});
		});

		/* ------------------------------------------------ 刷新界面 */
		function paintChoice(key, current) {
			Object.keys(choiceBtn[key]).forEach(function(k) {
				var b = choiceBtn[key][k];

				b.className = 'cbi-button ' + (k === current ? 'cbi-button-apply' : 'cbi-button-neutral');
				b.setAttribute('style', 'margin-right:6px');
			});

			if (key === 'persona') {
				var label = PERSONA.filter(function(p) { return p.k === current; })[0];
				personaNow.textContent = _('当前：%s').format(label ? label.label : current);
			}
			else {
				ttlNow.textContent = _('当前：%s').format(current);
			}
		}

		function paint() {
			var protectorOn = (st.enabled === '1');
			var act         = protectorOn ? (st.engine || 'ua2f') : '';
			var engineLive  = protectorOn && (st[act + '_running'] === '1');
			var advLive     = engineLive && (act === 'ua2f');

			ENG.forEach(function(k) {
				var name  = k.toUpperCase();
				var b     = engBtn[k];
				var s     = engState[k];
				var inst  = (st[k + '_installed'] === '1');
				var up    = (st[k + '_running'] === '1');
				var pid   = st[k + '_pid'] || '';

				if (!inst) {
					s.textContent = _('当前固件未内置 %s').format(name);
					s.style.color = '#999';
					b.textContent = _('不可用');
					b.className = 'cbi-button cbi-button-neutral';
					b.setAttribute('disabled', 'disabled');
					b.onclick = null;
					return;
				}

				b.removeAttribute('disabled');

				if (act === k) {
					s.textContent = up ? _('正在使用（PID %s）').format(pid || '?')
						: _('已启用，但服务没跑起来');
					s.style.color = up ? '#3c9' : '#c93';
					b.textContent = _('停用');
					b.className = 'cbi-button cbi-button-reset';
					b.onclick = function() {
						return run([ 'stop' ], _('停用整套防护'),
							function() { return st.enabled === '0'; });
					};
				}
				else {
					s.textContent = up ? _('运行中（未接管流量）') : _('未运行');
					s.style.color = up ? '#c93' : '#888';
					b.textContent = _('启用 %s').format(name);
					b.className = 'cbi-button cbi-button-apply';
					b.onclick = function() {
						return run([ 'use_' + k ], _('切换到 %s').format(name),
							function() { return st.enabled === '1' && st.engine === k; });
					};
				}
			});

			if (protectorOn) {
				allState.textContent = engineLive
					? _('已启用，当前引擎：%s').format(act.toUpperCase())
					: _('已启用，但引擎没跑起来（去「UA2F 高级设置」看日志）');
				allState.style.color = engineLive ? '#3c9' : '#c93';
				allBtn.textContent = _('全部停用');
				allBtn.className = 'cbi-button cbi-button-reset';
				allBtn.onclick = function() {
					return run([ 'stop' ], _('全部停用'),
						function() { return st.enabled === '0'; });
				};
			}
			else {
				allState.textContent = _('已停用（下面各开关是配置值，启用后才生效）');
				allState.style.color = '#c33';
				allBtn.textContent = _('按当前设置启用');
				allBtn.className = 'cbi-button cbi-button-apply';
				allBtn.onclick = function() {
					/* 注意：不能调 apply —— 配置里 enabled=0 时 apply 只会"按配置保持关闭"，
					   等于什么都不做。要启用就得切到配置里的那个引擎。 */
					return run([ 'use_' + (st.engine || 'ua2f') ], _('启用防护'),
						function() { return st.enabled === '1'; });
				};
			}

			paintChoice('persona', st.persona || 'iphone');
			paintChoice('ttl', st.ttl || '64');

			SWITCHES.forEach(function(s) {
				var on   = (st[s.k] === '1');
				var adv  = (s.k === 'l3_tcpts' || s.k === 'l3_ipid' || s.k === 'block_quic');
				var live = adv ? advLive : engineLive;

				swBtn[s.k].textContent = on ? _('停用') : _('启用');
				swBtn[s.k].className = 'cbi-button ' + (on ? 'cbi-button-reset' : 'cbi-button-apply');

				if (!on) {
					swState[s.k].textContent = _('已关闭');
					swState[s.k].style.color = '#888';
				}
				else if (live) {
					swState[s.k].textContent = _('已生效');
					swState[s.k].style.color = '#3c9';
				}
				else {
					swState[s.k].textContent = _('已开启（当前未生效）');
					swState[s.k].style.color = '#c93';
				}
			});
		}

		/* ------------------------------------------------ 组装页面 */
		var engineSection = section(_('引擎开关'), [
			row('UA2F',
				[ engBtn.ua2f, engState.ua2f ],
				_('改 UA + 固定 TTL + 清 TCP 时间戳 + IPID 归零')),
			row(_('整套防护'),
				[ allBtn, allState ],
				_('注意：上面的「正在使用 / 未运行」是进程状态，下面各开关显示的是配置值——' +
				  '配置只有在防护启用、引擎真正跑起来之后才生效。')),
			row(' ',
				[ span(_('规则 / 日志 / 统计页面已移除')) ])
		]);

		var checkSection = section(_('检测 UA 是否生效'), [
			row(_('自检网址'),
				CHECK_SITES.map(function(s) {
					return button(s.label, 'cbi-button-action', function() {
						window.open(s.url, '_blank');
					});
				}),
				_('用内网设备（关掉代理和 VPN）打开，页面上显示的 User-Agent 应该等于当前人格；' +
				  '如果还是设备自己的 UA，说明改写没生效。'))
		]);

		var personaSection = section(_('伪装人格（统一 UA + TTL）'), [
			row(_('所有设备对外表现为'),
				PERSONA.map(function(p) { return choiceBtn.persona[p.k]; }).concat([ personaNow ]),
				_('建议选你认证上网时用的那台设备。人格和 TTL 是配套的。')),
			row(_('固定 TTL'),
				TTL.map(function(v) { return choiceBtn.ttl[v]; }).concat([ ttlNow ]))
		]);

		var policySection = section(_('检测对策'), SWITCHES.slice(0, 4).map(function(s) {
			return row(s.title, [ swBtn[s.k], swState[s.k] ], s.descr);
		}));

		var advSection = section(_('进阶（当前引擎不支持这几项）'), [].map(function(s) {
			return row(s.title, [ swBtn[s.k], swState[s.k] ], s.descr);
		}));

		var footSection = section(' ', [
			row(' ', [
				button(_('重新应用配置'), 'cbi-button-save', function() {
					return run([ 'apply' ], _('重新应用'));
				}),
				button(_('复位成默认'), 'cbi-button-reset', function() {
					if (window.confirm(_('确定把防检测配置恢复成默认值吗？')))
						return run([ 'reset' ], _('复位'),
							function() { return st.enabled === '1'; });
				})
			], _('每次点开关都会立即生效，不需要额外保存。'))
		]);

		var watermark = E('div', {
			'style': 'position:fixed; right:10px; bottom:6px; z-index:5; pointer-events:none; ' +
				'font-size:11px; color:#999; opacity:0.75'
		}, BRAND);

		paint();

		poll.add(function() {
			if (!document.body.contains(engState.ua2f))
				return Promise.resolve();

			return refresh();
		}, 5);

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, _('UA 防检测中心')),
			E('div', { 'style': 'font-weight:bold; color:#c0392b; margin:2px 0 8px' },
				'作者：au学长　V：aauuo0'),
			E('div', { 'class': 'cbi-map-descr' },
				_('防检测引擎：UA2F —— 统一 UA + 固定 TTL + 清除 TCP 时间戳 + IPID 归零。')),
			engineSection,
			checkSection,
			personaSection,
			policySection,
			advSection,
			footSection,
			watermark
		]);
	}
});
