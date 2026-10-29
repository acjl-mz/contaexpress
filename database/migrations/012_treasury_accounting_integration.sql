BEGIN;

-- Map each treasury account/category/direction to the general-ledger accounts.
-- Integration creates a draft only; a qualified user must review and post it.
CREATE TABLE IF NOT EXISTS treasury_posting_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  treasury_account_id UUID NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inflow','outflow')),
  category TEXT NOT NULL CHECK (category IN ('customer_receipt','supplier_payment','salary','tax','fee','transfer','other')),
  ledger_account_id UUID NOT NULL,
  counterpart_account_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (accounting_entity_id, treasury_account_id)
    REFERENCES treasury_accounts(accounting_entity_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id, ledger_account_id)
    REFERENCES chart_of_accounts(accounting_entity_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id, counterpart_account_id)
    REFERENCES chart_of_accounts(accounting_entity_id,id) ON DELETE RESTRICT,
  UNIQUE (accounting_entity_id,id),
  UNIQUE (accounting_entity_id,treasury_account_id,direction,category),
  CHECK (ledger_account_id <> counterpart_account_id)
);

ALTER TABLE treasury_transactions
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'treasury_transactions_journal_entry_fk') THEN
    ALTER TABLE treasury_transactions
      ADD CONSTRAINT treasury_transactions_journal_entry_fk
      FOREIGN KEY (accounting_entity_id,journal_entry_id)
      REFERENCES journal_entries(accounting_entity_id,id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_treasury_source_unique
  ON journal_entries(accounting_entity_id,source_reference)
  WHERE source_reference LIKE 'treasury_transaction:%';

CREATE INDEX IF NOT EXISTS treasury_posting_mappings_lookup_idx
  ON treasury_posting_mappings(accounting_entity_id,treasury_account_id,direction,category);

CREATE OR REPLACE FUNCTION set_treasury_mapping_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS treasury_posting_mappings_updated_at ON treasury_posting_mappings;
CREATE TRIGGER treasury_posting_mappings_updated_at
BEFORE UPDATE ON treasury_posting_mappings
FOR EACH ROW EXECUTE FUNCTION set_treasury_mapping_updated_at();

COMMIT;
