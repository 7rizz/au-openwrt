/* =====================================================================
   UA3F 页面美化层 · 只做装饰，不碰任何表单/接口
   by au学长 V：aauuo0

   安全策略：
     · 只在「服务 → UA3F」这一页生效（找不到 .cbi-map 或标题不是 UA3F 就直接退出）
     · 只插入新节点 + 读一个 select 的当前值，不改表单、不拦截事件
     · 全部包在 try/catch 里，任何异常都不会影响页面本来功能
   ===================================================================== */
(function () {
	'use strict';

	var AUTHOR = '作者：au学长 V：aauuo0';
	var ACCENT = '#5e72e4';

	function qs(sel, root) {
		try { return (root || document).querySelector(sel); } catch (e) { return null; }
	}

	function el(tag, cls, text) {
		var n = document.createElement(tag);
		if (cls) { n.className = cls; }
		if (text != null) { n.textContent = text; }
		return n;
	}

	/* 找到当前选中值：CBI 的 select 名字形如 cbi.ua3f.main.server_mode */
	function currentMode(map) {
		var s = qs('select[name$="server_mode"]', map);
		if (!s) { return ''; }
		var opt = s.options[s.selectedIndex];
		return opt ? (opt.textContent || opt.value || '').trim() : (s.value || '');
	}

	function addWatermark() {
		if (qs('.ua3f-wm')) { return; }
		var big = el('div', 'ua3f-wm', AUTHOR);
		var corner = el('div', 'ua3f-wm-corner', AUTHOR);
		document.body.appendChild(big);
		document.body.appendChild(corner);
	}

	function addTopbar(map, h2) {
		if (qs('.ua3f-topbar', map)) { return; }

		var bar = el('div', 'ua3f-topbar');

		var chipMode = el('span', 'ua3f-chip');
		chipMode.appendChild(el('span', 'ua3f-dot'));
		var label = el('span', null, '引擎模式：');
		var val = el('b', null, currentMode(map) || '—');
		chipMode.appendChild(label);
		chipMode.appendChild(val);

		var chipAuthor = el('span', 'ua3f-chip');
		chipAuthor.appendChild(el('span', null, AUTHOR));

		var chipTip = el('span', 'ua3f-chip');
		chipTip.appendChild(el('span', null, '改动后记得点页面底部「保存并应用」'));

		bar.appendChild(chipMode);
		bar.appendChild(chipAuthor);
		bar.appendChild(chipTip);

		/* 插到标题下面（标题在 h2 里，可能带 badge） */
		h2.parentNode.insertBefore(bar, h2.nextSibling);

		/* 模式下拉一变，顶部小标签跟着变（只是显示，不动表单） */
		var sel = qs('select[name$="server_mode"]', map);
		if (sel) {
			sel.addEventListener('change', function () {
				try { val.textContent = currentMode(map) || '—'; } catch (e) {}
			});
		}
	}

	function addBadge(h2) {
		if (qs('.ua3f-badge', h2)) { return; }
		h2.appendChild(el('span', 'ua3f-badge', '主引擎'));
	}

	function addScrollTop() {
		if (qs('.ua3f-top')) { return; }
		var btn = el('div', 'ua3f-top', '↑');
		btn.title = '回到顶部';
		btn.addEventListener('click', function () {
			try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
		});
		document.body.appendChild(btn);

		function sync() {
			try { btn.style.display = window.pageYOffset > 420 ? 'flex' : 'none'; } catch (e) {}
		}
		window.addEventListener('scroll', sync, { passive: true });
		sync();
	}

	/* 给「状态」那张表里的值加个可读性更好的等宽字体（纯样式，不读内容） */
	function markStatusTable(map) {
		var tables = map.querySelectorAll('table.cbi-section-table');
		for (var i = 0; i < tables.length; i++) {
			tables[i].setAttribute('data-ua3f-table', '1');
		}
	}

	function boot() {
		try {
			var map = document.getElementById('cbi-ua3f') || qs('.cbi-map');
			if (!map) { return; }

			var h2 = qs('h2', map);
			if (!h2 || !/UA3F/i.test(h2.textContent || '')) { return; }

			document.documentElement.classList.add('ua3f-themed');

			addWatermark();
			addBadge(h2);
			addTopbar(map, h2);
			addScrollTop();
			markStatusTable(map);
		} catch (e) {
			/* 装饰失败就静默放弃，页面功能不受影响 */
			if (window.console && console.debug) { console.debug('[ua3f-theme] skipped:', e); }
		}
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot);
	} else {
		boot();
	}
})();
