-- Optional reference schema. The WebApp creates this table automatically on first startup.
CREATE TABLE IF NOT EXISTS disposition (
    id BIGSERIAL PRIMARY KEY,
    heat_no TEXT,
    work_center TEXT,
    grade TEXT,
    output_weight DOUBLE PRECISION,
    main_defect TEXT,
    defect_intensity TEXT,
    quality_decision TEXT,
    insp_lot_date TEXT DEFAULT '',
    month TEXT,
    week TEXT,
    quarter TEXT,
    financial_year TEXT
);


CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    event_type TEXT NOT NULL,
    tab TEXT DEFAULT '',
    filters_json TEXT DEFAULT '{}',
    user_agent TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Admin Control Center extensions
ALTER TABLE users ADD COLUMN IF NOT EXISTS department TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    username TEXT,
    action TEXT NOT NULL,
    entity_type TEXT DEFAULT '',
    entity_id TEXT DEFAULT '',
    details TEXT DEFAULT '{}',
    user_agent TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_history (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT,
    detected INTEGER DEFAULT 0,
    inserted INTEGER DEFAULT 0,
    duplicates INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    imported_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kpi_targets (
    id BIGSERIAL PRIMARY KEY,
    kpi_key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    target DOUBLE PRECISION,
    warning DOUBLE PRECISION,
    critical DOUBLE PRECISION,
    direction TEXT DEFAULT 'max',
    active BOOLEAN DEFAULT TRUE,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS master_data (
    id BIGSERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    value TEXT NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER DEFAULT 0,
    UNIQUE(category,value)
);

CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
