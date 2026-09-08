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
