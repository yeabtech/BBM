ALTER TABLE guest_profiles
  ADD COLUMN ball_skin text NOT NULL DEFAULT 'soccer'
  CHECK (ball_skin IN ('soccer', 'basketball', 'volleyball', 'beach'));

ALTER TABLE room_members
  ADD COLUMN ball_skin text NOT NULL DEFAULT 'soccer'
  CHECK (ball_skin IN ('soccer', 'basketball', 'volleyball', 'beach'));
