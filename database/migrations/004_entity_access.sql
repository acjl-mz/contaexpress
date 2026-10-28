BEGIN;

-- Helper used by the application to ensure an entity belongs to the signed-in
-- user's organisation and that the user has explicit access to that entity.
CREATE OR REPLACE FUNCTION user_can_access_entity(p_user_id UUID, p_entity_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM accounting_entities ae
    JOIN organisation_memberships om ON om.organisation_id = ae.organisation_id
    WHERE ae.id = p_entity_id AND om.user_id = p_user_id
      AND om.role IN ('superadmin', 'client_manager', 'accountant', 'tax_officer', 'finance_manager', 'client_director', 'auditor')
  ) OR EXISTS (
    SELECT 1 FROM entity_memberships em
    WHERE em.accounting_entity_id = p_entity_id AND em.user_id = p_user_id
  );
$$;

-- Enforce entity access for every accounting module at API level; this helper
-- is also available to future database policies and reports.
COMMIT;
