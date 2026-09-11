ALTER TABLE calibration_events ADD COLUMN IF NOT EXISTS as_found text NOT NULL DEFAULT '';
ALTER TABLE calibration_events ADD COLUMN IF NOT EXISTS as_left text NOT NULL DEFAULT '';
ALTER TABLE calibration_events ADD COLUMN IF NOT EXISTS technician text NOT NULL DEFAULT '';
ALTER TABLE calibration_events ADD COLUMN IF NOT EXISTS certificate text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS audit_findings (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  audit_id text NOT NULL REFERENCES internal_audits(id) ON DELETE CASCADE,
  severity text NOT NULL,
  clause text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  evidence text NOT NULL DEFAULT '',
  discrepancy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_findings_audit_idx ON audit_findings (organization_id, audit_id);

CREATE TABLE IF NOT EXISTS discrepancy_investigations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id text NOT NULL REFERENCES folders(id),
  finding_id text REFERENCES audit_findings(id),
  number text NOT NULL,
  identification text NOT NULL DEFAULT '',
  containment text NOT NULL DEFAULT '',
  investigation text NOT NULL DEFAULT '',
  disposition text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, finding_id),
  UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS discrepancy_org_idx ON discrepancy_investigations (organization_id);
CREATE INDEX IF NOT EXISTS discrepancy_folder_idx ON discrepancy_investigations (organization_id, folder_id);

CREATE TABLE IF NOT EXISTS entity_links (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_kind text NOT NULL,
  from_id text NOT NULL,
  to_kind text NOT NULL,
  to_id text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, from_kind, from_id, to_kind, to_id, kind)
);

CREATE INDEX IF NOT EXISTS entity_links_from_idx ON entity_links (organization_id, from_kind, from_id);
CREATE INDEX IF NOT EXISTS entity_links_to_idx ON entity_links (organization_id, to_kind, to_id);

CREATE TABLE IF NOT EXISTS inspections (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  folder_id text NOT NULL REFERENCES folders(id),
  number text NOT NULL,
  title text NOT NULL,
  area text NOT NULL DEFAULT '',
  inspector text NOT NULL DEFAULT '',
  inspected_at date,
  result text NOT NULL DEFAULT 'pending',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  created_by text REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, number)
);

CREATE INDEX IF NOT EXISTS inspections_org_idx ON inspections (organization_id);
CREATE INDEX IF NOT EXISTS inspections_folder_idx ON inspections (organization_id, folder_id);
