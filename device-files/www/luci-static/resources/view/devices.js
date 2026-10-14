'use strict';
'require view';

/* 连接设备：内嵌独立 CGI 页面（不经过 rpcd/ACL） by au学长 V：aauuo0 */

return view.extend({
	render: function () {
		return E('div', { style: 'width:100%' }, [
			E('iframe', {
				'src': '/cgi-bin/devices',
				'style': 'width:100%;height:calc(100vh - 130px);border:0;border-radius:8px;background:#11141a',
				'loading': 'eager'
			})
		]);
	}
});
