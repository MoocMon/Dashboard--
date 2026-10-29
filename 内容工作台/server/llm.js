// LLM 调用模块 —— OpenAI 兼容协议
// 豆包（火山方舟）/ DeepSeek / 通义 / Kimi / Claude 代理 通用
import { getSetting, allSettings } from './db.js';

const TIMEOUT_MS = 240_000;  // 4 分钟，豆包 Flash 等思考模型写长文需要（修复模式更长）

// 预置提供商默认值
const PRESETS = {
  ark: {
    label: '火山方舟（代理任意模型）',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',  // 留空，等用户在方舟控制台创建接入点后填入 endpoint ID（ep-xxx）
    hint: '方舟控制台「推理接入点」创建后复制 endpoint ID（格式 ep-202...xxxx）填到模型名',
  },
  doubao: {
    label: '豆包（火山方舟）',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-pro-32k',  // 免费版可用 lite-4k；pro-32k 有免费额度
    hint: '去 console.volcengine.com/ark 拿 API Key，模型名从方舟控制台复制',
  },
  deepseek: {
    label: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    hint: 'platform.deepseek.com 注册送免费额度',
  },
  kimi: {
    label: 'Kimi（Moonshot）',
    base_url: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    hint: 'platform.moonshot.cn 注册送 7 元券',
  },
  qwen: {
    label: '通义（阿里云百炼）',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    hint: 'dashscope.console.aliyun.com 开通后用 Compatibility 模式',
  },
  custom: {
    label: '自定义（任意 OpenAI 兼容）',
    base_url: '',
    model: '',
    hint: '自己填 base_url 和 model',
  },
};

export function getPresets() {
  return PRESETS;
}

export function llmConfig() {
  const s = allSettings();
  const provider = s.llm_provider || 'doubao';
  const preset = PRESETS[provider] || PRESETS.custom;
  return {
    enabled: s.llm_enabled === '1',
    provider,
    apiKey: s.llm_api_key || '',
    baseUrl: s.llm_base_url || preset.base_url,
    model: s.llm_model || preset.model,
    preset,
  };
}

export function llmStatus() {
  const c = llmConfig();
  return {
    enabled: c.enabled && !!c.apiKey,
    provider: c.provider,
    providerLabel: c.preset.label,
    model: c.model,
    hasKey: !!c.apiKey,
    baseUrl: c.baseUrl,
  };
}

// 调 LLM，返回纯文本
export async function callLLM({ system = '你是一位专业的内容创作者。', user, max_tokens, temperature = 0.7 }) {
  const c = llmConfig();
  if (!c.enabled) throw new Error('LLM 未启用，请到设置页开启并填入 API Key');
  if (!c.apiKey) throw new Error('API Key 未填写');
  if (!c.baseUrl) throw new Error('API Base URL 未填写');
  if (!c.model) throw new Error('模型名未填写');

  const url = c.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: c.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    stream: false,
  };
  // 只在明确传了才加 max_tokens，避免豆包 flash 等有思考模式的模型被截断 content
  if (max_tokens && max_tokens > 0) body.max_tokens = max_tokens;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`请求超时（${Math.round(TIMEOUT_MS / 1000)} 秒），可试试换更短的模板或换更快的模型`);
    throw new Error(`网络错误：${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  let data;
  try { data = await resp.json(); } catch { throw new Error(`响应不是 JSON，HTTP ${resp.status}`); }

  if (!resp.ok) {
    const msg = data?.error?.message || data?.message || JSON.stringify(data).slice(0, 200);
    throw new Error(`API 错误 ${resp.status}：${msg}`);
  }

  let text = data?.choices?.[0]?.message?.content;
  // 兜底：有些模型返回 content 为数组（多模态格式）
  if (Array.isArray(text)) {
    text = text.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  if (!text) {
    const reason = data?.choices?.[0]?.finish_reason;
    throw new Error(`API 返回为空（finish_reason=${reason || 'unknown'}），可能是思考模型被截断或配额不足`);
  }
  return text.trim();
}

// 连通性测试（用一条极短的 prompt，只看能不能拿到回复）
export async function testLLM() {
  try {
    const text = await callLLM({
      system: '你只回答「连接成功」四个字，不要多。',
      user: '说吧',
      temperature: 0,
    });
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 把质检给的证据定位成原文里的真实片段（容忍空白差异、多段拼接）
function locateInText(rawText, evidence) {
  const ev = String(evidence || '').trim();
  if (ev.length < 4) return '';
  if (rawText.includes(ev)) return ev;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const flexible = (s) => new RegExp(esc(s).replace(/\\?\s+/g, '\\s*'));
  const m = rawText.match(flexible(ev));
  if (m) return m[0];
  // 证据常是前两段用 \n 拼起来的，原文段落间可能还有空行 → 退回第一段
  const firstLine = ev.split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
  if (firstLine.length < 4) return '';
  if (rawText.includes(firstLine)) return firstLine;
  const m2 = rawText.match(flexible(firstLine));
  return m2 ? m2[0] : '';
}

// 定向修复：只让 AI 重写质检指出的问题句，返回替换后的全文
export async function repairTargeted({ platform, rawText, qcItems }) {
  // 同一个片段可能被多条规则点名（如 C1+C2 都指向结尾），合并成一次改写
  const targets = [];
  for (const it of qcItems) {
    if (it.level === 'info') continue;
    const snippet = locateInText(rawText, it.evidence);
    if (snippet.length < 4) continue;
    const exist = targets.find((x) => x.snippet === snippet);
    if (exist) { exist.items.push(it); continue; }
    targets.push({ snippet, items: [it] });
    if (targets.length >= 6) break;
  }
  if (!targets.length) return { text: rawText, patches: 0 };

  const ruleHint = (rule) => {
    if (rule === 'H1') return '必须重写成一句 ≤40 字的话，同时命中至少两项：具体场景（含"在/当/打开/下班/工位/电脑前"等场景词）、反差冲突（含"但是/却/结果/没想到/不是…而是"或问号）、强主张（含"别/不要/必须/真正/才是/根本"）；禁止"大家好/今天分享"式开头。';
    if (rule === 'H3') return '拆成两句话，每句 ≤40 字，保留原意，不要新增事实。';
    if (rule === 'H2') return '在保持原意的前提下调整长度，使其落在目标字数区间。';
    if (/^C\d$/.test(rule)) return '改写结尾，必须包含评论召唤 + 关注或下期钩子，不要照抄原句。';
    if (rule === 'V1') return '删除或换掉敏感表达，保持原意；不得用拼音、谐音、空格等方式规避。';
    return '按建议改写，不改动事实与数据。';
  };

  const list = targets.map((t, i) => {
    const title = t.items.map((it) => `${it.rule || ''} ${it.title || ''}`.trim()).join('；');
    const sug = t.items.map((it) => it.suggestion).filter(Boolean).join('；');
    const hints = [...new Set(t.items.map((it) => ruleHint(it.rule)))].join(' 另外：');
    return [
      `${i + 1}. 问题：${title}`,
      `   原文片段：${t.snippet}`,
      sug ? `   质检建议：${sug}` : '',
      `   改写要求：${hints}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const user = [
    '下面是一篇内容里被质检判定有问题的句子。请只重写这些句子，其余内容一个字都不要动。',
    '',
    '## 待修句子',
    list,
    '',
    '## 上下文（仅供理解，不要整体重写，不要输出）',
    rawText.slice(0, 3000),
    '',
    '## 输出格式',
    '只输出一个 JSON 数组，不要任何解释、不要代码块标记：',
    '[{"i":1,"replace":"<第 1 条改写后的句子>"}]',
    'i 是上面待修句子的编号；replace 只写替换后的这一句，不要带上下文、不要重复原文。',
  ].join('\n');

  const out = await callLLM({
    system: '你是严谨的文字编辑。只输出 JSON 数组，不要任何解释。',
    user,
    temperature: 0.3,
  });

  const patches = parsePatches(out);
  let text = rawText;
  let applied = 0;
  for (const p of patches) {
    const replace = String(p.replace || '').trim();
    if (!replace) continue;
    let snippet = '';
    const idxNo = Number(p.i);
    if (Number.isInteger(idxNo) && idxNo >= 1 && idxNo <= targets.length) snippet = targets[idxNo - 1].snippet;
    if (!snippet && p.find) snippet = locateInText(text, p.find) || String(p.find).trim();
    if (!snippet || snippet.length < 4 || replace === snippet) continue;
    const at = text.lastIndexOf(snippet);
    if (at < 0) continue;
    text = text.slice(0, at) + replace + text.slice(at + snippet.length);
    applied += 1;
  }
  return { text, patches: applied };
}

function parsePatches(out) {
  const s = String(out || '').replace(/```json|```/g, '').trim();
  const tryParse = (str) => { try { const v = JSON.parse(str); return Array.isArray(v) ? v : null; } catch { return null; } };
  const direct = tryParse(s);
  if (direct) return direct;
  const a = s.indexOf('[');
  const b = s.lastIndexOf(']');
  if (a >= 0 && b > a) return tryParse(s.slice(a, b + 1)) || [];
  return [];
}

// 构建修复 Prompt + 调 LLM 修
export async function repairVersion({ platform, rawText, qcItems, settings }) {
  const blocks = qcItems.filter((it) => it.level === 'block');
  const suggests = qcItems.filter((it) => it.level === 'suggest');
  if (!blocks.length && !suggests.length) {
    throw new Error('没有需要修复的阻断或建议项');
  }

  // 紧凑格式，让 AI 快速扫清单逐条处理，避免思考模式浪费 token
  const formatItem = (it, i) => {
    const ev = it.evidence ? String(it.evidence).slice(0, 80) : '';
    const sug = it.suggestion ? it.suggestion.slice(0, 80) : '';
    return `${i + 1}. 【${it.level === 'block' ? 'BLOCK' : 'SUGG'}】${it.rule || ''} ${it.title || ''}${ev ? ' · 证据:' + ev : ''}${sug ? ' · 建议:' + sug : ''}`;
  };

  let platformHint = '';
  if (platform === 'douyin') platformHint = '抖音口播脚本，格式必须保留 ## 分镜脚本 / ## 场次表 / ## 纯口播稿 三个顶层章节；时长 3–5 分钟。';
  else if (platform === 'xhs') platformHint = '小红书笔记，格式必须保留 ## 标题 / ## 正文 / ## 配图建议 / ## 话题标签；正文 300–800 字。';
  else if (platform === 'wechat') platformHint = '公众号长文，格式必须保留 ## 标题 / ## 开篇 / ## 正文 / ## 结尾；1500–3000 字，## 正文下的 ### 小标题不能丢。';

  const qcBlockText = blocks.length ? `【阻断项（必须全部修）】\n${blocks.map(formatItem).join('\n')}\n` : '';
  const qcSuggText = suggests.length ? `【建议项（尽量修）】\n${suggests.map(formatItem).join('\n')}\n` : '';

  const user = [
    `你是「AKA张猩猩」的内容助理。下面是一条${platformHint.split('，')[0]}经过四闸质检发现问题，请逐条对照修改，输出修复后的完整全文。`,
    '',
    `## 质检问题（${blocks.length} 阻断 + ${suggests.length} 建议）`,
    qcBlockText + qcSuggText,
    '',
    `## 原文（${rawText.length} 字）`,
    rawText,
    '',
    `## 输出要求`,
    '- 输出完整全文，不要 diff、不要修改说明、不要道歉、不要前后缀。',
    '- 严格保留 ## / ### 章节标题结构，不要删顶层章节。',
    '- 所有 BLOCK 必须解决；解决不了就删掉相关内容。',
    suggests.length ? '- SUGG 尽量处理，处理不动可以保留原样。' : '',
  ].join('\n');

  return callLLM({
    system: '你是严谨的内容修改助理。只输出修复后的完整正文，不要任何解释。严格保留原文档的 ## / ### 章节结构。',
    user,
    temperature: 0.3,  // 修复要保守，别乱改
  });
}
