'use strict';
'require view';
'require fs';
'require poll';
'require rpc';
'require ui';

/* ------------------------------------------------------------------
 * LuCI page for netcheck -- 湖南工学院顺枫公寓自动登录插件
 *   作者：au学长    V：aauuo0
 *
 *   - start / stop / restart the daemon, show its state
 *   - change USERNAME / PASSWORD in /etc/auth.conf
 *   - change CHECK_INTERVAL / COOLDOWN / LOG_KEEP_DAYS
 *   - one click "test login" with the raw auth.sh output
 *   - view / clear the log
 * ------------------------------------------------------------------ */

var AUTH_CONF = '/etc/auth.conf';
var NET_CONF  = '/etc/netcheck.conf';
var INIT      = '/etc/init.d/netcheck';
var LIVE_LOG  = '/tmp/netcheck.log';
var LAST_LOG  = '/tmp/auth_last.log';
var TEST_LOG  = '/tmp/netcheck_test.log';
var HELPER    = '/usr/libexec/netcheck-web';

var BRAND_LINE1 = '湖南工学院顺枫公寓自动登录插件';
var BRAND_LINE2 = '作者：au学长    V：aauuo0';

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

/* read "KEY=value" lines out of a shell style config file */
function parseKV(text) {
	var out = {};

	(text || '').split(/\n/).forEach(function(line) {
		if (/^\s*#/.test(line))
			return;

		var m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);

		if (!m)
			return;

		out[m[1]] = m[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
	});

	return out;
}

/* quote a value so that ". /etc/auth.conf" reads it back unchanged */
function shellValue(v) {
	if (/^[A-Za-z0-9._@%+,:=\/-]*$/.test(v))
		return v;

	return "'" + v.replace(/'/g, "'\\''") + "'";
}

/* replace "KEY=..." in place, or append the line when it is missing */
function setKV(text, key, value) {
	var re = new RegExp('^[ \\t]*' + key + '[ \\t]*=.*$', 'm');
	var line = '%s=%s'.format(key, shellValue(value));

	if (re.test(text))
		return text.replace(re, line);

	return text.replace(/\n*$/, '') + '\n' + line + '\n';
}

function tailLines(text, count) {
	var lines = (text || '').replace(/\s+$/, '').split(/\n/);

	if (lines.length > count)
		lines = lines.slice(lines.length - count);

	return lines.join('\n');
}

/* first running instance of the service, or null */
function activeInstance(reply) {
	var inst = reply && reply.netcheck && reply.netcheck.instances;

	if (!inst)
		return null;

	for (var name in inst)
		if (inst[name] && inst[name].running)
			return inst[name];

	return null;
}

return view.extend({
	load: function() {
		return Promise.all([
			readSafe(AUTH_CONF),
			readSafe(NET_CONF),
			readSafe(LIVE_LOG),
			readSafe(LAST_LOG),
			readSafe(TEST_LOG),
			callServiceList('netcheck').catch(function() { return {}; }),
			fs.exec(INIT, [ 'enabled' ]).then(function(res) {
				return !!(res && res.code === 0);
			}, function() {
				return null;
			})
		]);
	},

	render: function(data) {
		var authText = data[0];
		var confText = data[1];
		var conf     = parseKV(confText);
		var auth     = parseKV(authText);
		var logFile  = conf.LOG_FILE || LIVE_LOG;
		var autoRefresh = true;
		var showingLast = false;
		var testRunning = false;

		function notify(msg) {
			ui.addNotification(null, E('p', {}, msg));
		}

		/* -------------------------------------------------------- status */
		var statusText  = E('strong', {}, _('检查中…'));
		var enabledText = E('strong', {}, _('…'));
		var enabledState = null;

		function paint(inst, enabled) {
			statusText.textContent  = inst
				? '%s (PID %s)'.format(_('运行中'), inst.pid)
				: _('已停止');
			statusText.style.color  = inst ? '#3c9' : '#c33';
			enabledText.textContent = (enabled == null) ? _('未知') : (enabled ? _('是') : _('否'));
			enabledText.style.color = (enabled == null) ? '' : (enabled ? '#3c9' : '#c33');
			enabledState = enabled;
			if (btnAuto) {
				btnAuto.textContent = enabled ? _('关闭开机自启') : _('开启开机自启');
				btnAuto.className = enabled ? 'cbi-button cbi-button-reset' : 'cbi-button cbi-button-apply';
			}
		}

		function refreshStatus() {
			return Promise.all([
				callServiceList('netcheck').catch(function() { return {}; }),
				fs.exec(INIT, [ 'enabled' ]).then(function(res) {
					return !!(res && res.code === 0);
				}, function() {
					return null;
				})
			]).then(function(res) {
				paint(activeInstance(res[0]), res[1]);
			});
		}

		/* ----------------------------------------------------------- log */
		var logBox = E('pre', {
			'style': 'max-height:26em; overflow:auto; margin:0; padding:8px; ' +
				'background:#f5f5f5; border:1px solid #ccc; border-radius:3px; ' +
				'font-size:12px; line-height:1.4; white-space:pre-wrap; word-break:break-all;'
		}, '');

		function currentLogFile() {
			return showingLast ? LAST_LOG : logFile;
		}

		function refreshLog() {
			var file = currentLogFile();

			return fs.read(file).then(function(text) {
				logBox.textContent = tailLines(text, 300) || _('（暂时没有内容）');
			}, function(e) {
				logBox.textContent = _('无法读取 %s：%s').format(file, e.message);
			});
		}

		var logPathText = E('span', { 'style': 'margin-left:12px; color:#888' }, '');

		function paintLogPath() {
			logPathText.textContent = '%s: %s'.format(_('文件'), currentLogFile());
		}

		var btnLog = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-neutral', 'click': function() {
				showingLast = !showingLast;
				btnLog.textContent = showingLast ? _('显示实时日志') : _('显示上次登录详情');
				paintLogPath();

				return refreshLog();
			}
		}, _('显示上次登录详情'));

		var btnClear = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-reset', 'click': function() {
				if (!window.confirm(_('确定要清空日志吗？')))
					return;

				return fs.exec(HELPER, [ 'clear' ]).then(function() {
					notify(_('日志已清空。'));
					return refreshLog();
				}).catch(function(e) {
					notify(_('清空失败：%s').format(e.message));
				});
			}
		}, _('清空日志'));

		/* ------------------------------------------------------- actions */
		function run(action, label) {
			return fs.exec(INIT, [ action ]).then(function(res) {
				var out = ((res && res.stdout) || '') + ((res && res.stderr) || '');

				if (res && res.code !== 0)
					notify(_('%s 失败（退出码 %s）：%s').format(label, res.code, out));
				else
					notify(_('%s 完成').format(label));

				return refreshStatus();
			}).catch(function(e) {
				notify(_('%s 出错：%s').format(label, e.message));
			});
		}

		var btnStart = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-apply',
			'click': function() { return run('start', _('启动')); }
		}, _('启动'));

		var btnStop = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-reset',
			'click': function() { return run('stop', _('停止')); }
		}, _('停止'));

		var btnRestart = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-action',
			'click': function() { return run('restart', _('重启')); }
		}, _('重启'));

		var btnAuto = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-apply',
			'click': function() {
				return run(enabledState ? 'disable' : 'enable',
					enabledState ? _('关闭自启') : _('开启自启'));
			}
		}, _('开启开机自启'));

		/* ------------------------------------------------------- account */
		var userInput = E('input', { 'type': 'text', 'style': 'width:16em', 'spellcheck': 'false' }, '');
		var passInput = E('input', { 'type': 'password', 'style': 'width:16em' }, '');

		function paintAccountHints() {
			userInput.value = '';
			passInput.value = '';
			userInput.placeholder = auth.USERNAME
				? '%s %s'.format(_('当前：'), auth.USERNAME)
				: _('未设置');
			passInput.placeholder = auth.PASSWORD
				? _('已设置，留空则不修改')
				: _('未设置');
		}

		paintAccountHints();

		var saveButton = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-save', 'click': function() {
				var user = userInput.value.trim();
				var pass = passInput.value.trim();

				if (user === '' && pass === '') {
					notify(_('没有填写内容。留空表示不修改，想改哪个就填哪个。'));
					return;
				}

				if (/[\n\r]/.test(user) || /[\n\r]/.test(pass)) {
					notify(_('用户名和密码都不能包含换行符。'));
					return;
				}

				var text = authText;

				if (user !== '')
					text = setKV(text, 'USERNAME', user);

				if (pass !== '')
					text = setKV(text, 'PASSWORD', pass);

				return fs.write(AUTH_CONF, text).then(function() {
					authText = text;
					if (user !== '')
						auth.USERNAME = user;
					if (pass !== '')
						auth.PASSWORD = pass;
					paintAccountHints();
					notify(_('账号已保存。'));

					return run('restart', _('重启'));
				}).catch(function(e) {
					notify(_('保存失败：%s').format(e.message));
				});
			}
		}, _('保存账号并重启'));

		/* ------------------------------------------------------ settings */
		var intervalInput = E('input', { 'type': 'text', 'style': 'width:6em' }, '');
		var cooldownInput = E('input', { 'type': 'text', 'style': 'width:6em' }, '');
		var keepInput     = E('input', { 'type': 'text', 'style': 'width:6em' }, '');

		intervalInput.value = conf.CHECK_INTERVAL || '2';
		cooldownInput.value = conf.COOLDOWN || '6';
		keepInput.value     = conf.LOG_KEEP_DAYS || '2';

		var saveSettings = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-save', 'click': function() {
				var iv = intervalInput.value.trim();
				var cd = cooldownInput.value.trim();
				var kd = keepInput.value.trim();

				if (!/^\d+$/.test(iv) || parseInt(iv, 10) < 1) {
					notify(_('检测间隔必须是不小于 1 的整数（秒）。'));
					return;
				}

				if (!/^\d+$/.test(cd) || parseInt(cd, 10) < 0) {
					notify(_('冷却时间必须是整数（秒）。'));
					return;
				}

				if (!/^\d+$/.test(kd)) {
					notify(_('日志保留天数必须是整数（0 = 不清理）。'));
					return;
				}

				var text = confText;

				text = setKV(text, 'CHECK_INTERVAL', iv);
				text = setKV(text, 'COOLDOWN', cd);
				text = setKV(text, 'LOG_KEEP_DAYS', kd);

				return fs.write(NET_CONF, text).then(function() {
					confText = text;
					notify(_('参数已保存，正在重启服务…'));
					return run('restart', _('重启'));
				}).catch(function(e) {
					notify(_('保存失败：%s').format(e.message));
				});
			}
		}, _('保存设置并重启'));

		/* ---------------------------------------------------------- test */
		var testBox = E('pre', {
			'style': 'max-height:20em; overflow:auto; margin:8px 0 0 0; padding:8px; ' +
				'background:#fbfbfb; border:1px solid #ccc; border-radius:3px; ' +
				'font-size:12px; line-height:1.4; white-space:pre-wrap; word-break:break-all;'
		}, '');

		var btnTest = E('button', {
			'type': 'button', 'class': 'cbi-button cbi-button-action', 'click': function() {
				testRunning = true;
				testBox.textContent = _('正在测试登录，请稍候…（最多约 40 秒）');

				return fs.exec(HELPER, [ 'test' ]).then(function() {
					watchTest();
				}).catch(function(e) {
					testRunning = false;
					testBox.textContent = _('测试失败：%s').format(e.message);
				});
			}
		}, _('一键测试登录'));

		function readTest() {
			return fs.read(TEST_LOG).then(function(text) {
				text = (text || '').replace(/\s+$/, '');

				if (text === '') {
					testBox.textContent = _('还没有测试记录。点上面的按钮跑一次。');
					return;
				}

				if (/^EXIT=/m.test(text))
					testRunning = false;
				else
					testBox.textContent = text + '\n\n' + _('…测试进行中…');

				if (!testRunning)
					testBox.textContent = text;
			}, function() {
				testBox.textContent = _('还没有测试记录。点上面的按钮跑一次。');
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

		/* -------------------------------------------------------- render */
		var statusSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('运行状态')),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('服务状态')),
				E('div', { 'class': 'cbi-value-field' }, statusText)
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('开机自启')),
				E('div', { 'class': 'cbi-value-field' }, enabledText)
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('操作')),
				E('div', { 'class': 'cbi-value-field' }, [ btnStart, ' ', btnStop, ' ', btnRestart, ' ', btnAuto ])
			])
		]);

		var accountSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('账号设置')),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('用户名')),
				E('div', { 'class': 'cbi-value-field' }, [
					userInput,
					E('div', { 'class': 'cbi-value-description' },
						_('留空 = 不修改；想换账号就在这里填新的学号。'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('密码')),
				E('div', { 'class': 'cbi-value-field' }, [
					passInput,
					E('div', { 'class': 'cbi-value-description' },
						_('留空 = 不修改（出于安全，密码不会显示在页面上）。'))
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, ' '),
				E('div', { 'class': 'cbi-value-field' }, [
					saveButton,
					E('div', { 'class': 'cbi-value-description' },
						_('保存后会写入 /etc/auth.conf 并重启服务，下次断线就用新账号登录。'))
				])
			])
		]);

		var settingsSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('参数设置')),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('检测间隔')),
				E('div', { 'class': 'cbi-value-field' }, [
					intervalInput, _(' 秒（每多少秒探测一次网络，默认 2）')
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('冷却时间')),
				E('div', { 'class': 'cbi-value-field' }, [
					cooldownInput, _(' 秒（登录尝试后等多久再探测，默认 6）')
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, _('日志保留天数')),
				E('div', { 'class': 'cbi-value-field' }, [
					keepInput, _(' 天（0 = 永不自动清空，默认 2）')
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('div', { 'class': 'cbi-value-title' }, ' '),
				E('div', { 'class': 'cbi-value-field' }, [
					saveSettings,
					E('div', { 'class': 'cbi-value-description' },
						_('保存后写入 /etc/netcheck.conf 并重启服务。间隔越小越灵敏，越费 CPU。'))
				])
			])
		]);

		var testSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('一键测试登录')),
			E('div', {}, [
				btnTest,
				E('span', { 'style': 'margin-left:10px; color:#888' },
					_('立即跑一次 auth.sh，把结果原样显示在下面（不影响后台守护运行）。'))
			]),
			testBox
		]);

		var logSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('运行日志')),
			E('div', { 'style': 'margin-bottom:8px' }, [
				btnLog, ' ', btnClear,
				E('label', { 'style': 'margin-left:12px' }, [
					E('input', {
						'type': 'checkbox', 'checked': 'checked', 'change': function(ev) {
							autoRefresh = ev.target.checked;
						}
					}, ''),
					' ' + _('每 5 秒自动刷新')
				]),
				logPathText
			]),
			logBox
		]);

		/* watermark + author box ---------------------------------------- */
		var qrUrl = (L && typeof L.resource === 'function')
			? L.resource('netcheck/author.jpg')
			: '/luci-static/resources/netcheck/author.jpg';

		var watermark = E('div', {
			'style': 'position:fixed; right:10px; bottom:6px; z-index:5; pointer-events:none; ' +
				'text-align:right; line-height:1.4; font-size:11px; color:#999; opacity:0.75'
		}, [
			E('div', {}, BRAND_LINE1),
			E('div', {}, BRAND_LINE2)
		]);

		paint(activeInstance(data[5]), data[6]);
		paintLogPath();
		refreshLog();
		readTest();

		poll.add(function() {
			if (testRunning)
				watchTest();

			if (!autoRefresh || !document.body.contains(logBox))
				return Promise.resolve();

			return refreshLog().then(refreshStatus);
		}, 5);

		return E('div', { 'class': 'cbi-map au-page' }, [
			E('link', { 'rel': 'stylesheet', 'href': '/luci-static/resources/au/ui.css' }),
			E('div', { 'class': 'au-wm' }, '作者：au学长 V：aauuo0'),
			E('div', { 'class': 'au-wmc' }, '作者：au学长 V：aauuo0'),
			E('h2', {}, BRAND_LINE1),
			E('div', { 'class': 'cbi-map-descr' }, [
				BRAND_LINE2,
				E('br', {}, ''),
				_('账号为空时不会自动启动（保护）。')
			]),
			statusSection,
			accountSection,
			settingsSection,
			testSection,
			logSection,
			watermark
		]);
	}
});
