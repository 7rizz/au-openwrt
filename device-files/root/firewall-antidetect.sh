#!/bin/sh
# ============================================================================
# 校园网防检测 · 防火墙规则脚本
#
# 作用：处理 UA2F / UA2F 之外、需要网络层完成的几件事
#   - 固定出站 TTL（最关键的补充项）
#   - 把外网 NTP(123) 劫持到本路由器，统一时钟
#   - 可选：把 DNS(53) 劫持到本路由器
#
# 什么时候需要它：
#   - 用 UA2F（UA2F 只改 UA，不碰 TTL）→ 基本必跑
#   - 用 UA2F 但想额外统一 NTP / DNS
#   - 用 UA2F 的 TPROXY/REDIRECT 且已在面板勾了固定 TTL → 不必跑 TTL 部分
#
# 用法：
#   sh firewall-antidetect.sh install [TTL]   # 默认 TTL=64
#   sh firewall-antidetect.sh uninstall
#   sh firewall-antidetect.sh status
#
# 依赖（iptables 后端）：opkg install kmod-ipt-ipopt iptables-mod-ipopt
# ============================================================================

set -u

ACTION="${1:-status}"
TTL="${2:-64}"
GATEWAY="$(uci -q get network.lan.ipaddr 2>/dev/null || true)"
[ -z "$GATEWAY" ] && GATEWAY="192.168.1.1"

TABLE_TTL="ua2f_ttl"
TABLE_NAT="ua2f_nat"
CH_TTL="UA2F_TTL"
CH_NTP="UA2F_NTP"

have_nft() { command -v nft >/dev/null 2>&1; }
have_ipt() { command -v iptables >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# nftables（OpenWrt 22.03+ / fw4 默认）
# ---------------------------------------------------------------------------
nft_install() {
    echo "[*] 使用 nftables 后端，TTL = $TTL"

    # --- TTL ---
    nft add table ip "$TABLE_TTL" 2>/dev/null || true
    nft add chain ip "$TABLE_TTL" postrouting \
        '{ type filter hook postrouting priority mangle ; }' 2>/dev/null || true
    nft flush chain ip "$TABLE_TTL" postrouting 2>/dev/null || true
    if nft add rule ip "$TABLE_TTL" postrouting ip ttl set "$TTL" 2>/dev/null; then
        echo "    [+] 已固定 TTL = $TTL"
    else
        echo "    [!] TTL 规则下发失败（内核缺少 nft 的 ttl 支持？）"
    fi

    # --- NTP 劫持到本机 ---
    nft add table ip "$TABLE_NAT" 2>/dev/null || true
    nft add chain ip "$TABLE_NAT" prerouting \
        '{ type nat hook prerouting priority dstnat ; }' 2>/dev/null || true
    nft flush chain ip "$TABLE_NAT" prerouting 2>/dev/null || true
    nft add rule ip "$TABLE_NAT" prerouting ip daddr \
        '{ 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 }' return 2>/dev/null || true
    if nft add rule ip "$TABLE_NAT" prerouting udp dport 123 redirect to :123 2>/dev/null; then
        echo "    [+] NTP(123) 已劫持到路由器（网关 $GATEWAY）"
        echo "        → 记得在 LuCI 系统设置里启用 NTP 客户端，并勾选「作为 NTP 服务器」"
    else
        echo "    [!] NTP 劫持规则下发失败"
    fi
}

nft_uninstall() {
    nft delete table ip "$TABLE_TTL" 2>/dev/null || true
    nft delete table ip "$TABLE_NAT" 2>/dev/null || true
}

nft_status() {
    echo "--- nft: $TABLE_TTL ---"
    nft list table ip "$TABLE_TTL" 2>/dev/null || echo "(不存在)"
    echo "--- nft: $TABLE_NAT ---"
    nft list table ip "$TABLE_NAT" 2>/dev/null || echo "(不存在)"
}

# ---------------------------------------------------------------------------
# iptables（老版 OpenWrt / fw3）
# ---------------------------------------------------------------------------
ipt_install() {
    echo "[*] 使用 iptables 后端，TTL = $TTL"

    iptables -t mangle -N "$CH_TTL" 2>/dev/null || true
    iptables -t mangle -F "$CH_TTL" 2>/dev/null || true
    iptables -t mangle -D POSTROUTING -j "$CH_TTL" 2>/dev/null || true
    iptables -t mangle -A POSTROUTING -j "$CH_TTL"
    if iptables -t mangle -A "$CH_TTL" -j TTL --ttl-set "$TTL" 2>/dev/null; then
        echo "    [+] 已固定 TTL = $TTL"
    else
        echo "    [!] 失败：请先安装 kmod-ipt-ipopt iptables-mod-ipopt"
    fi

    iptables -t nat -N "$CH_NTP" 2>/dev/null || true
    iptables -t nat -F "$CH_NTP" 2>/dev/null || true
    iptables -t nat -D PREROUTING -p udp --dport 123 -j "$CH_NTP" 2>/dev/null || true
    iptables -t nat -A PREROUTING -p udp --dport 123 -j "$CH_NTP"
    iptables -t nat -A "$CH_NTP" -d 0.0.0.0/8 -j RETURN
    iptables -t nat -A "$CH_NTP" -d 10.0.0.0/8 -j RETURN
    iptables -t nat -A "$CH_NTP" -d 127.0.0.0/8 -j RETURN
    iptables -t nat -A "$CH_NTP" -d 172.16.0.0/12 -j RETURN
    iptables -t nat -A "$CH_NTP" -d 192.168.0.0/16 -j RETURN
    if iptables -t nat -A "$CH_NTP" -p udp --dport 123 -j DNAT --to-destination "$GATEWAY" 2>/dev/null; then
        echo "    [+] NTP(123) 已劫持到 $GATEWAY"
    else
        echo "    [!] NTP 劫持规则下发失败"
    fi
}

ipt_uninstall() {
    iptables -t mangle -D POSTROUTING -j "$CH_TTL" 2>/dev/null || true
    iptables -t mangle -F "$CH_TTL" 2>/dev/null || true
    iptables -t mangle -X "$CH_TTL" 2>/dev/null || true
    iptables -t nat -D PREROUTING -p udp --dport 123 -j "$CH_NTP" 2>/dev/null || true
    iptables -t nat -F "$CH_NTP" 2>/dev/null || true
    iptables -t nat -X "$CH_NTP" 2>/dev/null || true
}

ipt_status() {
    echo "--- iptables mangle: $CH_TTL ---"
    iptables -t mangle -L "$CH_TTL" -n -v 2>/dev/null || echo "(不存在)"
    echo "--- iptables nat: $CH_NTP ---"
    iptables -t nat -L "$CH_NTP" -n -v 2>/dev/null || echo "(不存在)"
}

# ---------------------------------------------------------------------------
# 可选：DNS 劫持（让所有终端用路由器做 DNS，统一解析行为）
# ---------------------------------------------------------------------------
install_dns() {
    echo "[*] 额外劫持 DNS(53) 到路由器"
    if have_nft; then
        nft add rule ip "$TABLE_NAT" prerouting udp dport 53 redirect to :53 2>/dev/null || true
        nft add rule ip "$TABLE_NAT" prerouting tcp dport 53 redirect to :53 2>/dev/null || true
    else
        iptables -t nat -A PREROUTING -p udp --dport 53 -j REDIRECT --to-ports 53
        iptables -t nat -A PREROUTING -p tcp --dport 53 -j REDIRECT --to-ports 53
    fi
    echo "    [+] 完成"
}

# ---------------------------------------------------------------------------
case "$ACTION" in
    install)
        if have_nft; then nft_install; else ipt_install; fi
        [ "${3:-}" = "dns" ] && install_dns
        echo "[+] 完成。用 'sh firewall-antidetect.sh status' 查看结果。"
        echo "[!] 注意：这条规则不会自动持久化，重启后请重跑，或写进 /etc/rc.local。"
        ;;
    uninstall)
        have_nft && nft_uninstall
        have_ipt && ipt_uninstall
        echo "[+] 已移除本脚本添加的规则。"
        ;;
    status)
        have_nft && nft_status
        have_ipt && ipt_status
        ;;
    dns)
        install_dns
        ;;
    *)
        echo "用法: sh $0 {install [TTL] | uninstall | status | dns}"
        exit 1
        ;;
esac
