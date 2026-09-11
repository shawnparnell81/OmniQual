ALTER TABLE users ADD COLUMN IF NOT EXISTS department text NOT NULL DEFAULT '';
ALTER TABLE controlled_documents ADD COLUMN IF NOT EXISTS training_roles text NOT NULL DEFAULT '';

UPDATE users SET department = 'Quality' WHERE department = '' AND email = 'demo@omniqual.local';

CREATE TABLE IF NOT EXISTS calibration_assets (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id text NOT NULL REFERENCES folders(id),
  name text NOT NULL,
  number text NOT NULL,
  location text NOT NULL DEFAULT '',
  interval_days integer NOT NULL DEFAULT 365,
  last_calibrated date,
  next_due date,
  status text NOT NULL DEFAULT 'due',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS calibration_assets_org_idx ON calibration_assets (organization_id);
CREATE INDEX IF NOT EXISTS calibration_assets_folder_idx ON calibration_assets (organization_id, folder_id);

CREATE TABLE IF NOT EXISTS calibration_events (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES calibration_assets(id) ON DELETE CASCADE,
  event_date date NOT NULL,
  result text NOT NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calibration_events_asset_idx ON calibration_events (organization_id, asset_id);

CREATE TABLE IF NOT EXISTS suppliers (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id text NOT NULL REFERENCES folders(id),
  name text NOT NULL,
  number text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  last_evaluation_date date,
  notes text NOT NULL DEFAULT '',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS suppliers_org_idx ON suppliers (organization_id);
CREATE INDEX IF NOT EXISTS suppliers_folder_idx ON suppliers (organization_id, folder_id);

CREATE TABLE IF NOT EXISTS supplier_evaluations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id text NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  eval_date date NOT NULL,
  result text NOT NULL,
  score integer,
  comments text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_evaluations_supplier_idx ON supplier_evaluations (organization_id, supplier_id);

CREATE TABLE IF NOT EXISTS management_reviews (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id text NOT NULL REFERENCES folders(id),
  number text NOT NULL,
  meeting_date date,
  attendees text NOT NULL DEFAULT '',
  inputs_summary text NOT NULL DEFAULT '',
  outputs_actions text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS management_reviews_org_idx ON management_reviews (organization_id);
CREATE INDEX IF NOT EXISTS management_reviews_folder_idx ON management_reviews (organization_id, folder_id);

CREATE TABLE IF NOT EXISTS quality_record_links (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  source_id text NOT NULL,
  record_id text NOT NULL REFERENCES form_records(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, source_type, source_id, record_id, kind)
);

CREATE INDEX IF NOT EXISTS quality_record_links_source_idx ON quality_record_links (organization_id, source_type, source_id);
