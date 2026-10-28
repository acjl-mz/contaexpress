BEGIN;

CREATE TABLE IF NOT EXISTS accounting_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  category TEXT NOT NULL DEFAULT 'other' CHECK (category IN ('documents', 'bookkeeping', 'tax', 'payroll', 'reconciliation', 'monthly_close', 'other')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'blocked', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  due_date DATE,
  assigned_to UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (accounting_entity_id, id),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR (status <> 'completed' AND completed_at IS NULL))
);

CREATE INDEX IF NOT EXISTS accounting_tasks_entity_status_due_idx
  ON accounting_tasks(accounting_entity_id, status, due_date);
CREATE INDEX IF NOT EXISTS accounting_tasks_assigned_idx
  ON accounting_tasks(assigned_to, status, due_date);
CREATE INDEX IF NOT EXISTS accounting_tasks_entity_created_idx
  ON accounting_tasks(accounting_entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION set_accounting_task_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounting_tasks_updated_at ON accounting_tasks;
CREATE TRIGGER accounting_tasks_updated_at
BEFORE UPDATE ON accounting_tasks
FOR EACH ROW EXECUTE FUNCTION set_accounting_task_updated_at();

COMMIT;
