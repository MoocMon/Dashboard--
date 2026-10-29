import { db } from './db.js';

export function activePrompt(key) {
  return db.prepare('SELECT * FROM prompts WHERE key = ? AND active = 1 ORDER BY version_no DESC LIMIT 1').get(key);
}

export function promptVersions(key) {
  return db.prepare('SELECT version_no,name,created_at,active FROM prompts WHERE key = ? ORDER BY version_no DESC').all(key);
}

export function varsIn(body) {
  return [...new Set([...body.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1].trim()))];
}

const KIND_LABEL = { fact: '事实', opinion: '观点', inference: '推断', pending: '待核实' };

export function materialDigest(materials = []) {
  if (!materials.length) return '（资料区为空，禁止生成。请先补至少 1 条事实资料。）';
  const groups = { fact: [], opinion: [], inference: [], pending: [] };
  for (const m of materials) (groups[m.kind] || groups.pending).push(m);
  let out = '';
  let n = 1;
  for (const [kind, list] of Object.entries(groups)) {
    if (!list.length) continue;
    out += `### ${KIND_LABEL[kind]}（${list.length} 条）\n`;
    for (const m of list) {
      const src = m.source_url ? ` | 来源：${m.source_url}` : m.source_name ? ` | 来源：${m.source_name}` : '';
      out += `${n}. ${(m.content || '').replace(/\n+/g, ' ').slice(0, 400)}${src}\n`;
      n++;
    }
    out += '\n';
  }
  return out.trim();
}

export function platformSpec(platform, settings) {
  const cps = settings.chars_per_sec || 7;
  if (platform === 'douyin') {
    return [
      `- 语速基线 ${cps} 字/秒；3–5 分钟，纯口播 1260–2100 字（±10% 容差 1134–2310 字）。`,
      '- 前 3 秒必须命中「具体场景 / 反差冲突 / 强主张」至少两项；禁止「大家好 / 今天给大家分享」。',
      '- 单句 ≤40 字；含 ≥4 个「的」且 ≥38 字的句子必须拆。',
      '- 每段对应一个场次；段间空行；每场标景别、画面、字幕或配音、素材来源与状态。',
      '- 结尾用不同话术复述核心结论，并带评论召唤 + 关注或下期钩子（限自然流量）。',
      '- 禁书面连接词：此外 / 综上所述 / 值得注意的是 / 换言之 / 与此同时 / 因此 / 从而 / 首先…其次…最后。',
    ].join('\n');
  }
  if (platform === 'xhs') {
    return [
      '- 标题 12–20 字，含具体利益点、身份标签或数字。',
      '- 正文 300–800 字；前三行先给结论，禁止自我介绍或背景铺垫开头。',
      '- 分点 3–5 个（观点类 2–4 个），每点首句是判断句。',
      '- 单段 ≤3 行，段间空行。',
      '- 配图 3–9 张，每张一句说明；首图沿用固定风格，只给封面文案。',
      '- 话题标签 3–6 个，至少 2 个与正文直接相关。',
      '- 禁止外链、微信号、二维码、加V、私信领。',
    ].join('\n');
  }
  return [
    '- 标题 ≤24 字。',
    '- 正文 1500–3000 字，3–5 章，每章有小标题，小标题写成具体判断。',
    '- 开篇 200 字内提出核心问题或冲突。',
    '- 单段 ≤5 行，章节之间要有承接。',
    '- 结尾回扣开篇问题，禁「赶快关注 / 点击购买 / 扫码领取」。',
  ].join('\n');
}

const TYPE_SPEC = {
  教程: '教程：每一步写清动作、对象、结果；开头交代工具名、版本、是否付费、是否需账号；必须写限制或失败情况；效果结论要有可核对的结果。',
  测评: '测评：先定 ≥3 个对比维度并全文一致；参数、价格、版本号必须有事实来源；结尾给「谁适合 / 谁不适合」。',
  观点: '观点：只立一个主论点；每段论点至少一条资料支撑；必须回应反方；推测句标「我的判断」；数字要带来源与时间。',
};

export function buildPrompt(key, { topic, materials, outline, draft, settings, node = {} }) {
  const tpl = activePrompt(key);
  if (!tpl) throw new Error('模板不存在');
  const map = {
    选题: topic?.name || '',
    立意: topic?.angle || '',
    内容类型: topic?.content_type || '（未设置）',
    受众: node.audience || '关注 AI 工具与效率的普通职场人',
    账号: settings.account || 'AKA张猩猩',
    资料: materialDigest(materials),
    时长: '3–5 分钟（口播 1260–2100 字）',
    字数: platformSpec(draft?.platform || 'douyin', settings),
    平台规范: platformSpec(draft?.platform || 'douyin', settings),
    平台: { douyin: '抖音', xhs: '小红书', wechat: '公众号' }[draft?.platform] || '抖音',
    大纲: outline
      ? [
        `钩子：${outline.hook}`,
        `核心论点：${outline.thesis}`,
        `结构：${outline.structure}`,
        `待验证假设：${outline.assumptions}`,
        `发布文案：${outline.post_copy}`,
        `封面文案：${outline.cover_copy}`,
      ].join('\n')
      : '（还没有确认的大纲，请先定方向）',
    封面字数提示: '封面文案 ≤12 字，只给文案，不指定字体与配色',
    投流要求: draft?.ad ? '是：禁止关注 / 点赞 / 评论 / 转发 / 私信 / 双击 / 收藏等一切互动引导，改用价值型软钩子' : '否：按自然流量，结尾需评论召唤 + 关注或下期钩子',
    商单要求: draft?.sponsor ? '是：客户要求的互动引导须附【客户要求·风险已报批】' : '否',
    正文: node.body || '',
  };
  let body = tpl.body;
  const missing = [];
  for (const v of varsIn(body)) {
    if (map[v] === undefined) {
      missing.push(v);
      continue;
    }
    body = body.replaceAll(`{{${v}}}`, map[v]);
  }
  if (TYPE_SPEC[topic?.content_type]) {
    body += `\n\n## 内容类型要求（${topic.content_type}）\n${TYPE_SPEC[topic.content_type]}`;
  }
  return { prompt: body, template: { key: tpl.key, name: tpl.name, version_no: tpl.version_no }, missing };
}
