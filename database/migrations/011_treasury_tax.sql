BEGIN;

CREATE TABLE IF NOT EXISTS treasury_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 120),
  account_type TEXT NOT NULL CHECK (account_type IN ('cash', 'bank', 'mobile_money')),
  institution TEXT CHECK (institution IS NULL OR length(institution) <= 120),
  account_reference TEXT CHECK (account_reference IS NULL OR length(account_reference) <= 120),
  currency CHAR(3) NOT NULL DEFAULT 'MZN' CHECK (currency ~ '^[A-Z]{3}$'),
  opening_balance NUMERIC(20,2) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id, id)
);

CREATE TABLE IF NOT EXISTS treasury_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  treasury_account_id UUID NOT NULL,
  transaction_date DATE NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inflow', 'outflow')),
  category TEXT NOT NULL CHECK (category IN ('customer_receipt', 'supplier_payment', 'salary', 'tax', 'fee', 'transfer', 'other')),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 2 AND 240),
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  reference TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  counterparty TEXT CHECK (counterparty IS NULL OR length(counterparty) <= 180),
  status TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'reconciled', 'voided')),
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (accounting_entity_id, treasury_account_id)
    REFERENCES treasury_accounts(accounting_entity_id, id) ON DELETE RESTRICT,
  UNIQUE (accounting_entity_id, id)
);
CREATE INDEX IF NOT EXISTS treasury_transactions_entity_date_idx
  ON treasury_transactions(accounting_entity_id, transaction_date DESC);

CREATE TABLE IF NOT EXISTS tax_obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('IVA', 'IRPS', 'IRPC', 'ISPC', 'INSS', 'IRRM', 'OTHER')),
  period_label TEXT NOT NULL CHECK (length(trim(period_label)) BETWEEN 2 AND 80),
  due_date DATE NOT NULL,
  amount_due NUMERIC(20,2) CHECK (amount_due IS NULL OR amount_due >= 0),
  amount_paid NUMERIC(20,2) CHECK (amount_paid IS NULL OR amount_paid >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'prepared', 'submitted', 'paid', 'not_applicable')),
  submitted_at DATE,
  paid_at DATE,
  reference TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 1500),
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id, id),
  CHECK ((status <> 'submitted' OR submitted_at IS NOT NULL) AND (status <> 'paid' OR paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS tax_obligations_entity_due_idx
  ON tax_obligations(accounting_entity_id, due_date, status);

CREATE OR REPLACE FUNCTION set_treasury_account_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS treasury_accounts_updated_at ON treasury_accounts;
CREATE TRIGGER treasury_accounts_updated_at BEFORE UPDATE ON treasury_accounts
FOR EACH ROW EXECUTE FUNCTION set_treasury_account_updated_at();
DROP TRIGGER IF EXISTS treasury_transactions_updated_at ON treasury_transactions;
CREATE TRIGGER treasury_transactions_updated_at BEFORE UPDATE ON treasury_transactions
FOR EACH ROW EXECUTE FUNCTION set_treasury_account_updated_at();
DROP TRIGGER IF EXISTS tax_obligations_updated_at ON tax_obligations;
CREATE TRIGGER tax_obligations_updated_at BEFORE UPDATE ON tax_obligations
FOR EACH ROW EXECUTE FUNCTION set_treasury_account_updated_at();

COMMIT;
