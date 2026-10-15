#!/usr/bin/env bash
# Управление «Историей нашего рода» на сервере. Устанавливается как /usr/local/sbin/family-archive.
#   sudo family-archive status | logs [N] | restart | backup | password | update
set -Eeuo pipefail

CONF=/etc/family-archive/install.conf
if [[ $EUID -ne 0 ]]; then
  echo "Запустите через sudo: sudo family-archive ${*:-help}" >&2
  exit 1
fi
[[ -f $CONF ]] || {
  echo "Не найдены настройки установки ($CONF). Установите приложение: sudo bash deploy/install.sh" >&2
  exit 1
}
# shellcheck source=/dev/null
. "$CONF"
NODE="$NODE_ROOT/bin/node"

load_env() {
  local line
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line =~ ^[A-Z_][A-Z0-9_]*= ]]; then export "${line?}"; fi
  done <"$ENV_FILE"
}

run_app_script() {
  (
    cd "$APP_DIR"
    load_env
    exec runuser -u "$SERVICE_USER" -- "$NODE" --disable-warning=ExperimentalWarning "$@"
  )
}

usage() {
  cat <<'EOF'
Управление семейным архивом:
  sudo family-archive status     состояние службы и место на диске
  sudo family-archive logs [N]   последние N строк журнала (по умолчанию 100)
  sudo family-archive restart    перезапуск
  sudo family-archive backup     создать резервную копию сейчас
  sudo family-archive password   сменить пароль входа (все устройства выйдут)
  sudo family-archive update     скачать обновление (git pull) и установить его
EOF
}

case "${1:-help}" in
  status)
    systemctl --no-pager --lines=0 status "$SERVICE" || true
    echo
    df -Ph "$DATA_DIR" | awk 'NR==2{print "Диск: свободно " $4 " из " $2}'
    for d in photos backups imports; do
      [[ -d $DATA_DIR/$d ]] && du -sh "$DATA_DIR/$d" | awk -v n="$d" '{print "  " n ": " $1}'
    done
    du -ch "$DATA_DIR"/family.db* 2>/dev/null | awk 'END{print "  база: " $1}'
    [[ -n ${DOMAIN:-} ]] && echo "Адрес: https://$DOMAIN"
    ;;
  logs)
    n="${2:-100}"
    [[ $n =~ ^[0-9]+$ ]] || n=100
    journalctl -u "$SERVICE" -n "$n" --no-pager
    ;;
  restart)
    systemctl restart "$SERVICE"
    echo "Перезапущено."
    ;;
  backup)
    run_app_script scripts/backup-cli.mjs
    ;;
  password)
    read -rsp "Новый пароль (не короче 10 символов): " pw
    echo
    read -rsp "Повторите пароль: " pw2
    echo
    [[ $pw == "$pw2" ]] || {
      echo "Пароли не совпадают." >&2
      exit 1
    }
    ((${#pw} >= 10)) || {
      echo "Пароль слишком короткий." >&2
      exit 1
    }
    hash="$(cd "$APP_DIR" && printf '%s' "$pw" | "$NODE" scripts/hash-password.mjs --stdin)"
    unset pw pw2
    [[ $hash == scrypt:* ]] || {
      echo "Не удалось создать хэш пароля." >&2
      exit 1
    }
    tmp="$(mktemp /etc/family-archive/env.XXXXXX)"
    awk -v h="$hash" '/^APP_PASSWORD_HASH=/{print "APP_PASSWORD_HASH=" h; done=1; next} /^APP_PASSWORD=/{next} {print} END{if(!done) print "APP_PASSWORD_HASH=" h}' "$ENV_FILE" >"$tmp"
    chmod 0600 "$tmp"
    mv "$tmp" "$ENV_FILE"
    systemctl restart "$SERVICE"
    echo "Пароль изменён. Все устройства должны войти заново."
    ;;
  update)
    [[ -d $SRC_DIR/.git ]] || {
      echo "Не найдена папка с исходниками ($SRC_DIR). Скачайте проект заново и запустите deploy/install.sh --update." >&2
      exit 1
    }
    git -C "$SRC_DIR" pull --ff-only
    bash "$SRC_DIR/deploy/install.sh" --update
    ;;
  help | -h | --help) usage ;;
  *)
    usage
    exit 1
    ;;
esac
