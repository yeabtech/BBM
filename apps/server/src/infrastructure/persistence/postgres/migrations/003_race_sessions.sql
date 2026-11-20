CREATE TABLE race_sessions (
  race_id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES lobby_rooms(room_id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state text NOT NULL CHECK (state IN ('Waiting', 'Countdown', 'InProgress', 'Finished', 'Cancelled')),
  countdown_started_at timestamptz,
  countdown_deadline_at timestamptz,
  official_start_at timestamptz,
  timeout_deadline_at timestamptz,
  cancellation_reason text CHECK (cancellation_reason IN ('Timeout', 'HostLeft', 'RoomExpired', 'ServerRestart')),
  cancelled_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((state IN ('Countdown', 'InProgress', 'Finished', 'Cancelled')) = (countdown_started_at IS NOT NULL AND countdown_deadline_at IS NOT NULL)),
  CHECK ((state IN ('InProgress', 'Finished') OR (state = 'Cancelled' AND official_start_at IS NOT NULL)) = (official_start_at IS NOT NULL AND timeout_deadline_at IS NOT NULL)),
  CHECK ((state = 'Cancelled') = (cancellation_reason IS NOT NULL AND cancelled_at IS NOT NULL)),
  CHECK ((cancellation_reason IS NULL) = (cancelled_at IS NULL)),
  CHECK ((state = 'Finished') = (finished_at IS NOT NULL)),
  CHECK (official_start_at IS NULL OR official_start_at = countdown_deadline_at),
  CHECK (timeout_deadline_at IS NULL OR timeout_deadline_at > official_start_at)
);

CREATE INDEX race_sessions_room_created_idx ON race_sessions(room_id, created_at DESC);
CREATE INDEX race_sessions_due_countdown_idx ON race_sessions(countdown_deadline_at) WHERE state = 'Countdown';
CREATE INDEX race_sessions_due_timeout_idx ON race_sessions(timeout_deadline_at) WHERE state = 'InProgress';
CREATE UNIQUE INDEX race_sessions_one_active_per_room_idx ON race_sessions(room_id) WHERE state IN ('Countdown', 'InProgress');
