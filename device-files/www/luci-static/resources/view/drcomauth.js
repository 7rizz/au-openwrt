'use strict';
'require view';
'require fs';
'require poll';
'require rpc';
'require uci';
'require ui';

/* ------------------------------------------------------------------
 * LuCI 页面：润泽公寓自动登录（Dr.COM 哆点）
 *
 *   - 启停 / 重启后台服务，显示运行状态
 *   - 修改账号、密码、运营商后缀
 *   - 修改门户地址、端口、认证方式、巡检间隔等
 *   - 一键测试登录（强制重新认证），原样显示输出
 *   - 查看 / 清空运行日志
 * ------------------------------------------------------------------ */

var CONFIG      = 'drcomauth';
var STATUS_FILE = '/tmp/drcomauth/status.json';
var LOG_FILE    = '/tmp/drcom-auth.log';
var TEST_LOG    = '/tmp/drcom-auth-test.log';
var INIT        = '/etc/init.d/drcomauth';
var HELPER      = '/usr/libexec/drcomauth-web';

var SUFFIXES = [
	{ value: '',       label: '校园用户（无后缀）' },
	{ value: '@dx',    label: '校园电信（@dx）' },
	{ value: '@lt',    label: '校园联通（@lt）' },
	{ value: '@cmcc',  label: '移动 / 其他（@cmcc）' }
];

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function readSafe(path) {
	return fs.read(path).then(function(s) {
		return (s != null) ? s : '';
	}, function() {
		return '';
	});
}

function tailLines(text, count) {
	var lines = (text || '').replace(/\s+$/, '').split(/\n/);

	if (lines.length > count)
		lines = lines.slice(lines.length - count);

	return lines.join('\n');
}

/* 某个服务第一个 running 的实例，没有就返回 null */
function activeInstance(reply, name) {
	var inst = reply && reply[name] && reply[name].instances;

	if (!inst)
		return null;

	for (var key in inst)
		if (inst[key] && inst[key].running)
			return inst[key];

	return null;
}

function parseStatus(text) {
	try {
		return JSON.parse(text || '{}') || {};
	} catch (e) {
		return {};
	}
}

function stateLabel(state) {
	switch (state) {
	case 'online':  return _('在线（已跳过登录）');
	case 'success': return _('登录成功');
	case 'fail':    return _('登录失败');
	case 'error':   return _('配置 / 网络错误');
	default:        return _('尚未运行');
	}
}

function stateColor(state) {
	switch (state) {
	case 'online':
	case 'success': return '#2f9e44';
	case 'fail':    return '#c92a2a';
	case 'error':   return '#e67700';
	default:        return '#868e96';
	}
}

function fmtTime(ts) {
	if (!ts)
		return '—';

	try {
		return new Date(ts * 1000).toLocaleString();
	} catch (e) {
		return '—';
	}
}

function ago(ts) {
	if (!ts)
		return '';

	var sec = Math.max(0, Math.floor(Date.now() / 1000 - ts));

	if (sec < 60)
		return '%s 秒前'.format(sec);
	if (sec < 3600)
		return '%s 分钟前'.format(Math.floor(sec / 60));
	if (sec < 86400)
		return '%s 小时前'.format(Math.floor(sec / 3600));

	return '%s 天前'.format(Math.floor(sec / 86400));
}

function normalizeSuffix(value) {
	value = (value || '').trim();

	if (value !== '' && value.charAt(0) !== '@')
		value = '@' + value;

	return value;
}

return view.extend({
	load: function() {
		return Promise.all([
			uci.load(CONFIG),
			readSafe(STATUS_FILE),
			callServiceList('drcomauth').catch(function() { return {}; }),
			fs.exec(INIT, [ 'enabled' ]).then(function(res) {
				return !!(res && res.code === 0);
			}, function() {
				return null;
			}),
			readSafe(LOG_FILE),
			readSafe(TEST_LOG)
		]);
	},

	render: function(data) {
		function cfg(name, def) {
			var value = uci.get(CONFIG, 'main', name);

			return (value != null && value !== '') ? value : def;
		}

		function cfgRaw(name, def) {
			var value = uci.get(CONFIG, 'main', name);

			return (value != null) ? value : def;
		}

		function notify(msg) {
			ui.addNotification(null, E('p', {}, msg));
		}

		/* ------------------------------------------------------ 状态 */
		var svcText     = E('strong', {}, _('检查中…'));
		var enabledText = E('strong', {}, _('…'));
		var authText    = E('strong', { 'style': 'font-size:15px' }, _('检查中…'));
		var msgText     = E('span', { 'style': 'color:#555; word-break:break-all' }, '');
		var timeText    = E('span', {}, '—');
		var wanText     = E('span', { 'style': 'font-family:monospace' }, '—');

		var enabledState = !!data[3];

		function paintService(inst, enabled) {
			enabledState = enabled;

			svcText.textContent = inst
				? _('运行中（PID %s）').format(inst.pid || '?')
				: _('已停止');
			svcText.style.color = inst ? '#2f9e44' : '#c92a2a';

			enabledText.textContent = (enabled == null)
				? _('未知')
				: (enabled ? _('是') : _('否'));
			enabledText.style.color = (enabled == null)
				? ''
				: (enabled ? '#2f9e44' : '#c92a2a');

			btnAuto.textContent = enabled ? _('关闭开机自启') : _('开启开机自启');
			btnAuto.className = enabled
				? 'cbi-button cbi-button-reset'
				: 'cbi-button cbi-button-apply';
		}

		function paintStatus(st) {
			var state = st.state || '';

			authText.textContent = stateLabel(state);
			authText.style.color = stateColor(state);

			msgText.textContent = st.message || _('服务还没跑过；点下面的“一键测试登录”或启动服务。');

			timeText.textContent = st.ts
				? '%s（%s）'.format(fmtTime(st.ts), ago(st.ts))
				: '—';

			wanText.textContent = (st.iface || st.ip || st.mac)
				? '%s   %s   %s'.format(st.iface || '—', st.ip || '—', st.mac || '—')
				: '—';
		}

		function refreshStatus() {
			return Promise.all([
				readSafe(STATUS_FILE),
				callServiceList('drcomauth').catch(function() { return {}; }),
				fs.exec(INIT, [ 'enabled' ]).then(function(res) {
					return !!(res && res.code === 0);
				}, function() {
					return null;
				})
			]).then(function(res) {
				paintStatus(parseStatus(res[0]));
				paintService(activeInstance(res[1], 'drcomauth'), res[2]);
			});
		}

		/* ------------------------------------------------------ 操作 */
		function runInit(action, label) {
			return fs.exec(INIT, [ action ]).then(function(res) {
				var out = ((res && res.stdout) || '') + ((res && res.stderr) || '');

				if (res && res.code !== 0)
					notify(_('%s 失败（退出码 %s）：%s').format(label, res.code, out));
				else
					notify(_('%s 完成').format(label));

				window.setTimeout(refreshStatus, 1200);
				return refreshStatus();
			}).catch(function(e) {
				notify(_('%s 出错：%s').format(label, e.message));
			});
		}

		var btnStart = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-apply',
			'click': function() { return runInit('start', _('启动')); }
		}, _('启动'));

		var btnStop = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-reset',
			'click': function() { return runInit('stop', _('停止')); }
		}, _('停止'));

		var btnRestart = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-action',
			'click': function() { return runInit('restart', _('重启')); }
		}, _('重启'));

		var btnAuto = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-neutral',
			'click': function() {
				var action = enabledState ? 'disable' : 'enable';
				var label  = enabledState ? _('关闭开机自启') : _('开启开机自启');

				return fs.exec(INIT, [ action ]).then(function() {
					notify(_('%s 完成').format(label));
					return refreshStatus();
				}).catch(function(e) {
					notify(_('操作失败：%s').format(e.message));
				});
			}
		}, _('开启开机自启'));

		/* ------------------------------------------------------ 账号 */
		var username = cfg('username', '');
		var isp      = cfgRaw('isp', '');
		var prefix   = cfg('prefix', ',0,');
		var hasPass  = !!cfgRaw('password', '');

		var userInput = E('input', {
			'type': 'text', 'class': 'cbi-input-text',
			'style': 'width:18em', 'spellcheck': 'false',
			'placeholder': _('学号 / e 卡号')
		}, '');

		var passInput = E('input', {
			'type': 'password', 'class': 'cbi-input-password',
			'style': 'width:18em',
			'placeholder': hasPass ? _('已设置，留空不修改') : _('未设置')
		}, '');

		userInput.value = '';
		userInput.placeholder = username
			? _('当前：%s').format(username)
			: _('学号 / e 卡号');

		var ispSelect = E('select', { 'class': 'cbi-input-select' }, []);

		SUFFIXES.forEach(function(item) {
			ispSelect.appendChild(E('option', { 'value': item.value }, item.label));
		});
		ispSelect.appendChild(E('option', { 'value': '__custom__' }, _('其它 / 自定义后缀')));

		var customWrap = E('span', { 'style': 'margin-left:8px; display:none' }, [
			E('input', {
				'type': 'text', 'class': 'cbi-input-text',
				'style': 'width:8em', 'spellcheck': 'false',
				'placeholder': _('例如 @cmcc')
			}, '')
		]);
		var customInput = customWrap.firstChild;

		var known = SUFFIXES.map(function(item) { return item.value; });

		if (known.indexOf(isp) >= 0) {
			ispSelect.value = isp;
		} else {
			ispSelect.value = '__custom__';
			customInput.value = isp;
			customWrap.style.display = '';
		}

		var accountHint = E('span', { 'style': 'opacity:.7; font-family:monospace' }, '');

		function currentSuffix() {
			if (ispSelect.value === '__custom__')
				return normalizeSuffix(customInput.value);

			return ispSelect.value;
		}

		function paintAccountHint() {
			var user = userInput.value.trim() || username || _('学号');
			var pfx  = prefixInput.value.trim() || ',0,';

			accountHint.textContent = '%s%s%s'.format(pfx, user, currentSuffix());
		}

		function syncSuffix() {
			customWrap.style.display = (ispSelect.value === '__custom__') ? '' : 'none';
			paintAccountHint();
		}

		ispSelect.addEventListener('change', syncSuffix);
		customInput.addEventListener('input', paintAccountHint);
		userInput.addEventListener('input', paintAccountHint);

		function saveAccount() {
			var user = userInput.value.trim() || username;
			var pass = passInput.value;
			var suffix = currentSuffix();

			if (!user) {
				notify(_('请填学号 / 账号。'));
				return;
			}

			if (/[\r\n]/.test(user) || /[\r\n]/.test(pass)) {
				notify(_('账号和密码不能包含换行符。'));
				return;
			}

			if (!pass && !hasPass) {
				notify(_('这是第一次配置，请填写密码。'));
				return;
			}

			if (suffix !== '' && !/^@?[A-Za-z0-9._-]+$/.test(suffix)) {
				notify(_('运营商后缀只能包含字母、数字、点、下划线和减号。'));
				return;
			}

			uci.set(CONFIG, 'main', 'username', user);
			uci.set(CONFIG, 'main', 'isp', suffix);

			if (pass !== '')
				uci.set(CONFIG, 'main', 'password', pass);

			return uci.save().then(function() {
				return uci.apply();
			}).then(function() {
				return fs.exec(HELPER, [ 'fixperm' ]).catch(function() {});
			}).then(function() {
				username = user;
				hasPass = hasPass || pass !== '';
				passInput.value = '';
				passInput.placeholder = _('已设置，留空不修改');
				notify(_('账号已保存，正在重启服务…'));
				return runInit('restart', _('重启服务'));
			}).catch(function(e) {
				notify(_('保存失败：%s').format(e.message));
			});
		}

		var btnSaveAccount = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-save',
			'click': saveAccount
		}, _('保存账号并重启'));

		/* ------------------------------------------------------ 参数 */
		var portalInput = E('input', {
			'type': 'text', 'class': 'cbi-input-text',
			'style': 'width:14em', 'spellcheck': 'false'
		}, '');
		portalInput.value = cfg('portal', '10.255.224.4');

		var portInput = E('input', {
			'type': 'text', 'class': 'cbi-input-text', 'style': 'width:6em'
		}, '');
		portInput.value = cfg('port', '801');

		var schemeSelect = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'http' }, 'http'),
			E('option', { 'value': 'https' }, 'https')
		]);
		schemeSelect.value = cfg('scheme', 'http');

		var intervalInput = E('input', {
			'type': 'text', 'class': 'cbi-input-text', 'style': 'width:6em'
		}, '');
		intervalInput.value = cfg('interval', '60');

		var modeSelect = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'aes' }, _('AES 加密（和门户一致，推荐）')),
			E('option', { 'value': 'legacy' }, _('明文兼容（无需 openssl）'))
		]);
		modeSelect.value = cfg('mode', 'aes');

		var macSourceSelect = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'wan' }, _('本机 WAN 口 MAC（推荐）')),
			E('option', { 'value': 'portal' }, _('门户返回的 olmac'))
		]);
		macSourceSelect.value = cfg('mac_source', 'wan');

		var prefixInput = E('input', {
			'type': 'text', 'class': 'cbi-input-text',
			'style': 'width:8em', 'spellcheck': 'false'
		}, '');
		prefixInput.value = cfg('prefix', ',0,');
		prefixInput.addEventListener('input', paintAccountHint);

		var wanInput = E('input', {
			'type': 'text', 'class': 'cbi-input-text',
			'style': 'width:10em', 'spellcheck': 'false',
			'placeholder': _('留空自动（默认路由接口）')
		}, '');
		wanInput.value = cfg('wan_if', '');

		var onlineInput = E('input', {
			'type': 'text', 'class': 'cbi-input-text',
			'style': 'width:100%; max-width:34em', 'spellcheck': 'false'
		}, '');
		onlineInput.value = cfg('online_url', 'http://connect.rom.miui.com/generate_204');

		var debugInput = E('input', { 'type': 'checkbox' }, '');
		debugInput.checked = cfg('debug', '0') === '1';

		function saveSettings() {
			var portal = portalInput.value.trim();
			var port   = portInput.value.trim();
			var iv     = intervalInput.value.trim();
			var wan    = wanInput.value.trim();
			var online = onlineInput.value.trim();
			var pfx    = prefixInput.value.trim();

			if (!/^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(portal) &&
			    !/^[0-9a-fA-F:]+$/.test(portal)) {
				notify(_('门户地址只能填 IP 或域名，不要带 http://。'));
				return;
			}

			if (!/^\d+$/.test(port) || parseInt(port, 10) < 1 || parseInt(port, 10) > 65535) {
				notify(_('端口必须是 1~65535 的整数。'));
				return;
			}

			if (!/^\d+$/.test(iv) || parseInt(iv, 10) < 10 || parseInt(iv, 10) > 3600) {
				notify(_('巡检间隔必须是 10~3600 的整数（秒）。'));
				return;
			}

			if (wan !== '' && !/^[A-Za-z0-9_.:@-]+$/.test(wan)) {
				notify(_('WAN 接口名不合法。'));
				return;
			}

			if (!/^https?:\/\/\S+$/.test(online)) {
				notify(_('在线检测地址必须以 http:// 或 https:// 开头。'));
				return;
			}

			if (pfx !== '' && /[\r\n]/.test(pfx)) {
				notify(_('账号前缀不能包含换行符。'));
				return;
			}

			uci.set(CONFIG, 'main', 'portal', portal);
			uci.set(CONFIG, 'main', 'port', port);
			uci.set(CONFIG, 'main', 'scheme', schemeSelect.value);
			uci.set(CONFIG, 'main', 'interval', iv);
			uci.set(CONFIG, 'main', 'mode', modeSelect.value);
			uci.set(CONFIG, 'main', 'mac_source', macSourceSelect.value);
			uci.set(CONFIG, 'main', 'prefix', pfx);
			uci.set(CONFIG, 'main', 'wan_if', wan);
			uci.set(CONFIG, 'main', 'online_url', online);
			uci.set(CONFIG, 'main', 'debug', debugInput.checked ? '1' : '0');

			return uci.save().then(function() {
				return uci.apply();
			}).then(function() {
				return fs.exec(HELPER, [ 'fixperm' ]).catch(function() {});
			}).then(function() {
				notify(_('参数已保存，正在重启服务…'));
				return runInit('restart', _('重启服务'));
			}).catch(function(e) {
				notify(_('保存失败：%s').format(e.message));
			});
		}

		var btnSaveSettings = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-save',
			'click': saveSettings
		}, _('保存参数并重启'));

		/* ------------------------------------------------------ 测试 */
		var testRunning = false;
		var testBox = E('pre', {
			'style': 'max-height:22em; overflow:auto; margin:10px 0 0 0; padding:10px; ' +
				'background:rgba(127,140,170,.10); border:1px solid rgba(128,146,184,.28); border-radius:10px; ' +
				'font-size:12px; line-height:1.45; white-space:pre-wrap; word-break:break-all;'
		}, '');

		function readTest() {
			return readSafe(TEST_LOG).then(function(text) {
				text = (text || '').replace(/\s+$/, '');

				if (text === '') {
					testBox.textContent = _('还没有测试记录。点上面的按钮跑一次。');
					return;
				}

				if (/^EXIT=\d+/m.test(text)) {
					testRunning = false;
					testBox.textContent = text;
				} else {
					testBox.textContent = text + '\n\n' + _('…测试进行中…');
				}
			});
		}

		function watchTest() {
			if (!document.body.contains(testBox))
				return;

			readTest().then(function() {
				if (testRunning)
					window.setTimeout(watchTest, 1500);
			});
		}

		var btnTest = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-action',
			'click': function() {
				testRunning = true;
				testBox.textContent = _('正在测试登录，请稍候…（最多约 40 秒）');

				return fs.exec(HELPER, [ 'test' ]).then(function() {
					window.setTimeout(watchTest, 1200);
				}).catch(function(e) {
					testRunning = false;
					testBox.textContent = _('测试失败：%s').format(e.message);
				});
			}
		}, _('一键测试登录'));

		/* ------------------------------------------------------ 日志 */
		var autoRefresh = true;
		var logBox = E('pre', {
			'style': 'max-height:24em; overflow:auto; margin:10px 0 0 0; padding:10px; ' +
				'background:rgba(127,140,170,.10); border:1px solid rgba(128,146,184,.28); border-radius:10px; ' +
				'font-size:12px; line-height:1.45; white-space:pre-wrap; word-break:break-all;'
		}, '');

		function refreshLog() {
			return readSafe(LOG_FILE).then(function(text) {
				logBox.textContent = tailLines(text, 300) || _('（暂时没有内容）');
			});
		}

		var btnClear = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-reset',
			'click': function() {
				if (!window.confirm(_('确定清空运行日志和测试日志吗？')))
					return;

				return fs.exec(HELPER, [ 'clear' ]).then(function() {
					testRunning = false;
					notify(_('日志已清空。'));
					return Promise.all([ refreshLog(), readTest() ]);
				}).catch(function(e) {
					notify(_('清空失败：%s').format(e.message));
				});
			}
		}, _('清空日志'));

		/* ------------------------------------------------------ 渲染 */
		var statusSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('运行状态')),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('后台服务')),
				E('div', { 'class': 'cbi-value-field' }, [
					svcText,
					E('span', { 'style': 'margin-left:18px' }, _('开机自启：')),
					enabledText,
					E('span', { 'style': 'margin-left:18px' }, [
						btnStart, ' ', btnStop, ' ', btnRestart, ' ', btnAuto
					])
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('认证状态')),
				E('div', { 'class': 'cbi-value-field' }, [ authText ])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('最近消息')),
				E('div', { 'class': 'cbi-value-field' }, [ msgText ])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('最近检查')),
				E('div', { 'class': 'cbi-value-field' }, [ timeText ])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('WAN 接口 / IP / MAC')),
				E('div', { 'class': 'cbi-value-field' }, [ wanText ])
			])
		]);

		var accountSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('账号设置')),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('学号 / 账号')),
				E('div', { 'class': 'cbi-value-field' }, [
					userInput,
					E('div', { 'class': 'cbi-value-description' },
						_('门户网页登录用的学号，不带运营商后缀'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('密码')),
				E('div', { 'class': 'cbi-value-field' }, [
					passInput,
					E('div', { 'class': 'cbi-value-description' },
						_('留空 = 不修改'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('运营商')),
				E('div', { 'class': 'cbi-value-field' }, [
					ispSelect,
					customWrap,
					E('div', { 'class': 'cbi-value-description' },
						_('留空 / @dx / @lt / @cmcc'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('实际提交账号')),
				E('div', { 'class': 'cbi-value-field' }, [
					accountHint,
					E('div', { 'class': 'cbi-value-description' },
						_('前缀 + 账号 + 后缀'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, ' '),
				E('div', { 'class': 'cbi-value-field' }, [ btnSaveAccount ])
			])
		]);

		var settingsSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('认证参数')),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('门户地址')),
				E('div', { 'class': 'cbi-value-field' }, [
					schemeSelect, ' ', portalInput, ' : ', portInput,
					E('div', { 'class': 'cbi-value-description' },
						_('默认 10.255.224.4:801'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('巡检间隔')),
				E('div', { 'class': 'cbi-value-field' }, [
					intervalInput, _(' 秒'),
					E('div', { 'class': 'cbi-value-description' },
						_('10~3600 秒，默认 60'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('认证方式')),
				E('div', { 'class': 'cbi-value-field' }, [
					modeSelect,
					E('div', { 'class': 'cbi-value-description' },
						_('没有 openssl 就选「明文兼容」'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('账号前缀')),
				E('div', { 'class': 'cbi-value-field' }, [
					prefixInput,
					E('div', { 'class': 'cbi-value-description' },
						_('默认 ,0,'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, ' '),
				E('div', { 'class': 'cbi-value-field' }, [ btnSaveSettings ])
			])
		]);

		var testSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('测试登录')),
			E('div', {}, [
				btnTest,
				E('span', { 'style': 'margin-left:12px; opacity:.65' },
					_('强制跑一次完整认证'))
			]),
			E('div', { 'class': 'cbi-value-description', 'style': 'margin-top:6px' },
				_('要验证密码是否正确，先断开一次再测')),
			testBox
		]);

		var logSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('运行日志')),
			E('div', { 'style': 'margin-bottom:6px' }, [
				btnClear,
				E('label', { 'style': 'margin-left:14px' }, [
					E('input', {
						'type': 'checkbox', 'checked': 'checked',
						'change': function(ev) { autoRefresh = ev.target.checked; }
					}, ''),
					' ' + _('每 5 秒自动刷新')
				]),
				E('span', { 'style': 'margin-left:14px; opacity:.6' },
					_('文件：%s').format(LOG_FILE))
			]),
			logBox
		]);


		/* ------------------------------------------------------ 初始化 */
		paintService(activeInstance(data[2], 'drcomauth'), data[3]);
		paintStatus(parseStatus(data[1]));
		paintAccountHint();
		refreshLog();
		readTest();

		poll.add(function() {
			if (testRunning)
				watchTest();

			if (!document.body.contains(logBox))
				return Promise.resolve();

			return refreshStatus().then(function() {
				if (autoRefresh)
					return refreshLog();
			});
		}, 5);

		return E('div', { 'class': 'cbi-map au-page' }, [
			E('link', { 'rel': 'stylesheet', 'href': '/luci-static/resources/au/ui.css' }),
			E('div', { 'class': 'au-wm' }, '作者：au学长 V：aauuo0'),
			E('div', { 'class': 'au-wmc' }, '作者：au学长 V：aauuo0'),
			E('h2', {}, _('润泽公寓自动登录（Dr.COM 哆点）')),
			E('div', { 'class': 'cbi-map-descr' }, _('账号为空时不会登录；掉线后自动重登。')),
			statusSection,
			accountSection,
			settingsSection,
			testSection,
			logSection
		]);
	}
});
