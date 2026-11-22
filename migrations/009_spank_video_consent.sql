-- Opt-in for the 🍑 Spanking gag's realistic AI video (server/spankConsent.js). A player only
-- ever gets one if they turned it on themselves, on their own account, for a photo sticker
-- that account uploaded. The admin page can switch it off (never on).

-- Who uploaded each player sticker (only uploads made while signed in are recorded).
CREATE TABLE sticker_uploads (
  sticker    TEXT PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX sticker_uploads_user_idx ON sticker_uploads (user_id);

ALTER TABLE users ADD COLUMN spank_video_opt_in_at TIMESTAMPTZ;
