BEGIN;

-- A confirmed entry can be reversed only once. The reversal is a separate,
-- balanced entry; the source remains in reports with status "reversed".
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_single_reversal_idx
  ON journal_entries (accounting_entity_id, reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_posted_entry_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('posted', 'reversed') THEN
    IF OLD.status = 'posted'
       AND NEW.status = 'reversed'
       AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at')
       AND EXISTS (
         SELECT 1 FROM journal_entries reversal
         WHERE reversal.accounting_entity_id = OLD.accounting_entity_id
           AND reversal.reverses_entry_id = OLD.id
           AND reversal.status = 'posted'
       ) THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Um lançamento confirmado é imutável; correcções exigem um estorno formal.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS journal_entry_immutable_update ON journal_entries;
CREATE TRIGGER journal_entry_immutable_update
BEFORE UPDATE ON journal_entries
FOR EACH ROW EXECUTE FUNCTION protect_posted_entry_update();

COMMIT;
