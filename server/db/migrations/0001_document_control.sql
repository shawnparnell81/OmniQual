CREATE TABLE IF NOT EXISTS controlled_documents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id text NOT NULL REFERENCES folders(id),
  title text NOT NULL,
  number text NOT NULL,
  revision text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  effective_date date,
  body text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number, revision)
);

CREATE INDEX IF NOT EXISTS controlled_documents_org_idx ON controlled_documents (organization_id);
CREATE INDEX IF NOT EXISTS controlled_documents_folder_idx ON controlled_documents (organization_id, folder_id);
CREATE INDEX IF NOT EXISTS controlled_documents_number_idx ON controlled_documents (organization_id, number);

CREATE TABLE IF NOT EXISTS record_links (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_record_id text NOT NULL REFERENCES form_records(id) ON DELETE CASCADE,
  to_record_id text NOT NULL REFERENCES form_records(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, from_record_id, to_record_id, kind)
);

CREATE INDEX IF NOT EXISTS record_links_org_idx ON record_links (organization_id);
CREATE INDEX IF NOT EXISTS record_links_from_idx ON record_links (organization_id, from_record_id);
CREATE INDEX IF NOT EXISTS record_links_to_idx ON record_links (organization_id, to_record_id);
