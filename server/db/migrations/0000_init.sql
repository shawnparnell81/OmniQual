CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS folders (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id text,
  slug text NOT NULL,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS form_templates (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id text NOT NULL REFERENCES folders(id),
  slug text NOT NULL,
  title text NOT NULL,
  description text,
  schema_json jsonb NOT NULL,
  pdf_bytes text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'effective',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS form_records (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES form_templates(id),
  folder_id text NOT NULL REFERENCES folders(id),
  title text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text REFERENCES users(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  action text NOT NULL,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_org_idx ON users (organization_id);
CREATE INDEX IF NOT EXISTS folders_org_idx ON folders (organization_id);
CREATE INDEX IF NOT EXISTS form_templates_org_idx ON form_templates (organization_id);
CREATE INDEX IF NOT EXISTS form_records_org_idx ON form_records (organization_id);
CREATE INDEX IF NOT EXISTS form_records_folder_idx ON form_records (organization_id, folder_id);
CREATE INDEX IF NOT EXISTS form_records_template_idx ON form_records (organization_id, template_id);
CREATE INDEX IF NOT EXISTS audit_events_org_idx ON audit_events (organization_id);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx ON audit_events (organization_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token);
