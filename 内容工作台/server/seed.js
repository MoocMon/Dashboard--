import { db, now, uid } from './db.js';

const RULES = [
  // ===== 闸① 结构 =====
  { id: 'X1', gate: 1, scope: 'all', ctype: 'all', name: '结构完整', level: 'block', params: {}, desc: '按平台约定解析章节/场次，缺章或空章' },
  { id: 'X5', gate: 1, scope: 'all', ctype: 'all', name: '标题一致', level: 'suggest', params: {}, desc: '标题关键词在正文中缺失' },
  { id: 'H1', gate: 1, scope: 'douyin', ctype: 'all', name: '前 3 秒钩子', level: 'block', params: { minHits: 2 }, desc: '首句命中「具体场景 / 反差冲突 / 强主张」至少两项；命中「大家好/今天分享」直接阻断' },
  { id: 'H2', gate: 1, scope: 'douyin', ctype: 'all', name: '字数与时长', level: 'block', params: { charsPerSec: 7, minSec: 180, maxSec: 300, tolerance: 0.1 }, desc: '纯口播字数 ÷ 7 = 秒数，须落在 180–300 秒' },
  { id: 'H3', gate: 1, scope: 'douyin', ctype: 'all', name: '单句长度', level: 'block', params: { maxChars: 40, deCount: 4, deChars: 38 }, desc: '>40 字，或含 ≥4 个「的」且 ≥38 字' },
  { id: 'H4', gate: 1, scope: 'douyin', ctype: 'all', name: '结尾复述', level: 'block', params: { overlap: 0.4 }, desc: '结尾段与核心论点的关键词重合度 ≥0.4 且句式不同' },
  { id: 'H5', gate: 1, scope: 'douyin', ctype: 'all', name: '场次覆盖', level: 'suggest', params: {}, desc: '每段口播有对应场次；场次表字段不空' },
  { id: 'R1', gate: 1, scope: 'xhs', ctype: 'all', name: '标题长度', level: 'suggest', params: { min: 12, max: 20 }, desc: '12–20 字' },
  { id: 'R2', gate: 1, scope: 'xhs', ctype: 'all', name: '标题利益点', level: 'suggest', params: {}, desc: '标题含具体利益点、身份标签或数字' },
  { id: 'R3', gate: 1, scope: 'xhs', ctype: 'all', name: '首屏结论', level: 'block', params: {}, desc: '前三行内出现结论句；自我介绍一下/背景铺垫开头 → 阻断' },
  { id: 'R4', gate: 1, scope: 'xhs', ctype: 'all', name: '分点数量', level: 'suggest', params: {}, desc: '教程 / 测评 3–5 个分点' },
  { id: 'R5', gate: 1, scope: 'xhs', ctype: 'all', name: '段落行数', level: 'suggest', params: { maxLines: 3 }, desc: '单段 ≤3 行，段间空行' },
  { id: 'R6', gate: 1, scope: 'xhs', ctype: 'all', name: '分点首句', level: 'info', params: {}, desc: '每点首句为判断句或结论句' },
  { id: 'R7', gate: 1, scope: 'xhs', ctype: 'all', name: '配图说明', level: 'suggest', params: { min: 3, max: 9 }, desc: '3–9 张，每张有且仅有一句说明' },
  { id: 'R8', gate: 1, scope: 'xhs', ctype: 'all', name: '标签相关性', level: 'info', params: { min: 3, max: 6 }, desc: '3–6 个；至少 2 个在正文出现相关词' },
  { id: 'R9', gate: 1, scope: 'xhs', ctype: 'all', name: '正文长度', level: 'info', params: { min: 300, max: 800 }, desc: '300–800 字' },
  { id: 'G1', gate: 1, scope: 'wechat', ctype: 'all', name: '开篇承诺', level: 'block', params: { chars: 200 }, desc: '200 字内提出核心问题或冲突；无问题句 → 阻断' },
  { id: 'G2', gate: 1, scope: 'wechat', ctype: 'all', name: '章节数量', level: 'suggest', params: { min: 3, max: 5 }, desc: '3–5 章，每章有小标题' },
  { id: 'G3', gate: 1, scope: 'wechat', ctype: 'all', name: '小标题具体性', level: 'suggest', params: {}, desc: '「一、二、三」「第一部分」式空标题 → 建议' },
  { id: 'G4', gate: 1, scope: 'wechat', ctype: 'all', name: '章节承接', level: 'info', params: {}, desc: '每章首句与上章有承接关系；硬切 → 提示' },
  { id: 'G5', gate: 1, scope: 'wechat', ctype: 'all', name: '段落行数', level: 'info', params: { maxLines: 5 }, desc: '单段 ≤5 行' },
  { id: 'G6', gate: 1, scope: 'wechat', ctype: 'all', name: '结尾回扣', level: 'suggest', params: {}, desc: '结尾回扣开篇问题；无回扣 → 建议' },
  { id: 'G8', gate: 1, scope: 'wechat', ctype: 'all', name: '正文长度', level: 'info', params: { min: 1500, max: 3000 }, desc: '1500–3000 字' },
  { id: 'T1', gate: 1, scope: 'all', ctype: '教程', name: '步骤可执行', level: 'suggest', params: {}, desc: '每步含具体动作、对象与结果；空动作 → 建议' },
  { id: 'T2', gate: 1, scope: 'all', ctype: '教程', name: '前置条件', level: 'suggest', params: {}, desc: '工具名、版本、是否付费、是否需账号，至少写明三项' },
  { id: 'T4', gate: 1, scope: 'all', ctype: '教程', name: '结果可验证', level: 'block', params: {}, desc: '「效果很好 / 提升明显」且无可核对的结果 → 阻断' },
  { id: 'T5', gate: 1, scope: 'all', ctype: '测评', name: '对比维度一致', level: 'suggest', params: {}, desc: '维度 ≥3 且全文一致' },
  { id: 'T6', gate: 1, scope: 'all', ctype: '测评', name: '参数与价格溯源', level: 'block', params: {}, desc: '参数、价格、版本号须对应资料区事实条目' },
  { id: 'T7', gate: 1, scope: 'all', ctype: '测评', name: '结论取舍', level: 'suggest', params: {}, desc: '结尾给出「谁适合 / 谁不适合」或明确推荐' },
  { id: 'T8', gate: 1, scope: 'all', ctype: '观点', name: '单一主论点', level: 'suggest', params: { max: 2 }, desc: '并列主论点 ≤2 条' },
  { id: 'T9', gate: 1, scope: 'all', ctype: '观点', name: '论点支撑', level: 'suggest', params: {}, desc: '每个论点至少 1 处资料条目支撑' },
  { id: 'T10', gate: 1, scope: 'all', ctype: '观点', name: '预设反驳', level: 'suggest', params: {}, desc: '未回应任何反方观点 → 建议' },
  { id: 'T11', gate: 1, scope: 'all', ctype: '观点', name: '来源与时间', level: 'block', params: {}, desc: '引用具体数字无来源与时间 → 阻断' },
  { id: 'T12', gate: 1, scope: 'all', ctype: '观点', name: '事实与推测', level: 'block', params: {}, desc: '推测须显式标注「我的判断」' },

  // ===== 闸② 去 AI 味 =====
  { id: 'S1', gate: 2, scope: 'all', ctype: 'all', name: '硬禁用词', level: 'block', params: { words: ['赋能', '重塑', '提升效率', '工作流', '闭环'] }, desc: '硬禁用词；引号内命中标为需人工判定' },
  { id: 'S2', gate: 2, scope: 'all', ctype: 'all', name: '模板化连接词', level: 'suggest', params: { words: ['此外', '综上所述', '值得注意的是', '换言之', '与此同时', '因此', '从而', '首先', '其次', '最后'], density: 0.45 }, desc: '连接词密度超阈值报错（每百字）' },
  { id: 'S3', gate: 2, scope: 'all', ctype: 'all', name: 'AI 句式', level: 'suggest', params: {}, desc: '「通过…从而…最终实现…」结构匹配' },
  { id: 'X4', gate: 2, scope: 'all', ctype: 'all', name: '重复表达', level: 'suggest', params: { similarity: 0.85 }, desc: '句级相似度 ≥0.85 的句子对' },

  // ===== 闸③ 转化与收尾 =====
  { id: 'C1', gate: 3, scope: 'douyin', ctype: 'all', name: '评论召唤', level: 'block', params: { words: ['评论区', '你觉得呢', '聊聊', '点名', '扣'] }, desc: '结尾含评论召唤' },
  { id: 'C2', gate: 3, scope: 'douyin', ctype: 'all', name: '关注或下期钩子', level: 'block', params: { words: ['关注', '下期'] }, desc: '结尾含关注/下期' },
  { id: 'C3', gate: 3, scope: 'douyin', ctype: 'all', name: '投流禁用语', level: 'block', params: { words: ['关注', '点赞', '评论', '转发', '私信', '双击', '收藏'] }, desc: '投流=是 时命中互动引导词' },
  { id: 'C4', gate: 3, scope: 'douyin', ctype: 'all', name: '商单标记', level: 'suggest', params: {}, desc: '商单=是 时，互动引导须附【客户要求·风险已报批】' },
  { id: 'T3', gate: 3, scope: 'all', ctype: 'all', name: '坑位与代价', level: 'info', params: {}, desc: '只讲好处、完全不提限制或失败情况 → 提示' },
  { id: 'T13', gate: 3, scope: 'all', ctype: '观点', name: '预测边界', level: 'suggest', params: {}, desc: '出现具体增长数字或时间承诺 → 建议' },
  { id: 'G7', gate: 3, scope: 'wechat', ctype: 'all', name: '硬广收尾', level: 'block', params: { words: ['赶快关注', '点击购买', '扫码领取', '立即下单'] }, desc: '硬广收尾类 → 阻断' },

  // ===== 闸④ 违禁词与红线 =====
  { id: 'V1', gate: 4, scope: 'all', ctype: 'all', name: '词库命中', level: 'block', params: { context: 25 }, desc: '本地词库子串匹配，命中=必审' },
  { id: 'V2', gate: 4, scope: 'all', ctype: 'all', name: '绝对化用语', level: 'block', params: {}, desc: '最/第一/国家级/唯一/100%/全网首发/最好用/第一选择' },
  { id: 'V3', gate: 4, scope: 'all', ctype: 'all', name: '导流', level: 'block', params: {}, desc: '微信号、二维码、手机号、加微信/私信领、点击下方链接' },
  { id: 'V4', gate: 4, scope: 'all', ctype: 'all', name: '类目红线', level: 'block', params: {}, desc: '医疗功效、金融收益承诺、K12 学科、拉踩竞品、AI 取代人' },
  { id: 'R10', gate: 4, scope: 'xhs', ctype: 'all', name: '导流与外链', level: 'block', params: {}, desc: 'URL、微信号、二维码、加V、私信领' },
  { id: 'R11', gate: 4, scope: 'xhs', ctype: 'all', name: '绝对化与功效', level: 'block', params: {}, desc: '最/第一/唯一/100%；治病、减肥、提升视力等功效承诺' },
  { id: 'X2', gate: 4, scope: 'all', ctype: 'all', name: '待核实未标注', level: 'block', params: {}, desc: '使用「待核实」资料却未标注' },
  { id: 'X3', gate: 4, scope: 'all', ctype: 'all', name: '真实性溯源', level: 'block', params: {}, desc: '「真实体验/截图/翻车/具体数据」在资料区找不到对应条目' },
];

const PROMPTS = [
  {
    key: 'douyin_outline',
    name: '抖音 · 大纲（生成）',
    variables: ['选题', '立意', '内容类型', '受众', '时长', '资料', '账号'],
    body: `你是「{{账号}}」的短视频编导助理。这次只做大纲，不写完整脚本。

## 选题信息
- 选题：{{选题}}
- 立意：{{立意}}
- 内容类型：{{内容类型}}
- 目标受众：{{受众}}
- 时长区间：{{时长}}（口播 7 字/秒，3–5 分钟，对应纯口播 1260–2100 字）

## 可用资料（只能用这些，不得虚构）
{{资料}}

## 任务
1. 钩子候选 3 个。第一句话就要让人停下来，每个候选标注命中了「具体场景 / 反差冲突 / 强主张」中的哪几项。
2. 核心论点一句话，必须能一句话说清，不允许并列三个以上论点。
3. 结构 4–6 段。每段写：这段干什么、大概多少秒、用哪条资料。段与段之间要有递进，不要平铺。
4. 待验证假设：哪些地方我没有资料支撑，需要我去核实。
5. 发布文案：≤40 字。
6. 封面文案：≤12 字。

## 禁止
- 不虚构真实体验、截图、翻车细节、具体数据。
- 不使用「赋能 / 重塑 / 提升效率 / 工作流 / 闭环」。
- 不使用「大家好 / 今天给大家分享」式开头。
- 不出现具体品牌价格，除非资料里有。

## 输出格式（严格遵守，便于我回填）
### 钩子候选
1. （文案）｜命中：具体场景+反差冲突
2. （文案）｜命中：…
3. （文案）｜命中：…
### 核心论点
（一句话）
### 结构
1. 段落：… / 约 XX 秒 / 资料：…
2. …
### 待验证假设
- …
### 发布文案
（≤40 字）
### 封面文案
（≤12 字）`,
  },
  {
    key: 'douyin_script',
    name: '抖音 · 分镜脚本（生成）',
    variables: ['选题', '立意', '内容类型', '受众', '时长', '资料', '大纲', '账号', '平台规范', '投流要求', '商单要求'],
    body: `你是「{{账号}}」的短视频编导助理。按已确认的大纲，写一条 3–5 分钟的纯口播视频分镜脚本。

## 选题信息
- 选题：{{选题}}
- 立意：{{立意}}
- 内容类型：{{内容类型}}
- 目标受众：{{受众}}
- 时长：{{时长}}

## 已确认的大纲
{{大纲}}

## 可用资料（只能用这些，不得虚构）
{{资料}}

## 平台规范
{{平台规范}}

## 投流与商单
- 投流：{{投流要求}}
- 商单：{{商单要求}}

## 输出格式（严格遵守，系统要靠这个结构解析）
## 分镜脚本
- 账号：{{账号}}
- 时长：X分X秒
- 产品：产品或主题一句话
- 封面文案：≤12 字
- 发布文案：≤40 字
- 投流：否
- 商单：否

## 场次表
| 场次 | 景别 | 时长(秒) | 画面描述 | 字幕/配音 | 花字 | 素材来源/状态 | 反馈 |
|---|---|---|---|---|---|---|---|
| 1 | 近景 | 6 |  |  |  | 原创实拍 / 待拍 |  |
| 2 |  |  |  |  |  |  |  |

## 纯口播稿
（这里只放最终要说出口的文字。段与段之间空一行。不要镜头号、不要时间戳、不要括号说明、不要「第一段」这类标注。每段对应场次表的一行。）

## 硬要求
- 开头 3 秒必须命中「具体场景 / 反差冲突 / 强主张」至少两项，禁止「大家好 / 今天给大家分享」。
- 单句 ≤40 字；一口气念不完就拆。
- 结尾用不同话术把核心结论再说一次。
- 结尾要有评论召唤 + 关注或下期钩子。
- 不用「赋能 / 重塑 / 提升效率 / 工作流 / 闭环」，不用「此外 / 综上所述 / 值得注意的是 / 换言之 / 与此同时 / 因此 / 从而 / 首先…其次…最后」。
- 不虚构真实体验、截图、翻车细节、具体数据；没有资料支撑的地方标注「⚠️ 真实性待补」。`,
  },
  {
    key: 'xhs_note',
    name: '小红书 · 图文笔记（生成）',
    variables: ['选题', '立意', '内容类型', '受众', '资料', '账号', '平台规范', '封面字数提示'],
    body: `你是「{{账号}}」的内容助理。写一篇小红书图文笔记，不是抖音口播稿的改写，要按小红书的阅读习惯重新组织。

## 选题信息
- 选题：{{选题}}
- 立意：{{立意}}
- 内容类型：{{内容类型}}
- 目标受众：{{受众}}

## 可用资料（只能用这些，不得虚构）
{{资料}}

## 平台规范
{{平台规范}}

## 输出格式（严格遵守，系统靠这个结构解析）
## 标题
（12–20 字，含具体利益点 / 身份标签 / 数字）

## 正文
（前三行先给结论。正文分 3–5 点，每点一行标题 + 一两句说明。单段不超过 3 行，段间空行。）

## 配图建议
1. 封面：{{封面字数提示}}
2. （第二张拍什么，一句话）
3. …

## 话题标签
#标签1 #标签2 #标签3

## 禁止
- 不出现外链、微信号、二维码、加V、私信领。
- 不出现「最 / 第一 / 唯一 / 100%」这类绝对化表达。
- 不虚构真实体验、截图、具体数据；没有资料支撑的标注「⚠️ 真实性待补」。`,
  },
  {
    key: 'wechat_article',
    name: '公众号 · 长文（生成）',
    variables: ['选题', '立意', '内容类型', '受众', '资料', '账号', '平台规范'],
    body: `你是「{{账号}}」的内容助理。写一篇公众号长文，要求有推进、有判断，不是要点罗列。

## 选题信息
- 选题：{{选题}}
- 立意：{{立意}}
- 内容类型：{{内容类型}}
- 目标受众：{{受众}}

## 可用资料（只能用这些，不得虚构）
{{资料}}

## 平台规范
{{平台规范}}

## 输出格式（严格遵守，系统靠这个结构解析）
## 标题
（≤24 字）

## 开篇
（200 字内提出核心问题或冲突，不要铺垫背景）

## 正文
### 小标题一（写成具体判断，不要「一、二、三」）
（内容）

### 小标题二
（内容）

### 小标题三
（内容）

## 结尾
（回扣开篇的问题，给出结论或延伸，不要硬广）

## 禁止
- 不出现「赶快关注 / 点击购买 / 扫码领取」。
- 章节之间要有承接，不要硬切。
- 不虚构真实体验、截图、具体数据；没有资料支撑的标注「⚠️ 真实性待补」。`,
  },
  {
    key: 'ai_review',
    name: 'AI 审阅（参考，不作判定）',
    variables: ['选题', '平台', '正文', '资料', '平台规范'],
    body: `下面是一篇准备发布的稿件。请你做审阅，不要改写全文。

- 选题：{{选题}}
- 平台：{{平台}}
- 平台规范：{{平台规范}}

## 资料区（判定真实性用）
{{资料}}

## 正文
{{正文}}

## 请你输出
1. 逻辑断点：哪两句之间接不上，指出原句。
2. 说服力薄弱处：哪个结论没有支撑。
3. 调性与「说人话」不符处：书面语、模板句，指出原句。
4. 你怀疑但无法判断的真实性问题。

每条都要附段落定位（第几段第几句）与原句片段。不要给改写稿。`,
  },
];

export function seed() {
  const t = now();
  const insRule = db.prepare(`INSERT OR IGNORE INTO rules(id,gate,scope,content_type,name,level,enabled,params,description,updated_at)
    VALUES(?,?,?,?,?,?,1,?,?,?)`);
  for (const r of RULES) insRule.run(r.id, r.gate, r.scope, r.ctype, r.name, r.level, JSON.stringify(r.params), r.desc, t);

  const hasPrompt = db.prepare('SELECT COUNT(*) c FROM prompts').get().c;
  if (!hasPrompt) {
    const insP = db.prepare('INSERT INTO prompts(key,version_no,name,body,variables,active,created_at) VALUES(?,1,?,?,?,1,?)');
    for (const p of PROMPTS) insP.run(p.key, p.name, p.body, JSON.stringify(p.variables), t);
  }
  return { rules: RULES.length, prompts: PROMPTS.length };
}
