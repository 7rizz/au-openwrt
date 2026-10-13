#!/bin/sh
# ============================================================================
# 路由器侧自检：确认 UA2F / UA2F 是否在跑、配置是否正确、UA 是否被改写
# 用法： sh verify.sh
# ============================================================================

say() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

say "系统信息"
. /etc/openwrt_release 2>/dev/null
echo "OpenWrt: ${DISTRIB_RELEASE:-未知}"
echo "架构:    $(opkg print-architecture 2>/dev/null | awk 'NR>1{print $2}' | sort -u | tr '\n' ' ')"

say "服务状态"
if [ -x /etc/init.d/ua2f ]; then
    /etc/init.d/ua2f status 2>&1 | head -5
    echo "UA2F 进程: $(pgrep -f ua2f | tr '\n' ' ')"
else
    echo "未安装 UA2F"
fi
if [ -x /etc/init.d/ua2f ] || command -v ua2f >/dev/null 2>&1; then
    service ua2f status 2>&1 | head -5
    echo "UA2F 进程: $(pgrep -f ua2f | tr '\n' ' ')"
else
    echo "未安装 UA2F"
fi

say "监听端口"
netstat -lntp 2>/dev/null | grep -E ':(1080|10010|7890|9000)' || \
    (command -v ss >/dev/null && ss -lntp | grep -E ':(1080|10010|7890|9000)') || \
    echo "(未发现常见端口，检查服务是否启动)"

say "UA2F 配置（如存在）"
[ -f /etc/config/ua2f ] && cat /etc/config/ua2f | sed 's/^/  /' || echo "(无 /etc/config/ua2f)"

say "UA2F 配置（如存在）"
[ -f /etc/config/ua2f ] && cat /etc/config/ua2f | sed 's/^/  /' || echo "(无 /etc/config/ua2f)"

say "防火墙规则（TTL / NTP）"
if command -v nft >/dev/null 2>&1; then
    nft list table ip ua2f_ttl 2>/dev/null || echo "(无 ua2f_ttl 表)"
    nft list table ip ua2f_nat 2>/dev/null || echo "(无 ua2f_nat 表)"
else
    iptables -t mangle -L UA2F_TTL -n -v 2>/dev/null || echo "(无 UA2F_TTL 链)"
    iptables -t nat -L UA2F_NTP -n -v 2>/dev/null || echo "(无 UA2F_NTP 链)"
fi

say "UA 改写自检（路由器本机发起，需联网）"
if command -v curl >/dev/null 2>&1; then
    curl -s --max-time 8 http://ua-check.stagoh.com 2>/dev/null | \
        grep -io 'user-agent[^<]*' | head -3 || echo "(curl 未取到内容，检查联网)"
else
    echo "(路由器未装 curl，可在内网设备上用浏览器打开 http://ua-check.stagoh.com)"
fi

say "最近日志"
logread 2>/dev/null | grep -iE 'ua2f|ua2f' | tail -15 || echo "(无相关日志)"

echo
echo "提示：TTL 是否正确需要用内网设备的流量抓包验证，见 docs/05-验证与排错.md。"

