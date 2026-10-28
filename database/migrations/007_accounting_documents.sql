BEGIN;

CREATE TABLE IF NOT EXISTS accounting_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accounting_entity_id UUID NOT NULL REFERENCES accounting_entities(id) ON DELETE RESTRICT,
  journal_entry_id UUID,
  original_filename TEXT NOT NULL CHECK (length(trim(original_filename)) BETWEEN 1 AND 240),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes BETWEEN 1 AND 8388608),
  sha256 CHAR(64) NOT NULL,
  file_data BYTEA NOT NULL,
  description TEXT,
  uploaded_by UUID NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (accounting_entity_id, journal_entry_id)
    REFERENCES journal_entries(accounting_entity_id, id) ON DELETE RESTRICT,
  UNIQUE (accounting_entity_id, id)
);

CREATE INDEX IF NOT EXISTS accounting_documents_entity_created_idx
  ON accounting_documents(accounting_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS accounting_documents_entry_idx
  ON accounting_documents(accounting_entity_id, journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

COMMIT;
