import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, uid, now } from './db.js';
import { PLATFORM_LABEL, PLATFORM_FILE } from './parse.js';

const QC_LABEL = { pass: '通过', warn: '有建议', block: '有阻断' };

export function fingerprint(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

function readBody(text) {
  const m = text.match(/<!--\s*正文指纹:[\s\S]*?-->\n?/);
  return (m ? text.slice(m.index + m[0].length) : '').trim();
}

function readStoredFingerprint(text) {
  const m = text.match(/^指纹:\s*(\S+)\s*$/m);
  return m ? m[1] : '';
}

export function safeName(name) {
  return (name || '未命名').replace(/[\\/:*?"<>|#^[\]]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function baseDir(settings) {
  return path.join(settings.obsidian_vault, settings.obsidian_subdir);
}

export function buildMarkdown({ topic, draft, version, qc, settings, tags }) {
  const platform = PLATFORM_LABEL[draft.platform];
  const rawFp = fingerprint(String(version.raw_text || '').trim());
  const title = (version.parsed?.title || version.parsed?.meta?.product || topic.name || '').toString().trim() || topic.name;
  const duration = version.parsed?.meta?.duration || (draft.platform === 'douyin' ? '按稿子折算' : '—');
  const fm = [
    '---',
    `选题ID: ${topic.id}`,
    `选题: ${topic.name}`,
    `平台: ${platform}`,
    `账号: ${settings.account}`,
    `内容类型: ${topic.content_type || '未设置'}`,
    `状态: 已归档`,
    `版本: v${version.version_no}`,
    `时长: ${duration}`,
    `投流: ${draft.ad ? '是' : '否'}`,
    `商单: ${draft.sponsor ? '是' : '否'}`,
    `质检结论: ${QC_LABEL[qc?.conclusion] || '未质检'}`,
    `更新时间: ${now()}`,
    `标签: ${tags || topic.tags || ''}`,
    `指纹: ${rawFp}`,
    '---',
    '',
    `# ${platform}｜${title}`,
    '',
    `> 选题索引：[[${safeName(topic.name)}]] ・ 选题ID ${topic.id} ・ 该文件由「内容工作台」写入，应用为唯一真相源`,
    '',
    `<!-- 正文指纹: ${rawFp} -->`,
    '',
    version.raw_text,
    '',
  ].join('\n');
  return { markdown: fm, title, duration };
}

export function archiveVersion({ topic, draft, version, qc, settings, mode = 'overwrite' }) {
  const dir = baseDir(settings);
  if (!fs.existsSync(dir)) return { status: 'need-dir', dir };
  const sub = path.join(dir, '02-稿件', safeName(topic.name));
  fs.mkdirSync(sub, { recursive: true });
  const base = `${PLATFORM_FILE[draft.platform]}-v${version.version_no}`;
  let file = path.join(sub, `${base}.md`);
  const { markdown, duration } = buildMarkdown({ topic, draft, version, qc, settings });

  if (fs.existsSync(file) && mode !== 'new-file') {
    const old = fs.readFileSync(file, 'utf8');
    const appFp = fingerprint(String(version.raw_text || '').trim());
    const storedFp = readStoredFingerprint(old);
    const bodyFp = fingerprint(readBody(old));
    if (storedFp === appFp && bodyFp === appFp) return { status: 'same', path: file };
    if (mode !== 'overwrite') {
      return { status: 'conflict', path: file, localFingerprint: storedFp || bodyFp, appFingerprint: appFp };
    }
  }
  if (fs.existsSync(file) && mode === 'new-file') {
    let i = 2;
    while (fs.existsSync(path.join(sub, `${base}-${i}.md`))) i++;
    file = path.join(sub, `${base}-${i}.md`);
  }
  fs.writeFileSync(file, markdown, 'utf8');
  const fp = fingerprint(markdown);
  const exist = db.prepare('SELECT id FROM archives WHERE draft_id = ? AND version_id = ?').get(draft.id, version.id);
  if (exist) db.prepare('UPDATE archives SET path=?, fingerprint=?, created_at=? WHERE id=?').run(file, fp, now(), exist.id);
  else db.prepare('INSERT INTO archives(id,topic_id,draft_id,version_id,path,fingerprint,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(uid('arc'), topic.id, draft.id, version.id, file, fp, now());

  ensureIndex(topic, settings);
  ensureSchedule(topic, settings);
  return { status: 'written', path: file, fingerprint: fp, duration };
}

function ensureIndex(topic, settings) {
  const dir = path.join(baseDir(settings), '00-索引');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '选题索引.md');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, '# 选题索引\n\n由「内容工作台」自动维护。\n\n| 选题 | 类型 | 平台 | 排期 | 选题ID |\n|---|---|---|---|---|\n', 'utf8');
  }
  const line = `| [[${safeName(topic.name)}]] | ${topic.content_type || '—'} | ${(JSON.parse(topic.platforms || '[]') || []).map((p) => PLATFORM_LABEL[p]).join(' / ')} | ${topic.schedule_date || '待排期'} | ${topic.id} |`;
  const cur = fs.readFileSync(file, 'utf8');
  if (!cur.includes(topic.id)) fs.appendFileSync(file, line + '\n', 'utf8');
}

function isoWeek(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - y0) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function ensureSchedule(topic, settings) {
  const dir = path.join(baseDir(settings), '03-排期');
  fs.mkdirSync(dir, { recursive: true });
  const wk = isoWeek(topic.schedule_date);
  const file = path.join(dir, `${wk}.md`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${wk} 排期\n\n| 日期 | 选题 | 平台 | 状态 |\n|---|---|---|---|\n`, 'utf8');
  const cur = fs.readFileSync(file, 'utf8');
  if (!cur.includes(topic.id)) {
    const platforms = JSON.parse(topic.platforms || '[]');
    const rows = platforms.map((p) => `| ${topic.schedule_date || '待排期'} | ${topic.name}（${topic.id}） | ${PLATFORM_LABEL[p]} | 已归档 |`).join('\n');
    fs.appendFileSync(file, rows + '\n', 'utf8');
  }
}
