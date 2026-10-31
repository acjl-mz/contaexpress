BEGIN;

-- Indexes supporting the platform administration dashboard and tenant lookup.
CREATE INDEX IF NOT EXISTS organisations_status_created_idx
  ON organisations(status, created_at DESC);

CREATE INDEX IF NOT EXISTS organisation_memberships_org_role_idx
  ON organisation_memberships(organisation_id, role);

CREATE INDEX IF NOT EXISTS platform_administrators_created_idx
  ON platform_administrators(created_at DESC);

COMMIT;
