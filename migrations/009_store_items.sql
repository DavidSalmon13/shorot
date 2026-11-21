-- The Store's item list moves into the database so prices, names and on/off can change
-- without a deploy. What each item *does* (consumable vs cosmetic, equip slot, who it
-- targets, its animation) stays in code (server/store/catalog.js), keyed by the same id.
-- This table is the source of truth for everything a player sees and pays; the server keeps
-- an in-memory copy for listing the shop, but a purchase always re-reads the price here
-- inside its own transaction. See docs/plans/store-implementation-plan.md (D3).
--
-- `id` matches store_inventory.item_id and must never be renamed once shipped. A row whose
-- id has no implementation in code is hidden (and logged) rather than sold. `active = false`
-- stops an item being sold; players who already own it keep it and can still use/equip it.

CREATE TABLE store_items (
  id           TEXT    PRIMARY KEY,
  name         TEXT    NOT NULL,
  description  TEXT    NOT NULL DEFAULT '',
  icon         TEXT    NOT NULL DEFAULT '',
  price        INTEGER NOT NULL CHECK (price >= 0),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seeded with exactly the catalog that shipped in code, so nothing changes for players.
INSERT INTO store_items (id, name, description, icon, price, sort_order) VALUES
  ('frame.pack',          'Avatar Frame Pack',    'Four frames - gold, neon, flames, crown - to ring your avatar everywhere you appear.', '🖼️', 14400,  10),
  ('namecolor.pack',      'Name Color & Glow',    'Tint and glow your name in a color of your choice.',                                     '🎨',  9600,  20),
  ('title.pack',          'Vanity Title',         'Wear a title under your name, like "The Bluffer" or "High Roller".',                     '🏷️',  7200,  30),
  ('podium.confetti',     'Winner''s Podium',     'Confetti and fireworks burst over you when you win a game.',                             '🎆', 18000,  40),
  ('entrance.grand',      'Grand Entrance',       'Make an animated entrance when you appear in the lobby.',                                '✨', 10800,  50),
  ('boardskin.midnight',  'Table Skin: Midnight', 'A premium midnight skin for the table.',                                                 '🌃', 24000,  60),
  ('stickerpack.premium', 'Premium Sticker Pack', 'Unlock a set of premium stickers in the sticker chooser.',                               '🌟', 12000,  70),
  ('taunt',               'Taunt Burst',          'Pop a laughing burst over another player''s icon.',                                      '😂',    10, 100),
  ('fanfare',             'Loser Fanfare',        'Play a sad-trombone over another player.',                                               '🎺',    40, 110),
  ('confetti_bomb',       'Confetti Self-Bomb',   'Rain confetti on your own icon.',                                                        '💣',    50, 120),
  ('water_balloon',       'Water Balloon',        'Lob a water balloon - it bursts and leaves them dripping wet.',                          '💦',    60, 130),
  ('tomato',              'Tomato Throw',         'Splat a tomato on another player''s icon.',                                              '🍅',    80, 140),
  ('pie',                 'Pie in the Face',      'Smack a cream pie onto another player. It slides off... slowly.',                        '🥧',    90, 150),
  ('glove',               'Boxing Glove',         'Punch another player''s icon. POW!',                                                     '🥊',   100, 160),
  ('crown',               'Crown a Player',       'Drop a crown on another player - a nice one.',                                           '👑',   120, 170),
  ('lightning',           'Lightning Strike',     'Call down a lightning bolt - flash, thunder, and a smoking, charred icon.',              '⚡',   150, 180),
  ('spank',               'Spanking',             'Your own photo marches out of your icon, over to another player, and spanks them. Three times.', '🍑', 300, 190);
