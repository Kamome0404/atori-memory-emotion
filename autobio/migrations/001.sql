PRAGMA foreign_keys=ON;
BEGIN;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS candidates(
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,self_id TEXT NOT NULL,uid TEXT NOT NULL,scope TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation>0),
 basis TEXT NOT NULL CHECK(basis IN('user_said','delivered_reply','character_reflection','verified_tool_action')),
 content_class TEXT NOT NULL CHECK(content_class IN('real_record','role_idea','fiction')),
 text TEXT NOT NULL CHECK(length(text)<=240),
 uncertain INTEGER NOT NULL CHECK(uncertain IN(0,1)),
 status TEXT NOT NULL CHECK(status IN('pending','approved','rejected','invalidated')),
 source_set_digest TEXT NOT NULL,content_digest TEXT NOT NULL,dedupe_key TEXT NOT NULL UNIQUE,
 supersedes_id TEXT,blocked_reason TEXT,
 created_at INTEGER NOT NULL,reviewed_at INTEGER,reviewer_id TEXT,invalid_reason TEXT,
 CHECK(scope='private:'||uid),
 CHECK((basis='character_reflection' AND uncertain=1 AND content_class IN('role_idea','fiction')) OR (basis!='character_reflection' AND content_class='real_record'))
);
CREATE TABLE IF NOT EXISTS sources(
 candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
 source_kind TEXT NOT NULL CHECK(source_kind IN('event','reply','tool_receipt')),
 event_id TEXT NOT NULL,reply_id TEXT NOT NULL DEFAULT '',ordinal INTEGER NOT NULL DEFAULT -1,
 generation INTEGER NOT NULL,event_digest TEXT NOT NULL,source_text_digest TEXT NOT NULL,
 PRIMARY KEY(candidate_id,source_kind,event_id,reply_id),
 CHECK(source_kind!='reply' OR(reply_id!='' AND ordinal>=0))
);
CREATE INDEX IF NOT EXISTS sources_event_reply ON sources(event_id,reply_id);
CREATE TABLE IF NOT EXISTS delivery_observations(
 attempt_key TEXT PRIMARY KEY,account_id TEXT,self_id TEXT,uid TEXT,scope TEXT,
 content_digest TEXT NOT NULL,content_class TEXT NOT NULL,source_refs_json TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('attempted','confirmed','failed','unknown','confirmed_not_eligible')),
 real_receipt_id TEXT,created_at INTEGER NOT NULL,eligible INTEGER NOT NULL DEFAULT 0
);
INSERT INTO meta(key,value) VALUES('marker','atori-autobio-candidates-v1'),('schema','1');
PRAGMA user_version=1;
COMMIT;
