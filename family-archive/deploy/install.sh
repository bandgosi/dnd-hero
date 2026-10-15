#!/usr/bin/env bash
# Установка «Истории нашего рода» на сервер (Ubuntu 22.04/24.04, Debian 12).
#
#   sudo bash deploy/install.sh --domain archive.example.ru     # доступ по HTTPS для семьи
#   sudo bash deploy/install.sh --local-only                    # без домена: только через SSH-туннель
#   sudo bash deploy/install.sh --update                        # обновление (настройки и данные сохраняются)
#
# Что делает: ставит Node.js 22 с nodejs.org (с проверкой контрольной суммы), копирует приложение
# в /opt/family-archive, создаёт системного пользователя без входа в систему, данные — в
# /var/lib/family-archive (доступ только у службы), настройки — в /etc/family-archive/env
# (только root). Служба работает в «песочнице» systemd и слушает только 127.0.0.1; снаружи
# её открывает Caddy с бесплатным сертификатом HTTPS. Брандмауэр пропускает только SSH, 80 и 443.
# Порт приложения держит systemd (family-archive.socket), поэтому его не перехватит другая программа.
set -Eeuo pipefail
umask 022

PREFIX="${FA_PREFIX:-}"   # только для самопроверки установщика (вместе с --skip-system)
APP_DIR="$PREFIX/opt/family-archive"
NODE_ROOT="$PREFIX/opt/node"
DATA_DIR="$PREFIX/var/lib/family-archive"
CONF_DIR="$PREFIX/etc/family-archive"
ENV_FILE="$CONF_DIR/env"
INSTALL_CONF="$CONF_DIR/install.conf"
UNIT_FILE="$PREFIX/etc/systemd/system/family-archive.service"
SOCKET_FILE="$PREFIX/etc/systemd/system/family-archive.socket"
DROPIN_DIR="$PREFIX/etc/systemd/system/family-archive.service.d"
CTL_BIN="$PREFIX/usr/local/sbin/family-archive"
SERVICE=family-archive
SERVICE_USER=family-archive
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PORT=3000
PORT_SET=0
OLD_PORT=""
OLD_DOMAIN=""
DOMAIN=""
DOMAIN_SET=0
DOMAIN_CHANGED=0
FIREWALL_DONE=0
WEB_PORTS_DONE=0
EMAIL=""
LOCAL_ONLY=0
SKIP_FIREWALL=0
SKIP_SYSTEM=0
UPDATE=0
GEN_PASSWORD=0
GENERATED=0
PW=""
SHOW_PW=""

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33mВнимание:\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[1;31mОшибка:\033[0m %s\n' "$*" >&2
  exit 1
}
trap 'die "команда на строке $LINENO завершилась неудачно. Установка остановлена."' ERR
# Созданный пароль не должен потеряться, даже если установка прервётся позже.
on_exit() {
  local rc=$?
  if ((rc != 0)) && [[ -n $SHOW_PW ]]; then
    printf '\n\033[1;33mСозданный пароль для входа (сохраните его):\033[0m %s\n' "$SHOW_PW" >&2
  fi
}
trap on_exit EXIT

usage() {
  cat <<'EOF'
Установка «Истории нашего рода» на сервер.

  sudo bash deploy/install.sh --domain archive.example.ru [--email you@example.ru]
  sudo bash deploy/install.sh --local-only
  sudo bash deploy/install.sh --update

Параметры:
  --domain ИМЯ          доменное имя сайта (его DNS-запись A должна указывать на этот сервер)
  --email АДРЕС         почта для уведомлений Let's Encrypt о сертификате (необязательно)
  --local-only          без домена и HTTPS: доступ только через SSH-туннель
  --port N              внутренний порт приложения (по умолчанию 3000)
  --generate-password   не спрашивать пароль, а создать случайный (будет показан один раз)
  --skip-firewall       не настраивать брандмауэр ufw
  --update              обновить приложение, сохранив настройки и данные
  --skip-system         самопроверка без systemd/apt/Caddy/ufw (для разработчиков, с FA_PREFIX)
EOF
}

while (($#)); do
  case "$1" in
    --domain) DOMAIN="${2:-}"; DOMAIN_SET=1; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --local-only) LOCAL_ONLY=1; shift ;;
    --port) PORT="${2:-}"; PORT_SET=1; shift 2 ;;
    --generate-password) GEN_PASSWORD=1; shift ;;
    --skip-firewall) SKIP_FIREWALL=1; shift ;;
    --update) UPDATE=1; shift ;;
    --skip-system) SKIP_SYSTEM=1; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage; die "неизвестный параметр: $1" ;;
  esac
done

# ---------- Проверки ----------
[[ $EUID -eq 0 || $SKIP_SYSTEM -eq 1 ]] || die "запустите через sudo: sudo bash deploy/install.sh ..."
[[ -f "$SRC_DIR/package.json" && -d "$SRC_DIR/server" && -f "$SRC_DIR/package-lock.json" ]] || die "скрипт должен лежать в папке проекта family-archive/deploy."
if ((SKIP_SYSTEM)); then
  [[ -n $PREFIX ]] || die "--skip-system используется только вместе с FA_PREFIX (самопроверка)."
else
  [[ -d /run/systemd/system ]] || die "нужен Linux с systemd (Ubuntu 22.04+ или Debian 12)."
  command -v apt-get >/dev/null || die "поддерживаются Ubuntu и Debian (нужен apt-get)."
fi
case "$(uname -m)" in
  x86_64) NODE_ARCH=x64 ;;
  aarch64 | arm64) NODE_ARCH=arm64 ;;
  *) die "неподдерживаемая архитектура процессора: $(uname -m)" ;;
esac
if [[ ! $PORT =~ ^[0-9]{4,5}$ ]] || ((PORT < 1024 || PORT > 65535)); then die "порт должен быть числом от 1024 до 65535."; fi

if [[ -f $ENV_FILE ]]; then
  UPDATE=1
fi
conf_value() {
  # Значение из прежнего install.conf (файл пишет только установщик, root, 0600).
  [[ -f $INSTALL_CONF ]] || return 0
  # shellcheck source=/dev/null
  (. "$INSTALL_CONF" && printf '%s' "${!1:-}")
}
valid_domain() { [[ $1 =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$ ]]; }
if [[ -n $EMAIL && ! $EMAIL =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; then die "неверный адрес почты: $EMAIL"; fi
if ((UPDATE)); then
  [[ -f $ENV_FILE ]] || die "приложение ещё не установлено — запустите установку без --update."
  # Из прежних настроек берём домен, почту и выбор брандмауэра (путь к исходникам — текущий).
  OLD_DOMAIN="$(conf_value DOMAIN || true)"
  DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
  if ((DOMAIN_SET)) && [[ -n $DOMAIN && $DOMAIN != "$OLD_DOMAIN" ]]; then
    # Повторный запуск с другим --domain: домен добавляется или исправляется.
    valid_domain "$DOMAIN" || die "неверное доменное имя: $DOMAIN"
    DOMAIN_CHANGED=1
  elif ((LOCAL_ONLY)) && [[ -n $OLD_DOMAIN ]]; then
    # Повторный запуск с --local-only: доступ из интернета отключается.
    DOMAIN=""
    DOMAIN_CHANGED=1
  else
    DOMAIN="$OLD_DOMAIN"
  fi
  [[ -n $EMAIL ]] || EMAIL="$(conf_value EMAIL || true)"
  [[ "$(conf_value SKIP_FIREWALL || true)" == 1 ]] && SKIP_FIREWALL=1
  [[ "$(conf_value FIREWALL_DONE || true)" == 1 ]] && FIREWALL_DONE=1
  [[ "$(conf_value WEB_PORTS_DONE || true)" == 1 ]] && WEB_PORTS_DONE=1
  ((DOMAIN_CHANGED)) && WEB_PORTS_DONE=0
  # Установки прежних версий не записывали эту отметку: брандмауэр у них уже настраивался при установке.
  if [[ -f $INSTALL_CONF ]] && ! grep -q '^FIREWALL_DONE=' "$INSTALL_CONF"; then FIREWALL_DONE=1; fi
  OLD_PORT="$(awk -F= '$1=="PORT"{print $2}' "$ENV_FILE" | tail -n1)"
  OLD_PORT="${OLD_PORT:-3000}"
  ((PORT_SET)) || PORT="$OLD_PORT"
else
  DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
  if ((!LOCAL_ONLY)) && [[ -z $DOMAIN ]]; then
    if [[ -t 0 ]]; then
      read -rp "Доменное имя сайта (например, archive.example.ru), Enter — без домена: " DOMAIN
      DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')"
    fi
    [[ -n $DOMAIN ]] || LOCAL_ONLY=1
  fi
  if [[ -n $DOMAIN ]]; then
    valid_domain "$DOMAIN" || die "неверное доменное имя: $DOMAIN"
    LOCAL_ONLY=0
  fi
fi

avail_mb() { df -Pm "$1" | awk 'NR==2{print $4}'; }
mkdir -p "$PREFIX/opt" "$PREFIX/var/lib"
for d in "$PREFIX/opt" "$PREFIX/var/lib"; do
  (($(avail_mb "$d") >= 500)) || die "на диске ($d) свободно меньше 500 МБ — освободите место."
done

# Порт не должен быть занят чужой программой (свой сокет systemd — не помеха).
check_port() {
  local busy
  command -v ss >/dev/null || return 0
  busy="$(ss -Hltnp "sport = :$PORT" 2>/dev/null || true)"
  [[ -z $busy ]] && return 0
  if ((!SKIP_SYSTEM)); then
    if systemctl is-active --quiet "$SERVICE.socket" 2>/dev/null &&
      [[ "$(systemctl show -p Listen --value "$SERVICE.socket" 2>/dev/null)" == "127.0.0.1:$PORT "* ]]; then
      return 0
    fi
    # Порт занят нашей же службой (версия без отдельного сокета) — при обновлении она будет остановлена.
    local pid
    pid="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo 0)"
    if [[ -n $pid && $pid != 0 ]] && grep -q "pid=$pid," <<<"$busy"; then return 0; fi
  fi
  printf '%s\n' "$busy" >&2
  die "порт $PORT уже занят другой программой. Укажите свободный порт, например: --port 3010"
}
check_port

apt_install() { DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$@" >/dev/null; }

# ---------- Системные пакеты ----------
if ((!SKIP_SYSTEM)); then
  say "Системные пакеты"
  apt-get update -qq
  apt_install ca-certificates curl xz-utils iproute2
  ((SKIP_FIREWALL)) || apt_install ufw
  apt_install unattended-upgrades
  # Автоматические обновления безопасности системы (если администратор не настроил иначе).
  if [[ ! -f /etc/apt/apt.conf.d/20auto-upgrades ]]; then
    printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' >/etc/apt/apt.conf.d/20auto-upgrades
  fi
  # Caddy — единственная программа, принимающая соединения из интернета: обновляем при каждом запуске.
  if command -v caddy >/dev/null; then apt_install --only-upgrade caddy || warn "не удалось обновить Caddy."; fi
fi

# ---------- Node.js ----------
node_ok() {
  local v maj min
  v="$("$1" -p 'process.versions.node' 2>/dev/null)" || return 1
  IFS=. read -r maj min _ <<<"$v"
  ((maj > 22 || (maj == 22 && min >= 13)))
}

install_node() {
  say "Node.js 22 (LTS)"
  local tmp file ver dest
  tmp="$(mktemp -d)"
  if ! curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/SHASUMS256.txt" https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt; then
    rm -rf "$tmp"
    if [[ -x $NODE_ROOT/bin/node ]] && node_ok "$NODE_ROOT/bin/node"; then
      warn "nodejs.org недоступен — оставляю установленный Node.js $("$NODE_ROOT/bin/node" -v)."
      return
    fi
    die "не удалось скачать Node.js с nodejs.org."
  fi
  file="$(awk -v suf="-linux-$NODE_ARCH.tar.xz" '{ n = $2; if (index(n, "node-v22.") == 1 && substr(n, length(n) - length(suf) + 1) == suf) print n }' "$tmp/SHASUMS256.txt" | head -n1)"
  [[ -n $file ]] || die "не найден Node.js для архитектуры $NODE_ARCH."
  ver="${file%"-linux-$NODE_ARCH.tar.xz"}"
  if [[ -x $NODE_ROOT/bin/node && "$("$NODE_ROOT/bin/node" -v)" == "${ver#node-}" ]]; then
    info "уже установлена актуальная версия ${ver#node-}"
    rm -rf "$tmp"
    return
  fi
  curl -fsSL --proto '=https' --tlsv1.2 -o "$tmp/$file" "https://nodejs.org/dist/latest-v22.x/$file"
  (cd "$tmp" && grep -E "  $file\$" SHASUMS256.txt | sha256sum -c --quiet -) || die "контрольная сумма Node.js не совпала — файл повреждён или подменён."
  dest="$PREFIX/opt/$ver-linux-$NODE_ARCH"
  rm -rf "$dest"
  mkdir -p "$dest"
  tar -xJf "$tmp/$file" -C "$dest" --strip-components=1 --no-same-owner
  rm -rf "$dest/include" "$dest/share/doc" "$dest/share/man" "$dest/CHANGELOG.md" "$dest/README.md"
  chown -R root:root "$dest" 2>/dev/null || true
  ln -sfn "$dest" "$NODE_ROOT"
  # Прежняя версия удаляется только после успешного запуска (см. конец установки) — для отката.
  rm -rf "$tmp"
  info "установлен Node.js ${ver#node-} ($(du -sh "$dest" | cut -f1))"
}
PREV_NODE="$(readlink "$NODE_ROOT" 2>/dev/null || true)"
install_node
NODE="$NODE_ROOT/bin/node"
node_ok "$NODE" || die "Node.js не запускается."

# ---------- Проверка готовой сборки интерфейса ----------
say "Проверка приложения"
(cd "$SRC_DIR" && "$NODE" scripts/check-dist.mjs) || die "готовая сборка интерфейса (client/dist) отсутствует или не соответствует исходникам. Скачайте актуальную версию проекта (git pull)."

# ---------- Пользователь и папки ----------
if ((SKIP_SYSTEM)); then
  RUN_USER="$(id -un)"
else
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
  RUN_USER="$SERVICE_USER"
fi
install -d -m 0700 -o "$RUN_USER" -g "$(id -gn "$RUN_USER")" "$DATA_DIR"
install -d -m 0700 "$CONF_DIR"

# Настройки службы передаются через окружение (не через аргументы — их видно в списке процессов).
load_env_into_shell() {
  local line
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line =~ ^[A-Z_][A-Z0-9_]*= ]]; then export "${line?}"; fi
  done <"$ENV_FILE"
}

# Запуск node-скрипта приложения от имени службы с её настройками.
run_app_script() {
  (
    cd "$APP_DIR"
    load_env_into_shell
    if ((SKIP_SYSTEM)); then
      exec "$NODE" --disable-warning=ExperimentalWarning "$@"
    else
      exec runuser -u "$SERVICE_USER" -- "$NODE" --disable-warning=ExperimentalWarning "$@"
    fi
  )
}

# ---------- Копирование приложения ----------
say "Установка приложения в $APP_DIR"
STAGE="$APP_DIR.new"
rm -rf "$STAGE"
mkdir -p "$STAGE"
tar -C "$SRC_DIR" --exclude=./node_modules --exclude=./data --exclude=./tests --exclude=./.env --exclude=./.git \
  --exclude='*.xlsx' --exclude='*.db' --exclude='*.db-wal' --exclude='*.db-shm' -cf - . | tar -C "$STAGE" -xf - --no-same-owner
NPM_TMP="$(mktemp -d)"
(cd "$STAGE" && PATH="$NODE_ROOT/bin:$PATH" HOME="$NPM_TMP" npm ci --omit=dev --ignore-scripts --no-audit --no-fund --update-notifier=false --loglevel=error --cache "$NPM_TMP/cache") ||
  { rm -rf "$NPM_TMP" "$STAGE"; die "не удалось установить зависимости (npm ci)."; }
rm -rf "$NPM_TMP"
if ((!SKIP_SYSTEM)); then chown -R root:root "$STAGE"; fi
chmod -R u=rwX,go=rX "$STAGE"
info "размер приложения: $(du -sh "$STAGE" | cut -f1)"

# ---------- Настройки (только при первой установке) ----------
rm -f "$ENV_FILE.prev"
if [[ ! -f $ENV_FILE ]]; then
  say "Пароль для входа в архив"
  if [[ -n ${FA_PASSWORD:-} ]]; then
    PW="$FA_PASSWORD"
  elif ((GEN_PASSWORD)); then
    PW="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)"
    GENERATED=1
  else
    [[ -t 0 ]] || die "нет терминала для ввода пароля: используйте --generate-password."
    while :; do
      IFS= read -rsp "Придумайте пароль (не короче 10 символов): " PW
      echo
      if ((${#PW} < 10)); then
        warn "слишком короткий пароль."
        continue
      fi
      IFS= read -rsp "Повторите пароль: " PW2
      echo
      [[ $PW == "$PW2" ]] && break
      warn "пароли не совпадают."
    done
  fi
  ((${#PW} >= 10)) || die "пароль должен быть не короче 10 символов."
  HASH="$(cd "$STAGE" && printf '%s' "$PW" | "$NODE" scripts/hash-password.mjs --stdin)" || die "не удалось создать хэш пароля."
  [[ $HASH == scrypt:* ]] || die "не удалось создать хэш пароля."
  ENV_TMP="$(mktemp "$CONF_DIR/env.XXXXXX")"
  {
    echo "# Настройки «Истории нашего рода». После изменения: sudo systemctl restart $SERVICE"
    echo "HOST=127.0.0.1"
    echo "PORT=$PORT"
    echo "DATA_DIR=$DATA_DIR"
    echo "APP_PASSWORD_HASH=$HASH"
    if [[ -n $DOMAIN ]]; then
      echo "ALLOWED_HOSTS=$DOMAIN"
      echo "TRUST_PROXY=loopback"
      echo "COOKIE_SECURE=1"
    fi
    echo "# Фото уменьшаются до этого размера по длинной стороне (пикселей) и сжимаются в JPEG"
    echo "PHOTO_MAX_SIDE=2048"
    echo "PHOTO_QUALITY=0.85"
    echo "MAX_PHOTO_MB=10"
    echo "# Резервные копии: сколько хранить автоматических и «перед изменениями»"
    echo "AUTO_BACKUP_DAYS=1"
    echo "AUTO_BACKUP_KEEP=2"
    echo "SAFETY_BACKUP_KEEP=2"
    echo "MAX_BACKUP_MB=1024"
    echo "# Сколько места на диске всегда оставлять свободным (МБ)"
    echo "DISK_RESERVE_MB=300"
  } >"$ENV_TMP"
  chmod 0600 "$ENV_TMP"
  mv "$ENV_TMP" "$ENV_FILE"
  ((GENERATED)) && SHOW_PW="$PW"
  unset PW PW2 HASH
elif [[ $PORT != "$OLD_PORT" ]] || ((DOMAIN_CHANGED)); then
  # Смена порта (--port) или домена (--domain / --local-only); прежние настройки — для отката.
  cp -p "$ENV_FILE" "$ENV_FILE.prev"
  ENV_TMP="$(mktemp "$CONF_DIR/env.XXXXXX")"
  awk -v p="$PORT" -v d="$DOMAIN" -v dc="$DOMAIN_CHANGED" '
    /^PORT=/ { print "PORT=" p; next }
    dc == 1 && /^(ALLOWED_HOSTS|TRUST_PROXY|COOKIE_SECURE)=/ { next }
    { print }
    END { if (dc == 1 && d != "") { print "ALLOWED_HOSTS=" d; print "TRUST_PROXY=loopback"; print "COOKIE_SECURE=1" } }
  ' "$ENV_FILE" >"$ENV_TMP"
  chmod 0600 "$ENV_TMP"
  mv "$ENV_TMP" "$ENV_FILE"
  [[ $PORT != "$OLD_PORT" ]] && info "порт приложения изменён: $OLD_PORT → $PORT"
  ((DOMAIN_CHANGED)) && info "адрес изменён: ${DOMAIN:-только через SSH-туннель}"
fi
write_install_conf() {
  {
    echo "SRC_DIR=$(printf '%q' "$SRC_DIR")"
    echo "APP_DIR=$(printf '%q' "$APP_DIR")"
    echo "NODE_ROOT=$(printf '%q' "$NODE_ROOT")"
    echo "DATA_DIR=$(printf '%q' "$DATA_DIR")"
    echo "ENV_FILE=$(printf '%q' "$ENV_FILE")"
    echo "DOMAIN=$(printf '%q' "$DOMAIN")"
    echo "EMAIL=$(printf '%q' "$EMAIL")"
    echo "SKIP_FIREWALL=$SKIP_FIREWALL"
    echo "FIREWALL_DONE=$FIREWALL_DONE"
    echo "WEB_PORTS_DONE=$WEB_PORTS_DONE"
    echo "SERVICE=$SERVICE"
    echo "SERVICE_USER=$SERVICE_USER"
  } >"$INSTALL_CONF"
  chmod 0600 "$INSTALL_CONF"
}
write_install_conf

# ---------- Служба systemd ----------
# Прежние файлы служб сохраняются для отката.
for f in "$UNIT_FILE" "$SOCKET_FILE" "$DROPIN_DIR/10-compat.conf"; do
  if [[ -f $f ]]; then cp -p "$f" "$f.prev"; else rm -f "$f.prev"; fi
done
SOCKET_EXISTED=0
[[ -f $SOCKET_FILE ]] && SOCKET_EXISTED=1
write_unit() {
  mkdir -p "$(dirname "$UNIT_FILE")"
  # Запасной режим без фильтра системных вызовов не переносится между запусками:
  # каждая установка сначала проверяет полную защиту.
  rm -f "$DROPIN_DIR/10-compat.conf"
  cat >"$SOCKET_FILE" <<EOF
# Создано установщиком family-archive. Порт держит systemd — даже во время перезапуска
# приложения его не может занять другая программа.
[Unit]
Description=История нашего рода — сокет

[Socket]
ListenStream=127.0.0.1:$PORT
NoDelay=true

[Install]
WantedBy=sockets.target
EOF
  cat >"$UNIT_FILE" <<EOF
# Создано установщиком family-archive. Изменения затрутся при обновлении —
# свои настройки кладите в /etc/systemd/system/$SERVICE.service.d/*.conf
[Unit]
Description=История нашего рода — семейный архив
Requires=$SERVICE.socket
After=network.target $SERVICE.socket

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=$NODE --disable-warning=ExperimentalWarning --max-old-space-size=256 server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15

# Песочница: служба видит систему только для чтения, пишет только в папку данных,
# не может повышать привилегии, загружать модули ядра, открывать сырые сокеты и т. п.
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
RemoveIPC=yes
CapabilityBoundingSet=
AmbientCapabilities=
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @mount @swap @reboot @raw-io @module @debug @cpu-emulation @obsolete @clock
SystemCallErrorNumber=EPERM
UMask=0077
MemoryMax=450M
# Если ядро завершит по памяти вспомогательный процесс (разбор файла), служба продолжает работать.
OOMPolicy=continue
TasksMax=64

[Install]
WantedBy=multi-user.target
EOF
}
write_unit

# Отвечает именно это приложение (а не другая программа на том же порту) и именно наша служба.
health() {
  local _ body pid
  for _ in $(seq 1 40); do
    body="$(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
    if [[ $body == *'"app":"family-archive"'* ]]; then
      ((SKIP_SYSTEM)) && return 0
      pid="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || echo 0)"
      if [[ $pid != 0 ]] && systemctl is-active --quiet "$SERVICE" && ss -Hltnp "sport = :$PORT" 2>/dev/null | grep -q "pid=$pid,"; then return 0; fi
    fi
    sleep 0.5
  done
  return 1
}


BACKUP_NOTE=""
if ((UPDATE)) && [[ -d $APP_DIR ]] && [[ -f $DATA_DIR/family.db ]]; then
  say "Резервная копия перед обновлением"
  if run_app_script scripts/backup-cli.mjs --label before-update; then
    BACKUP_NOTE="$(find "$DATA_DIR/backups" -maxdepth 1 -name '*-before-update.zip' -printf '%T@ %p\n' 2>/dev/null | sort -n | tail -n1 | cut -d' ' -f2-)"
  else
    warn "копию создать не удалось — обновление продолжится."
  fi
fi

# Подмена версии с возможностью отката.
if [[ -d $APP_DIR ]]; then
  rm -rf "$APP_DIR.old"
  mv "$APP_DIR" "$APP_DIR.old"
fi
mv "$STAGE" "$APP_DIR"

rollback() {
  warn "$1"
  ((SKIP_SYSTEM)) || systemctl stop "$SERVICE" 2>/dev/null || true
  # Запасной режим возвращается таким, каким был у прежней версии.
  if [[ -f $DROPIN_DIR/10-compat.conf.prev ]]; then mv -f "$DROPIN_DIR/10-compat.conf.prev" "$DROPIN_DIR/10-compat.conf"; else rm -f "$DROPIN_DIR/10-compat.conf"; fi
  if [[ -n $PREV_NODE && -d $PREV_NODE && "$(readlink "$NODE_ROOT")" != "$PREV_NODE" ]]; then ln -sfn "$PREV_NODE" "$NODE_ROOT"; fi
  local note=""
  [[ -n $BACKUP_NOTE ]] && note=" Резервная копия перед обновлением: $BACKUP_NOTE"
  if [[ -d $APP_DIR.old ]]; then
    rm -rf "$APP_DIR.failed"
    mv "$APP_DIR" "$APP_DIR.failed"
    mv "$APP_DIR.old" "$APP_DIR"
    if [[ -f $ENV_FILE.prev ]]; then
      mv -f "$ENV_FILE.prev" "$ENV_FILE"
      PORT="$OLD_PORT"
      # Домен в install.conf должен соответствовать восстановленным настройкам.
      DOMAIN="$OLD_DOMAIN"
      write_install_conf
    fi
    if ((!SKIP_SYSTEM)); then
      # Прежняя версия без отдельного сокета: новый сокет убирается, иначе он занял бы её порт.
      if ((!SOCKET_EXISTED)); then
        systemctl disable --now "$SERVICE.socket" >/dev/null 2>&1 || true
        rm -f "$SOCKET_FILE"
      fi
      for f in "$UNIT_FILE" "$SOCKET_FILE"; do if [[ -f $f.prev ]]; then mv -f "$f.prev" "$f"; fi; done
      systemctl daemon-reload
      ((SOCKET_EXISTED)) && { systemctl restart "$SERVICE.socket" 2>/dev/null || true; }
      systemctl restart "$SERVICE" || true
      if health; then
        die "новая версия не запустилась — возвращена прежняя, она работает.$note Подробности: sudo journalctl -u $SERVICE -n 50"
      fi
      die "новая версия не запустилась, прежняя тоже не отвечает.$note Подробности: sudo journalctl -u $SERVICE -n 50"
    fi
    die "новая версия не запустилась — возвращена прежняя.$note"
  fi
  die "приложение не запустилось. Подробности: sudo journalctl -u $SERVICE -n 50"
}

# Команда управления ставится до запуска службы — она нужна и при неудачном запуске (например, смена пароля).
mkdir -p "$(dirname "$CTL_BIN")"
install -m 0755 "$APP_DIR/deploy/family-archive-ctl.sh" "$CTL_BIN"

if ((SKIP_SYSTEM)); then
  say "Самопроверка запуска (без systemd)"
  (
    cd "$APP_DIR"
    load_env_into_shell
    exec "$NODE" --disable-warning=ExperimentalWarning --max-old-space-size=256 server/index.js
  ) >"$PREFIX/app.log" 2>&1 &
  APP_PID=$!
  if health; then info "приложение отвечает на 127.0.0.1:$PORT"; else
    kill "$APP_PID" 2>/dev/null || true
    cat "$PREFIX/app.log" >&2
    rollback "самопроверка не прошла."
  fi
  kill "$APP_PID" 2>/dev/null || true
  wait "$APP_PID" 2>/dev/null || true
else
  say "Служба $SERVICE"
  start_service() {
    systemctl daemon-reload
    systemctl stop "$SERVICE" 2>/dev/null || true
    systemctl restart "$SERVICE.socket"
    systemctl start "$SERVICE" || true
  }
  systemctl daemon-reload
  systemctl enable "$SERVICE.socket" "$SERVICE" >/dev/null 2>&1
  start_service
  if ! health; then
    # Запасной вариант — только если в журнале видны отказы системных вызовов (на некоторых ядрах
    # фильтр мешает запуску). Иначе причина другая, и защиту не ослабляем.
    if journalctl -u "$SERVICE" -n 80 --no-pager 2>/dev/null | grep -qiE 'operation not permitted|EPERM|seccomp|SIGSYS|bad system call'; then
      warn "служба не запустилась из-за фильтра системных вызовов — пробую без него."
      mkdir -p "$DROPIN_DIR"
      printf '[Service]\nSystemCallFilter=\n' >"$DROPIN_DIR/10-compat.conf"
      start_service
    fi
    health || {
      journalctl -u "$SERVICE" -n 30 --no-pager >&2 || true
      rollback "служба не запустилась."
    }
  fi
  info "служба работает (только на 127.0.0.1:$PORT)"
fi
rm -rf "$APP_DIR.old" "$APP_DIR.failed" "$UNIT_FILE.prev" "$SOCKET_FILE.prev" "$ENV_FILE.prev" "$DROPIN_DIR/10-compat.conf.prev"
# Старые версии Node.js больше не нужны для отката.
find "$PREFIX/opt" -maxdepth 1 -type d -name 'node-v22.*' ! -path "$(readlink "$NODE_ROOT")" -exec rm -rf {} +

# ---------- HTTPS через Caddy ----------
setup_caddy() {
  say "HTTPS для $DOMAIN (Caddy)"
  local busy
  busy="$(ss -Hltnp '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v '"caddy"' || true)"
  if [[ -n $busy ]]; then
    warn "порты 80/443 уже заняты другой программой — Caddy не настраивается автоматически:"
    printf '%s\n' "$busy" >&2
    info "Настройте свой веб-сервер как обратный прокси на http://127.0.0.1:$PORT (с заголовками Host и X-Forwarded-For)."
    return
  fi
  if ! command -v caddy >/dev/null; then
    apt_install gnupg
    if curl -fsSL --proto '=https' https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg &&
      curl -fsSL --proto '=https' https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list; then
      chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
      apt-get update -qq
    else
      warn "официальный репозиторий Caddy недоступен — ставлю версию из репозитория дистрибутива."
      rm -f /etc/apt/sources.list.d/caddy-stable.list
    fi
    apt_install caddy
  fi
  # Обновления безопасности Caddy из официального репозитория ставятся автоматически.
  if [[ -f /etc/apt/sources.list.d/caddy-stable.list ]]; then
    printf '// Создано установщиком family-archive: автоматические обновления Caddy\nUnattended-Upgrade::Origins-Pattern {\n\t"site=dl.cloudsmith.io";\n};\n' >/etc/apt/apt.conf.d/51family-archive-caddy
  fi
  local max_mb
  max_mb="$(awk -F= '$1=="MAX_BACKUP_MB"{print $2}' "$ENV_FILE" | tail -n1)"
  [[ $max_mb =~ ^[0-9]+$ ]] || max_mb=1024
  mkdir -p /etc/caddy/conf.d
  cat >/etc/caddy/conf.d/family-archive.caddy <<EOF
# Создано установщиком family-archive
$DOMAIN {
	encode zstd gzip
	request_body {
		max_size $((max_mb + 100))MB
	}
	header {
		-Server
		Strict-Transport-Security "max-age=31536000"
	}
	reverse_proxy 127.0.0.1:$PORT
}
EOF
  local cf=/etc/caddy/Caddyfile
  if [[ ! -f $cf ]] || grep -q "The Caddyfile is an easy way to configure" "$cf" || grep -q "^# Управляется установщиком family-archive" "$cf"; then
    {
      echo "# Управляется установщиком family-archive"
      if [[ -n $EMAIL ]]; then printf '{\n\temail %s\n}\n\n' "$EMAIL"; fi
      echo "import /etc/caddy/conf.d/*.caddy"
    } >"$cf"
  elif ! grep -q 'import /etc/caddy/conf.d/\*.caddy' "$cf"; then
    cp "$cf" "$cf.bak-$(date +%Y%m%d%H%M%S)"
    printf '\nimport /etc/caddy/conf.d/*.caddy\n' >>"$cf"
    info "в существующий $cf добавлена строка import (копия сохранена рядом)."
  fi
  caddy validate --config "$cf" --adapter caddyfile >/dev/null 2>&1 || die "конфигурация Caddy неверна: проверьте $cf"
  systemctl enable caddy >/dev/null 2>&1
  systemctl reload-or-restart caddy
  local resolved
  resolved="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')"
  if [[ -z $resolved ]]; then
    warn "домен $DOMAIN пока не находится в DNS. Создайте запись A на IP этого сервера — сертификат выпустится автоматически."
  else
    info "домен $DOMAIN указывает на $resolved"
  fi
}

# Все порты, на которых может работать SSH: настройки sshd (Port и ListenAddress),
# сокет ssh.socket (Ubuntu 22.10+) и фактически слушающий sshd.
ssh_ports() {
  {
    sshd -T 2>/dev/null | awk '$1=="port"{print $2} $1=="listenaddress"{n=split($2,a,":"); print a[n]}'
    systemctl show -p Listen --value ssh.socket 2>/dev/null | tr ' ' '\n' | awk -F: '/:[0-9]+$/{print $NF}'
    ss -Hltnp 2>/dev/null | awk '/"sshd"/{n=split($4,a,":"); print a[n]}'
  } | grep -E '^[0-9]+$' | sort -un | tr '\n' ' ' | sed 's/ $//'
}

setup_firewall() {
  say "Брандмауэр (ufw)"
  local ports p answer
  ports="$(ssh_ports || true)"
  if [[ -z $ports ]]; then
    warn "не удалось определить порт SSH — брандмауэр не включён, чтобы не потерять доступ к серверу."
    return
  fi
  info "порты SSH: $ports"
  if [[ -t 0 ]]; then
    read -rp "    Разрешить SSH на этих портах и включить брандмауэр? [Y/n] " answer
    if [[ $answer =~ ^[nNнН] ]]; then
      warn "брандмауэр не включён (по вашему выбору) — его можно настроить вручную командой ufw."
      return
    fi
  fi
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  for p in $ports; do ufw limit "$p/tcp" >/dev/null; done
  if [[ -n $DOMAIN ]]; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  fi
  ufw --force enable >/dev/null
  info "открыты: SSH ($ports, с защитой от перебора)${DOMAIN:+, 80 и 443}; порт приложения $PORT снаружи закрыт."
}

if ((!SKIP_SYSTEM)); then
  if [[ -n $DOMAIN ]]; then
    # Домен добавлен позже, а брандмауэр (настроенный установщиком) уже включён: нужны порты 80 и 443.
    # Отметка сохраняется, поэтому и после прерванного запуска порты будут открыты при следующем.
    if ((FIREWALL_DONE && !SKIP_FIREWALL && !WEB_PORTS_DONE)) && command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
      ufw allow 80/tcp >/dev/null
      ufw allow 443/tcp >/dev/null
      WEB_PORTS_DONE=1
      write_install_conf
    fi
    setup_caddy
  elif ((DOMAIN_CHANGED)) && [[ -f /etc/caddy/conf.d/family-archive.caddy ]]; then
    rm -f /etc/caddy/conf.d/family-archive.caddy
    systemctl reload caddy 2>/dev/null || true
    info "сайт в Caddy отключён: архив доступен только через SSH-туннель."
  fi
  # Брандмауэр настраивается один раз (и при повторном запуске, если первая установка прервалась
  # раньше); дальше обновления не трогают правила администратора.
  if ((!SKIP_FIREWALL && !FIREWALL_DONE)); then
    setup_firewall
    FIREWALL_DONE=1
    [[ -n $DOMAIN ]] && WEB_PORTS_DONE=1
    write_install_conf
  fi
fi

# ---------- Итог ----------
say "Готово"
if [[ -n $DOMAIN ]]; then
  info "Адрес архива:  https://$DOMAIN"
else
  info "Архив доступен только с сервера. Чтобы открыть его на своём компьютере, выполните там:"
  info "  ssh -L 3000:127.0.0.1:$PORT ПОЛЬЗОВАТЕЛЬ@АДРЕС_СЕРВЕРА"
  info "и откройте http://localhost:3000"
fi
if ((GENERATED)); then
  info "Пароль для входа (сохраните его, больше он не будет показан):"
  info "  $SHOW_PW"
fi
info "Данные:        $DATA_DIR (база, фото, резервные копии)"
info "Настройки:     $ENV_FILE"
info "Управление:    sudo family-archive status | logs | backup | password | update"
info "Свободно на диске: $(df -Ph "$DATA_DIR" | awk 'NR==2{print $4}')"
