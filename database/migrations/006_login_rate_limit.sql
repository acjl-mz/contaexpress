BEGIN;

-- Store only keyed hashes, never raw email addresses or IP addresses.
CREATE TABLE IF NOT EXISTS auth_login_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('ip', 'email')),
  identifier_hash CHAR(64) NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  succeeded BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS auth_login_attempts_lookup_idx
  ON auth_login_attempts (identifier_type, identifier_hash, attempted_at DESC);

COMMIT;
