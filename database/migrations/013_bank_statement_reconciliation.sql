BEGIN;

CREATE TABLE IF NOT EXISTS bank_statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  treasury_account_id UUID NOT NULL,
  file_name TEXT NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 180),
  statement_start DATE,
  statement_end DATE,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count BETWEEN 0 AND 1000),
  imported_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id, id),
  FOREIGN KEY (accounting_entity_id, treasury_account_id)
    REFERENCES treasury_accounts(accounting_entity_id, id) ON DELETE RESTRICT,
  CHECK (statement_start IS NULL OR statement_end IS NULL OR statement_start <= statement_end)
);

CREATE TABLE IF NOT EXISTS bank_statement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  import_id UUID NOT NULL,
  treasury_account_id UUID NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number BETWEEN 1 AND 1000),
  line_date DATE NOT NULL,
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 240),
  direction TEXT NOT NULL CHECK (direction IN ('inflow','outflow')),
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  reference TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  treasury_transaction_id UUID,
  status TEXT NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','ignored')),
  matched_by UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  matched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id, id),
  FOREIGN KEY (accounting_entity_id, import_id)
    REFERENCES bank_statement_imports(accounting_entity_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id, treasury_account_id)
    REFERENCES treasury_accounts(accounting_entity_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id, treasury_transaction_id)
    REFERENCES treasury_transactions(accounting_entity_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'matched' AND treasury_transaction_id IS NOT NULL AND matched_at IS NOT NULL)
      OR (status <> 'matched' AND treasury_transaction_id IS NULL AND matched_at IS NULL))
);
-- Backfill line numbers for installations that applied an earlier version of this migration.
ALTER TABLE bank_statement_lines ADD COLUMN IF NOT EXISTS line_number INTEGER;
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY import_id ORDER BY created_at, id)::INTEGER AS n
  FROM bank_statement_lines WHERE line_number IS NULL
)
UPDATE bank_statement_lines l SET line_number = numbered.n
FROM numbered WHERE l.id = numbered.id;
ALTER TABLE bank_statement_lines ALTER COLUMN line_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_lines_import_line_unique
  ON bank_statement_lines(import_id, line_number);

CREATE UNIQUE INDEX IF NOT EXISTS bank_statement_lines_transaction_unique
  ON bank_statement_lines(accounting_entity_id, treasury_transaction_id)
  WHERE treasury_transaction_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bank_statement_lines_pending_idx
  ON bank_statement_lines(accounting_entity_id, treasury_account_id, status, line_date);
CREATE INDEX IF NOT EXISTS bank_statement_imports_account_idx
  ON bank_statement_imports(accounting_entity_id, treasury_account_id, created_at DESC);

COMMIT;
