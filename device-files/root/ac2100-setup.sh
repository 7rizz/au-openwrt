#!/bin/sh
# ============================================================================
# 红米 AC2100 (MT7621A / mipsel_24kc) · UA3F 一键配置
#
# 适配场景：OpenWrt + 多设备同时上网被检测
# 用法：
#   sh ac2100-setup.sh iphone    # iPhone 人格，TTL 64（默认）
#   sh ac2100-setup.sh windows   # Windows 人格，TTL 128
#   sh ac2100-setup.sh android   # Android 人格，TTL 64
# ============================================================================
set -u

PERSONA="${1:-iphone}"

UA_IPHONE="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
UA_WINDOWS="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
UA_ANDROID="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36"

case "$PERSONA" in
    iphone)  UA="$UA_IPHONE";  TTL=64  ;;
    android) UA="$UA_ANDROID"; TTL=64  ;;
    windows) UA="$UA_WINDOWS"; TTL=128 ;;
    *) echo "未知人格: $PERSONA（可选 iphone / android / windows）"; exit 1 ;;
esac

echo "=============================================="
echo " AC2100 UA3F 配置"
echo " 人格: $PERSONA    TTL: $TTL"
echo "=============================================="

# --- 0. 环境检查 -----------------------------------------------------------
echo "[*] 检查环境..."
. /etc/openwrt_release 2>/dev/null
echo "    OpenWrt: ${DISTRIB_DESCRIPTION:-未知} ${DISTRIB_RELEASE:-}"

if ! command -v ua3f >/dev/null 2>&1; then
    echo "[!] 没找到 ua3f 可执行文件，请先安装对应的 mipsel_24kc 安装包。"
    echo "    UA3F:  https://github.com/SunBK201/UA3F/releases"
    exit 1
fi

ARCH="$(opkg print-architecture 2>/dev/null | awk 'NR>1{print $2}' | sort -u | tr '\n' ' ')"
echo "    架构:   $ARCH"
case "$ARCH" in
    *mipsel_24kc*) : ;;
    *) echo "[!] 提示：当前架构不含 mipsel_24kc，确认你下的是对的安装包。" ;;
esac

# --- 1. 依赖 ---------------------------------------------------------------
echo "[*] 检查 nftables 队列依赖..."
if opkg list-installed 2>/dev/null | grep -q 'kmod-nft-queue'; then
    echo "    [+] 依赖已就绪"
else
    echo "    [!] 建议先安装: opkg update && opkg install kmod-nft-queue kmod-nft-tproxy"
fi

# --- 2. 写入 UCI 配置 ------------------------------------------------------
echo "[*] 写入 UA3F 配置..."
uci set ua3f.enabled.enabled='1'
uci set ua3f.main.server_mode='TPROXY'
uci set ua3f.main.bind='0.0.0.0'
uci set ua3f.main.port='1080'
uci set ua3f.main.rewrite_mode='RULE'
uci set ua3f.main.ua="$UA"
uci set ua3f.main.log_level='WARN'

# L3 重写：TTL + 清 TCP 时间戳 + IPID 归零；重武器一律关闭
uci set ua3f.main.l3_rewrite_ttl='1'
uci set ua3f.main.l3_rewrite_ttl_value="$TTL"
uci set ua3f.main.l3_rewrite_tcpts='1'
uci set ua3f.main.l3_rewrite_tcpwin='0'
uci set ua3f.main.l3_rewrite_ipid='1'
uci set ua3f.main.l3_rewrite_block_quic='0'
uci set ua3f.main.l3_rewrite_bpf_offload='0'

# Desync / MitM 默认关闭（AC2100 性能有限，且兼容性差）
uci set ua3f.main.desync_reorder='0'
uci set ua3f.main.desync_inject='0'
uci set ua3f.main.mitm_enabled='0'

uci commit ua3f
echo "    [+] 已写入"

# --- 3. 启动 ---------------------------------------------------------------
echo "[*] 启动服务..."
/etc/init.d/ua3f enable 2>/dev/null
/etc/init.d/ua3f restart
sleep 2
if pgrep -f ua3f >/dev/null 2>&1; then
    echo "    [+] UA3F 已运行 (pid: $(pgrep -f ua3f | tr '\n' ' '))"
else
    echo "    [!] 进程没起来，看日志： logread | grep -i ua3f | tail -30"
fi

# --- 4. 收尾提示 -----------------------------------------------------------
echo
echo "=============================================="
echo " 完成。接下来："
echo "  1) 验证 UA：内网设备（关 VPN）打开 http://ua-check.stagoh.com"
echo "  2) 验证 TTL： tcpdump -i br-lan -vv -c 20 'tcp and port 80'  应为 ttl $TTL"
echo "  3) 统一时钟：sh firewall-antidetect.sh install $TTL"
echo "  4) 若 TPROXY 下不通，改模式重试："
echo "       uci set ua3f.main.server_mode='REDIRECT' && uci commit ua3f && /etc/init.d/ua3f restart"
echo "=============================================="

