CREATE TABLE guest_profiles (
  guest_id uuid PRIMARY KEY,
  display_name varchar(20) NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 20),
  ball_color text NOT NULL CHECK (ball_color IN ('mint', 'coral', 'sun', 'sky', 'violet', 'blue')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guest_tokens (
  guest_id uuid PRIMARY KEY REFERENCES guest_profiles(guest_id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX guest_tokens_active_hash_idx ON guest_tokens(token_hash) WHERE revoked_at IS NULL;

CREATE TABLE lobby_rooms (
  room_id uuid PRIMARY KEY,
  room_code varchar(6) NOT NULL UNIQUE CHECK (room_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  host_guest_id uuid NOT NULL REFERENCES guest_profiles(guest_id),
  status text NOT NULL CHECK (status IN ('open', 'closed', 'expired')),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  host_disconnected_until timestamptz,
  closed_at timestamptz
);

CREATE INDEX lobby_rooms_expiry_idx ON lobby_rooms(expires_at) WHERE status = 'open';
CREATE INDEX lobby_rooms_host_grace_idx ON lobby_rooms(host_disconnected_until) WHERE status = 'open';

CREATE TABLE room_members (
  room_id uuid NOT NULL REFERENCES lobby_rooms(room_id) ON DELETE CASCADE,
  guest_id uuid NOT NULL REFERENCES guest_profiles(guest_id),
  display_name varchar(20) NOT NULL,
  ball_color text NOT NULL CHECK (ball_color IN ('mint', 'coral', 'sun', 'sky', 'violet', 'blue')),
  ready boolean NOT NULL DEFAULT false CHECK (NOT ready OR connected),
  connected boolean NOT NULL DEFAULT false,
  connection_id uuid,
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  PRIMARY KEY (room_id, guest_id)
);

CREATE INDEX room_members_guest_open_idx ON room_members(guest_id, joined_at DESC) WHERE left_at IS NULL;
CREATE INDEX room_members_room_active_idx ON room_members(room_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX room_members_one_active_room_guest_idx ON room_members(guest_id) WHERE left_at IS NULL;

ALTER TABLE lobby_rooms ADD CONSTRAINT lobby_rooms_host_member_fk
  FOREIGN KEY (room_id, host_guest_id) REFERENCES room_members(room_id, guest_id)
  DEFERRABLE INITIALLY DEFERRED;
