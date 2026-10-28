BEGIN;

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_uq
  ON app_users (lower(email));

-- New users must receive a password hash from the controlled admin bootstrap
-- process or a future invitation/reset workflow. Existing accounts without a
-- hash cannot authenticate until explicitly provisioned.

COMMIT;
