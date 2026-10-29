BEGIN;

-- National rules are global reference data, not tenant-owned tax calculations.
-- No live rates are seeded: a rule cannot be activated without source verification
-- and an independent approval recorded by a different user from its author.
CREATE TABLE IF NOT EXISTS tax_rule_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key TEXT NOT NULL CHECK (rule_key ~ '^[a-z][a-z0-9._-]{2,79}$'),
  version INTEGER NOT NULL CHECK (version > 0),
  jurisdiction CHAR(2) NOT NULL DEFAULT 'MZ' CHECK (jurisdiction = 'MZ'),
  tax_type TEXT NOT NULL CHECK (tax_type IN ('IVA','IRPS','IRPC','ISPC','INSS','IRRM','OTHER')),
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 180),
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  calculation_method TEXT NOT NULL CHECK (calculation_method IN ('percentage_of_base','fixed_amount','progressive_brackets','manual')),
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parameters) = 'object'),
  effective_from DATE NOT NULL,
  effective_to DATE,
  legal_reference TEXT NOT NULL CHECK (length(trim(legal_reference)) BETWEEN 6 AND 300),
  source_url TEXT NOT NULL CHECK (source_url ~ '^https://'),
  source_published_on DATE,
  source_verified_on DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','active','retired')),
  review_notes TEXT CHECK (review_notes IS NULL OR length(review_notes) <= 3000),
  created_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  approved_by UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  activated_by UUID REFERENCES app_users(id) ON DELETE RESTRICT,
  activated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (
    status NOT IN ('approved','active','retired') OR
    (source_verified_on IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CHECK (status <> 'active' OR (activated_by IS NOT NULL AND activated_at IS NOT NULL)),
  CHECK (status <> 'retired' OR (activated_by IS NOT NULL AND activated_at IS NOT NULL AND retired_at IS NOT NULL)),
  CHECK (reviewed_by IS NULL OR reviewed_by <> created_by),
  CHECK (approved_by IS NULL OR approved_by <> created_by),
  CHECK (approved_by IS NULL OR reviewed_by IS NULL OR approved_by = reviewed_by)
);

CREATE INDEX IF NOT EXISTS tax_rule_versions_lookup_idx
  ON tax_rule_versions(tax_type, jurisdiction, status, effective_from DESC);
CREATE INDEX IF NOT EXISTS tax_rule_versions_key_idx
  ON tax_rule_versions(rule_key, version DESC);

CREATE TABLE IF NOT EXISTS tax_rule_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_version_id UUID NOT NULL REFERENCES tax_rule_versions(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('created','submitted_for_review','approved','activated','retired','calculation_preview')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tax_rule_audit_events_rule_idx
  ON tax_rule_audit_events(rule_version_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_tax_rule_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'retired' AND NEW.status <> 'retired' THEN
    RAISE EXCEPTION 'Uma versão fiscal retirada não pode ser reactivada; crie uma nova versão.';
  END IF;

  IF OLD.status = 'active' AND NEW.status NOT IN ('active','retired') THEN
    RAISE EXCEPTION 'Uma versão fiscal activa só pode ser retirada.';
  END IF;

  IF OLD.status = 'approved' AND NEW.status NOT IN ('approved','active') THEN
    RAISE EXCEPTION 'Uma versão fiscal aprovada só pode ser activada.';
  END IF;

  IF OLD.status IN ('in_review','approved','active','retired') AND (
    NEW.rule_key IS DISTINCT FROM OLD.rule_key OR
    NEW.version IS DISTINCT FROM OLD.version OR
    NEW.jurisdiction IS DISTINCT FROM OLD.jurisdiction OR
    NEW.tax_type IS DISTINCT FROM OLD.tax_type OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.description IS DISTINCT FROM OLD.description OR
    NEW.calculation_method IS DISTINCT FROM OLD.calculation_method OR
    NEW.parameters IS DISTINCT FROM OLD.parameters OR
    NEW.effective_from IS DISTINCT FROM OLD.effective_from OR
    NEW.effective_to IS DISTINCT FROM OLD.effective_to OR
    NEW.legal_reference IS DISTINCT FROM OLD.legal_reference OR
    NEW.source_url IS DISTINCT FROM OLD.source_url OR
    NEW.source_published_on IS DISTINCT FROM OLD.source_published_on
  ) THEN
    RAISE EXCEPTION 'A regra submetida para revisão é imutável; corrija-a através de um novo rascunho/versionamento.';
  END IF;

  IF OLD.status IN ('approved','active','retired') AND (
    NEW.source_verified_on IS DISTINCT FROM OLD.source_verified_on OR
    NEW.review_notes IS DISTINCT FROM OLD.review_notes OR
    NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR
    NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR
    NEW.approved_by IS DISTINCT FROM OLD.approved_by OR
    NEW.approved_at IS DISTINCT FROM OLD.approved_at
  ) THEN
    RAISE EXCEPTION 'A validação e aprovação registadas não podem ser alteradas.';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_rule_versions_protect_update ON tax_rule_versions;
CREATE TRIGGER tax_rule_versions_protect_update
BEFORE UPDATE ON tax_rule_versions
FOR EACH ROW EXECUTE FUNCTION protect_tax_rule_version();

COMMIT;
