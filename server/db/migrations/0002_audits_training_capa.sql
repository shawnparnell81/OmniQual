CREATE TABLE IF NOT EXISTS internal_audits (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id text NOT NULL REFERENCES folders(id),
  title text NOT NULL,
  number text NOT NULL,
  scope text NOT NULL DEFAULT '',
  planned_date date,
  auditor text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned',
  findings text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS internal_audits_org_idx ON internal_audits (organization_id);
CREATE INDEX IF NOT EXISTS internal_audits_folder_idx ON internal_audits (organization_id, folder_id);

CREATE TABLE IF NOT EXISTS audit_record_links (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  audit_id text NOT NULL REFERENCES internal_audits(id) ON DELETE CASCADE,
  record_id text NOT NULL REFERENCES form_records(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, audit_id, record_id, kind)
);

CREATE INDEX IF NOT EXISTS audit_record_links_org_idx ON audit_record_links (organization_id);
CREATE INDEX IF NOT EXISTS audit_record_links_audit_idx ON audit_record_links (organization_id, audit_id);

CREATE TABLE IF NOT EXISTS training_assignments (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id text NOT NULL REFERENCES controlled_documents(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_number text NOT NULL,
  revision text NOT NULL,
  document_title text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, document_id, user_id)
);

CREATE INDEX IF NOT EXISTS training_assignments_org_idx ON training_assignments (organization_id);
CREATE INDEX IF NOT EXISTS training_assignments_user_idx ON training_assignments (organization_id, user_id);
CREATE INDEX IF NOT EXISTS training_assignments_doc_idx ON training_assignments (organization_id, document_id);

CREATE TABLE IF NOT EXISTS capa_investigations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_id text NOT NULL REFERENCES form_records(id) ON DELETE CASCADE,
  root_cause text NOT NULL DEFAULT '',
  rca_method text NOT NULL DEFAULT '5-why',
  effectiveness_plan text NOT NULL DEFAULT '',
  effectiveness_result text NOT NULL DEFAULT '',
  verified_date date,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, record_id)
);

CREATE TABLE IF NOT EXISTS capa_actions (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  record_id text NOT NULL REFERENCES form_records(id) ON DELETE CASCADE,
  kind text NOT NULL,
  description text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  due_date date,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capa_actions_record_idx ON capa_actions (organization_id, record_id);
