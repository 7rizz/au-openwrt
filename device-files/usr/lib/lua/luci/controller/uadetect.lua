-- Copyright 2026
-- UA 防检测中心 · LuCI 控制器

module("luci.controller.uadetect", package.seeall)

local fs   = require "nixio.fs"
local http = require "luci.http"
local sys  = require "luci.sys"
local disp = require "luci.dispatcher"

local ALLOWED = {
	enabled = true, engine = true, persona = true, custom_ua = true, ttl = true,
	handle_lan = true, handle_firewall = true, handle_443 = true, handle_mmtls = true,
	l3_tcpts = true, l3_ipid = true, block_quic = true,
	apply = true, save = true, reset = true,
	use_ua3f = true, use_ua2f = true, stop = true
}

function index()
	-- 页面已改成 JS 版：/www/luci-static/resources/view/uadetect.js
	-- 这里不再注册任何菜单，避免和 JS 版抢占 admin/services/uadetect 这个路径。
end

function action_do()
	local key   = http.formvalue("key")
	local value = http.formvalue("value") or "1"

	if key and ALLOWED[key] then
		-- 只保留安全字符，杜绝命令注入
		value = tostring(value):gsub("[^%w%._%-%s:/()@,;+=]", "")
		sys.call("/usr/sbin/ua-detect-ctl set '" .. key .. "' '" .. value .. "' >/dev/null 2>&1")
	end

	http.redirect(disp.build_url("admin", "services", "uadetect"))
end
