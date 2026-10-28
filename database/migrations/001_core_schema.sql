-- ContaExpress initial PostgreSQL schema.
-- This migration establishes the core data model; application-level authorization
-- and tenant-aware database policies must be implemented before production use.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounting_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  legal_name TEXT NOT NULL CHECK (length(trim(legal_name)) > 0),
  tax_number TEXT,
  country_code CHAR(2) NOT NULL DEFAULT 'MZ',
  functional_currency CHAR(3) NOT NULL DEFAULT 'MZN',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, id)
);
CREATE INDEX IF NOT EXISTS accounting_entities_org_idx ON accounting_entities(organisation_id);

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organisation_memberships (
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('superadmin', 'client_manager', 'accountant', 'tax_officer', 'payroll_officer', 'finance_manager', 'client_director', 'auditor')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS entity_memberships (
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('accountant', 'tax_officer', 'payroll_officer', 'finance_manager', 'client_director', 'auditor', 'document_manager')),
  can_view_sensitive_data BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (accounting_entity_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS fiscal_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  UNIQUE (accounting_entity_id, label),
  UNIQUE (accounting_entity_id, id)
);

CREATE TABLE IF NOT EXISTS accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE RESTRICT,
  label TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'locked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  UNIQUE (fiscal_year_id, label),
  UNIQUE (accounting_entity_id, id),
  FOREIGN KEY (accounting_entity_id, fiscal_year_id)
    REFERENCES fiscal_years(accounting_entity_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  code TEXT NOT NULL CHECK (length(trim(code)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense', 'memo')),
  parent_account_id UUID,
  is_postable BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id, code),
  UNIQUE (accounting_entity_id, id),
  FOREIGN KEY (accounting_entity_id, parent_account_id)
    REFERENCES chart_of_accounts(accounting_entity_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS accounting_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id, code),
  UNIQUE (accounting_entity_id, id)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  period_id UUID NOT NULL REFERENCES accounting_periods(id) ON DELETE RESTRICT,
  journal_id UUID NOT NULL REFERENCES accounting_journals(id) ON DELETE RESTRICT,
  entry_number BIGINT,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'reversed')),
  source_reference TEXT,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  posted_by UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  posted_at TIMESTAMPTZ,
  reverses_entry_id UUID REFERENCES journal_entries(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id, id),
  UNIQUE (accounting_entity_id, journal_id, entry_number),
  FOREIGN KEY (accounting_entity_id, period_id)
    REFERENCES accounting_periods(accounting_entity_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id, journal_id)
    REFERENCES accounting_journals(accounting_entity_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id, reverses_entry_id)
    REFERENCES journal_entries(accounting_entity_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'draft' AND posted_at IS NULL)
    OR (status IN ('posted', 'reversed') AND posted_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS journal_entries_entity_date_idx
  ON journal_entries(accounting_entity_id, entry_date);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  entry_id UUID NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  account_id UUID NOT NULL,
  description TEXT,
  debit NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(20, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entry_id, line_number),
  FOREIGN KEY (accounting_entity_id, entry_id)
    REFERENCES journal_entries(accounting_entity_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (accounting_entity_id, account_id)
    REFERENCES chart_of_accounts(accounting_entity_id, id) ON DELETE RESTRICT,
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);
CREATE INDEX IF NOT EXISTS journal_entry_lines_account_idx
  ON journal_entry_lines(accounting_entity_id, account_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organisation_id UUID REFERENCES organisations(id) ON DELETE RESTRICT,
  accounting_entity_id UUID REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_entity_created_idx
  ON audit_events(accounting_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_created_idx
  ON audit_events(actor_user_id, created_at DESC);

COMMIT;

-- Important: application transactions must validate each posted journal entry:
-- at least two lines, sum(debit) = sum(credit), open period, postable accounts,
-- authorized actor, and immutable posted history. A future database trigger or
-- stored procedure should enforce posting invariants atomically.
