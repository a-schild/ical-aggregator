#!/bin/bash
#
# Install or update ical-aggregator from a GitHub release.
#
#   update.sh            install the latest release
#   update.sh 1.2.0      install release 1.2.0
#   update.sh --force    reinstall even if the version is already installed
#
# Run as root on the server. config.json in the install dir is never touched.
# If the service does not come up again, the previous version is restored.
#
# Settings can be overridden by environment variables:
#   INSTALL_DIR (default /opt/ical-aggregator), SERVICE (default ical-aggregator)
#
set -euo pipefail

REPO="a-schild/ical-aggregator"
INSTALL_DIR="${INSTALL_DIR:-/opt/ical-aggregator}"
SERVICE="${SERVICE:-ical-aggregator}"
# System user the service runs as (no login shell), see systemd/ical-aggregator.service
SERVICE_USER="ical-aggregator"
UNIT_FILE="/etc/systemd/system/${SERVICE}.service"
BACKUP_ROOT="/var/backups/ical-aggregator"
HEALTH_URL="http://127.0.0.1:3000/"

VERSION=""
FORCE=0
for arg in "$@"; do
    case "$arg" in
        --force) FORCE=1 ;;
        -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
        *) VERSION="$arg" ;;
    esac
done

log()  { echo "[update] $*"; }
fail() { echo "[update] ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "must run as root"
for cmd in curl unzip rsync node npm systemctl; do
    command -v "$cmd" >/dev/null || fail "required command not found: $cmd"
done

#
# Node.js runtime: report pending (security) updates, but don't install them here,
# the runtime is shared with other services on this host
#
log "Node.js $(node -v)"
if command -v apt-get >/dev/null; then
    apt-get update -qq >/dev/null 2>&1 || log "WARNING: apt-get update failed, can't check for Node.js updates"
    if apt list --upgradable 2>/dev/null | grep -q '^nodejs/'; then
        log "WARNING: a Node.js update is available: $(apt list --upgradable 2>/dev/null | grep '^nodejs/')"
        log "WARNING: install it with 'apt-get install --only-upgrade nodejs' and restart all node services"
    else
        log "Node.js package is up to date"
    fi
fi

#
# Find the release
#
if [ -n "$VERSION" ]; then
    API_URL="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
else
    API_URL="https://api.github.com/repos/${REPO}/releases/latest"
fi
RELEASE_JSON="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$API_URL")" \
    || fail "release not found: $API_URL"

# jq is not installed on the server, node is
read -r TAG ZIP_URL < <(node -e '
    const r = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const zip = (r.assets || []).find((a) => /^ical-aggregator-.*\.zip$/.test(a.name));
    console.log(r.tag_name, zip ? zip.browser_download_url : "");
' <<< "$RELEASE_JSON")
[ -n "${ZIP_URL:-}" ] || fail "release $TAG has no ical-aggregator zip"

INSTALLED=""
if [ -f "$INSTALL_DIR/package.json" ]; then
    INSTALLED="$(node -p 'require(process.argv[1]).version' "$INSTALL_DIR/package.json")"
fi
log "Installed: ${INSTALLED:-none}, release: $TAG"
if [ "$INSTALLED" = "$TAG" ] && [ "$FORCE" -eq 0 ]; then
    log "Already up to date (use --force to reinstall)"
    exit 0
fi

#
# Download and unpack
#
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
log "Downloading $ZIP_URL"
curl -fsSL -o "$WORK_DIR/release.zip" "$ZIP_URL"
unzip -q "$WORK_DIR/release.zip" -d "$WORK_DIR"
NEW_DIR="$WORK_DIR/ical-aggregator"
[ -f "$NEW_DIR/server.js" ] || fail "unexpected zip layout, ical-aggregator/server.js missing"

#
# Backup the current install (including node_modules, for a fast rollback)
#
BACKUP_DIR=""
CONFIG_PERMS=""
if [ -d "$INSTALL_DIR" ]; then
    # Root-only directory, not /var/tmp: the backup contains config.json with the feed tokens,
    # and root restores it on rollback, so no other user may be able to touch it
    [ -L "$BACKUP_ROOT" ] && fail "$BACKUP_ROOT is a symlink"
    install -d -m 700 -o root -g root "$BACKUP_ROOT"
    [ "$(stat -c '%U %a' "$BACKUP_ROOT")" = "root 700" ] || fail "$BACKUP_ROOT must be owned by root with mode 700"
    BACKUP_DIR="$(mktemp -d "$BACKUP_ROOT/${INSTALLED:-unknown}-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
    log "Backup to $BACKUP_DIR"
    cp -a "$INSTALL_DIR" "$BACKUP_DIR/app"
    if [ -f "$UNIT_FILE" ]; then
        cp -a "$UNIT_FILE" "$BACKUP_DIR/unit.service"
    fi
    if [ -f "$INSTALL_DIR/config.json" ]; then
        CONFIG_PERMS="$(stat -c '%U:%G %a' "$INSTALL_DIR/config.json")"
    fi
fi

rollback() {
    if [ -z "$BACKUP_DIR" ]; then
        fail "$1 (no backup to roll back to)"
    fi
    echo "[update] ERROR: $1, restoring $BACKUP_DIR" >&2
    rsync -a --delete "$BACKUP_DIR/app/" "$INSTALL_DIR/"
    chmod 755 "$INSTALL_DIR"
    # The old unit may run as another user, it must still be able to read config.json
    if [ -n "$CONFIG_PERMS" ]; then
        chown "${CONFIG_PERMS% *}" "$INSTALL_DIR/config.json"
        chmod "${CONFIG_PERMS#* }" "$INSTALL_DIR/config.json"
    fi
    if [ -f "$BACKUP_DIR/unit.service" ]; then
        cp -a "$BACKUP_DIR/unit.service" "$UNIT_FILE"
        systemctl daemon-reload
    fi
    systemctl restart "$SERVICE" || true
    fail "rolled back to ${INSTALLED:-previous version}"
}

#
# Install. No --delete, so local files (config.json, output files, .git) survive.
# rsync replaces files by rename, so updating this running script is safe.
#
mkdir -p "$INSTALL_DIR"
log "Installing to $INSTALL_DIR"
rsync -a --exclude 'config.json' --exclude 'node_modules/' "$NEW_DIR/" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/scripts/"*.sh
(cd "$INSTALL_DIR" && npm ci --omit=dev --no-audit --no-fund) || rollback "npm ci failed"
(cd "$INSTALL_DIR" && npm audit --omit=dev --audit-level=high) \
    || log "WARNING: npm audit reports vulnerabilities, check for a newer release"

#
# Own system user without login shell. The code stays owned by root, so the service
# can't modify itself; only config.json is readable by the service user (feed tokens).
#
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    log "Creating system user $SERVICE_USER"
    useradd --system --user-group --no-create-home --home-dir /nonexistent \
        --shell /usr/sbin/nologin "$SERVICE_USER"
fi
chown -R root:root "$INSTALL_DIR/server.js" "$INSTALL_DIR/main.js" "$INSTALL_DIR/modules" \
    "$INSTALL_DIR/node_modules" "$INSTALL_DIR/scripts" "$INSTALL_DIR/systemd"
chmod 755 "$INSTALL_DIR"

if [ ! -f "$INSTALL_DIR/config.json" ]; then
    log "No config.json yet: copy config-sample.json to $INSTALL_DIR/config.json and adapt it,"
    log "then run this script again (--force) to install and start the service"
    exit 0
fi
chown "root:$SERVICE_USER" "$INSTALL_DIR/config.json"
chmod 640 "$INSTALL_DIR/config.json"

# Install or update the systemd unit (it contains the /opt/ical-aggregator path)
if [ "$INSTALL_DIR" = "/opt/ical-aggregator" ] && ! cmp -s "$INSTALL_DIR/systemd/ical-aggregator.service" "$UNIT_FILE"; then
    log "Installing systemd unit $UNIT_FILE"
    install -m 644 "$INSTALL_DIR/systemd/ical-aggregator.service" "$UNIT_FILE"
    systemctl daemon-reload
    systemctl enable --quiet "$SERVICE"
fi

#
# Restart and check the service answers (404 = running, no config requested)
#
log "Restarting $SERVICE"
systemctl restart "$SERVICE" || rollback "restart failed"
STATUS=""
for _ in $(seq 1 15); do
    sleep 1
    STATUS="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" || true)"
    [ "$STATUS" = "404" ] && break
done
[ "$STATUS" = "404" ] || rollback "service does not answer on $HEALTH_URL (status '$STATUS')"
systemctl is-active --quiet "$SERVICE" || rollback "service is not active"

log "ical-aggregator $TAG installed and running"
[ -n "$BACKUP_DIR" ] && log "Previous version kept in $BACKUP_DIR"
exit 0
