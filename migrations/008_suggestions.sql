-- Suggestion box (the 💡 button in the app header, server/suggestions.js): players send
-- ideas for the app, the admin reads them in /admin's Messages tab.

CREATE TABLE suggestions (
  id         BIGSERIAL PRIMARY KEY,
  message    TEXT NOT NULL,
  name_used  TEXT,                                          -- the in-game name they typed, if any
  user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL, -- signed-in account, if any
  client_id  TEXT,                                          -- device id (localStorage)
  room_code  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX suggestions_created_at_idx ON suggestions (created_at DESC);
