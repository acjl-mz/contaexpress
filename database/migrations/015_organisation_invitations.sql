BEGIN;

CREATE TABLE IF NOT EXISTS organisation_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('client_manager','accountant','tax_officer','payroll_officer','finance_manager','client_director','auditor')),
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (expires_at > created_at),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX IF NOT EXISTS organisation_invitations_pending_idx
  ON organisation_invitations (organisation_id, lower(email), expires_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS organisation_invitations_email_idx
  ON organisation_invitations (lower(email), expires_at DESC)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

COMMIT;
