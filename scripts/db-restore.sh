#!/usr/bin/env bash
set -euo pipefail

backup_file="${1:-}"
if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
  echo "Uso: RESTORE_DATABASE_URL=... RESTORE_CONFIRM=YES_RESTORE_DATABASE ./scripts/db-restore.sh caminho/backup.dump" >&2
  exit 2
fi
: "${RESTORE_DATABASE_URL:?Defina explicitamente a base de dados de destino em RESTORE_DATABASE_URL}"
if [[ "${RESTORE_CONFIRM:-}" != "YES_RESTORE_DATABASE" ]]; then
  echo "Restauro recusado. Defina RESTORE_CONFIRM=YES_RESTORE_DATABASE depois de confirmar o destino." >&2
  exit 2
fi
if [[ -n "${DATABASE_URL:-}" ]]; then
  source_identity="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT current_database() || '|' || COALESCE(inet_server_addr()::text, 'local') || '|' || COALESCE(inet_server_port()::text, 'local')")"
  target_identity="$(psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT current_database() || '|' || COALESCE(inet_server_addr()::text, 'local') || '|' || COALESCE(inet_server_port()::text, 'local')")"
  if [[ "$source_identity" == "$target_identity" ]]; then
    echo "Restauro recusado: o destino é a mesma base de dados de origem." >&2
    exit 2
  fi
fi
if [[ ! -f "$backup_file.sha256" ]]; then
  echo "Checksum ausente: esperado $backup_file.sha256" >&2
  exit 2
fi
sha256sum --check "$backup_file.sha256"
pg_restore --list "$backup_file" >/dev/null
echo "A restaurar para o destino explicitamente indicado. Os objectos existentes no destino serão substituídos."
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$RESTORE_DATABASE_URL" "$backup_file"
echo "Restauro concluído. Execute scripts/db-verify.sh com RESTORE_DATABASE_URL apontado para a base restaurada."
