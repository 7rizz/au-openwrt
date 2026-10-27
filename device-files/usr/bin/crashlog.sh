#!/bin/sh
# =====================================================================
#  崩溃取证（procd 服务版）   by au学长 V：aauuo0
#
#  两件事：
#    1. 把 panic / OOM / 卡死 / 驱动错误 / UA3F 异常 的日志行实时落盘
#    2. 每 5 分钟记一次：可用内存、ua3f 占用、conntrack、uptime
#
#  为什么要 procd：写到 /etc/rc.local 里，遇到硬复位有时来不及执行；
#  做成服务由 procd 拉起，每次开机一定会跑，崩了还会被重新拉起。
#
#  看记录：cat /root/crash.log    停止：/etc/init.d/crashlog stop
# =====================================================================

LOG=/root/crash.log

# --- 启动标记（带 uptime，方便算这次活了多久）---
echo "===== boot $(date '+%Y-%m-%d %H:%M:%S') uptime=$(cut -d. -f1 /proc/uptime)s =====" >>"$LOG"
sync

# --- 文件超过 128KB 砍掉前半段 ---
size=$(wc -c <"$LOG" 2>/dev/null || echo 0)
if [ "${size:-0}" -gt 131072 ]; then
	tail -c 65536 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

# --- 后台：每 5 分钟采样一次 ---
(
	while :; do
		avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
		p=$(pgrep -f /usr/bin/ua3f 2>/dev/null | head -n1)
		rss=$(awk '/VmRSS/{printf "%d", $2/1024}' /proc/$p/status 2>/dev/null)
		ct=$(cat /proc/sys/net/netfilter/nf_conntrack_count 2>/dev/null)
		up=$(cut -d. -f1 /proc/uptime)
		echo "$(date '+%m-%d %H:%M') avail=${avail:-?}MB ua3f=${rss:-0}MB ct=${ct:-?} up=${up}s" >>"$LOG"
		sleep 300
	done
) &

# --- 前台：盯日志（panic 这类关键行写完立刻 sync，防止被硬复位吞掉）---
logread -f 2>/dev/null | while read -r l; do
	case "$l" in
		*panic*|*Panic*|*oom-kill*|*Out\ of\ memory*|*lockup*|*Lockup*|*stall*|*Stall*)
			echo "$l" >>"$LOG"; sync ;;
		*watchdog*|*Watchdog*|*reset*|*Reset*)
			echo "$l" >>"$LOG"; sync ;;
		*mt76*|*ieee80211*|*mac80211*|*mt7615*|*mt7603*)
			echo "$l" >>"$LOG"; sync ;;
		*nf_conntrack*|*conntrack*)
			echo "$l" >>"$LOG"; sync ;;
		*segfault*|*procd*exit*|*ua3f*level=error*|*ua3f*level=fatal*)
			echo "$l" >>"$LOG"; sync ;;
	esac
done