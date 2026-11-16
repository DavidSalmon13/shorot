-- The Store. Play money only; spends the betting `wallets`. See docs/specs/store-specs.md
-- and docs/plans/store-implementation-plan.md. The item catalog lives in code
-- (server/store/catalog.js); this migration only records ownership and equipped choices.
-- New table + additive columns only - nothing here changes any existing table's data.

-- One row per (user, item). Permanent cosmetics stay quantity 1 and can't be rebought;
-- consumables increment on buy and decrement on use (CHECK keeps them from going negative).
CREATE TABLE store_inventory (
  user_id      BIGINT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id      TEXT    NOT NULL,                      -- matches a catalog id
  quantity     INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  acquired_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, item_id)
);

-- Equipped cosmetics: one choice per slot, mirroring users.sticker. NULL = nothing equipped
-- in that slot. Each value is a catalog item id or a variant key, validated at equip time as
-- "the backing item is owned."
ALTER TABLE users ADD COLUMN equipped_frame       TEXT;
ALTER TABLE users ADD COLUMN equipped_name_color  TEXT;
ALTER TABLE users ADD COLUMN equipped_title       TEXT;
ALTER TABLE users ADD COLUMN equipped_podium      TEXT;
ALTER TABLE users ADD COLUMN equipped_board_skin  TEXT;
ALTER TABLE users ADD COLUMN equipped_entrance    TEXT;
