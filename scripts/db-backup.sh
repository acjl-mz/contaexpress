#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Configure DATABASE_URL before creating a backup}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
BACKUP_GPG_RECIPIENT="${BACKUP_GPG_RECIPIENT:-}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$BACKUP_DIR/contaexpress-$timestamp.dump"
metadata_file="$backup_file.metadata.txt"

umask 077
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$backup_file"
pg_restore --list "$backup_file" >/dev/null
sha256sum "$backup_file" > "$backup_file.sha256"
{
  printf 'created_utc=%s\n' "$timestamp"
  printf 'format=postgres-custom\n'
  printf 'database_fingerprint=%s\n' "$(printf '%s' "$DATABASE_URL" | sha256sum | cut -d' ' -f1)"
  printf 'backup_file=%s\n' "$(basename "$backup_file")"
} > "$metadata_file"
chmod 600 "$backup_file" "$backup_file.sha256" "$metadata_file"
echo "Backup criado e validado: $backup_file"
echo "Checksum: $backup_file.sha256"

if [[ -n "$BACKUP_GPG_RECIPIENT" ]]; then
  command -v gpg >/dev/null || { echo "gpg é obrigatório para cifragem." >&2; exit 1; }
  encrypted_file="$backup_file.gpg"
  gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --output "$encrypted_file" --encrypt "$backup_file"
  sha256sum "$encrypted_file" > "$encrypted_file.sha256"
  chmod 600 "$encrypted_file" "$encrypted_file.sha256"
  rm -f "$backup_file" "$backup_file.sha256"
  echo "Backup cifrado: $encrypted_file"
fi

if [[ -n "$BACKUP_REMOTE" ]]; then
  command -v rclone >/dev/null || { echo "rclone é obrigatório para envio externo." >&2; exit 1; }
  [[ -n "$BACKUP_GPG_RECIPIENT" ]] || { echo "Envio externo recusado: configure BACKUP_GPG_RECIPIENT para cifrar o backup antes de o transmitir." >&2; exit 1; }
  rclone copy "$BACKUP_DIR" "$BACKUP_REMOTE" --include "contaexpress-*.dump.gpg" --include "contaexpress-*.dump.gpg.sha256" --include "contaexpress-*.dump.metadata.txt" --max-age 24h
  rclone delete "$BACKUP_REMOTE" --min-age "${BACKUP_RETENTION_DAYS}d" --include "contaexpress-*.dump.gpg" --include "contaexpress-*.dump.gpg.sha256" --include "contaexpress-*.dump.metadata.txt"
  echo "Backup cifrado enviado; retenção remota aplicada: ${BACKUP_RETENTION_DAYS} dias."
fi
