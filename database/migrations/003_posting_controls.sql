BEGIN;

-- A posted entry is an immutable accounting record. Corrections must use a
-- separately posted reversal, never edit or delete posted lines.
CREATE OR REPLACE FUNCTION prevent_posted_entry_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO old_status FROM journal_entries WHERE id = OLD.entry_id;
    IF old_status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'Não é permitido apagar linhas de um lançamento confirmado.';
    END IF;
    RETURN OLD;
  END IF;

  SELECT status INTO old_status FROM journal_entries WHERE id = OLD.entry_id;
  IF old_status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Não é permitido alterar linhas de um lançamento confirmado.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_lines_immutable_after_posting ON journal_entry_lines;
CREATE TRIGGER journal_lines_immutable_after_posting
BEFORE UPDATE OR DELETE ON journal_entry_lines
FOR EACH ROW EXECUTE FUNCTION prevent_posted_entry_mutation();

CREATE OR REPLACE FUNCTION prevent_posted_entry_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('posted', 'reversed') THEN
    RAISE EXCEPTION 'Não é permitido apagar um lançamento confirmado.';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS journal_entry_immutable_delete ON journal_entries;
CREATE TRIGGER journal_entry_immutable_delete
BEFORE DELETE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION prevent_posted_entry_delete();

CREATE OR REPLACE FUNCTION post_journal_entry(p_entry_id UUID, p_actor_id UUID)
RETURNS TABLE(entry_id UUID, assigned_number BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
  v_entry journal_entries%ROWTYPE;
  v_period accounting_periods%ROWTYPE;
  v_count INTEGER;
  v_debit NUMERIC(20,2);
  v_credit NUMERIC(20,2);
  v_number BIGINT;
BEGIN
  SELECT * INTO v_entry
  FROM journal_entries
  WHERE id = p_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF v_entry.status <> 'draft' THEN RAISE EXCEPTION 'Apenas lançamentos em rascunho podem ser confirmados.'; END IF;

  SELECT * INTO v_period
  FROM accounting_periods
  WHERE id = v_entry.period_id
    AND accounting_entity_id = v_entry.accounting_entity_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.status <> 'open' THEN
    RAISE EXCEPTION 'O período contabilístico não está aberto.';
  END IF;
  IF v_entry.entry_date < v_period.starts_on OR v_entry.entry_date > v_period.ends_on THEN
    RAISE EXCEPTION 'A data do lançamento está fora do período seleccionado.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organisation_memberships om
    JOIN accounting_entities ae ON ae.organisation_id = om.organisation_id
    WHERE ae.id = v_entry.accounting_entity_id
      AND om.user_id = p_actor_id
      AND om.role IN ('superadmin', 'client_manager', 'accountant')
  ) AND NOT EXISTS (
    SELECT 1 FROM entity_memberships em
    WHERE em.accounting_entity_id = v_entry.accounting_entity_id
      AND em.user_id = p_actor_id
      AND em.role = 'accountant'
  ) THEN
    RAISE EXCEPTION 'O utilizador não tem permissão para confirmar lançamentos.';
  END IF;

  SELECT count(*), COALESCE(sum(lines.debit), 0), COALESCE(sum(lines.credit), 0)
    INTO v_count, v_debit, v_credit
  FROM journal_entry_lines AS lines
  WHERE lines.entry_id = p_entry_id
    AND lines.accounting_entity_id = v_entry.accounting_entity_id;

  IF v_count < 2 THEN RAISE EXCEPTION 'Um lançamento deve conter pelo menos duas linhas.'; END IF;
  IF v_debit <= 0 OR v_credit <= 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'O total de débitos deve ser igual ao total de créditos e superior a zero.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM journal_entry_lines l
    JOIN chart_of_accounts a
      ON a.id = l.account_id AND a.accounting_entity_id = l.accounting_entity_id
    WHERE l.entry_id = p_entry_id
      AND (NOT a.is_active OR NOT a.is_postable)
  ) THEN RAISE EXCEPTION 'Existem contas inactivas ou não movimentáveis no lançamento.'; END IF;

  -- Serialise numbering per journal to avoid duplicate document numbers.
  PERFORM 1 FROM accounting_journals
    WHERE id = v_entry.journal_id AND accounting_entity_id = v_entry.accounting_entity_id
    FOR UPDATE;
  SELECT COALESCE(max(je.entry_number), 0) + 1 INTO v_number
    FROM journal_entries je
    WHERE je.accounting_entity_id = v_entry.accounting_entity_id
      AND je.journal_id = v_entry.journal_id;

  UPDATE journal_entries
  SET status = 'posted', entry_number = v_number, posted_by = p_actor_id,
      posted_at = now(), updated_at = now()
  WHERE id = p_entry_id;

  RETURN QUERY SELECT p_entry_id, v_number;
END;
$$;

COMMIT;
