#!/bin/sh
# Turn a minimal Debian 13 (trixie) machine into a WhereInTheWorld kiosk:
# boots straight into WhereInTheWorld, full screen, no desktop.
#
#   sudo ./install-kiosk.sh                     # downloads the latest WhereInTheWorld .deb from GitHub
#   sudo ./install-kiosk.sh ./WhereInTheWorld_1.0.0_amd64.deb
#
set -eu
REPO="Cd084/WhereInTheWorld"

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
KUSER=${SUDO_USER:-}
if [ -z "$KUSER" ] || [ "$KUSER" = root ]; then
  echo "Run this with sudo from the normal user account that should auto-login to the kiosk." >&2
  exit 1
fi
HERE=$(cd "$(dirname "$0")" && pwd)

echo "==> Installing X and a minimal window manager"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q --no-install-recommends curl ca-certificates xserver-xorg xinit x11-xserver-utils \
  matchbox-window-manager fonts-open-sans fonts-noto-color-emoji

echo "==> Installing WhereInTheWorld"
DEB=${1:-}
if [ -z "$DEB" ]; then
  ARCH=$(dpkg --print-architecture)
  URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
        | grep -o "\"browser_download_url\": *\"[^\"]*_${ARCH}\.deb\"" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
  [ -n "$URL" ] || { echo "No ${ARCH} .deb found in the latest release of $REPO" >&2; exit 1; }
  DEB=/tmp/whereintheworld.deb
  curl -fsSL -o "$DEB" "$URL"
fi
case "$DEB" in /*) ;; *) DEB="$(pwd)/$DEB" ;; esac
apt-get install -y -q "$DEB"

echo "==> Kiosk session for $KUSER"
mkdir -p /etc/whereintheworld /opt/whereintheworld
install -m 755 "$HERE/xinitrc" /opt/whereintheworld/xinitrc
[ -f /etc/whereintheworld/kiosk.conf ] || install -m 644 "$HERE/kiosk.conf" /etc/whereintheworld/kiosk.conf

# Auto-login on tty1.
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf <<EOF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $KUSER --noclear %I \$TERM
EOF

# Start X on tty1 login (other ttys and SSH stay normal shells).
HOMEDIR=$(getent passwd "$KUSER" | cut -d: -f6)
PROFILE="$HOMEDIR/.bash_profile"
touch "$PROFILE"
if ! grep -q "whereintheworld-kiosk" "$PROFILE"; then
  cat >> "$PROFILE" <<'EOF'

# whereintheworld-kiosk: start the map on the console
[ -f ~/.profile ] && . ~/.profile
if [ -z "${DISPLAY:-}" ] && [ "$(tty)" = /dev/tty1 ]; then
  exec startx /opt/whereintheworld/xinitrc -- -nocursor >/dev/null 2>&1
fi
EOF
fi
chown "$KUSER": "$PROFILE"

if [ -f /etc/X11/Xwrapper.config ]; then
  sed -i 's/^allowed_users=.*/allowed_users=anybody/' /etc/X11/Xwrapper.config
else
  echo "allowed_users=anybody" > /etc/X11/Xwrapper.config
fi

# Kinder to a USB stick: keep logs in RAM.
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=volatile\nRuntimeMaxUse=32M\n' > /etc/systemd/journald.conf.d/whereintheworld.conf
systemctl restart systemd-journald || true
systemctl daemon-reload

echo
echo "Done. Reboot: WhereInTheWorld opens full screen. Tap the gear (top right) to enter your Tautulli details."
echo "To update later: sudo ./install-kiosk.sh   (or use the app's update notice)"
