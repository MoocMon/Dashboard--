import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.WORKBENCH_DATA || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'workbench.db');

export const DEFAULTS = {
  account: 'AKA张猩猩',
  obsidian_vault: '/Users/liz/Documents/Obsidian Vault',
  obsidian_subdir: '内容工作台',
  wordlib_path: path.join(process.env.HOME || '', '.workbuddy/skills/douyin-sensitive-check/data/sensitive_words.txt'),
  radar_dir: path.join(process.env.HOME || '', 'Documents/Obsidian Vault/AI测试/02_内容规划/选题池'),
  chars_per_sec: '7',
  douyin_min_sec: '180',
  douyin_max_sec: '300',
  tolerance: '0.1',
  // LLM 自动生成
  llm_enabled: '0',
  llm_provider: 'doubao',
  llm_api_key: '',
  llm_base_url: 'https://ark.cn-beijing.volces.com/api/v3',
  llm_model: 'doubao-pro-32k',
};

for (const d of [DATA_DIR, path.join(DATA_DIR, 'assets'), path.join(DATA_DIR, 'exports'), path.join(DATA_DIR, 'backups'), path.join(DATA_DIR, 'uploads')]) {
  fs.mkdirSync(d, { recursive: true });
}

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT DEFAULT '',
  angle TEXT DEFAULT '',
  content_type TEXT DEFAULT '',
  platforms TEXT DEFAULT '["douyin","xhs","wechat"]',
  priority INTEGER DEFAULT 2,
  status TEXT DEFAULT '待整理',
  schedule_date TEXT,
  tags TEXT DEFAULT '',
  account TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT DEFAULT '',
  content TEXT NOT NULL,
  source_url TEXT DEFAULT '',
  source_name TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  verify_status TEXT DEFAULT 'none',
  note TEXT DEFAULT '',
  snippet_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  disabled INTEGER DEFAULT 0,
  cite_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outlines (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  hook TEXT DEFAULT '',
  thesis TEXT DEFAULT '',
  structure TEXT DEFAULT '',
  assumptions TEXT DEFAULT '',
  post_copy TEXT DEFAULT '',
  cover_copy TEXT DEFAULT '',
  status TEXT DEFAULT 'draft',
  reject_reason TEXT DEFAULT '',
  version_no INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT DEFAULT '未开始',
  ad INTEGER DEFAULT 0,
  sponsor INTEGER DEFAULT 0,
  current_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(topic_id, platform),
  FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  parsed TEXT DEFAULT '{}',
  structure TEXT DEFAULT '{}',
  origin TEXT DEFAULT 'manual',
  prompt_snapshot TEXT DEFAULT '',
  qc_summary TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(draft_id) REFERENCES drafts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS qc_reports (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  content_type TEXT DEFAULT '',
  conclusion TEXT,
  stats TEXT DEFAULT '{}',
  items TEXT DEFAULT '[]',
  rules_fingerprint TEXT DEFAULT '',
  stale INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(draft_id) REFERENCES drafts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS qc_ignores (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS archives (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  path TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  date TEXT NOT NULL,
  UNIQUE(topic_id, platform),
  FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  gate INTEGER NOT NULL,
  scope TEXT NOT NULL,
  content_type TEXT DEFAULT 'all',
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  params TEXT DEFAULT '{}',
  description TEXT DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS prompts (
  key TEXT NOT NULL,
  version_no INTEGER NOT NULL,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  variables TEXT DEFAULT '[]',
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  PRIMARY KEY(key, version_no)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS whitelist (
  id TEXT PRIMARY KEY,
  word TEXT NOT NULL UNIQUE,
  reason TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_url TEXT DEFAULT '',
  source_name TEXT DEFAULT '',
  retrieved_at TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  origin TEXT DEFAULT 'manual',
  radar_ref TEXT DEFAULT '',
  topic_id TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS change_log (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id TEXT DEFAULT '',
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_materials_topic ON materials(topic_id);
CREATE INDEX IF NOT EXISTS idx_versions_draft ON versions(draft_id);
CREATE INDEX IF NOT EXISTS idx_qc_version ON qc_reports(version_id);
`);

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function now() {
  return new Date().toISOString();
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULTS[key];
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

export function allSettings() {
  const out = { ...DEFAULTS };
  for (const row of db.prepare('SELECT key,value FROM settings').all()) out[row.key] = row.value;
  return out;
}

export function log(entity, entityId, action, detail = '') {
  db.prepare('INSERT INTO change_log(id,entity,entity_id,action,detail,created_at) VALUES(?,?,?,?,?,?)')
    .run(uid('log'), entity, entityId, action, typeof detail === 'string' ? detail : JSON.stringify(detail), now());
}

export function j(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
