#!/bin/sh
# ================================================================
# netcheck.sh - keep the campus network logged in, non-stop.
#
# It runs as a loop (not cron), so the interval can be very short.
# Each round:
#   online  -> do nothing.
#   offline -> run the auth script (the "miss" counter goes up).
#
# Log looks like this:
#   2026-10-08 13:21:59 OFFLINE (miss #1) -> running /usr/bin/auth.sh
#   2026-10-08 13:22:10 auth result:
#       OFFLINE, starting auth
#       PORTAL     = http://...
#       wlanacip   = ...
#       wlanuserip = ...
#       SUCCESS
#
# The log is kept tidy in two ways:
#   - LOG_MAX_LINES   : it is trimmed to the last N lines.
#   - LOG_KEEP_DAYS   : it is wiped completely every N days.
#
# Files it uses:
#   /usr/bin/auth.sh       the login script it calls
#   /etc/auth.conf         the account (read by auth.sh)
#   /etc/netcheck.conf     optional settings for this script
#
# Start it :  /etc/init.d/netcheck start   (procd service, at boot)
#             /usr/bin/netcheck.sh &       (manual / background)
# Log file :  /tmp/netcheck.log
# ================================================================

PATH=/usr/sbin:/usr/bin:/sbin:/bin:$PATH
export PATH

# ---- optional config file (settings below can be overridden here) ----
[ -r /etc/netcheck.conf ] && . /etc/netcheck.conf

# ---------------- tunables ----------------
AUTH_SCRIPT="${AUTH_SCRIPT:-/usr/bin/auth.sh}"
CHECK_INTERVAL="${CHECK_INTERVAL:-2}"   # seconds between checks (min 1)
COOLDOWN="${COOLDOWN:-6}"               # seconds to pause after a login try
CHECK_TIMEOUT="${CHECK_TIMEOUT:-4}"     # curl timeout for one probe
LOG_FILE="${LOG_FILE:-/tmp/netcheck.log}"
DETAIL_FILE="${DETAIL_FILE:-/tmp/auth_last.log}"
LOG_MAX_LINES="${LOG_MAX_LINES:-1000}"
# clear the log automatically every N days (0 = never clear)
LOG_KEEP_DAYS="${LOG_KEEP_DAYS:-2}"
ROTATE_FILE="${ROTATE_FILE:-/etc/.netcheck.rotate}"
# how the auth output is written to the log:
#   detail : "auth result:" then the output, one line each   (default)
#   fold   : the whole output on a single line, joined by ';'
#   brief  : one short line with only the final verdict
LOG_STYLE="${LOG_STYLE:-detail}"
UA="${UA:-Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36}"
# the first URL that answers 204 means "really online"
PROBE_204="${PROBE_204:-http://connect.rom.miui.com/generate_204}"
# fallback probe; a captive portal can fake a 200 here, so check the body
PROBE_FALLBACK="${PROBE_FALLBACK:-http://www.baidu.com}"

LOCK_DIR=/tmp/netcheck.lock
PID_FILE="$LOCK_DIR/pid"

# ---------------- helpers ----------------
ts()  { date '+%Y-%m-%d %H:%M:%S'; }
now() { date '+%s'; }
log() { printf '%s %s\n' "$(ts)" "$*" >>"$LOG_FILE"; }

trim_log() {
    [ -f "$LOG_FILE" ] || return 0
    lines=$(wc -l <"$LOG_FILE" 2>/dev/null)
    [ "${lines:-0}" -gt "$LOG_MAX_LINES" ] || return 0
    tail -n "$LOG_MAX_LINES" "$LOG_FILE" >"$LOG_FILE.tmp" 2>/dev/null \
        && mv "$LOG_FILE.tmp" "$LOG_FILE"
}

# Clear the log automatically every LOG_KEEP_DAYS days (0 = never).
# The "last cleared" moment is kept in ROTATE_FILE so that a reboot
# does not reset the countdown.
rotate_log() {
    [ "${LOG_KEEP_DAYS:-0}" -gt 0 ] 2>/dev/null || return 0
    stamp=$(cat "$ROTATE_FILE" 2>/dev/null)
    case "$stamp" in
        ''|*[!0-9]*)
            printf '%s\n' "$(now)" >"$ROTATE_FILE"
            return 0
            ;;
    esac
    [ $(( $(now) - stamp )) -ge $(( LOG_KEEP_DAYS * 86400 )) ] || return 0
    : >"$LOG_FILE"
    : >"$DETAIL_FILE" 2>/dev/null
    printf '%s\n' "$(now)" >"$ROTATE_FILE"
    log "log cleared automatically (every ${LOG_KEEP_DAYS} days)"
}

# last non-empty line of the auth output (usually SUCCESS / FAILED / ONLINE)
last_line() {
    printf '%s\n' "$1" | sed -e 's/\r$//' | grep -v '^[[:space:]]*$' | tail -n1
}

# Returns 0 when the internet really works, 1 when it does not.
is_online() {
    # 1) the clean "204 = online" answer
    code=$(curl -s -o /dev/null -m "$CHECK_TIMEOUT" -A "$UA" \
           -w '%{http_code}' "$PROBE_204" 2>/dev/null)
    [ "$code" = "204" ] && return 0

    # 2) fallback URL; a portal may answer 200 with its own login page
    body=$(curl -s -m "$CHECK_TIMEOUT" -A "$UA" "$PROBE_FALLBACK" 2>/dev/null)
    case "$body" in
        *webauth.do*|*wlanacip*|*wlanuserip*) return 1 ;;
    esac
    [ -n "$body" ] && return 0

    # 3) last resort: can we at least reach a public DNS server?
    ping -c1 -W2 223.5.5.5 >/dev/null 2>&1 && return 0
    return 1
}

# ---------------- single instance guard ----------------
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    old=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
        echo "netcheck is already running (pid $old)"
        exit 0
    fi
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" || { echo "cannot create lock $LOCK_DIR"; exit 1; }
fi
echo $$ >"$PID_FILE"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

[ -x "$AUTH_SCRIPT" ] || {
    echo "ERROR: $AUTH_SCRIPT not found or not executable"
    log "ERROR: $AUTH_SCRIPT not found or not executable"
    exit 1
}

# ---------------- main loop ----------------
log "netcheck started: pid=$$ interval=${CHECK_INTERVAL}s auth=$AUTH_SCRIPT style=$LOG_STYLE keep=${LOG_KEEP_DAYS}d"

misses=0
rotate_log
while :; do
    rotate_log
    if is_online; then
        misses=0
    else
        misses=$((misses + 1))
        log "OFFLINE (miss #$misses) -> running $AUTH_SCRIPT"

        t0=$(now)
        out=$("$AUTH_SCRIPT" 2>&1)
        t1=$(now)
        printf '%s\n' "$out" >"$DETAIL_FILE" 2>/dev/null

        case "$LOG_STYLE" in
            fold)
                log "auth result: $(printf '%s' "$out" | tr '\n' ';')"
                ;;
            brief)
                log "auth result: $(last_line "$out")  (took $((t1 - t0))s)"
                ;;
            *)
                printf '%s auth result:\n' "$(ts)" >>"$LOG_FILE"
                printf '%s\n' "$out" | sed 's/^/    /' >>"$LOG_FILE"
                ;;
        esac

        trim_log
        sleep "$COOLDOWN"
    fi
    sleep "$CHECK_INTERVAL"
done
