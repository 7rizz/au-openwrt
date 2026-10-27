#!/bin/sh
# ================================================================
# Campus network auto-login with AUTOMATIC parameter detection.
#
# Instead of hard-coding wlanacip / wlanacname / vlan / mac ...,
# this script asks the network for them:
#
#   1. Request a normal URL. A captive portal answers with a
#      redirect to   http://<portal>/webauth.do?wlanacip=...&...
#      -> every parameter is read out of that redirect URL.
#   2. Download the portal login page and read its hidden form
#      fields (serverIp, hostIp, pageid, templatetype, ...).
#   3. POST the form with the account from the config file.
#   4. Verify the result by testing the network again.
#
# So the same file works on a different router / different
# building / different VLAN without editing anything.
#
# Configuration (only the account is required):
#     /etc/auth.conf          or  auth.conf next to this script
#         USERNAME=你的学号
#         PASSWORD=你的密码
#
# Optional overrides, all of them can go in the config file too:
#     AUTH_CONF        path of the config file
#     DETECT_URLS      URLs used to trigger the portal redirect
#     HTTP_TIMEOUT     seconds for normal requests        (8)
#     POST_TIMEOUT     seconds for the login request      (20)
#     WAIT_AFTER_LOGIN seconds to wait before verifying   (3)
#     UA               User-Agent sent to the portal
#     PORTAL_MARKS     words that identify a portal URL
#     FALLBACK_PORTAL  full portal URL if auto-detection fails
#
# Requires: curl, and 'ip' (iproute2) on Linux / OpenWrt.
# Result printed on stdout: ONLINE / SUCCESS = exit 0, FAILED = 1.
# ================================================================

PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
export PATH

SCRIPT_DIR=$(dirname "$0")
case "$SCRIPT_DIR" in
    /*) ;;
    *) SCRIPT_DIR="$(pwd)/$SCRIPT_DIR" ;;
esac

CONF="${AUTH_CONF:-/etc/auth.conf}"
[ -r "$CONF" ] || CONF="$SCRIPT_DIR/auth.conf"
if [ ! -r "$CONF" ]; then
    echo "ERROR: config file not found"
    echo "       looked for /etc/auth.conf and $SCRIPT_DIR/auth.conf"
    exit 1
fi
. "$CONF"

if [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    echo "ERROR: USERNAME / PASSWORD missing in $CONF"
    exit 1
fi

# ---------------- tunables (override via the config) ----------------
UA="${UA:-Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36}"
HTTP_TIMEOUT="${HTTP_TIMEOUT:-8}"
POST_TIMEOUT="${POST_TIMEOUT:-20}"
WAIT_AFTER_LOGIN="${WAIT_AFTER_LOGIN:-3}"
REDIRECT_PAGE="${REDIRECT_PAGE:-http://1.1.1.1/}"
# the first URL that answers decides - 204 means "really online"
DETECT_URLS="${DETECT_URLS:-http://connect.rom.miui.com/generate_204 http://www.baidu.com}"
# words that mean "this URL / page is the captive portal"
PORTAL_MARKS="${PORTAL_MARKS:-webauth.do wlanacip wlanuserip}"

# ---------------- small helpers ----------------

have() { command -v "$1" >/dev/null 2>&1; }

is_portal_url() {
    for m in $PORTAL_MARKS; do
        case "$1" in *"$m"*) return 0 ;; esac
    done
    return 1
}

http_code() {
    curl -s -o /dev/null -m "$HTTP_TIMEOUT" -A "$UA" -w '%{http_code}' "$1" 2>/dev/null
}

http_body() {
    curl -s -m "$HTTP_TIMEOUT" -A "$UA" "$1" 2>/dev/null
}

http_redirect() {
    curl -s -o /dev/null -m "$HTTP_TIMEOUT" -A "$UA" -w '%{redirect_url}' "$1" 2>/dev/null
}

# Read one parameter out of a URL:  url_param <name> <url>
url_param() {
    printf '%s' "$2" | awk -v want="$1" '
        {
            n = split($0, part, "[?&]")
            for (i = 1; i <= n; i++) {
                eq = index(part[i], "=")
                if (eq == 0) continue
                if (substr(part[i], 1, eq - 1) == want) {
                    print substr(part[i], eq + 1)
                    exit
                }
            }
}'
}

# Percent-encode a value so the POST body matches a real browser.
# Safe characters are kept, everything else becomes %XX.
urlencode() {
    printf '%s' "$1" | awk '
        BEGIN {
            for (i = 1; i < 256; i++) ord[sprintf("%c", i)] = i
            for (i = 48; i <= 57; i++) safe[sprintf("%c", i)] = 1
            for (i = 65; i <= 90; i++) safe[sprintf("%c", i)] = 1
            for (i = 97; i <= 122; i++) safe[sprintf("%c", i)] = 1
            safe["-"] = 1; safe["_"] = 1; safe["."] = 1; safe["~"] = 1
        }
        {
            n = length($0)
            out = ""
            for (i = 1; i <= n; i++) {
                c = substr($0, i, 1)
                if (c in safe) out = out c
                else if (c in ord) out = out sprintf("%%%02X", ord[c])
                else out = out c
            }
            printf "%s", out
        }'
}

# Read every enabled <input name=... value=...> of a form.
# Attribute order does not matter; disabled fields are ignored.
parse_form_fields() {
    tr '\n' ' ' | tr '>' '\n' | grep -i '<input' | while IFS= read -r tag; do
        case "$tag" in *[Dd][Ii][Ss][Aa][Bb][Ll][Ee][Dd]*) continue ;; esac
        name=$(printf '%s' "$tag" | sed -n 's/.*[[:space:]]name[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p')
        [ -n "$name" ] || continue
        # these three always come from the config or are set below
        case "$name" in userId|passwd|remInfo) continue ;; esac
        value=$(printf '%s' "$tag" | sed -n 's/.*[[:space:]]value[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p')
        value=$(printf '%s' "$value" | sed 's/&amp;/\&/g')
        printf '%s=%s\n' "$name" "$value"
    done
}

# ---------------- 0. already online? ----------------

is_online() {
    for u in $DETECT_URLS; do
        code=$(http_code "$u")
        case "$code" in
            204) return 0 ;;
            200)
                # a portal can fake a 200 with its own page - check it
                is_portal_url "$(http_body "$u")" && continue
                return 0 ;;
        esac
    done
    return 1
}

if is_online; then
    echo "ONLINE"
    exit 0
fi

if ! have curl; then
    echo "ERROR: curl is missing. Install it first:"
    echo "       opkg update && opkg install curl"
    exit 1
fi

echo "OFFLINE, starting auth"

# ---------------- 1. WAN interface / IP / MAC (fallback only) ----------------

WAN_IF=""
if have ip; then
    WAN_IF=$(ip route show default 2>/dev/null | awk '/^default/ {print $5; exit}')
    [ -n "$WAN_IF" ] || WAN_IF=$(ip route 2>/dev/null | awk '/^default/ {print $5; exit}')
fi
if [ -z "$WAN_IF" ] && have route; then
    WAN_IF=$(route -n 2>/dev/null | awk '$1 == "0.0.0.0" {print $8; exit}')
fi

WAN_IP=""
WAN_MAC=""
if [ -n "$WAN_IF" ]; then
    if have ip; then
        WAN_IP=$(ip -4 addr show "$WAN_IF" 2>/dev/null | awk '/inet / {print $2}' | cut -d/ -f1 | grep -v '^127\.' | head -n1)
        WAN_MAC=$(ip link show "$WAN_IF" 2>/dev/null | awk '/link\/ether/ {print $2; exit}')
    fi
    if [ -z "$WAN_MAC" ] && have ifconfig; then
        WAN_IP=$(ifconfig "$WAN_IF" 2>/dev/null | awk '/inet / {print $2}' | sed 's/^addr://' | head -n1)
        WAN_MAC=$(ifconfig "$WAN_IF" 2>/dev/null | awk '/HWaddr|ether/ {print $5; exit}')
    fi
fi

# ---------------- 2. find the portal ----------------

discover_portal_url() {
    # a) the classic case: the network answers with a redirect
    for u in $DETECT_URLS; do
        loc=$(http_redirect "$u")
        if [ -n "$loc" ] && is_portal_url "$loc"; then
            printf '%s' "$loc"
            return 0
        fi
    done
    # b) the portal answers 200 with an HTML / meta-refresh page
    for u in $DETECT_URLS; do
        loc=$(http_body "$u" | tr '"' '\n' | tr "'" '\n' \
              | grep -Eo 'https?://[^ <>"]*webauth\.do[^ <>"]*' | head -n1)
        if [ -n "$loc" ]; then
            printf '%s' "$loc"
            return 0
        fi
    done
    return 1
}

PORTAL_URL=$(discover_portal_url)

if [ -z "$PORTAL_URL" ]; then
    if [ -n "$FALLBACK_PORTAL" ]; then
        PORTAL_URL="$FALLBACK_PORTAL"
    elif [ -n "$WAN_IP" ] && [ -n "$WAN_MAC" ]; then
        # last resort: same campus, parameters taken from the interface
        PORTAL_URL="http://${PORTAL_HOST:-172.31.31.8}/webauth.do?wlanacip=${WLANACIP:-172.31.31.11}&wlanacname=${WLANACNAME:-hngxyxs}&wlanuserip=${WAN_IP}&mac=${WAN_MAC}&vlan=${VLAN:-20}&url=${REDIRECT_PAGE}"
        echo "WARN: no redirect seen, using the fallback portal URL"
    else
        echo "FAILED: no portal found and no WAN interface detected"
        exit 1
    fi
fi

# ---------------- 3. parameters taken out of the portal URL ----------------

P_WLANACIP=$(url_param wlanacip "$PORTAL_URL")
P_WLANACNAME=$(url_param wlanacname "$PORTAL_URL")
P_WLANUSERIP=$(url_param wlanuserip "$PORTAL_URL")
P_MAC=$(url_param mac "$PORTAL_URL")
P_VLAN=$(url_param vlan "$PORTAL_URL")

echo "PORTAL     = $PORTAL_URL"
echo "wlanacip   = ${P_WLANACIP:-?}   wlanacname = ${P_WLANACNAME:-?}"
echo "wlanuserip = ${P_WLANUSERIP:-$WAN_IP}   mac = ${P_MAC:-$WAN_MAC}   vlan = ${P_VLAN:-?}"
echo "WAN_IF=$WAN_IF  WAN_IP=$WAN_IP  WAN_MAC=$WAN_MAC"

# ---------------- 4. hidden form fields of the login page ----------------

PORTAL_PAGE=$(http_body "$PORTAL_URL")
FIELDS=$(printf '%s' "$PORTAL_PAGE" | parse_form_fields)

if [ -z "$FIELDS" ]; then
    echo "WARN: could not read the login form, using the known values"
    FIELDS="scheme=http
serverIp=tomcat_server:80
hostIp=http://127.0.0.1:8082/
loginType=
auth_type=0
isBindMac1=0
pageid=3
templatetype=1
listbindmac=0
recordmac=0
isRemind=1
loginTimes=
groupId=
distoken=
echostr=
isautoauth=
mobile=
url=${REDIRECT_PAGE}"
fi

if [ "${DEBUG:-0}" = "1" ]; then
    echo "--- form fields ---"
    printf '%s\n' "$FIELDS"
    echo "-------------------"
fi

# ---------------- 5. log in ----------------

BODY_FILE=$(mktemp 2>/dev/null) || BODY_FILE="/tmp/authbody.$$"
trap 'rm -f "$BODY_FILE"' EXIT
: > "$BODY_FILE"
first_field=1
printf '%s\n' "$FIELDS" | while IFS='=' read -r f_name f_value; do
    [ -n "$f_name" ] || continue
    f_name=$(urlencode "$f_name")
    f_value=$(urlencode "$f_value")
    if [ "$first_field" = "1" ]; then
        first_field=0
        printf '%s=%s' "$f_name" "$f_value" >> "$BODY_FILE"
    else
        printf '&%s=%s' "$f_name" "$f_value" >> "$BODY_FILE"
    fi
done

# curl merges every --data option with '&', and --data-urlencode
# escapes the account, so special characters cannot break it.
RESPONSE=$(curl -s -m "$POST_TIMEOUT" -A "$UA" -X POST \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data @"$BODY_FILE" \
    --data-urlencode "userId=$USERNAME" \
    --data-urlencode "passwd=$PASSWORD" \
    --data "remInfo=on" \
    "$PORTAL_URL" 2>&1)

# ---------------- 6. verify ----------------

sleep "$WAIT_AFTER_LOGIN"

if is_online; then
    echo "SUCCESS"
    exit 0
fi

if printf '%s' "$RESPONSE" | grep -qi 'loginsucc'; then
    echo "SUCCESS (portal reported a successful login)"
    exit 0
fi

echo "FAILED"
if [ "${DEBUG:-0}" = "1" ]; then
    echo "--- portal response (first 400 bytes) ---"
    printf '%s' "$RESPONSE" | head -c 400
    echo ""
fi
exit 1
