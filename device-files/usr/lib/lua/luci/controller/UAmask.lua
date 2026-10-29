module("luci.controller.UAmask", package.seeall)

function index()
    entry({"admin", "services", "UAmask"}, cbi("UAmask"), "UA-Mask 高级设置", 55)
end