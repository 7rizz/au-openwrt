#!/bin/sh
# =====================================================================
#  全过程记录（procd 服务版）   by au VX：aauuo0
#
#  记三样东西到 /root/crash.log（重启不丢）：
#    1) 每次开机的标记 + 当时的 uptime
#    2) 每 60 秒一次的状态快照：可用内存 / UA3F 占用 / conntrack /
#       ARP 表条数 / DHCP 租约数 / 外网通不通 / uptime
#       （没变化时不写盘，只有 5 分钟一次心跳，省 flash）
#    3) 内核与系统日志里的异常行：panic / OOM / 卡死 / 无线驱动 / conntrack
#
#  看记录：cat /root/crash.log        停止：/etc/init.d/crashlog stop
# =====================================================================

LOG=/root/crash.log

echo "===== boot $(date '+%Y-%m-%d %H:%M:%S') uptime=$(cut -d. -f1 /proc/uptime)s =====" >>"$LOG"
sync

size=$(wc -c <"$LOG" 2>/dev/null || echo 0)
if [ "${size:-0}" -gt 131072 ]; then
	tail -c 65536 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

# ---------- 每 60 秒采一次；数值有变化才落盘，否则 5 分钟一条心跳 ----------
(
	last=""
	beat=0
	while :; do
		avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
		p=$(pgrep -f /usr/bin/ua3f 2>/dev/null | head -n1)
		rss=$(awk '/VmRSS/{printf "%d", $2/1024}' /proc/$p/status 2>/dev/null)
		ct=$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null)
		arp=$(grep -c . /proc/net/arp 2>/dev/null)
		lease=$(wc -l < /tmp/dhcp.leases 2>/dev/null)
		wan=$(ping -c1 -W1 223.5.5.5 >/dev/null 2>&1 && echo up || echo down)
		up=$(cut -d. -f1 /proc/uptime)
		cur="avail=${avail:-?}MB ua3f=${rss:-0}MB ct=${ct:-?} arp=${arp:-?} lease=${lease:-0} wan=$wan up=${up}s"

		beat=$((beat + 1))
		if [ "$cur" != "$last" ] || [ "$beat" -ge 5 ]; then
			echo "$(date '+%m-%d %H:%M') $cur" >>"$LOG"
			sync
			last="$cur"
			beat=0
		fi
		sleep 60
	done
) &

# ---------- 日志里的异常行：写完立刻 sync ----------
logread -f 2>/dev/null | while read -r l; do
	case "$l" in
		*panic*|*Panic*|*oom-kill*|*Out\ of\ memory*|*lockup*|*Lockup*|*stall*|*Stall*)
			echo "$l" >>"$LOG"; sync ;;
		*watchdog*|*Watchdog*|*reset*|*Reset*)
			echo "$l" >>"$LOG"; sync ;;
		*mt76*fail*|*mt76*err*|*mt76*timeout*|*mt76*reset*|*mt76*stuck*)
			echo "$l" >>"$LOG"; sync ;;
		*ieee80211*err*|*ieee80211*fail*|*mac80211*err*|*firmware*crash*|*FW*assert*)
			echo "$l" >>"$LOG"; sync ;;
		*BUG:*|*Call Trace*|*Unable to handle*|*soft lockup*|*hard LOCKUP*|*rcu_sched*)
			echo "$l" >>"$LOG"; sync ;;
		*nf_conntrack*|*conntrack*)
			echo "$l" >>"$LOG"; sync ;;
		*segfault*|*procd*exit*|*ua3f*level=fatal*|*ua3f*level=error*)
			echo "$l" >>"$LOG"; sync ;;
	esac
done