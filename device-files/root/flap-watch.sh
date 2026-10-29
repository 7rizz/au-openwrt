#!/bin/sh
# =====================================================================
#  偶发「没网几秒」抓现场   sh /root/flap-watch.sh [分钟]   by au VX：aauuo0
#
#  只读，不改配置。断线后把 /tmp/flap.log 发出来。
#
#  ⚠ 探测方式必须挑 busybox 支持的：
#      · nc 没有 -z 选项（这条 busybox 只有 "nc IPADDR PORT"）→ 不能用 nc 探端口
#      · wget 没有 -S 选项 → 不能用它打印响应头
#    所以 TCP 层用 `wget -q -O /dev/null` 探一个真实的 80 端口页面：
#    它走 UA3F 的 TPROXY（只接管 TCP），能连上并拿到 200 就算通。
#
#  三路：
#    ICMP  ping 223.5.5.5              不走 UA3F，测上游
#    HTTP  wget http://www.baidu.com   走 UA3F 的 TCP 80，测代理链路
#    DNS   nslookup baidu.com 127.0.0.1
#
#  读法：
#    ICMP 通 + HTTP 断 = UA3F 这层断了
#    两个都断          = 上游断了
#    都通 + DNS 断     = dnsmasq 的问题
#    都通              = 那几秒太短没采到，或者根本不是网络断
# =====================================================================

LOG=/tmp/flap.log
MIN="${1:-30}"
: >"$LOG"
note() { echo "$(date '+%m-%d %H:%M:%S') $*" >>"$LOG"; }

note "# 开始采样 ${MIN} 分钟（每分钟打一条 BEAT 表示还活着）"

probe_icmp() { ping -c1 -W1 223.5.5.5 >/dev/null 2>&1 && echo up || echo down; }
probe_http() { wget -q -O /dev/null -T 3 http://www.baidu.com >/dev/null 2>&1 && echo up || echo down; }
probe_dns()  { nslookup baidu.com 127.0.0.1 >/dev/null 2>&1 && echo up || echo down; }

last=""
i=0
while [ "$i" -lt $((MIN * 60)) ]; do
	ic="$(probe_icmp)"; ht="$(probe_http)"; dn="$(probe_dns)"
	ua="$(pgrep -f /usr/bin/ua3f 2>/dev/null | head -n1)"
	ct="$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null)"
	cur="icmp=$ic http=$ht dns=$dn ua3f=${ua:-none}"
	if [ "$cur" != "$last" ]; then
		note "STATE $cur conntrack=${ct:-?}"
		last="$cur"
	fi
	i=$((i + 1))
	[ $((i % 60)) -eq 0 ] && note "BEAT $cur"
done

note "# 采样结束，附系统日志（最近 120 条相关）"
logread 2>/dev/null \
	| grep -Ei 'ua3f|dnsmasq|netifd|firewall|dhcp|conntrack|link (up|down)|wan' \
	| tail -n 120 | sed 's/^/LOG /' >>"$LOG"

echo "抓完了：$LOG（$(wc -l <"$LOG") 行）"
echo "发我：tail -n 80 $LOG"