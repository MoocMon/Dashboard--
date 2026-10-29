import { cleanChars, splitParagraphs } from './text.js';

const norm = (s) => s.replace(/\s/g, '').replace(/[：:]/g, '');

function scan(raw) {
  const lines = raw.split('\n');
  const heads = [];
  lines.forEach((line, i) => {
    const m = line.match(/^(#{1,6})\s*(.+?)\s*$/);
    if (m) heads.push({ i, level: m[1].length, title: m[2].trim() });
  });
  return { lines, heads };
}

function block(lines, head, allHeads) {
  const pos = allHeads.findIndex((h) => h.i === head.i);
  const next = allHeads[pos + 1];
  const from = head.i + 1;
  const to = next ? next.i : lines.length;
  return lines.slice(from, to).join('\n').trim();
}

function findHead(heads, patterns, maxLevel = 6) {
  return heads.find((h) => h.level <= maxLevel && patterns.some((p) => p.test(h.title)));
}

function parseTable(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t.startsWith('|')) continue;
    if (/^\|[\s:\-|]+\|?$/.test(t)) continue;
    const cells = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (!cells.length) continue;
    if (norm(cells[0]) === '场次' || norm(cells[0]) === '序号') continue;
    rows.push(cells);
  }
  return rows;
}

function parseMeta(text) {
  const meta = {};
  const map = {
    账号: 'account',
    时长: 'duration',
    产品: 'product',
    封面文案: 'cover',
    发布文案: 'post',
    投流: 'ad',
    商单: 'sponsor',
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*[-*]?\s*([^：:]{2,8})[：:]\s*(.+)$/);
    if (!m) continue;
    const key = map[norm(m[1])];
    if (key) meta[key] = m[2].trim();
  }
  return meta;
}

function parseList(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^(\d+[.、)]|[-*•])\s*/.test(l))
    .map((l) => l.replace(/^(\d+[.、)]|[-*•])\s*/, '').trim())
    .filter(Boolean);
}

function sectionBody(raw, patterns) {
  const { lines, heads } = scan(raw);
  const head = findHead(heads, patterns);
  if (!head) return null;
  return block(lines, head, heads);
}

export function parseDouyin(raw) {
  const { lines, heads } = scan(raw);
  const metaHead = findHead(heads, [/分镜|脚本信息|基础信息|元数据|口播脚本/]);
  const sceneHead = findHead(heads, [/场次表|分镜表|镜头表/]);
  const scriptHead = findHead(heads, [/纯口播|口播稿|口播/]);
  const problems = [];
  const recognized = [];

  if (metaHead) recognized.push('分镜脚本');
  else problems.push({ code: 'meta', message: '未识别到「## 分镜脚本」元数据段（账号 / 时长 / 封面文案 / 发布文案）' });
  if (sceneHead) recognized.push('场次表');
  else problems.push({ code: 'scenes', message: '未识别到「## 场次表」' });
  if (scriptHead) recognized.push('纯口播稿');
  else problems.push({ code: 'script', message: '未识别到「## 纯口播稿」' });

  const meta = metaHead ? parseMeta(block(lines, metaHead, heads)) : {};
  const scenes = sceneHead ? parseTable(block(lines, sceneHead, heads)) : [];
  let scriptRaw = scriptHead ? block(lines, scriptHead, heads) : '';
  if (!scriptHead) scriptRaw = '';

  const scriptParas = splitParagraphs(scriptRaw).map((p) => p.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  const chars = cleanChars(scriptParas.join(''));

  if (sceneHead && scenes.length === 0) problems.push({ code: 'scenes', message: '场次表为空' });
  if (scriptHead && scriptParas.length === 0) problems.push({ code: 'script', message: '纯口播稿为空' });

  return {
    parsed: {
      meta,
      scenes: scenes.map((c) => ({
        index: c[0] || '',
        shot: c[1] || '',
        duration: c[2] || '',
        picture: c[3] || '',
        audio: c[4] || '',
        title: c[5] || '',
        asset: c[6] || '',
        feedback: c[7] || '',
      })),
      script: scriptParas,
      scriptText: scriptParas.join('\n\n'),
      chars,
    },
    structure: { ok: problems.length === 0, problems, recognized },
  };
}

export function parseXhs(raw) {
  const { lines, heads } = scan(raw);
  const titleHead = findHead(heads, [/^标题$|标题/]);
  const bodyHead = findHead(heads, [/^正文$|正文/]);
  const imgHead = findHead(heads, [/配图|图片/]);
  const tagHead = findHead(heads, [/话题|标签/]);
  const problems = [];
  const recognized = [];

  if (titleHead) recognized.push('标题');
  else problems.push({ code: 'title', message: '未识别到「## 标题」' });
  if (bodyHead) recognized.push('正文');
  else problems.push({ code: 'body', message: '未识别到「## 正文」' });
  if (imgHead) recognized.push('配图建议');
  else problems.push({ code: 'images', message: '未识别到「## 配图建议」' });
  if (tagHead) recognized.push('话题标签');
  else problems.push({ code: 'tags', message: '未识别到「## 话题标签」' });

  const firstLine = (text) => (text || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  const title = titleHead ? firstLine(block(lines, titleHead, heads)).replace(/^#+\s*/, '') : '';
  const body = bodyHead ? block(lines, bodyHead, heads) : '';
  const images = imgHead ? parseList(block(lines, imgHead, heads)) : [];
  const tagsRaw = tagHead ? block(lines, tagHead, heads) : '';
  const tags = [...tagsRaw.matchAll(/#([^\s#]+)/g)].map((m) => m[1].trim()).filter(Boolean);

  if (titleHead && !title) problems.push({ code: 'title', message: '标题为空' });
  if (bodyHead && cleanChars(body) === 0) problems.push({ code: 'body', message: '正文为空' });

  return {
    parsed: { title, body, images, tags, chars: cleanChars(body) },
    structure: { ok: problems.length === 0, problems, recognized },
  };
}

export function parseWechat(raw) {
  const { lines, heads } = scan(raw);
  const top = heads.filter((h) => h.level <= 2);
  const titleHead = top.find((h) => /标题/.test(h.title));
  const openHead = top.find((h) => /开篇|导语/.test(h.title));
  const bodyHead = top.find((h) => /正文/.test(h.title));
  const endHead = top.find((h) => /结尾|结语/.test(h.title));
  const problems = [];
  const recognized = [];

  if (titleHead) recognized.push('标题');
  else problems.push({ code: 'title', message: '未识别到「## 标题」' });
  if (openHead) recognized.push('开篇');
  else problems.push({ code: 'opening', message: '未识别到「## 开篇」' });
  if (bodyHead) recognized.push('正文');
  else problems.push({ code: 'body', message: '未识别到「## 正文」' });
  if (endHead) recognized.push('结尾');
  else problems.push({ code: 'ending', message: '未识别到「## 结尾」' });

  const firstLine = (text) => (text || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  const title = titleHead ? firstLine(block(lines, titleHead, heads)) : '';
  const opening = openHead ? block(lines, openHead, heads) : '';
  const ending = endHead ? block(lines, endHead, heads) : '';

  let chapters = [];
  if (bodyHead) {
    const pos = heads.findIndex((h) => h.i === bodyHead.i);
    const nextTop = heads.slice(pos + 1).find((h) => h.level <= 2);
    const start = bodyHead.i + 1;
    const end = nextTop ? nextTop.i : lines.length;
    const bodyLines = lines.slice(start, end);
    let cur = { title: '', lines: [] };
    for (const line of bodyLines) {
      const m = line.match(/^#{3,6}\s*(.+?)\s*$/);
      if (m) {
        if (cur.lines.length || cur.title) chapters.push(cur);
        cur = { title: m[1].trim(), lines: [] };
      } else if (line.trim()) {
        cur.lines.push(line);
      }
    }
    if (cur.lines.length || cur.title) chapters.push(cur);
    chapters = chapters.filter((c) => c.title).map((c) => ({ title: c.title, content: c.lines.join('\n').trim() }));
  }

  const bodyText = chapters.map((c) => c.content).join('\n');
  const chars = cleanChars([opening, bodyText, ending].join(''));

  if (titleHead && !title) problems.push({ code: 'title', message: '标题为空' });
  if (openHead && cleanChars(opening) === 0) problems.push({ code: 'opening', message: '开篇为空' });
  if (bodyHead && chapters.length === 0) problems.push({ code: 'chapters', message: '正文下没有任何「### 小标题 + 内容」，未识别到章节' });
  if (endHead && cleanChars(ending) === 0) problems.push({ code: 'ending', message: '结尾为空' });

  return {
    parsed: { title, opening, chapters, ending, body: bodyText, chars },
    structure: { ok: problems.length === 0, problems, recognized },
  };
}

export function parseByPlatform(platform, raw) {
  if (platform === 'douyin') return parseDouyin(raw);
  if (platform === 'xhs') return parseXhs(raw);
  if (platform === 'wechat') return parseWechat(raw);
  return { parsed: {}, structure: { ok: false, problems: [{ code: 'platform', message: '未知平台' }], recognized: [] } };
}

export const PLATFORM_LABEL = { douyin: '抖音', xhs: '小红书', wechat: '公众号' };
export const PLATFORM_FILE = { douyin: '抖音-分镜', xhs: '小红书-图文', wechat: '公众号-长文' };
export { sectionBody };
