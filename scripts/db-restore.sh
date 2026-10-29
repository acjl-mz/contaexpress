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
if [[ -n "${DATABASE_URL:-}" && "$RESTORE_DATABASE_URL" == "$DATABASE_URL" ]]; then
  echo "Restauro recusado: o destino coincide com DATABASE_URL." >&2
  exit 2
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
