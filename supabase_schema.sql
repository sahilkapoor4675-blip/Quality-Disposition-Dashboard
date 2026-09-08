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
