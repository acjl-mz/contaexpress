#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?Configure DATABASE_URL before creating a backup}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
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
