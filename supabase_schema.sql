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

-- 6M Fishbone (Man/Machine/Material/Method/Measurement/Environment) master
-- reference data. Imported ONCE by an admin from the 6M Defect Master
-- workbook (Admin -> 6M Fishbone Master Import) and independent of the
-- monthly disposition data import — uploading new disposition/QCR data does
-- NOT clear this table. As with `disposition` above, the WebApp also
-- creates these tables automatically on first startup; this is only here
-- for reference / manual schema setup.
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
