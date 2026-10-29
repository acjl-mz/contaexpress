BEGIN;

CREATE TABLE IF NOT EXISTS commercial_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  partner_type TEXT NOT NULL CHECK (partner_type IN ('customer','supplier','both')),
  legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) BETWEEN 2 AND 180),
  tax_number TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id,id)
);
CREATE INDEX IF NOT EXISTS commercial_partners_lookup_idx
  ON commercial_partners(accounting_entity_id,partner_type,is_active,legal_name);

CREATE TABLE IF NOT EXISTS commercial_account_mappings (
  accounting_entity_id UUID PRIMARY KEY REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  receivable_account_id UUID NOT NULL,
  payable_account_id UUID NOT NULL,
  sales_account_id UUID NOT NULL,
  purchase_account_id UUID NOT NULL,
  output_tax_account_id UUID,
  input_tax_account_id UUID,
  updated_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (accounting_entity_id,receivable_account_id) REFERENCES chart_of_accounts(accounting_entity_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id,payable_account_id) REFERENCES chart_of_accounts(accounting_entity_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id,sales_account_id) REFERENCES chart_of_accounts(accounting_entity_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id,purchase_account_id) REFERENCES chart_of_accounts(accounting_entity_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id,output_tax_account_id) REFERENCES chart_of_accounts(accounting_entity_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id,input_tax_account_id) REFERENCES chart_of_accounts(accounting_entity_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS commercial_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  partner_id UUID NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('sales_invoice','supplier_bill')),
  document_number TEXT NOT NULL CHECK (length(trim(document_number)) BETWEEN 1 AND 80),
  document_date DATE NOT NULL,
  due_date DATE,
  currency CHAR(3) NOT NULL DEFAULT 'MZN' CHECK (currency ~ '^[A-Z]{3}$'),
  net_amount NUMERIC(20,2) NOT NULL CHECK (net_amount >= 0),
  tax_amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(20,2) NOT NULL CHECK (total_amount > 0),
  tax_type TEXT,
  tax_reference TEXT,
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 2 AND 500),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','accounting_draft','posted','partially_paid','paid','voided')),
  journal_entry_id UUID,
  external_reference TEXT,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id,id),
  UNIQUE (accounting_entity_id,document_type,document_number),
  FOREIGN KEY (accounting_entity_id,partner_id) REFERENCES commercial_partners(accounting_entity_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id,journal_entry_id) REFERENCES journal_entries(accounting_entity_id,id) ON DELETE RESTRICT,
  CHECK (round(net_amount + tax_amount,2) = round(total_amount,2)),
  CHECK (due_date IS NULL OR due_date >= document_date)
);
CREATE INDEX IF NOT EXISTS commercial_documents_entity_date_idx
  ON commercial_documents(accounting_entity_id,document_date DESC);
CREATE INDEX IF NOT EXISTS commercial_documents_partner_idx
  ON commercial_documents(accounting_entity_id,partner_id,document_date DESC);

CREATE TABLE IF NOT EXISTS commercial_document_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  document_id UUID NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 240),
  quantity NUMERIC(20,4) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(20,4) NOT NULL CHECK (unit_price >= 0),
  net_amount NUMERIC(20,2) NOT NULL CHECK (net_amount >= 0),
  tax_amount NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  UNIQUE (document_id,line_number),
  FOREIGN KEY (accounting_entity_id,document_id) REFERENCES commercial_documents(accounting_entity_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS commercial_document_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  document_id UUID NOT NULL,
  treasury_transaction_id UUID NOT NULL,
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (accounting_entity_id,document_id) REFERENCES commercial_documents(accounting_entity_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id,treasury_transaction_id) REFERENCES treasury_transactions(accounting_entity_id,id) ON DELETE RESTRICT,
  UNIQUE (accounting_entity_id,treasury_transaction_id)
);
CREATE INDEX IF NOT EXISTS commercial_document_payments_doc_idx
  ON commercial_document_payments(accounting_entity_id,document_id);

COMMIT;
