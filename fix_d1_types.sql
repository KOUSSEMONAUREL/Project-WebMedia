-- ===================================================================
-- fix_d1_types.sql
-- Correct media_state types in D1 that were stored with wrong values
-- Run: npx wrangler d1 execute webmedia --remote --file fix_d1_types.sql
-- ===================================================================

-- 1) Fix 'game' -> 'jeu' (509 entries)
UPDATE media_state SET type = 'jeu' WHERE type = 'game';

-- 2) Fix 'movie' -> 'film' (53 entries)
UPDATE media_state SET type = 'film' WHERE type = 'movie';

-- 3) Fix webtoons stored as 'comic' (343 entries)
UPDATE media_state SET type = 'webtoon'
WHERE type = 'comic'
  AND media_id IN (
    '037debc0-f64f-47d0-8313-71afc00fa2ae',
    '08634f5c-14e2-4dbc-9f6b-1569f1b8cf18',
    '1ce18566-4420-4b71-bcdb-6f3502460523',
    '5744efca-da3b-4249-8902-9b45061c4a0e',
    '619877f3-e49c-4f29-a060-4f358e05294b',
    '85436269-7e38-4102-b566-7a09807c05fa',
    '85efad88-8da0-451e-bb45-96ea738164ca',
    '89dc6a7d-5386-4b50-97e2-584686239674',
    '9547d057-7190-4863-b5e9-ab5b192edf56',
    '988a493f-0ef3-414c-bcc0-151594de6237',
    '9c8db1ff-91da-4fe4-b2c5-74cbb8f1d9c0',
    'b322df5e-10de-42f2-bfff-1d1531f895f6',
    'dd98d9ff-4000-4c06-af95-11689adb5763'
  );

-- 4) Fix anime stored as 'serie' (11 entries)
UPDATE media_state SET type = 'anime'
WHERE type = 'serie'
  AND media_id IN (
    '23b6768b-9772-40e0-a5be-74ca636151c1',
    '2c05518c-e2a8-4b39-b9ec-618f6fff8ade',
    '326ede62-2505-4ec3-9924-41d265cfb843',
    '3b427447-993a-4345-8ed4-899cda44017a',
    '3bdd6c17-b884-4fdb-a011-172e0bd0ce89',
    '51b63113-76e9-45f8-9d78-ad35dcc6073c',
    '6cfa24d9-b17a-483f-8eb9-27e1a497600f',
    '8fc796a9-8a2f-414c-a92b-468657f440d9',
    'a2228558-0dd2-4f85-8492-78bb28cc3cb7',
    'aa70b1d2-2856-469f-8f03-c26191e5eaff',
    'b255ff00-33cb-45e9-9aa1-50817566b8e2'
  );

-- 5) Insert 13 missing games
INSERT OR IGNORE INTO media_state (media_id, type, title, slug, metadata_ok, active_links, has_content, next_scrape, scrape_priority)
VALUES
  ('037debc0-f64f-47d0-8313-71afc00fa2ae', 'jeu', 'Tianzi 76', 'tianzi-76', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('5744efca-da3b-4249-8902-9b45061c4a0e', 'jeu', 'Cotton 16Bit Tribute: Special Pack - Limited Edition', 'cotton-16bit-tribute-special-pack---limited-edition', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('9c8db1ff-91da-4fe4-b2c5-74cbb8f1d9c0', 'jeu', 'Uncharted: The Nathan Drake Collection', 'uncharted-the-nathan-drake-collection', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('08634f5c-14e2-4dbc-9f6b-1569f1b8cf18', 'jeu', 'Not for Broadcast', 'not-for-broadcast', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('988a493f-0ef3-414c-bcc0-151594de6237', 'jeu', 'Doom', 'doom', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('9547d057-7190-4863-b5e9-ab5b192edf56', 'jeu', 'Ico', 'ico', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('b322df5e-10de-42f2-bfff-1d1531f895f6', 'jeu', 'Astro Bot: Rescue Mission', 'astro-bot-rescue-mission', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('89dc6a7d-5386-4b50-97e2-584686239674', 'jeu', 'Overcooked!: The Festive Seasoning', 'overcooked-the-festive-seasoning', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('85efad88-8da0-451e-bb45-96ea738164ca', 'jeu', 'The Legend of Zelda: Twilight Princess', 'the-legend-of-zelda-twilight-princess', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('1ce18566-4420-4b71-bcdb-6f3502460523', 'jeu', 'Silent Hill 2: Restless Dreams', 'silent-hill-2-restless-dreams', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('619877f3-e49c-4f29-a060-4f358e05294b', 'jeu', 'Assassin''s Creed Black Flag Resynced', 'assassins-creed-black-flag-resynced', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('85436269-7e38-4102-b566-7a09807c05fa', 'jeu', 'Dance Dance Revolution Extreme', 'dance-dance-revolution-extreme', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1),
  ('dd98d9ff-4000-4c06-af95-11689adb5763', 'jeu', 'The Legend of Zelda: Majora''s Mask 3D', 'the-legend-of-zelda-majoras-mask-3d', 1, 0, 0, CAST((strftime('%s','now') + 10) * 1000 AS INTEGER), 1);

-- 6) Remove stale entries (8 orphaned game UUIDs from Neon cleanup)
DELETE FROM media_state WHERE media_id IN (
  '447f84d3-8d69-4aae-9af8-0e81b205c646',
  '55a10272-4b89-498c-ae8e-c299f7455aa7',
  '5dd39bd5-d494-46ed-97a2-dba61ed02bc0',
  'b396737c-976a-49b8-98dd-648b0bc1d14f',
  'b5c65edf-cf87-454e-b7d8-0e988a19ebca',
  'ba20838d-beb2-4937-86db-7fc087d92ddb',
  'cdc83739-8249-40b6-9eb7-5e1626a6883a',
  'd7b08a6a-869d-4902-9229-804404c091e4'
) AND type = 'jeu';
