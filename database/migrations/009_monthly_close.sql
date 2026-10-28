BEGIN;

CREATE TABLE IF NOT EXISTS accounting_period_closes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  accounting_period_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  closed_by UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  UNIQUE (accounting_entity_id, accounting_period_id),
  UNIQUE (accounting_entity_id, id),
  FOREIGN KEY (accounting_entity_id, accounting_period_id)
    REFERENCES accounting_periods(accounting_entity_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL)
      OR (status = 'open' AND closed_by IS NULL AND closed_at IS NULL))
);

CREATE TABLE IF NOT EXISTS accounting_period_close_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL,
  close_id UUID NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  description TEXT CHECK (description IS NULL OR length(description) <= 1000),
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'not_applicable')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  completed_by UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (accounting_entity_id, close_id)
    REFERENCES accounting_period_closes(accounting_entity_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'completed' AND completed_by IS NOT NULL AND completed_at IS NOT NULL)
      OR (status <> 'completed' AND completed_by IS NULL AND completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS accounting_period_close_items_close_idx
  ON accounting_period_close_items(accounting_entity_id, close_id, sort_order);

CREATE OR REPLACE FUNCTION set_accounting_period_close_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounting_period_closes_updated_at ON accounting_period_closes;
CREATE TRIGGER accounting_period_closes_updated_at
BEFORE UPDATE ON accounting_period_closes
FOR EACH ROW EXECUTE FUNCTION set_accounting_period_close_updated_at();

DROP TRIGGER IF EXISTS accounting_period_close_items_updated_at ON accounting_period_close_items;
CREATE TRIGGER accounting_period_close_items_updated_at
BEFORE UPDATE ON accounting_period_close_items
FOR EACH ROW EXECUTE FUNCTION set_accounting_period_close_updated_at();

COMMIT;
