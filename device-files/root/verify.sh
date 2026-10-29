#!/bin/sh
# =====================================================================
#  防检测一键自检（只读，不改任何配置）        by au VX：aauuo0
#  用法：sh /root/verify.sh
#
#  看四件事：
#    1) 现在是哪个引擎在跑（UA3F / UA2F，只能有一个）
#    2) UA3F 的关键开关是不是速度档（TTL=128、TCPts/IPID=0）
#    3) nft 里实际下发的 TTL 值
#    4) UA2F 的状态（如果装了）
# =====================================================================

say() { printf '\n\033[1;36m== %s\033[0m\n' "$1"; }

say "引擎状态"
if [ -x /usr/sbin/ua-engine ]; then
	ua-engine status
else
	[ "$(pgrep -f /usr/bin/ua3f)" ] && echo "UA3F 进程：在跑" || echo "UA3F 进程：没跑"
	[ "$(pgrep -f /usr/bin/ua2f)" ] && echo "UA2F 进程：在跑" || echo "UA2F 进程：没跑"
fi

say "UA3F 配置"
for k in server_mode port rewrite_mode l3_rewrite_ttl l3_rewrite_ttl_value l3_rewrite_tcpts l3_rewrite_ipid; do
	v="$(uci -q get ua3f.main.$k)"
	echo "  $k = ${v:-（空）}"
done
ua="$(uci -q get ua3f.main.ua)"
echo "  ua = $(printf '%s' "$ua" | cut -c1-64)…"

say "UA3F 进程与 nft 规则"
pgrep -f /usr/bin/ua3f >/dev/null 2>&1 && echo "  进程：在跑" || echo "  进程：没跑"
nft list table inet ua3f >/dev/null 2>&1 && echo "  nft 表 inet ua3f：已下发" || echo "  nft 表 inet ua3f：没有"
ttl="$(nft list ruleset 2>/dev/null | sed -n 's/.*ip ttl set \([0-9]*\).*/\1/p' | head -n1)"
[ -n "$ttl" ] && echo "  实际 TTL 规则：$ttl" || echo "  实际 TTL 规则：没看到"

say "UA2F"
if [ -x /etc/init.d/ua2f ]; then
	pgrep -f /usr/bin/ua2f >/dev/null 2>&1 && echo "  进程：在跑（和 UA3F 只能二选一）" || echo "  进程：没跑"
	nft list table inet ua2f >/dev/null 2>&1 && echo "  NFQUEUE 规则：已下发" || echo "  NFQUEUE 规则：没有"
else
	echo "  未安装"
fi

say "结论怎么读"
echo "  · 速度档 = TTL 128 且 TCPts / IPID 都是 0；有一个不是 0 就会掉速"
echo "  · UA3F 和 UA2F 的进程只能有一个是「在跑」"
echo "  · 改完去内网设备开 http://ua-check.stagoh.com 复核 UA"