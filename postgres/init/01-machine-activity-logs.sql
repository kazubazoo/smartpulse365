-- Status-change log written by the Node-RED flow (on change only, via the rbe
-- node) and read by the Grafana "Motor Status" panel.
--
-- Runs automatically the first time the postgres volume is initialised.
CREATE TABLE IF NOT EXISTS machine_activity_logs (
    id           BIGSERIAL PRIMARY KEY,
    asset_id     TEXT        NOT NULL,
    status_code  SMALLINT    NOT NULL,
    status_label TEXT        NOT NULL,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS machine_activity_logs_changed_at_idx
    ON machine_activity_logs (changed_at DESC);

CREATE INDEX IF NOT EXISTS machine_activity_logs_asset_idx
    ON machine_activity_logs (asset_id, changed_at DESC);
