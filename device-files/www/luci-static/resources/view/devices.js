'use strict';
'require view';

/* 连接设备：内嵌独立 CGI 页面（不经 rpcd/ACL） by au学长 V：aauuo0
 *
 * 尺寸说明：LuCI 顶部有 60px 左右的头部、内容区自己还有 padding，
 * 老写法 calc(100vh - 130px) 在窗口矮的时候会同时出现「外层滚动条 + iframe 内滚动条」，
 * 窗口高的时候下面又空一块。改成 flex 撑满可用区域 + 420px 最小高度兜底。
 */

return view.extend({
	render: function () {
		return E('div', {
			style: 'display:flex;width:100%;height:calc(100vh - 118px);min-height:420px;-webkit-overflow-scrolling:touch'
		}, [
			E('iframe', {
				'src': '/cgi-bin/devices',
				'title': '连接设备',
				'style': 'flex:1;width:100%;height:100%;border:0;border-radius:10px;' +
				         'background:#11141a;display:block',
				'loading': 'eager'
			})
		]);
	}
});