#!/usr/bin/env bash
set -euo pipefail

: "${RESTORE_DATABASE_URL:?Defina RESTORE_DATABASE_URL para a base de dados a verificar}"
core_result="$(psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "
SELECT CASE
  WHEN to_regclass('public.organisations') IS NOT NULL
   AND to_regclass('public.accounting_entities') IS NOT NULL
   AND to_regclass('public.journal_entries') IS NOT NULL
   AND to_regclass('public.journal_entry_lines') IS NOT NULL
   AND to_regclass('public.audit_events') IS NOT NULL
  THEN 'OK'
  ELSE 'ERRO'
END;
")"
if [[ "$core_result" != "OK" ]]; then
  echo "Verificação falhou: faltam tabelas contabilísticas principais." >&2
  exit 1
fi
result="$(psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
if [[ "$result" -lt 10 ]]; then
  echo "Verificação falhou: apenas $result tabelas públicas encontradas." >&2
  exit 1
fi
echo "Verificação estrutural concluída: tabelas principais presentes; $result tabelas públicas."
