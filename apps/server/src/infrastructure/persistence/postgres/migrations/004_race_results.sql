CREATE TABLE race_results (
  race_id uuid PRIMARY KEY REFERENCES race_sessions(race_id) ON DELETE CASCADE,
  finished_at timestamptz NOT NULL,
  results jsonb NOT NULL CHECK (jsonb_typeof(results) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now()
);
