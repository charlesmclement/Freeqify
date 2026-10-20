/** Append migrations; never edit an applied migration or reset user data. */
export const migrations = [{ version: 1, sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','listener')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT REFERENCES users(id),
  revoked_at INTEGER
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  idle_expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
) STRICT;
CREATE INDEX sessions_by_user ON sessions(user_id);
CREATE INDEX sessions_by_expiry ON sessions(expires_at);
CREATE TABLE auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
` }, { version: 2, sql: `
CREATE TABLE playback_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
` } , { version: 3, sql: `
CREATE TABLE personal_playlists (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100), revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX personal_playlists_owner ON personal_playlists(user_id,updated_at DESC);
CREATE TABLE personal_entries (
 id TEXT PRIMARY KEY, playlist_id TEXT NOT NULL REFERENCES personal_playlists(id) ON DELETE CASCADE,
 source TEXT NOT NULL CHECK(source='local'), track_id TEXT NOT NULL, media_kind TEXT NOT NULL DEFAULT 'song',
 metadata TEXT NOT NULL, position INTEGER NOT NULL, UNIQUE(playlist_id,position)
) STRICT;
CREATE TABLE personal_favorites (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, source TEXT NOT NULL CHECK(source='local'),
 track_id TEXT NOT NULL, media_kind TEXT NOT NULL DEFAULT 'song', metadata TEXT NOT NULL, created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id,source,track_id)
) STRICT;
CREATE INDEX personal_favorites_recent ON personal_favorites(user_id,created_at DESC);
CREATE TABLE personal_settings (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, history_generation INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE TABLE personal_history (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source='local'), track_id TEXT NOT NULL, media_kind TEXT NOT NULL DEFAULT 'song',
 metadata TEXT NOT NULL, listened REAL NOT NULL, position REAL NOT NULL,
 started_at INTEGER NOT NULL, played_at INTEGER NOT NULL, PRIMARY KEY(user_id,event_id)
) STRICT;
CREATE INDEX personal_history_recent ON personal_history(user_id,played_at DESC);
CREATE INDEX personal_history_track ON personal_history(user_id,source,track_id,played_at DESC);
` }, { version: 4, sql: `
CREATE INDEX personal_entries_track ON personal_entries(track_id,playlist_id);
CREATE INDEX personal_favorites_page ON personal_favorites(user_id,created_at DESC,track_id);
` }, {version:5,sql:`
CREATE TABLE personal_usage(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, bytes INTEGER NOT NULL DEFAULT 0) STRICT;
INSERT INTO personal_usage SELECT id,0 FROM users;
CREATE TRIGGER usage_user AFTER INSERT ON users BEGIN INSERT INTO personal_usage VALUES(new.id,0); END;
UPDATE personal_usage SET bytes=
 coalesce((SELECT sum(length(CAST(name AS BLOB))+256) FROM personal_playlists WHERE user_id=personal_usage.user_id),0)
 +coalesce((SELECT sum(length(CAST(e.metadata AS BLOB))+length(CAST(e.track_id AS BLOB))+512) FROM personal_entries e JOIN personal_playlists p ON p.id=e.playlist_id WHERE p.user_id=personal_usage.user_id),0)
 +coalesce((SELECT sum(length(CAST(metadata AS BLOB))+length(CAST(track_id AS BLOB))+512) FROM personal_favorites WHERE user_id=personal_usage.user_id),0)
 +coalesce((SELECT sum(length(CAST(metadata AS BLOB))+length(CAST(track_id AS BLOB))+length(CAST(event_id AS BLOB))+512) FROM personal_history WHERE user_id=personal_usage.user_id),0)
 +coalesce((SELECT length(CAST(state AS BLOB))+256 FROM playback_state WHERE user_id=personal_usage.user_id),0);
CREATE TRIGGER usage_playlist_insert AFTER INSERT ON personal_playlists BEGIN UPDATE personal_usage SET bytes=bytes+length(CAST(new.name AS BLOB))+256 WHERE user_id=new.user_id; END;
CREATE TRIGGER usage_playlist_update AFTER UPDATE OF name ON personal_playlists BEGIN UPDATE personal_usage SET bytes=bytes+length(CAST(new.name AS BLOB))-length(CAST(old.name AS BLOB)) WHERE user_id=new.user_id; END;
CREATE TRIGGER usage_playlist_entries BEFORE DELETE ON personal_playlists BEGIN UPDATE personal_usage SET bytes=bytes-coalesce((SELECT sum(length(CAST(metadata AS BLOB))+length(CAST(track_id AS BLOB))+512) FROM personal_entries WHERE playlist_id=old.id),0) WHERE user_id=old.user_id; END;
CREATE TRIGGER usage_playlist_delete AFTER DELETE ON personal_playlists BEGIN UPDATE personal_usage SET bytes=bytes-length(CAST(old.name AS BLOB))-256 WHERE user_id=old.user_id; END;
CREATE TRIGGER usage_entry_insert AFTER INSERT ON personal_entries BEGIN UPDATE personal_usage SET bytes=bytes+length(CAST(new.metadata AS BLOB))+length(CAST(new.track_id AS BLOB))+512 WHERE user_id=(SELECT user_id FROM personal_playlists WHERE id=new.playlist_id); END;
CREATE TRIGGER usage_entry_delete AFTER DELETE ON personal_entries BEGIN UPDATE personal_usage SET bytes=bytes-length(CAST(old.metadata AS BLOB))-length(CAST(old.track_id AS BLOB))-512 WHERE user_id=(SELECT user_id FROM personal_playlists WHERE id=old.playlist_id); END;
`+usageTriggers('personal_favorites','length(CAST(ROW.metadata AS BLOB))+length(CAST(ROW.track_id AS BLOB))+512')
 +usageTriggers('personal_history','length(CAST(ROW.metadata AS BLOB))+length(CAST(ROW.track_id AS BLOB))+length(CAST(ROW.event_id AS BLOB))+512')
 +usageTriggers('playback_state','length(CAST(ROW.state AS BLOB))+256')}, {version:6,sql:`
CREATE TABLE album_artwork_choices (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 album_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('fallback','selected','custom','none')),
 cover_key TEXT,
 content_type TEXT,
 image BLOB,
 PRIMARY KEY(user_id,album_id),
 CHECK((mode IN ('fallback','selected') AND cover_key IS NOT NULL AND image IS NULL AND content_type IS NULL)
   OR (mode='custom' AND cover_key IS NULL AND image IS NOT NULL AND content_type IS NOT NULL)
   OR (mode='none' AND cover_key IS NULL AND image IS NULL AND content_type IS NULL))
) STRICT;
CREATE TRIGGER usage_art_insert AFTER INSERT ON album_artwork_choices BEGIN
 UPDATE personal_usage SET bytes=bytes+length(CAST(new.album_id AS BLOB))+coalesce(length(new.image),0)+256 WHERE user_id=new.user_id;
END;
CREATE TRIGGER usage_art_update AFTER UPDATE ON album_artwork_choices BEGIN
 UPDATE personal_usage SET bytes=bytes+coalesce(length(new.image),0)-coalesce(length(old.image),0) WHERE user_id=new.user_id;
END;
CREATE TRIGGER usage_art_delete AFTER DELETE ON album_artwork_choices BEGIN
 UPDATE personal_usage SET bytes=bytes-length(CAST(old.album_id AS BLOB))-coalesce(length(old.image),0)-256 WHERE user_id=old.user_id;
END;
`}, {version:7,sql:`
UPDATE album_artwork_choices SET cover_key='generic_07_vinyl_warmth.jpg' WHERE mode IN ('fallback','selected') AND cover_key GLOB 'genre_*';
CREATE TABLE album_online_artwork (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 album_id TEXT NOT NULL, artist TEXT NOT NULL, title TEXT NOT NULL,
 content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp')),
 image BLOB NOT NULL CHECK(length(image)<=3145728),
 PRIMARY KEY(user_id,album_id)
) STRICT;
`+usageTriggers('album_online_artwork','length(ROW.image)+length(CAST(ROW.album_id AS BLOB))+length(CAST(ROW.artist AS BLOB))+length(CAST(ROW.title AS BLOB))+512')}, {version:8,sql:`
CREATE TABLE imported_playlists (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,playable_id TEXT
) STRICT;
CREATE INDEX imported_playlists_owner ON imported_playlists(user_id,updated_at DESC);
CREATE TABLE imported_entries (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 playlist_id TEXT NOT NULL REFERENCES imported_playlists(id) ON DELETE CASCADE,
 position INTEGER NOT NULL,payload TEXT NOT NULL,UNIQUE(playlist_id,position)
) STRICT;
CREATE TABLE import_album_reviews (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 playlist_id TEXT NOT NULL REFERENCES imported_playlists(id) ON DELETE CASCADE,
 payload TEXT NOT NULL,expires_at INTEGER NOT NULL
) STRICT;
`+usageTriggers('imported_playlists','length(CAST(ROW.name AS BLOB))+256')
+usageTriggers('imported_entries','length(CAST(ROW.payload AS BLOB))+256')
+usageTriggers('import_album_reviews','length(CAST(ROW.payload AS BLOB))+256')}, {version:9,sql:`
CREATE TABLE import_album_queues (
 id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 playlist_id TEXT PRIMARY KEY REFERENCES imported_playlists(id) ON DELETE CASCADE,payload TEXT NOT NULL
) STRICT;
`+usageTriggers('import_album_queues','length(CAST(ROW.payload AS BLOB))+256')}, {version:10,sql:`
ALTER TABLE import_album_queues ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_album_queues ADD COLUMN paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_album_queues ADD COLUMN session_hash TEXT;
`}, {version:11,sql:`
CREATE TABLE shared_album_artwork (
 album_id TEXT PRIMARY KEY, content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/png','image/webp')),
 image BLOB NOT NULL CHECK(length(image) BETWEEN 1 AND 3145728),
 artist TEXT NOT NULL, title TEXT NOT NULL
) STRICT;
`}, {version:12,sql:`
CREATE TABLE library_removals (
 source TEXT NOT NULL CHECK(source='local'),kind TEXT NOT NULL CHECK(kind IN ('track','album')),
 id TEXT NOT NULL,title TEXT NOT NULL,artist TEXT NOT NULL,album_id TEXT,removed_at INTEGER NOT NULL,
 PRIMARY KEY(source,kind,id)
) STRICT;
CREATE TABLE library_removed_members (
 source TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'album' CHECK(kind='album'),album_id TEXT NOT NULL,track_id TEXT NOT NULL,
 PRIMARY KEY(source,album_id,track_id),
 FOREIGN KEY(source,kind,album_id) REFERENCES library_removals(source,kind,id) ON DELETE CASCADE
) STRICT;
CREATE INDEX library_removed_track ON library_removed_members(source,track_id);
`}];
/** Trusted migration identifiers/expressions only; never caller supplied. */
function usageTriggers(table:string,expression:string){
 const value=(row:string)=>expression.replaceAll('ROW.',row+'.');
 return `CREATE TRIGGER usage_${table}_insert AFTER INSERT ON ${table} BEGIN UPDATE personal_usage SET bytes=bytes+(${value('new')}) WHERE user_id=new.user_id; END;
 CREATE TRIGGER usage_${table}_update AFTER UPDATE ON ${table} BEGIN UPDATE personal_usage SET bytes=bytes+(${value('new')})-(${value('old')}) WHERE user_id=new.user_id; END;
 CREATE TRIGGER usage_${table}_delete AFTER DELETE ON ${table} BEGIN UPDATE personal_usage SET bytes=bytes-(${value('old')}) WHERE user_id=old.user_id; END;`;
}
