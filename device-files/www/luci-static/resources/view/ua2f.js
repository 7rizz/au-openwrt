'use strict';
'require view';

/* UA2F 防检测：内嵌独立的 CGI 页面（左侧菜单不跳走）。
   不用 fs.exec / rpcd ACL → 不会有 PermissionError。
   作者：au学长 V：aauuo0 */

return view.extend({
	render: function () {
		return E('div', { style: 'width:100%' }, [
			E('iframe', {
				'src': '/cgi-bin/ua2f',
				'style': 'width:100%;height:calc(100vh - 130px);border:0;border-radius:8px;background:#11141a',
				'loading': 'eager'
			})
		]);
	}
});
