-- Quality Disposition Control Dashboard reference schema (PostgreSQL)
-- Runtime startup remains authoritative and performs idempotent migrations.

CREATE TABLE IF NOT EXISTS disposition (
    id BIGSERIAL PRIMARY KEY,
    heat_no TEXT,
    batch_no TEXT DEFAULT '',
    work_center TEXT,
    grade TEXT,
    output_weight DOUBLE PRECISION,
    main_defect TEXT,
    defect_intensity TEXT,
    quality_decision TEXT,
    insp_lot_date TEXT DEFAULT '',
    ud_date TEXT DEFAULT '',
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
    must_reset_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    event_type TEXT NOT NULL,
    tab TEXT DEFAULT '',
    filters_json TEXT DEFAULT '{}',
    user_agent TEXT DEFAULT '',
    ip_address TEXT DEFAULT '',
    visitor_id TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_ip_time ON activity_log (ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_log (created_at);

CREATE TABLE IF NOT EXISTS audit_trail (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    username TEXT,
    role TEXT,
    action TEXT NOT NULL,
    record_id BIGINT,
    details TEXT DEFAULT '{}',
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_trail (created_at);

CREATE TABLE IF NOT EXISTS kpi_targets (
    id BIGSERIAL PRIMARY KEY,
    label TEXT UNIQUE NOT NULL,
    target DOUBLE PRECISION,
    warning DOUBLE PRECISION,
    critical DOUBLE PRECISION,
    direction TEXT NOT NULL DEFAULT 'higher',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kpi_target_history (
    id BIGSERIAL PRIMARY KEY,
    label TEXT NOT NULL,
    old_target DOUBLE PRECISION,
    new_target DOUBLE PRECISION,
    old_warning DOUBLE PRECISION,
    new_warning DOUBLE PRECISION,
    old_critical DOUBLE PRECISION,
    new_critical DOUBLE PRECISION,
    old_direction TEXT,
    new_direction TEXT,
    effective_date TEXT DEFAULT '',
    changed_by TEXT DEFAULT '',
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_history (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT,
    detected INTEGER DEFAULT 0,
    valid INTEGER DEFAULT 0,
    duplicates INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    updated INTEGER DEFAULT 0,
    imported INTEGER DEFAULT 0,
    imported_by TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fishbone_master (
    id BIGSERIAL PRIMARY KEY,
    defect_name TEXT NOT NULL,
    norm_name TEXT NOT NULL UNIQUE,
    man TEXT DEFAULT '',
    machine TEXT DEFAULT '',
    material TEXT DEFAULT '',
    method TEXT DEFAULT '',
    measurement TEXT DEFAULT '',
    environment TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fishbone_alias (
    id BIGSERIAL PRIMARY KEY,
    disposition_defect TEXT NOT NULL,
    norm_disposition_defect TEXT NOT NULL UNIQUE,
    master_defect TEXT NOT NULL,
    created_by TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fishbone_import_history (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT,
    detected INTEGER DEFAULT 0,
    imported INTEGER DEFAULT 0,
    imported_by TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rca_detected INTEGER DEFAULT 0,
    rca_imported INTEGER DEFAULT 0,
    style_imported INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rca_master (
    id BIGSERIAL PRIMARY KEY,
    defect_name TEXT NOT NULL,
    norm_name TEXT NOT NULL,
    category TEXT NOT NULL,
    why1 TEXT DEFAULT '',
    why2 TEXT DEFAULT '',
    why3 TEXT DEFAULT '',
    why4 TEXT DEFAULT '',
    why5 TEXT DEFAULT '',
    action TEXT DEFAULT '',
    preventive_action TEXT DEFAULT '',
    role TEXT DEFAULT '',
    responsibility TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fishbone_style (
    category TEXT PRIMARY KEY,
    label TEXT DEFAULT '',
    icon TEXT DEFAULT '',
    color TEXT DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_disposition_batch_no_norm
ON disposition (UPPER(TRIM(batch_no)));
CREATE INDEX IF NOT EXISTS idx_disposition_month ON disposition(month);
CREATE INDEX IF NOT EXISTS idx_disposition_work_center ON disposition(work_center);
CREATE INDEX IF NOT EXISTS idx_disposition_grade ON disposition(grade);
CREATE INDEX IF NOT EXISTS idx_disposition_quality_decision ON disposition(quality_decision);
CREATE INDEX IF NOT EXISTS idx_disposition_week ON disposition(week);
CREATE INDEX IF NOT EXISTS idx_disposition_quarter ON disposition(quarter);
CREATE INDEX IF NOT EXISTS idx_disposition_financial_year ON disposition(financial_year);
CREATE INDEX IF NOT EXISTS idx_disposition_defect_intensity ON disposition(defect_intensity);
CREATE INDEX IF NOT EXISTS idx_disposition_main_defect ON disposition(main_defect);
