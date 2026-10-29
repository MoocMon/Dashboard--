import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, ROOT, DATA_DIR, uid, now, allSettings, setSetting, getSetting, log } from './db.js';
import { seed } from './seed.js';
import { parseByPlatform, PLATFORM_LABEL } from './parse.js';
import { runQC, loadRules, loadWordlib, recomputeConclusion } from './qc.js';
import { buildPrompt, activePrompt, promptVersions, varsIn, materialDigest, platformSpec } from './prompts.js';
import { archiveVersion, baseDir } from './archive.js';
import { fetchUrl, parseUpload } from './parsers.js';
import { importRadar } from './radar.js';
import { callLLM, testLLM, llmStatus, getPresets, repairVersion, repairTargeted } from './llm.js';

seed();
const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 30 * 1024 * 1024 });

const J = (v, fb) => { try { return JSON.parse(v ?? ''); } catch { return fb; } };
const today = () => new Date().toISOString().slice(0, 10);

function rulesMap() {
  return loadRules(db.prepare('SELECT * FROM rules').all());
}

function getTopic(id) {
  return db.prepare('SELECT * FROM topics WHERE id = ?').get(id);
}

function materialsOf(topicId) {
  return db.prepare('SELECT * FROM materials WHERE topic_id = ? ORDER BY created_at ASC').all(topicId);
}

function outlineOf(topicId) {
  return db.prepare('SELECT * FROM outlines WHERE topic_id = ? ORDER BY created_at DESC LIMIT 1').get(topicId);
}

function versionsOf(draftId) {
  return db.prepare('SELECT * FROM versions WHERE draft_id = ? ORDER BY version_no DESC').all(draftId);
}

function latestQC(versionId) {
  return db.prepare('SELECT * FROM qc_reports WHERE version_id = ? ORDER BY created_at DESC LIMIT 1').get(versionId);
}

function archivedOf(draftId) {
  return db.prepare('SELECT * FROM archives WHERE draft_id = ? ORDER BY created_at DESC LIMIT 1').get(draftId);
}

function deriveDraftStatus(draft, versions, outline, qc, archived) {
  if (archived) return '已归档';
  if (!versions.length) {
    if (draft.platform === 'douyin') {
      if (!outline) return '待大纲';
      if (outline.status !== 'confirmed') return '待确认方向';
      return '待大纲';
    }
    return '未开始';
  }
  if (qc && qc.conclusion === 'block') return '待修改';
  return '可归档';
}

function draftCards(topicId) {
  const drafts = db.prepare('SELECT * FROM drafts WHERE topic_id = ?').all(topicId);
  const outline = outlineOf(topicId);
  return drafts.map((d) => {
    const versions = versionsOf(d.id);
    const cur = versions[0] || null;
    const qc = cur ? latestQC(cur.id) : null;
    const arc = archivedOf(d.id);
    return {
      ...d,
      ad: !!d.ad,
      sponsor: !!d.sponsor,
      status: deriveDraftStatus(d, versions, outline, qc, arc),
      version_count: versions.length,
      current_version: cur ? { id: cur.id, version_no: cur.version_no, created_at: cur.created_at, origin: cur.origin } : null,
      qc: qc ? { id: qc.id, conclusion: qc.conclusion, stats: J(qc.stats, {}), created_at: qc.created_at, stale: !!qc.stale } : null,
      archived: arc ? { path: arc.path, created_at: arc.created_at } : null,
    };
  });
}

function deriveTopicStatus(topic) {
  if (topic.status === '已搁置') return '已搁置';
  const drafts = db.prepare('SELECT * FROM drafts WHERE topic_id = ?').all(topic.id);
  const arcs = db.prepare('SELECT COUNT(*) c FROM archives WHERE topic_id = ?').get(topic.id).c;
  if (arcs > 0) return '已归档';
  let versions = 0, pendingQC = false;
  for (const d of drafts) {
    const v = versionsOf(d.id);
    versions += v.length;
    if (v.length && !latestQC(v[0].id)) pendingQC = true;
  }
  if (versions > 0) return pendingQC ? '待质检' : '创作中';
  const mats = materialsOf(topic.id);
  if (mats.length) return '资料就绪';
  return '待整理';
}

const topicView = (t) => ({ ...t, platforms: J(t.platforms, []), status: deriveTopicStatus(t) });

const backup = () => {
  const dir = path.join(DATA_DIR, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(DATA_DIR, 'workbench.db');
  if (!fs.existsSync(src)) return null;
  const target = path.join(dir, `workbench-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)}.db`);
  if (fs.existsSync(target)) return target;
  fs.copyFileSync(src, target);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
  while (files.length > 7) {
    const old = files.shift();
    try { fs.unlinkSync(path.join(dir, old)); } catch { /* ignore */ }
  }
  return target;
};
try { backup(); } catch { /* 备份失败不阻塞启动 */ }

// ---------------- 基础状态 ----------------
app.get('/api/bootstrap', async () => {
  const s = allSettings();
  const wordlib = loadWordlib(s.wordlib_path);
  const dir = baseDir(s);
  const dirExists = fs.existsSync(dir);
  const counts = {
    topics: db.prepare('SELECT COUNT(*) c FROM topics').get().c,
    materials: db.prepare('SELECT COUNT(*) c FROM materials').get().c,
    drafts: db.prepare('SELECT COUNT(*) c FROM drafts').get().c,
    candidates: db.prepare("SELECT COUNT(*) c FROM candidates WHERE status='pending'").get().c,
    archived: db.prepare('SELECT COUNT(*) c FROM archives').get().c,
  };
  return {
    settings: s,
    wordlib: { count: wordlib.count, mtime: wordlib.mtime, error: wordlib.error },
    obsidian: { dir, exists: dirExists, vault: s.obsidian_vault },
    counts,
    today: today(),
    llm: { ...llmStatus(), presets: getPresets() },
  };
});

app.get('/api/wordlib', async () => {
  const s = allSettings();
  const w = loadWordlib(s.wordlib_path);
  return { count: w.count, mtime: w.mtime, error: w.error, path: s.wordlib_path };
});

// ---------------- 选题 ----------------
app.get('/api/topics', async (req) => {
  const { q = '', status = '', tag = '' } = req.query || {};
  let rows = db.prepare('SELECT * FROM topics').all().map(topicView);
  if (q) {
    const k = String(q).toLowerCase();
    rows = rows.filter((t) => [t.name, t.source, t.angle, t.tags].join(' ').toLowerCase().includes(k));
  }
  if (status) rows = rows.filter((t) => t.status === status);
  if (tag) rows = rows.filter((t) => (t.tags || '').split(/[,，\s]+/).includes(tag));
  const pri = { 1: 1, 2: 2, 3: 3 };
  rows.sort((a, b) => {
    if (a.schedule_date && b.schedule_date) return a.schedule_date.localeCompare(b.schedule_date);
    if (a.schedule_date) return -1;
    if (b.schedule_date) return 1;
    const p = (pri[a.priority] || 2) - (pri[b.priority] || 2);
    return p !== 0 ? p : b.created_at.localeCompare(a.created_at);
  });
  return rows.map((t) => ({ ...t, draft_count: db.prepare('SELECT COUNT(*) c FROM drafts WHERE topic_id=?').get(t.id).c }));
});

app.post('/api/topics', async (req, reply) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) return reply.code(400).send({ error: '选题名称必填' });
  if (String(b.name).length > 60) return reply.code(400).send({ error: '选题名称不超过 60 字' });
  if ((b.angle || '').length > 120) return reply.code(400).send({ error: '立意不超过 120 字' });
  const dup = db.prepare('SELECT id,name FROM topics WHERE name = ?').get(String(b.name).trim());
  const id = uid('tp');
  const t = now();
  const platforms = Array.isArray(b.platforms) && b.platforms.length ? b.platforms : ['douyin', 'xhs', 'wechat'];
  db.prepare(`INSERT INTO topics(id,name,source,angle,content_type,platforms,priority,status,schedule_date,tags,account,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, String(b.name).trim(), b.source || '', b.angle || '', b.content_type || '',
    JSON.stringify(platforms), Number(b.priority || 2), '待整理', b.schedule_date || null,
    b.tags || '', getSetting('account'), t, t,
  );
  for (const p of platforms) {
    db.prepare('INSERT OR IGNORE INTO drafts(id,topic_id,platform,status,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(uid('dr'), id, p, '未开始', t, t);
  }
  if (b.schedule_date) {
    for (const p of platforms) db.prepare('INSERT OR REPLACE INTO schedule(id,topic_id,platform,date) VALUES(?,?,?,?)').run(uid('sc'), id, p, b.schedule_date);
  }
  log('topic', id, 'create', b.name);
  return { topic: topicView(getTopic(id)), duplicate: dup ? dup.name : null };
});

app.get('/api/topics/:id', async (req, reply) => {
  const t = getTopic(req.params.id);
  if (!t) return reply.code(404).send({ error: '选题不存在' });
  const mats = materialsOf(t.id);
  const outline = outlineOf(t.id);
  const drafts = draftCards(t.id);
  const archives = db.prepare('SELECT * FROM archives WHERE topic_id = ? ORDER BY created_at DESC').all(t.id);
  return {
    topic: topicView(t),
    materials: mats.map((m) => ({ ...m, snippet: m.snippet_id ? db.prepare('SELECT id,text FROM snippets WHERE id=?').get(m.snippet_id) : null })),
    outline,
    drafts,
    archives,
    completeness: {
      fact: mats.filter((m) => m.kind === 'fact').length,
      opinion: mats.filter((m) => m.kind === 'opinion').length,
      inference: mats.filter((m) => m.kind === 'inference').length,
      pending: mats.filter((m) => m.kind === 'pending').length,
      ready: mats.length > 0 && mats.every((m) => ['fact', 'opinion', 'inference', 'pending'].includes(m.kind)),
    },
    prompts: {
      douyin_outline: activePrompt('douyin_outline')?.name,
      douyin_script: activePrompt('douyin_script')?.name,
      xhs_note: activePrompt('xhs_note')?.name,
      wechat_article: activePrompt('wechat_article')?.name,
    },
  };
});

app.patch('/api/topics/:id', async (req, reply) => {
  const t = getTopic(req.params.id);
  if (!t) return reply.code(404).send({ error: '选题不存在' });
  const b = req.body || {};
  const fields = ['name', 'source', 'angle', 'content_type', 'priority', 'schedule_date', 'tags', 'status', 'account'];
  const sets = [], vals = [];
  for (const f of fields) if (b[f] !== undefined) { sets.push(`${f} = ?`); vals.push(b[f]); }
  if (b.platforms !== undefined) {
    sets.push('platforms = ?');
    vals.push(JSON.stringify(b.platforms));
    const cur = db.prepare('SELECT platform FROM drafts WHERE topic_id=?').all(t.id).map((r) => r.platform);
    for (const p of b.platforms) if (!cur.includes(p)) db.prepare('INSERT INTO drafts(id,topic_id,platform,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(uid('dr'), t.id, p, '未开始', now(), now());
    for (const p of cur) if (!b.platforms.includes(p)) {
      const d = db.prepare('SELECT id FROM drafts WHERE topic_id=? AND platform=?').get(t.id, p);
      const hasVersion = db.prepare('SELECT COUNT(*) c FROM versions WHERE draft_id=?').get(d.id).c;
      if (!hasVersion) db.prepare('DELETE FROM drafts WHERE id=?').run(d.id);
    }
  }
  if (!sets.length && b.platforms === undefined) return { topic: topicView(t) };
  sets.push('updated_at = ?'); vals.push(now()); vals.push(t.id);
  db.prepare(`UPDATE topics SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  if (b.schedule_date !== undefined) {
    const platforms = J(getTopic(t.id).platforms, []);
    for (const p of platforms) {
      if (b.schedule_date) db.prepare('INSERT OR REPLACE INTO schedule(id,topic_id,platform,date) VALUES(?,?,?,?)').run(uid('sc'), t.id, p, b.schedule_date);
      else db.prepare('DELETE FROM schedule WHERE topic_id=? AND platform=?').run(t.id, p);
    }
  }
  log('topic', t.id, 'update', b);
  return { topic: topicView(getTopic(t.id)) };
});

app.delete('/api/topics/:id', async (req, reply) => {
  const t = getTopic(req.params.id);
  if (!t) return reply.code(404).send({ error: '选题不存在' });
  const archived = db.prepare('SELECT COUNT(*) c FROM archives WHERE topic_id=?').get(t.id).c;
  db.prepare('DELETE FROM topics WHERE id=?').run(t.id);
  log('topic', t.id, 'delete', archived ? '已归档选题删除索引，Obsidian 文件保留' : '');
  return { ok: true, keptObsidianFiles: archived > 0 };
});

// ---------------- 资料 ----------------
app.post('/api/topics/:id/materials', async (req, reply) => {
  const t = getTopic(req.params.id);
  if (!t) return reply.code(404).send({ error: '选题不存在' });
  const b = req.body || {};
  const kinds = ['fact', 'opinion', 'inference', 'pending'];
  if (!kinds.includes(b.kind)) return reply.code(400).send({ error: '资料必须归入事实 / 观点 / 推断 / 待核实 之一' });
  if (!b.content || !String(b.content).trim()) return reply.code(400).send({ error: '资料内容为空' });
  const id = uid('mt');
  db.prepare('INSERT INTO materials(id,topic_id,kind,title,content,source_url,source_name,file_path,verify_status,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, t.id, b.kind, b.title || '', b.content, b.source_url || '', b.source_name || '', b.file_path || '', b.verify_status || 'none', b.note || '', now());
  log('material', id, 'create', b.kind);
  return { material: db.prepare('SELECT * FROM materials WHERE id=?').get(id) };
});

app.patch('/api/materials/:id', async (req, reply) => {
  const m = db.prepare('SELECT * FROM materials WHERE id=?').get(req.params.id);
  if (!m) return reply.code(404).send({ error: '资料不存在' });
  const b = req.body || {};
  for (const f of ['kind', 'title', 'content', 'source_url', 'verify_status', 'note']) {
    if (b[f] !== undefined) db.prepare(`UPDATE materials SET ${f}=? WHERE id=?`).run(b[f], m.id);
  }
  return { material: db.prepare('SELECT * FROM materials WHERE id=?').get(m.id) };
});

app.delete('/api/materials/:id', async (req) => {
  db.prepare('DELETE FROM materials WHERE id=?').run(req.params.id);
  return { ok: true };
});

app.post('/api/materials/:id/to-snippet', async (req, reply) => {
  const m = db.prepare('SELECT * FROM materials WHERE id=?').get(req.params.id);
  if (!m) return reply.code(404).send({ error: '资料不存在' });
  const id = uid('sn');
  db.prepare('INSERT INTO snippets(id,text,kind,source,tags,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, m.content, m.kind, m.source_url || m.source_name || '', (req.body && req.body.tags) || '', now());
  db.prepare('UPDATE materials SET snippet_id=? WHERE id=?').run(id, m.id);
  return { snippet: db.prepare('SELECT * FROM snippets WHERE id=?').get(id) };
});

// ---------------- 抓取与文件解析 ----------------
app.post('/api/fetch/url', async (req, reply) => {
  const { url } = req.body || {};
  if (!url) return reply.code(400).send({ error: '缺少链接' });
  return fetchUrl(url);
});

app.post('/api/fetch/file', async (req, reply) => {
  const { name, base64 } = req.body || {};
  if (!name) return reply.code(400).send({ error: '缺少文件名' });
  return parseUpload({ name, base64 });
});

// ---------------- 素材库 ----------------
app.get('/api/snippets', async (req) => {
  const { tag = '' } = req.query || {};
  let rows = db.prepare('SELECT * FROM snippets ORDER BY created_at DESC').all();
  if (tag) rows = rows.filter((s) => (s.tags || '').includes(tag));
  return rows;
});

app.post('/api/snippets', async (req, reply) => {
  const b = req.body || {};
  if (!b.text) return reply.code(400).send({ error: '内容为空' });
  const id = uid('sn');
  db.prepare('INSERT INTO snippets(id,text,kind,source,tags,created_at) VALUES(?,?,?,?,?,?)')
    .run(id, b.text, b.kind || 'fact', b.source || '', b.tags || '', now());
  return { snippet: db.prepare('SELECT * FROM snippets WHERE id=?').get(id) };
});

app.patch('/api/snippets/:id', async (req, reply) => {
  const s = db.prepare('SELECT * FROM snippets WHERE id=?').get(req.params.id);
  if (!s) return reply.code(404).send({ error: '素材不存在' });
  const b = req.body || {};
  for (const f of ['text', 'kind', 'source', 'tags']) if (b[f] !== undefined) db.prepare(`UPDATE snippets SET ${f}=? WHERE id=?`).run(b[f], s.id);
  return { snippet: db.prepare('SELECT * FROM snippets WHERE id=?').get(s.id), cited: s.cite_count };
});

app.delete('/api/snippets/:id', async (req) => {
  const s = db.prepare('SELECT * FROM snippets WHERE id=?').get(req.params.id);
  if (!s) return { ok: true };
  if (s.cite_count > 0) {
    db.prepare('UPDATE snippets SET disabled=1 WHERE id=?').run(s.id);
    return { ok: true, disabled: true, reason: '已被引用，只停用不删除' };
  }
  db.prepare('DELETE FROM snippets WHERE id=?').run(s.id);
  return { ok: true };
});

app.post('/api/snippets/:id/cite', async (req, reply) => {
  const s = db.prepare('SELECT * FROM snippets WHERE id=?').get(req.params.id);
  const { topic_id } = req.body || {};
  const t = getTopic(topic_id);
  if (!s || !t) return reply.code(404).send({ error: '素材或选题不存在' });
  if (s.disabled) return reply.code(400).send({ error: '该素材已停用' });
  const id = uid('mt');
  db.prepare('INSERT INTO materials(id,topic_id,kind,title,content,source_url,source_name,snippet_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, t.id, s.kind, `引用素材 ${s.id}`, s.text, s.source || '', '素材库', s.id, now());
  db.prepare('UPDATE snippets SET cite_count = cite_count + 1 WHERE id=?').run(s.id);
  return { material: db.prepare('SELECT * FROM materials WHERE id=?').get(id), warning: '引用时已快照，源素材后续修改不影响本选题' };
});

// ---------------- 大纲 ----------------
app.get('/api/topics/:id/outlines', async (req) => db.prepare('SELECT * FROM outlines WHERE topic_id=? ORDER BY created_at DESC').all(req.params.id));

app.post('/api/topics/:id/outlines', async (req, reply) => {
  const t = getTopic(req.params.id);
  if (!t) return reply.code(404).send({ error: '选题不存在' });
  const b = req.body || {};
  if (!b.hook && !b.thesis) return reply.code(400).send({ error: '钩子和核心论点至少填一项' });
  const id = uid('ol');
  const vno = (db.prepare('SELECT COALESCE(MAX(version_no),0) c FROM outlines WHERE topic_id=?').get(t.id).c || 0) + 1;
  db.prepare('INSERT INTO outlines(id,topic_id,hook,thesis,structure,assumptions,post_copy,cover_copy,status,version_no,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, t.id, b.hook || '', b.thesis || '', b.structure || '', b.assumptions || '', b.post_copy || '', b.cover_copy || '', 'draft', vno, now());
  log('outline', id, 'create', `v${vno}`);
  return { outline: db.prepare('SELECT * FROM outlines WHERE id=?').get(id) };
});

app.patch('/api/outlines/:id', async (req, reply) => {
  const o = db.prepare('SELECT * FROM outlines WHERE id=?').get(req.params.id);
  if (!o) return reply.code(404).send({ error: '大纲不存在' });
  const b = req.body || {};
  for (const f of ['hook', 'thesis', 'structure', 'assumptions', 'post_copy', 'cover_copy', 'reject_reason']) {
    if (b[f] !== undefined) db.prepare(`UPDATE outlines SET ${f}=? WHERE id=?`).run(b[f], o.id);
  }
  if (b.status === 'confirmed') db.prepare("UPDATE outlines SET status='confirmed', confirmed_at=? WHERE id=?").run(now(), o.id);
  if (b.status === 'rejected') db.prepare("UPDATE outlines SET status='rejected', reject_reason=? WHERE id=?").run(b.reject_reason || '方向被否', o.id);
  log('outline', o.id, 'update', b.status || 'edit');
  return { outline: db.prepare('SELECT * FROM outlines WHERE id=?').get(o.id) };
});

// AI 生成大纲（独立路由，不存入 drafts/versions）
app.post('/api/topics/:id/outline/generate', async (req, reply) => {
  const t = getTopic(req.params.id);
  if (!t) return reply.code(404).send({ error: '选题不存在' });
  const mats = materialsOf(t.id);
  if (!mats.length) return reply.code(400).send({ error: '资料区为空，禁止生成' });
  const built = buildPrompt('douyin_outline', { topic: t, materials: mats, outline: null, draft: null, settings: allSettings(), node: {} });
  if (built.missing?.length) return reply.code(400).send({ error: `模板缺少变量：${built.missing.join('、')}` });

  let text;
  try {
    text = await callLLM({ user: built.prompt, temperature: 0.7 });
  } catch (e) {
    return reply.code(502).send({ error: e.message });
  }

  // 解析大纲 sections（复用 CreateTab 里的 parseOutlineSections 逻辑）
  const parsed = {};
  const re = /^#{2,4}\s*(.+)$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text))) heads.push({ title: m[1].trim(), start: m.index + m[0].length });
  heads.forEach((h, i) => {
    const body = text.slice(h.start, i + 1 < heads.length ? heads[i + 1].start : text.length).trim();
    const k = /钩子/.test(h.title) ? 'hook'
      : /核心论点|论点/.test(h.title) ? 'thesis'
        : /结构/.test(h.title) ? 'structure'
          : /假设|待验证/.test(h.title) ? 'assumptions'
            : /发布文案/.test(h.title) ? 'post_copy'
              : /封面/.test(h.title) ? 'cover_copy' : null;
    if (k && !parsed[k]) parsed[k] = body;
  });
  if (parsed.hook) parsed.hook = parsed.hook.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
  for (const k of ['thesis', 'post_copy', 'cover_copy']) if (parsed[k]) parsed[k] = parsed[k].split('\n')[0].trim();

  const id = uid('ol');
  const vno = (db.prepare('SELECT COALESCE(MAX(version_no),0) c FROM outlines WHERE topic_id=?').get(t.id).c || 0) + 1;
  db.prepare('INSERT INTO outlines(id,topic_id,hook,thesis,structure,assumptions,post_copy,cover_copy,status,version_no,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, t.id, parsed.hook || '', parsed.thesis || '', parsed.structure || '', parsed.assumptions || '', parsed.post_copy || '', parsed.cover_copy || '', 'draft', vno, now());
  log('outline', id, 'ai-generate', `v${vno}`);
  return { outline: db.prepare('SELECT * FROM outlines WHERE id=?').get(id), raw_text: text };
});

// ---------------- 稿件与版本 ----------------
app.post('/api/topics/:id/drafts', async (req, reply) => {
  const t = getTopic(req.params.id);
  if (!t) return reply.code(404).send({ error: '选题不存在' });
  const { platform } = req.body || {};
  if (!PLATFORM_LABEL[platform]) return reply.code(400).send({ error: '未知平台' });
  const id = uid('dr');
  db.prepare('INSERT OR IGNORE INTO drafts(id,topic_id,platform,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, t.id, platform, '未开始', now(), now());
  return { drafts: draftCards(t.id) };
});

app.patch('/api/drafts/:id', async (req, reply) => {
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(req.params.id);
  if (!d) return reply.code(404).send({ error: '稿件不存在' });
  const b = req.body || {};
  if (b.ad !== undefined) db.prepare('UPDATE drafts SET ad=? WHERE id=?').run(b.ad ? 1 : 0, d.id);
  if (b.sponsor !== undefined) db.prepare('UPDATE drafts SET sponsor=? WHERE id=?').run(b.sponsor ? 1 : 0, d.id);
  db.prepare('UPDATE drafts SET updated_at=? WHERE id=?').run(now(), d.id);
  return { draft: db.prepare('SELECT * FROM drafts WHERE id=?').get(d.id) };
});

app.get('/api/drafts/:id', async (req, reply) => {
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(req.params.id);
  if (!d) return reply.code(404).send({ error: '稿件不存在' });
  const t = getTopic(d.topic_id);
  const versions = versionsOf(d.id).map((v) => ({
    id: v.id, version_no: v.version_no, created_at: v.created_at, origin: v.origin,
    chars: (v.parsed ? (J(v.parsed, {}).chars || 0) : 0),
    qc: (() => { const q = latestQC(v.id); return q ? { id: q.id, conclusion: q.conclusion, stale: !!q.stale } : null; })(),
  }));
  const cur = versionsOf(d.id)[0];
  return {
    draft: { ...d, ad: !!d.ad, sponsor: !!d.sponsor },
    topic: topicView(t),
    versions,
    current: cur ? {
      ...cur, parsed: J(cur.parsed, {}), structure: J(cur.structure, {}),
      qc: (() => { const q = latestQC(cur.id); return q ? { ...q, stats: J(q.stats, {}), items: J(q.items, []) } : null; })(),
    } : null,
    outline: outlineOf(t.id),
    archived: archivedOf(d.id),
  };
});

app.post('/api/drafts/:id/prompt', async (req, reply) => {
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(req.params.id);
  if (!d) return reply.code(404).send({ error: '稿件不存在' });
  const t = getTopic(d.topic_id);
  const mats = materialsOf(t.id);
  if (!mats.length) return reply.code(400).send({ error: '资料区为空，禁止生成。请先补至少 1 条资料。' });
  const key = d.platform === 'douyin' ? (req.body?.kind === 'script' ? 'douyin_script' : 'douyin_outline')
    : d.platform === 'xhs' ? 'xhs_note' : 'wechat_article';
  const outline = outlineOf(t.id);
  if (key === 'douyin_script' && (!outline || outline.status !== 'confirmed')) {
    return reply.code(400).send({ error: '抖音必须先出大纲并确认方向，才能生成分镜脚本' });
  }
  const built = buildPrompt(key, { topic: t, materials: mats, outline, draft: d, settings: allSettings(), node: req.body?.node || {} });
  return { ...built, snapshot: JSON.stringify(built.template) };
});

// AI 自动出稿：拼 Prompt → 调 LLM → 直接返回正文（可选 auto_save 自动存版本）
app.post('/api/drafts/:id/generate', async (req, reply) => {
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(req.params.id);
  if (!d) return reply.code(404).send({ error: '稿件不存在' });
  const t = getTopic(d.topic_id);
  const mats = materialsOf(t.id);
  if (!mats.length) return reply.code(400).send({ error: '资料区为空，禁止生成' });
  const key = d.platform === 'douyin' ? (req.body?.kind === 'script' ? 'douyin_script' : 'douyin_outline')
    : d.platform === 'xhs' ? 'xhs_note' : 'wechat_article';
  const outline = outlineOf(t.id);
  if (key === 'douyin_script' && (!outline || outline.status !== 'confirmed')) {
    return reply.code(400).send({ error: '抖音必须先确认大纲方向，才能生成分镜脚本' });
  }
  if (key === 'douyin_outline') {
    // 大纲本身不需要先确认，直接生成
  }
  const built = buildPrompt(key, { topic: t, materials: mats, outline, draft: d, settings: allSettings(), node: req.body?.node || {} });
  if (built.missing?.length) return reply.code(400).send({ error: `模板缺少变量：${built.missing.join('、')}` });

  let text;
  try {
    text = await callLLM({ user: built.prompt, temperature: 0.7 });
  } catch (e) {
    return reply.code(502).send({ error: e.message });
  }

  const autoSave = req.body?.auto_save !== false;  // 默认自动存
  if (autoSave) {
    const prev = versionsOf(d.id)[0];
    const { parsed, structure } = parseByPlatform(d.platform, text);
    const vno = (prev ? prev.version_no : 0) + 1;
    const id = uid('vs');
    db.prepare('INSERT INTO versions(id,draft_id,version_no,raw_text,parsed,structure,origin,prompt_snapshot,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, d.id, vno, text, JSON.stringify(parsed), JSON.stringify(structure), 'ai', JSON.stringify(built.template), '', now());
    db.prepare('UPDATE drafts SET current_version_id=?, updated_at=? WHERE id=?').run(id, now(), d.id);
    log('version', id, 'ai-generate', `v${vno} platform=${d.platform} kind=${key}`);
    return { text, version_no: vno, structure, saved: true, version_id: id };
  }
  // 不自动存，只返回文本，让前端决定
  const { parsed, structure } = parseByPlatform(d.platform, text);
  return { text, structure, saved: false };
});

// LLM 连通性测试
app.post('/api/llm/test', async () => testLLM());
app.get('/api/llm/status', async () => llmStatus());

app.post('/api/drafts/:id/versions', async (req, reply) => {
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(req.params.id);
  if (!d) return reply.code(404).send({ error: '稿件不存在' });
  const b = req.body || {};
  const raw = String(b.raw_text || '');
  if (!raw.trim()) return reply.code(400).send({ error: '正文为空' });
  const prev = versionsOf(d.id)[0];
  if (prev && prev.raw_text.trim() === raw.trim()) return reply.code(400).send({ error: '内容无变化，不产生空版本' });
  const { parsed, structure } = parseByPlatform(d.platform, raw);
  const vno = (prev ? prev.version_no : 0) + 1;
  const id = uid('vs');
  db.prepare('INSERT INTO versions(id,draft_id,version_no,raw_text,parsed,structure,origin,prompt_snapshot,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, d.id, vno, raw, JSON.stringify(parsed), JSON.stringify(structure), b.origin || 'manual', b.prompt_snapshot || '', b.note || '', now());
  db.prepare('UPDATE drafts SET current_version_id=?, updated_at=? WHERE id=?').run(id, now(), d.id);
  log('version', id, 'create', `v${vno}`);
  return { version: db.prepare('SELECT * FROM versions WHERE id=?').get(id), structure };
});

app.get('/api/versions/:id', async (req, reply) => {
  const v = db.prepare('SELECT * FROM versions WHERE id=?').get(req.params.id);
  if (!v) return reply.code(404).send({ error: '版本不存在' });
  const qc = latestQC(v.id);
  return {
    ...v,
    parsed: J(v.parsed, {}),
    structure: J(v.structure, {}),
    qc: qc ? { ...qc, stats: J(qc.stats, {}), items: J(qc.items, []) } : null,
    ignores: db.prepare('SELECT * FROM qc_ignores WHERE report_id=?').all(qc?.id || ''),
  };
});

app.put('/api/versions/:id', async (req, reply) => {
  const v = db.prepare('SELECT * FROM versions WHERE id=?').get(req.params.id);
  if (!v) return reply.code(404).send({ error: '版本不存在' });
  const raw = String(req.body?.raw_text || '');
  if (!raw.trim()) return reply.code(400).send({ error: '正文为空' });
  if (raw.trim() === v.raw_text.trim()) return reply.code(400).send({ error: '内容无变化，不产生空版本' });
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(v.draft_id);
  const { parsed, structure } = parseByPlatform(d.platform, raw);
  const maxNo = db.prepare('SELECT MAX(version_no) m FROM versions WHERE draft_id=?').get(d.id).m;
  const id = uid('vs');
  db.prepare('INSERT INTO versions(id,draft_id,version_no,raw_text,parsed,structure,origin,prompt_snapshot,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, d.id, maxNo + 1, raw, JSON.stringify(parsed), JSON.stringify(structure), 'manual', '', req.body?.note || '', now());
  db.prepare('UPDATE drafts SET current_version_id=?, updated_at=? WHERE id=?').run(id, now(), d.id);
  return { version: db.prepare('SELECT * FROM versions WHERE id=?').get(id), structure };
});

// AI 自动修复（按质检问题清单修，存新版本，自动再质检）
app.post('/api/versions/:id/repair', async (req, reply) => {
  const v = db.prepare('SELECT * FROM versions WHERE id=?').get(req.params.id);
  if (!v) return reply.code(404).send({ error: '版本不存在' });
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(v.draft_id);
  const qc = latestQC(v.id);
  if (!qc) return reply.code(400).send({ error: '该版本还没跑过质检，没东西可修' });
  const settings = allSettings();
  const rules = rulesMap();
  const wordlib = loadWordlib(settings.wordlib_path);
  const whitelist = db.prepare('SELECT * FROM whitelist').all();
  const t = getTopic(d.topic_id);
  const maxRounds = Math.min(Math.max(Number(req.body?.rounds) || 3, 1), 3);

  const qcOnce = (text) => runQC({
    raw: text, platform: d.platform, contentType: t.content_type, topic: t,
    materials: materialsOf(t.id), rules, whitelist, wordlib, settings,
    outline: outlineOf(t.id), ad: !!d.ad, sponsor: !!d.sponsor,
  });

  let curText = v.raw_text;
  let curQC = qcOnce(curText);
  const rounds = [];
  let lastError = '';

  for (let round = 1; round <= maxRounds; round += 1) {
    const pending = curQC.items.filter((it) => it.level !== 'info');
    if (!pending.length) break;
    const beforeBlock = curQC.stats.block || 0;
    let nextText = '';
    let mode = '';

    try {
      // 前几轮只改质检点名的句子；最后一轮整篇重写兜底
      if (round < maxRounds) {
        mode = 'targeted';
        const r = await repairTargeted({ platform: d.platform, rawText: curText, qcItems: pending });
        if (r.patches > 0) nextText = r.text;
      }
      if (!nextText) {
        mode = 'full';
        nextText = await repairVersion({ platform: d.platform, rawText: curText, qcItems: pending, settings });
      }
    } catch (e) {
      lastError = e.message;
      rounds.push({ round, mode, error: e.message });
      break;
    }

    if (!nextText || nextText.trim() === curText.trim()) {
      rounds.push({ round, mode, changed: false });
      break;
    }

    const nextQC = qcOnce(nextText);
    rounds.push({ round, mode, block: nextQC.stats.block || 0, suggest: nextQC.stats.suggest || 0, conclusion: nextQC.conclusion });
    curText = nextText;
    curQC = nextQC;
    if (nextQC.conclusion === 'pass') break;
    // 整篇重写也没能减少阻断，才停；定向多轮无效时留给最后一轮整篇兜底
    if (mode === 'full' && round >= 2 && (nextQC.stats.block || 0) >= beforeBlock) break;
  }

  const improved = rounds.some((r) => r.changed !== false && (r.block !== undefined));
  if (!improved) {
    if (lastError) return reply.code(502).send({ error: lastError, rounds });
    return reply.code(400).send({ error: 'AI 没能定位到可改的句子（可能问题在结构或整体层面），请手动修改这一版', rounds });
  }

  // 存新版本
  const id = uid('vs');
  const maxNo = db.prepare('SELECT MAX(version_no) m FROM versions WHERE draft_id=?').get(d.id).m;
  const roundNote = rounds.map((r) => `第${r.round}轮${r.mode === 'targeted' ? '定向' : '整篇'}→阻断${r.block ?? '-'}/建议${r.suggest ?? '-'}`).join('；');
  db.prepare('INSERT INTO versions(id,draft_id,version_no,raw_text,parsed,structure,origin,prompt_snapshot,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, d.id, maxNo + 1, curText, JSON.stringify(curQC.parsed || {}), JSON.stringify(curQC.structure || {}), 'repair', '', `AI 修复自 v${v.version_no}（${roundNote}）`, now());
  db.prepare('UPDATE drafts SET current_version_id=?, updated_at=? WHERE id=?').run(id, now(), d.id);
  log('version', id, 'repair', `from v${v.version_no} rounds=${rounds.length}`);

  const qcId = uid('qc');
  db.prepare('INSERT INTO qc_reports(id,draft_id,version_id,platform,content_type,conclusion,stats,items,rules_fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(qcId, d.id, id, d.platform, t.content_type || '', curQC.conclusion, JSON.stringify(curQC.stats), JSON.stringify(curQC.items), cryptoFingerprint(rules), now());
  curQC.id = qcId;
  log('qc', qcId, 'repair-run', `conclusion=${curQC.conclusion}`);

  return {
    version: db.prepare('SELECT * FROM versions WHERE id=?').get(id),
    structure: curQC.structure,
    qc: { ...curQC, stats: curQC.stats, items: curQC.items },
    rounds,
  };
});

app.post('/api/drafts/:id/rollback', async (req, reply) => {
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(req.params.id);
  const src = db.prepare('SELECT * FROM versions WHERE id=?').get(req.body?.version_id);
  if (!d || !src) return reply.code(404).send({ error: '稿件或版本不存在' });
  const maxNo = db.prepare('SELECT MAX(version_no) m FROM versions WHERE draft_id=?').get(d.id).m;
  const { parsed, structure } = parseByPlatform(d.platform, src.raw_text);
  const id = uid('vs');
  db.prepare('INSERT INTO versions(id,draft_id,version_no,raw_text,parsed,structure,origin,prompt_snapshot,note,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, d.id, maxNo + 1, src.raw_text, JSON.stringify(parsed), JSON.stringify(structure), 'rollback', '', `回滚自 v${src.version_no}`, now());
  db.prepare('UPDATE drafts SET current_version_id=?, updated_at=? WHERE id=?').run(id, now(), d.id);
  return { version: db.prepare('SELECT * FROM versions WHERE id=?').get(id), structure };
});

// ---------------- 质检 ----------------
app.post('/api/versions/:id/qc', async (req, reply) => {
  const v = db.prepare('SELECT * FROM versions WHERE id=?').get(req.params.id);
  if (!v) return reply.code(404).send({ error: '版本不存在' });
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(v.draft_id);
  const t = getTopic(d.topic_id);
  const settings = allSettings();
  const rules = rulesMap();
  const wordlib = loadWordlib(settings.wordlib_path);
  const whitelist = db.prepare('SELECT * FROM whitelist').all();
  const result = runQC({
    raw: v.raw_text, platform: d.platform, contentType: t.content_type, topic: t,
    materials: materialsOf(t.id), rules, whitelist, wordlib, settings,
    outline: outlineOf(t.id), ad: !!d.ad, sponsor: !!d.sponsor,
  });
  const id = uid('qc');
  const fp = cryptoFingerprint(rules);
  db.prepare('INSERT INTO qc_reports(id,draft_id,version_id,platform,content_type,conclusion,stats,items,rules_fingerprint,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, d.id, v.id, d.platform, t.content_type || '', result.conclusion, JSON.stringify(result.stats), JSON.stringify(result.items), fp, now());
  return {
    report: {
      id, draft_id: d.id, version_id: v.id, platform: d.platform, content_type: t.content_type,
      conclusion: result.conclusion, stats: result.stats, items: result.items, note: result.note || null,
      created_at: now(), structure: result.structure, parsed: result.parsed, wordlib: { count: wordlib.count, error: wordlib.error },
      disabled_rules: result.disabled,
    },
  };
});

function cryptoFingerprint(rules) {
  const arr = [...rules.values()].map((r) => `${r.id}:${r.enabled}:${JSON.stringify(r.params)}`).sort();
  return crypto.createHash('sha1').update(arr.join('|')).digest('hex').slice(0, 10);
}

app.get('/api/versions/:id/qc', async (req) => {
  const r = latestQC(req.params.id);
  if (!r) return { report: null };
  return { report: { ...r, stats: J(r.stats, {}), items: J(r.items, []), ignores: db.prepare('SELECT * FROM qc_ignores WHERE report_id=?').all(r.id) } };
});

app.get('/api/drafts/:id/qc', async (req) => {
  const rows = db.prepare('SELECT * FROM qc_reports WHERE draft_id=? ORDER BY created_at DESC').all(req.params.id);
  return rows.map((r) => ({ ...r, stats: J(r.stats, {}) }));
});

app.post('/api/qc/:id/ignore', async (req, reply) => {
  const r = db.prepare('SELECT * FROM qc_reports WHERE id=?').get(req.params.id);
  if (!r) return reply.code(404).send({ error: '报告不存在' });
  const { rule_id, reason, evidence } = req.body || {};
  if (!reason || !String(reason).trim()) return reply.code(400).send({ error: '忽略必须填写理由' });
  db.prepare('INSERT INTO qc_ignores(id,report_id,rule_id,reason,created_at) VALUES(?,?,?,?,?)').run(uid('ig'), r.id, rule_id || '', reason, now());
  const items = J(r.items, []);
  const filtered = items.filter((it) => !(it.rule === rule_id && (!evidence || it.evidence === evidence)));
  const { stats, conclusion } = recomputeConclusion(filtered);
  db.prepare('UPDATE qc_reports SET items=?, stats=?, conclusion=? WHERE id=?').run(JSON.stringify(filtered), JSON.stringify(stats), conclusion, r.id);
  return { conclusion, stats, removed: items.length - filtered.length };
});

app.post('/api/versions/:id/archive', async (req, reply) => {
  const v = db.prepare('SELECT * FROM versions WHERE id=?').get(req.params.id);
  if (!v) return reply.code(404).send({ error: '版本不存在' });
  const d = db.prepare('SELECT * FROM drafts WHERE id=?').get(v.draft_id);
  const t = getTopic(d.topic_id);
  const qc = latestQC(v.id);
  if (!qc) return reply.code(409).send({ error: '该版本尚未质检，不可归档' });
  if (qc.conclusion === 'block') return reply.code(409).send({ error: '质检存在阻断项，不可归档。请逐条处理或忽略并填理由。' });
  const settings = allSettings();
  const result = archiveVersion({ topic: t, draft: d, version: { ...v, parsed: J(v.parsed, {}) }, qc, settings, mode: req.body?.mode || 'abort' });
  if (result.status === 'need-dir') {
    if (!req.body?.createDir) return reply.code(409).send({ error: `Obsidian 目录不存在：${result.dir}`, status: 'need-dir', dir: result.dir });
    fs.mkdirSync(result.dir, { recursive: true });
    return { ...archiveVersion({ topic: t, draft: d, version: { ...v, parsed: J(v.parsed, {}) }, qc, settings, mode: req.body?.mode || 'abort' }), createdDir: result.dir };
  }
  if (result.status === 'conflict') return reply.code(409).send({ ...result, error: '本地文件已被手改，指纹不一致' });
  if (result.status === 'same') return { ...result, message: '已归档，内容一致' };
  log('archive', d.id, 'write', result.path);
  return result;
});

// ---------------- 排期 ----------------
app.get('/api/schedule', async (req) => {
  const start = req.query.start || today();
  const days = Number(req.query.days || 7);
  const base = new Date(`${start}T00:00:00`);
  const end = new Date(base.getTime() + (days - 1) * 86400000);
  const from = base.toISOString().slice(0, 10);
  const to = end.toISOString().slice(0, 10);
  const rows = db.prepare('SELECT * FROM schedule WHERE date BETWEEN ? AND ? ORDER BY date').all(from, to);
  const daysArr = [];
  for (let i = 0; i < days; i++) {
    const dstr = new Date(base.getTime() + i * 86400000).toISOString().slice(0, 10);
    const entries = rows.filter((r) => r.date === dstr).map((r) => {
      const t = getTopic(r.topic_id);
      const dr = db.prepare('SELECT * FROM drafts WHERE topic_id=? AND platform=?').get(r.topic_id, r.platform);
      return t ? {
        id: r.id, topic_id: r.topic_id, topic: t.name, platform: r.platform,
        status: dr ? deriveDraftStatus(dr, versionsOf(dr.id), outlineOf(r.topic_id), (versionsOf(dr.id)[0] ? latestQC(versionsOf(dr.id)[0].id) : null), archivedOf(dr.id)) : '未开始',
        overdue: dstr < today() && !archivedOf(dr?.id || ''),
      } : null;
    }).filter(Boolean);
    daysArr.push({ date: dstr, entries });
  }
  const all = db.prepare('SELECT * FROM topics').all().map(topicView);
  const unscheduled = all.filter((t) => t.status !== '已归档' && !t.schedule_date).map((t) => ({ topic_id: t.id, topic: t.name, status: t.status }));
  const conflicts = daysArr.flatMap((d) => {
    const by = {};
    d.entries.forEach((e) => { by[e.platform] = (by[e.platform] || 0) + 1; });
    return Object.entries(by).filter(([, n]) => n > 2).map(([p, n]) => ({ date: d.date, platform: p, count: n }));
  });
  return { from, to, days: daysArr, unscheduled, conflicts };
});

app.post('/api/schedule/move', async (req, reply) => {
  const { topic_id, platform, date } = req.body || {};
  if (!topic_id || !platform || !date) return reply.code(400).send({ error: '缺少参数' });
  db.prepare('INSERT OR REPLACE INTO schedule(id,topic_id,platform,date) VALUES(?,?,?,?)').run(uid('sc'), topic_id, platform, date);
  db.prepare('UPDATE topics SET schedule_date=?, updated_at=? WHERE id=?').run(date, now(), topic_id);
  return { ok: true };
});

app.post('/api/schedule/remove', async (req, reply) => {
  const { topic_id, platform } = req.body || {};
  if (!topic_id || !platform) return reply.code(400).send({ error: '缺少参数' });
  db.prepare('DELETE FROM schedule WHERE topic_id=? AND platform=?').run(topic_id, platform);
  return { ok: true };
});

// ---------------- 候选池 ----------------
app.get('/api/candidates', async (req) => {
  const { status = '' } = req.query || {};
  let rows = db.prepare('SELECT * FROM candidates ORDER BY created_at DESC').all();
  if (status) rows = rows.filter((r) => r.status === status);
  return rows;
});

app.post('/api/candidates', async (req, reply) => {
  const b = req.body || {};
  if (!b.title) return reply.code(400).send({ error: '候选标题必填' });
  if (!b.source_url) return reply.code(400).send({ error: '候选必须带来源链接，无来源不入库' });
  if (!b.retrieved_at) return reply.code(400).send({ error: '候选必须带检索日期' });
  const id = uid('cd');
  db.prepare('INSERT INTO candidates(id,title,source_url,source_name,retrieved_at,reason,status,origin,radar_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(id, b.title, b.source_url, b.source_name || '', b.retrieved_at, b.reason || '', 'pending', b.origin || 'manual', b.radar_ref || '', now());
  return { candidate: db.prepare('SELECT * FROM candidates WHERE id=?').get(id) };
});

app.post('/api/candidates/:id/adopt', async (req, reply) => {
  const c = db.prepare('SELECT * FROM candidates WHERE id=?').get(req.params.id);
  if (!c) return reply.code(404).send({ error: '候选不存在' });
  const id = uid('tp');
  const t = now();
  const name = (req.body?.name || c.title).slice(0, 60);
  db.prepare('INSERT INTO topics(id,name,source,angle,content_type,platforms,priority,status,tags,account,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, name, c.source_url, req.body?.angle || c.reason || '', req.body?.content_type || '', '["douyin","xhs","wechat"]', 2, '待整理', '', getSetting('account'), t, t);
  for (const p of ['douyin', 'xhs', 'wechat']) db.prepare('INSERT INTO drafts(id,topic_id,platform,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(uid('dr'), id, p, '未开始', t, t);
  db.prepare("UPDATE candidates SET status='adopted', topic_id=? WHERE id=?").run(id, c.id);
  return { topic: topicView(getTopic(id)) };
});

app.post('/api/candidates/:id/discard', async (req) => {
  db.prepare("UPDATE candidates SET status='discarded' WHERE id=?").run(req.params.id);
  return { ok: true };
});

app.post('/api/candidates/import', async () => {
  const settings = allSettings();
  const radar = importRadar(settings.radar_dir);
  if (!radar.ok) return { ok: false, error: radar.error, path: radar.path, added: 0, duplicate: 0 };
  let added = 0, duplicate = 0;
  for (const it of radar.items) {
    const existing = db.prepare('SELECT id FROM candidates WHERE title=? OR radar_ref=?').get(it.title, it.ref);
    if (existing) { duplicate++; continue; }
    db.prepare('INSERT INTO candidates(id,title,source_url,source_name,retrieved_at,reason,status,origin,radar_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(uid('cd'), it.title, it.url, '选题雷达', it.date || today(), it.reason, 'pending', 'radar', it.ref, now());
    added++;
  }
  return { ok: true, path: radar.path, files: radar.files, added, duplicate, total: radar.items.length };
});

// ---------------- 规则 / 模板 / 设置 ----------------
app.get('/api/rules', async () => db.prepare('SELECT * FROM rules ORDER BY gate, id').all().map((r) => ({ ...r, params: J(r.params, {}), enabled: !!r.enabled })));

app.patch('/api/rules/:id', async (req, reply) => {
  const r = db.prepare('SELECT * FROM rules WHERE id=?').get(req.params.id);
  if (!r) return reply.code(404).send({ error: '规则不存在' });
  const b = req.body || {};
  if (b.enabled === false) {
    const off = db.prepare('SELECT COUNT(*) c FROM rules WHERE enabled=0').get().c;
    if (off + 1 >= db.prepare('SELECT COUNT(*) c FROM rules').get().c) return reply.code(400).send({ error: '不允许关闭全部规则' });
  }
  if (b.enabled !== undefined) db.prepare('UPDATE rules SET enabled=?, updated_at=? WHERE id=?').run(b.enabled ? 1 : 0, now(), r.id);
  if (b.params !== undefined) db.prepare('UPDATE rules SET params=?, updated_at=? WHERE id=?').run(JSON.stringify(b.params), now(), r.id);
  if (b.level) db.prepare('UPDATE rules SET level=?, updated_at=? WHERE id=?').run(b.level, now(), r.id);
  db.prepare("UPDATE qc_reports SET stale=1 WHERE rules_fingerprint != ?").run(cryptoFingerprint(rulesMap()));
  log('rule', r.id, 'update', b);
  return { rule: { ...db.prepare('SELECT * FROM rules WHERE id=?').get(r.id), params: J(db.prepare('SELECT params FROM rules WHERE id=?').get(r.id).params, {}) } };
});

app.get('/api/prompts', async () => db.prepare('SELECT key,version_no,name,variables,active,created_at FROM prompts').all().map((p) => ({ ...p, variables: J(p.variables, []) })));

app.get('/api/prompts/:key', async (req, reply) => {
  const p = activePrompt(req.params.key);
  if (!p) return reply.code(404).send({ error: '模板不存在' });
  return { ...p, variables: J(p.variables, []), versions: promptVersions(req.params.key) };
});

app.put('/api/prompts/:key', async (req, reply) => {
  const cur = activePrompt(req.params.key);
  if (!cur) return reply.code(404).send({ error: '模板不存在' });
  const body = String(req.body?.body || '');
  if (!body.trim()) return reply.code(400).send({ error: '模板内容为空' });
  const required = J(cur.variables, []).filter((v) => varsIn(cur.body).includes(v));
  const missing = required.filter((v) => !body.includes(`{{${v}}}`));
  if (missing.length) return reply.code(400).send({ error: `缺少必要变量：${missing.join('、')}` });
  const vno = cur.version_no + 1;
  db.prepare('UPDATE prompts SET active=0 WHERE key=?').run(req.params.key);
  db.prepare('INSERT INTO prompts(key,version_no,name,body,variables,active,created_at) VALUES(?,?,?,?,?,1,?)')
    .run(req.params.key, vno, req.body?.name || cur.name, body, JSON.stringify(required), now());
  log('prompt', req.params.key, 'update', `v${vno}`);
  return { key: req.params.key, version_no: vno };
});

app.post('/api/prompts/:key/rollback', async (req, reply) => {
  const target = db.prepare('SELECT * FROM prompts WHERE key=? AND version_no=?').get(req.params.key, Number(req.body?.version_no));
  if (!target) return reply.code(404).send({ error: '历史版本不存在' });
  const cur = activePrompt(req.params.key);
  const vno = cur.version_no + 1;
  db.prepare('UPDATE prompts SET active=0 WHERE key=?').run(req.params.key);
  db.prepare('INSERT INTO prompts(key,version_no,name,body,variables,active,created_at) VALUES(?,?,?,?,?,1,?)')
    .run(req.params.key, vno, target.name, target.body, target.variables, now());
  return { key: req.params.key, version_no: vno, from: target.version_no };
});

app.get('/api/whitelist', async () => db.prepare('SELECT * FROM whitelist ORDER BY created_at DESC').all());

app.get('/api/settings', async () => allSettings());

app.post('/api/whitelist', async (req, reply) => {
  const { word, reason } = req.body || {};
  if (!word) return reply.code(400).send({ error: '缺少词' });
  db.prepare('INSERT OR IGNORE INTO whitelist(id,word,reason,created_at) VALUES(?,?,?,?)').run(uid('wl'), String(word).trim(), reason || '', now());
  log('whitelist', word, 'add', reason || '');
  return { words: db.prepare('SELECT * FROM whitelist').all() };
});

app.delete('/api/whitelist/:id', async (req) => {
  db.prepare('DELETE FROM whitelist WHERE id=?').run(req.params.id);
  return { words: db.prepare('SELECT * FROM whitelist').all() };
});

app.put('/api/settings', async (req, reply) => {
  const b = req.body || {};
  const s = allSettings();
  const next = { ...s, ...b };
  if (b.obsidian_subdir !== undefined || b.obsidian_vault !== undefined) {
    const dir = baseDir(next);
    const parent = next.obsidian_vault;
    if (!fs.existsSync(parent)) return reply.code(400).send({ error: `Obsidian 库路径不存在：${parent}` });
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
    } catch (e) {
      return reply.code(400).send({ error: `目录不可写：${dir}（${e.code}）` });
    }
  }
  if (b.wordlib_path) {
    const w = loadWordlib(b.wordlib_path);
    if (w.error) return reply.code(400).send({ error: w.error });
  }
  for (const [k, v] of Object.entries(b)) setSetting(k, v);
  log('settings', '', 'update', Object.keys(b).join(','));
  return { settings: allSettings() };
});

app.post('/api/settings/test', async (req) => {
  const s = allSettings();
  const dir = baseDir(s);
  const res = { obsidian_dir: dir, exists: fs.existsSync(dir), writable: false, wordlib: loadWordlib(s.wordlib_path), radar: s.radar_dir };
  try { fs.accessSync(fs.existsSync(dir) ? dir : s.obsidian_vault, fs.constants.W_OK); res.writable = true; } catch { res.writable = false; }
  res.radar_exists = fs.existsSync(s.radar_dir);
  return res;
});

app.post('/api/export', async () => {
  const dir = path.join(DATA_DIR, 'exports', `export-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`);
  fs.mkdirSync(dir, { recursive: true });
  const tables = ['topics', 'materials', 'snippets', 'outlines', 'drafts', 'versions', 'qc_reports', 'archives', 'schedule', 'candidates', 'rules', 'prompts'];
  const dump = {};
  for (const t of tables) dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
  fs.writeFileSync(path.join(dir, 'workbench.json'), JSON.stringify(dump, null, 2), 'utf8');
  const mdDir = path.join(dir, 'md');
  for (const topic of dump.topics) {
    const tdir = path.join(mdDir, topic.name.replace(/[\\/:*?"<>|]/g, '_'));
    fs.mkdirSync(tdir, { recursive: true });
    for (const d of dump.drafts.filter((x) => x.topic_id === topic.id)) {
      for (const v of dump.versions.filter((x) => x.draft_id === d.id)) {
        fs.writeFileSync(path.join(tdir, `${d.platform}-v${v.version_no}.md`), v.raw_text, 'utf8');
      }
    }
  }
  return { path: dir, tables: Object.keys(dump) };
});

app.post('/api/backup', async () => ({ path: backup() }));

app.get('/api/health', async () => ({ ok: true, today: today() }));

// ---------------- 静态资源 ----------------
const dist = path.join(ROOT, 'web', 'dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  await app.register(fastifyStatic, { root: dist, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url.startsWith('/api')) return reply.code(404).send({ error: '接口不存在' });
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async (req, reply) => reply.type('text/html').send(`<h2>前端尚未构建</h2><p>在项目目录执行 <code>npm run build</code> 后重启服务，或用 <code>npm run dev</code> 开发模式。</p>`));
}

const PORT = Number(process.env.PORT || 5178);
try {
  await app.listen({ host: '127.0.0.1', port: PORT });
  console.log(`内容工作台已启动：http://localhost:${PORT}`);
} catch (e) {
  console.error('启动失败：', e.message);
  process.exit(1);
}
