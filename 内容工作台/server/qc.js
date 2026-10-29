import fs from 'node:fs';
import { cleanChars, splitParagraphs, splitSentences, overlapRatio, similarity, countMatches, contextOf, inQuotes } from './text.js';
import { parseByPlatform, PLATFORM_LABEL } from './parse.js';

const GATE_NAMES = { 1: '① 结构', 2: '② 去 AI 味', 3: '③ 转化与收尾', 4: '④ 违禁词与红线' };

export function loadRules(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.id, { ...r, params: safeJson(r.params, {}) });
  return map;
}

function safeJson(v, fb) {
  try { return JSON.parse(v); } catch { return fb; }
}

export function loadWordlib(file) {
  try {
    const st = fs.statSync(file);
    const raw = fs.readFileSync(file, 'utf8');
    const words = raw.split(/\r?\n/).map((w) => w.trim()).filter((w) => w.length >= 2);
    return { words, count: words.length, mtime: st.mtime.toISOString(), error: null };
  } catch (e) {
    return { words: [], count: 0, mtime: null, error: `词库文件不可用：${e.code === 'ENOENT' ? '文件不存在' : e.message}` };
  }
}

export function runQC(opts) {
  const { platform, contentType, topic, materials = [], rules, whitelist = [], wordlib, settings } = opts;
  const raw = opts.raw || '';
  const { parsed, structure } = parseByPlatform(platform, raw);
  const items = [];
  const disabled = [];

  const R = (id) => rules.get(id);
  const on = (id) => {
    const r = R(id);
    if (!r) return false;
    if (!r.enabled) { disabled.push(id); return false; }
    return true;
  };
  const add = (id, o) => {
    const rule = R(id);
    if (!rule) return;
    items.push({
      rule: id,
      gate: rule.gate,
      gateName: GATE_NAMES[rule.gate],
      level: o.level || rule.level,
      name: rule.name,
      title: o.title || rule.name,
      location: o.location || '',
      evidence: o.evidence || '',
      suggestion: o.suggestion || '',
      needsReview: !!o.needsReview,
      auto: true,
    });
  };
  const gate1 = () => ruleIdsByGate(rules, 1).filter((id) => on(id) && scopeOk(id, platform, contentType));

  // ---------- 闸① 结构 ----------
  for (const p of structure.problems) {
    add('X1', {
      title: `结构缺失：${p.message.replace(/^未识别到/, '')}`,
      location: '整体',
      evidence: `已识别：${structure.recognized.join(' / ') || '无'}`,
      suggestion: '按 Prompt 输出格式补齐章节标题后再质检；结构不通过时不执行后三闸。',
    });
  }
  if (structure.problems.length > 0 || cleanChars(raw) === 0) {
    return finish({ items, structure, parsed, platform, contentType, disabled, wordlib, note: cleanChars(raw) === 0 ? '正文为空，未执行任何闸门' : '结构未通过，未执行后三闸' });
  }

  const d = platform === 'douyin';
  const x = platform === 'xhs';
  const w = platform === 'wechat';
  const fullText = d
    ? parsed.scriptText
    : x
      ? [parsed.title, parsed.body, (parsed.tags || []).map((t) => `#${t}`).join(' ')].join('\n')
      : [parsed.title, parsed.opening, parsed.chapters.map((c) => `${c.title}\n${c.content}`).join('\n'), parsed.ending].join('\n');
  const paras = d ? parsed.script : x ? splitParagraphs(parsed.body) : splitParagraphs([parsed.opening, ...parsed.chapters.map((c) => c.content), parsed.ending].join('\n\n'));
  const sents = splitSentences(fullText);
  const thesis = (opts.outline && opts.outline.thesis) || topic?.angle || '';

  if (d) {
    // H1 钩子
    const first = sents[0] || '';
    const banned = /^(大家好|哈喽|hello|嗨|今天(给)?大家?分享|今天分享|今天聊|今天我们来聊)/i.test(first.trim());
    const hits = hookHits(first);
    if (banned) {
      add('H1', {
        title: '开头是套话，前 3 秒留不住人',
        location: '第 1 段第 1 句',
        evidence: first,
        suggestion: '换成具体场景（我正在做什么）+ 反差或强主张的一句话。',
      });
    } else if (hits.length < (R('H1').params.minHits || 2)) {
      add('H1', {
        title: `钩子只命中 ${hits.length} 项：${hits.join('、') || '无'}`,
        location: '第 1 段第 1 句',
        evidence: first,
        suggestion: '至少同时命中两项：具体场景 / 反差冲突 / 强主张。把「今天分享」换成「我昨天在 X 遇到 Y，结果 Z」。',
      });
    }

    // H2 字数与时长
    const p = R('H2').params;
    const cps = Number(p.charsPerSec || settings.chars_per_sec || 7);
    const minChars = Math.round((p.minSec || 180) * cps * (1 - (p.tolerance ?? 0.1)));
    const maxChars = Math.round((p.maxSec || 300) * cps * (1 + (p.tolerance ?? 0.1)));
    const chars = parsed.chars;
    const seconds = chars / cps;
    if (chars < minChars || chars > maxChars) {
      add('H2', {
        title: `口播 ${chars} 字 ≈ ${seconds.toFixed(0)} 秒，超出 3–5 分钟区间`,
        location: '整体',
        evidence: `要求 ${minChars}–${maxChars} 字（${p.minSec || 180}–${p.maxSec || 300} 秒，±${Math.round((p.tolerance ?? 0.1) * 100)}% 容差）`,
        suggestion: chars < minChars ? `还需补约 ${minChars - chars} 字，优先补资料支撑的细节段。` : `需删约 ${chars - maxChars} 字，先删重复铺垫段。`,
      });
    }

    // H3 单句长度
    const hp = R('H3').params;
    const longSents = splitSentences(parsed.scriptText).filter((s) => {
      const n = cleanChars(s);
      return n > (hp.maxChars || 40) || (n >= (hp.deChars || 38) && (s.match(/的/g) || []).length >= (hp.deCount || 4));
    });
    longSents.slice(0, 8).forEach((s) => add('H3', {
      title: `单句 ${cleanChars(s)} 字，一口气念不完`,
      location: locateSentence(parsed.script, s, '段'),
      evidence: s,
      suggestion: '在转折处断句，单句控制在 40 字以内。',
    }));

    // H4 结尾复述
    const lastPara = parsed.script[parsed.script.length - 1] || '';
    if (thesis) {
      const ov = overlapRatio(thesis, lastPara);
      const sim = similarity(thesis, lastPara);
      if (ov < (R('H4').params.overlap || 0.4) || sim >= 0.85) {
        add('H4', {
          title: ov < 0.4 ? '结尾没有复述核心论点' : '结尾是原句复读，不是换话说',
          location: '最后一段',
          evidence: lastPara.slice(0, 120),
          suggestion: '用不同句式把核心结论再说一遍，关键词要落在结尾段。',
        });
      }
    }

    // H5 场次覆盖
    const emptyCells = parsed.scenes.filter((s) => !s.picture || !s.audio || !s.asset);
    if (parsed.scenes.length < parsed.script.length) {
      add('H5', {
        title: `口播 ${parsed.script.length} 段，场次表只有 ${parsed.scenes.length} 行`,
        location: '场次表',
        evidence: '场次与口播段落未一一对应',
        suggestion: '每个口播段落配一行场次，方便剪辑对位。',
      });
    } else if (emptyCells.length) {
      add('H5', {
        title: `${emptyCells.length} 个场次的画面 / 配音 / 素材来源为空`,
        location: `第 ${emptyCells[0].index || 1} 场起`,
        evidence: emptyCells.map((s) => s.index).join('、'),
        suggestion: '补齐画面描述、字幕或配音、素材来源与状态。',
      });
    }
  }

  if (x) {
    const title = parsed.title || '';
    const body = parsed.body || '';
    const bodyLines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    const p1 = R('R1').params;
    if (cleanChars(title) < (p1.min || 12) || cleanChars(title) > (p1.max || 20)) {
      add('R1', {
        title: `标题 ${cleanChars(title)} 字，不在 12–20 字`,
        location: '标题',
        evidence: title,
        suggestion: '补具体利益点或数字，控制在 12–20 字。',
      });
    }
    if (!hasValuePoint(title)) {
      add('R2', {
        title: '标题缺少具体利益点 / 身份标签 / 数字',
        location: '标题',
        evidence: title,
        suggestion: '改成「给谁 + 解决什么 + 具体结果」，例如「小白做 PPT 的 3 个偷懒法」。',
      });
    }
    const first3 = bodyLines.slice(0, 3).join('\n');
    const opening = bodyLines[0] || '';
    const banOpen = /^(自我介绍一下|先介绍一下|背景是|最近我|大家好|今天想和大家)/.test(opening);
    if (banOpen || !/(结论|答案是|其实就是|直接说|说白了|建议|不建议|千万别|核心|一句话|先说结果|亲测)/.test(first3)) {
      add('R3', {
        title: banOpen ? '开头在自我介绍 / 铺垫背景' : '前三行没有给出结论',
        location: '正文第 1–3 行',
        evidence: first3.slice(0, 160),
        suggestion: '第一行就给结论或结论式钩子，背景放到后面。',
      });
    }
    const bullets = bodyLines.filter((l) => /^(第?[一二三四五六七八九十0-9]+[、.)）]|[-*•]\s)/.test(l));
    const want = contentType === '观点' ? [2, 4] : [3, 5];
    if (bullets.length < want[0] || bullets.length > want[1]) {
      add('R4', {
        title: `分点 ${bullets.length} 个，${contentType === '观点' ? '观点建议 2–4' : '教程 / 测评建议 3–5'} 个`,
        location: '正文',
        evidence: bullets.slice(0, 6).map((b) => b.slice(0, 24)).join(' / '),
        suggestion: '合并或拆分分点，让每点只讲一件事。',
      });
    }
    const tallParas = splitParagraphs(body).filter((p) => p.split('\n').filter(Boolean).length > (R('R5').params.maxLines || 3));
    if (tallParas.length) {
      add('R5', {
        title: `${tallParas.length} 段超过 3 行`,
        location: `第 ${splitParagraphs(body).indexOf(tallParas[0]) + 1} 段`,
        evidence: tallParas[0].slice(0, 100),
        suggestion: '一段只留 1–3 行，长内容改成多个分点。',
      });
    }
    if (contentType === '教程' && bullets.length >= 3) {
      const starters = bullets.map((b) => b.replace(/^(第?[一二三四五六七八九十0-9]+[、.)）]|[-*•]\s*)/, '').slice(0, 2));
      let run = 1;
      for (let i = 1; i < starters.length; i++) {
        const trans = /^(首先|然后|接着|另外|最后|其次|第一|第二|第三)/.test(starters[i]);
        const prevTrans = /^(首先|然后|接着|另外|最后|其次|第一|第二|第三)/.test(starters[i - 1]);
        run = trans && prevTrans ? run + 1 : 1;
        if (run >= 3) {
          add('R6', {
            title: '连续 3 个分点用过渡词开头',
            location: '正文分点',
            evidence: bullets.slice(0, 4).map((b) => b.slice(0, 18)).join(' / '),
            suggestion: '分点首句直接写判断，不要「首先/然后/最后」。',
          });
          break;
        }
      }
    }
    const rp = R('R7').params;
    if (parsed.images.length < (rp.min || 3) || parsed.images.length > (rp.max || 9)) {
      add('R7', {
        title: `配图 ${parsed.images.length} 张，建议 3–9 张`,
        location: '配图建议',
        evidence: parsed.images.slice(0, 3).join(' / '),
        suggestion: '每张图配一句说明，编号连续。',
      });
    } else {
      const bad = parsed.images.filter((img) => splitSentences(img).length > 1);
      if (bad.length) add('R7', {
        title: `${bad.length} 张配图的说明超过一句`,
        location: '配图建议',
        evidence: bad[0],
        suggestion: '每张图只写一句「这张拍什么」。',
      });
    }
    const r8 = R('R8').params;
    if (parsed.tags.length < (r8.min || 3) || parsed.tags.length > (r8.max || 6)) {
      add('R8', {
        title: `话题标签 ${parsed.tags.length} 个，建议 3–6 个`,
        location: '话题标签',
        evidence: parsed.tags.join(' '),
        suggestion: '补到 3–6 个，至少 2 个与正文直接相关。',
      });
    } else {
      const rel = parsed.tags.filter((t) => body.includes(t) || overlapRatio(t, body) >= 0.3).length;
      if (rel < 2) add('R8', {
        title: '标签与正文相关性不足',
        location: '话题标签',
        evidence: parsed.tags.join(' '),
        suggestion: '至少 2 个标签的关键词要出现在正文里。',
      });
    }
    const r9 = R('R9').params;
    if (parsed.chars < (r9.min || 300) || parsed.chars > (r9.max || 800)) {
      add('R9', {
        title: `正文 ${parsed.chars} 字，建议 300–800 字`,
        location: '正文',
        evidence: '',
        suggestion: parsed.chars < 300 ? '补一个具体步骤或一个对比细节。' : '拆成两篇，或删掉重复说明。',
      });
    }
  }

  if (w) {
    const opening = parsed.opening || '';
    const chapters = parsed.chapters || [];
    const ending = parsed.ending || '';
    const first200 = cleanChars(opening) > 0 ? [...opening].slice(0, 200).join('') : '';
    const gp = R('G1').params;
    if (cleanChars(opening) === 0) {
      add('G1', { title: '开篇为空', location: '开篇', evidence: '', suggestion: '前 200 字内提出核心问题或冲突。' });
    } else if (!(/[？?]/.test(first200) || /(为什么|怎么|是不是|到底|问题|困境|冲突|矛盾|然而|但)/.test(first200))) {
      add('G1', {
        title: `开篇 ${gp.chars || 200} 字内没有提出核心问题`,
        location: '开篇',
        evidence: first200.slice(0, 140),
        suggestion: '第一段直接抛出读者正在面对的问题，不要先铺垫行业背景。',
      });
    }
    const g2 = R('G2').params;
    if (chapters.length < (g2.min || 3) || chapters.length > (g2.max || 5)) {
      add('G2', {
        title: `章节 ${chapters.length} 个，建议 3–5 个`,
        location: '正文',
        evidence: chapters.map((c) => c.title).join(' / '),
        suggestion: '每章一个小标题，3–5 章为宜。',
      });
    }
    const generic = chapters.filter((c) => /^(第?[一二三四五六七八九十]+[、.]|第[一二三四五六七八九十]+(部分|章|节)|背景|现状|问题|方法|总结|结论|引言)$/.test(c.title.trim()));
    if (generic.length) {
      add('G3', {
        title: `${generic.length} 个小标题是空标题`,
        location: '正文小标题',
        evidence: generic.map((c) => c.title).join(' / '),
        suggestion: '把小标题写成具体判断，例如「先别急着买会员，这一步能省钱」。',
      });
    }
    chapters.forEach((c, i) => {
      if (i === 0) return;
      const first = splitSentences(c.content)[0] || '';
      if (cleanChars(first) < 8) {
        add('G4', {
          title: `第 ${i + 1} 章开头疑似硬切`,
          location: `第 ${i + 1} 章`,
          evidence: first || c.content.slice(0, 60),
          suggestion: '章首补一句承接上一章的判断，再进入新内容。',
        });
      }
    });
    splitParagraphs([opening, ...chapters.map((c) => c.content), ending].join('\n\n'))
      .filter((p) => p.split('\n').filter(Boolean).length > (R('G5').params.maxLines || 5))
      .slice(0, 3)
      .forEach((p) => add('G5', {
        title: '单段超过 5 行',
        location: '正文',
        evidence: p.slice(0, 90),
        suggestion: '拆段，长段落手机上看会糊成一片。',
      }));
    if (ending && overlapRatio(opening, ending) < 0.2) {
      add('G6', {
        title: '结尾没有回扣开篇的问题',
        location: '结尾',
        evidence: ending.slice(0, 120),
        suggestion: '结尾用一句话回答开篇提出的问题。',
      });
    }
    const g8 = R('G8').params;
    if (parsed.chars < (g8.min || 1500) || parsed.chars > (g8.max || 3000)) {
      add('G8', {
        title: `正文 ${parsed.chars} 字，建议 1500–3000 字`,
        location: '整体',
        evidence: '',
        suggestion: parsed.chars < 1500 ? '补一个案例或一段反方讨论。' : '删掉重复论述，保留递进段落。',
      });
    }
  }

  // ---------- X5 标题一致 ----------
  const titleForX5 = x || w ? parsed.title : (topic?.name || '');
  if (titleForX5 && overlapRatio(titleForX5, fullText) < 0.3) {
    add('X5', {
      title: '标题关键词在正文里几乎没出现',
      location: '标题',
      evidence: titleForX5,
      suggestion: '正文至少自然出现一次标题的核心词，避免标题党。',
    });
  }

  // ---------- T 系列（按选题类型） ----------
  if (!contentType || !['教程', '测评', '观点'].includes(contentType)) {
    items.push({ rule: 'T0', gate: 1, gateName: GATE_NAMES[1], level: 'info', name: '类型规则未执行', title: '选题未选择内容类型，T 系列规则未执行', location: '选题', evidence: '', suggestion: '在选题里设置内容类型（教程 / 测评 / 观点），三平台共用。', needsReview: false, auto: true });
  } else {
    if (contentType === '教程') runTutorial({ add, fullText, parsed, platform, materials, R });
    if (contentType === '测评') runReview({ add, fullText, parsed, platform, materials, R });
    if (contentType === '观点') runOpinion({ add, fullText, parsed, software: null, platform, materials, R });
  }

  // ---------- 闸② 去 AI 味 ----------
  const s1 = R('S1').params.words || [];
  for (const hit of countMatches(fullText, s1).slice(0, 12)) {
    const quoted = inQuotes(fullText, hit.index);
    add('S1', {
      level: quoted ? 'suggest' : 'block',
      title: `硬禁用词「${hit.word}」${quoted ? '（在引号内）' : ''}`,
      location: locate(fullText, hit.index, paras),
      evidence: contextOf(fullText, hit.index, hit.word),
      suggestion: quoted ? '引号内可能是反面示例，需人工判定；叙述者自用则必须换掉。' : '换成人话：说清楚具体动作和结果，不用抽象名词。',
      needsReview: quoted,
    });
  }
  const s2 = R('S2').params;
  const connHits = countMatches(fullText, s2.words || []);
  const density = (connHits.length / Math.max(1, cleanChars(fullText))) * 100;
  if (density > (s2.density || 0.45)) {
    add('S2', {
      title: `模板化连接词 ${connHits.length} 处（每百字 ${density.toFixed(2)}）`,
      location: '整体',
      evidence: connHits.slice(0, 6).map((h) => h.word).join('、'),
      suggestion: '删掉「此外 / 综上所述 / 因此」，句子靠内容承接，不靠连接词。',
    });
  }
  const s3 = /通过[\s\S]{0,40}从而[\s\S]{0,40}(最终|实现|达到)/.exec(fullText) || /旨在[\s\S]{0,30}从而/.exec(fullText);
  if (s3) {
    add('S3', {
      title: 'AI 句式「通过…从而…最终实现…」',
      location: locate(fullText, s3.index, paras),
      evidence: s3[0],
      suggestion: '拆成「我做了什么 → 结果怎样」两句。',
    });
  }
  const dupPairs = findDuplicates(sents, R('X4').params.similarity || 0.85);
  dupPairs.slice(0, 4).forEach(([a, b, sim]) => add('X4', {
    title: `重复表达（相似度 ${(sim * 100).toFixed(0)}%）`,
    location: locateSentence(paras, a, '段'),
    evidence: `${a} ／ ${b}`,
    suggestion: '两处留一处，或把后一处换成具体例子。',
  }));

  // ---------- 闸③ 转化 ----------
  const tail = paras.slice(-2).join('\n');
  const ad = !!opts.ad;
  const sponsor = !!opts.sponsor;
  if (d && !ad) {
    if (!(R('C1').params.words || []).some((wd) => tail.includes(wd))) {
      add('C1', {
        title: '结尾没有评论召唤',
        location: '最后一段',
        evidence: tail.slice(0, 100),
        suggestion: '结尾加一句具体提问，例如「你卡在第几步，评论区说」。',
      });
    }
    if (!(R('C2').params.words || []).some((wd) => tail.includes(wd))) {
      add('C2', {
        title: '结尾没有关注或下期钩子',
        location: '最后一段',
        evidence: tail.slice(0, 100),
        suggestion: '结尾补一句下期内容钩子，再带关注。',
      });
    }
  }
  if (d && ad) {
    const c3words = R('C3').params.words || [];
    const hits = countMatches(fullText, c3words);
    if (hits.length) {
      hits.slice(0, 8).forEach((h) => add('C3', {
        title: `投流稿出现互动引导「${h.word}」`,
        location: locate(fullText, h.index, paras),
        evidence: contextOf(fullText, h.index, h.word),
        suggestion: '投流稿禁止一切互动引导，改成价值型软钩子（例如「这条可以先收藏，下次照着做」也算引导，需删）。',
      }));
    }
  }
  if (d && sponsor) {
    const interact = (R('C3').params.words || []).filter((wd) => fullText.includes(wd));
    if (interact.length && !fullText.includes('【客户要求·风险已报批】')) {
      add('C4', {
        title: '商单稿有互动引导但未打风险标记',
        location: '整体',
        evidence: interact.join('、'),
        suggestion: '客户硬性要求的引导，需在句中附「【客户要求·风险已报批】」并留存沟通记录。',
      });
    }
  }
  if (w && (R('G7').params.words || []).some((wd) => endingHas(parsed.ending || '', wd))) {
    const endingTail = parsed.ending || '';
    add('G7', {
      title: '结尾是硬广',
      location: '结尾',
      evidence: endingTail.slice(0, 120),
      suggestion: '删掉「赶快关注 / 点击购买 / 扫码领取」，改成结论或延伸。',
    });
  }
  if (contentType) {
    const t3 = /(限制|缺点|不足|坑|失败|不适合|代价|注意|门槛|问题|翻车)/;
    if (!t3.test(fullText)) {
      add('T3', {
        title: '全文只讲好处，没有限制或失败情况',
        location: '整体',
        evidence: '',
        suggestion: '加一段「什么情况下这套方法不成立」，可信度会更高。',
      });
    }
    if (contentType === '观点') {
      const growth = /(\d+%|增长\s*\d+|翻倍|涨了\s*\d+)/.exec(fullText);
      const promise = /(明年|3 个月|三个月|半年|一年内|未来两年|三年内)/.exec(fullText);
      if (growth || promise) {
        add('T13', {
          title: '出现具体增长数字或时间承诺',
          location: locate(fullText, (growth || promise).index, paras),
          evidence: (growth || promise)[0],
          suggestion: '改成范围或条件判断，例如「如果 X 成立，可能会 Y」，并标明这是判断。',
        });
      }
    }
  }

  // ---------- 闸④ 红线 ----------
  const wl = new Set(whitelist.map((w) => w.word));
  if (wordlib && !wordlib.error) {
    let shown = 0;
    for (const w of wordlib.words) {
      if (wl.has(w)) continue;
      if (/^[\x00-\x7F]+$/.test(w) && w.length < 4) continue; // 英文短词易误命中，见 README
      const hits = countMatches(fullText, [w]);
      for (const h of hits) {
        if (shown >= 30) break;
        shown++;
        add('V1', {
          title: `词库命中「${w}」`,
          location: locate(fullText, h.index, paras),
          evidence: contextOf(fullText, h.index, w, R('V1').params.context || 25),
          suggestion: '命中只代表必审，不等于违规；确认语境后决定改写或忽略并填理由。',
          needsReview: true,
        });
      }
      if (shown >= 30) break;
    }
  } else if (wordlib?.error) {
    items.push({ rule: 'V1', gate: 4, gateName: GATE_NAMES[4], level: 'info', name: '词库不可用', title: '闸门④不可用：' + wordlib.error, location: '设置', evidence: wordlib.error, suggestion: '恢复词库文件路径后重新质检。', needsReview: false, auto: true });
  }

  const absRe = /(最好用|第一选择|全网首发|国家级|最佳选择|最强|最便宜|最划算|最快|唯一|100%|绝对|顶级|冠军)/g;
  for (const m of fullText.matchAll(absRe)) {
    add('V2', {
      title: `绝对化用语「${m[0]}」`,
      location: locate(fullText, m.index, paras),
      evidence: contextOf(fullText, m.index, m[0]),
      suggestion: '改成有条件、有范围的表达，或给出比较对象与依据。',
      needsReview: true,
    });
  }
  const drainRe = /(微信号|加微信|加V|私信领|二维码|扫码|点击下方链接|https?:\/\/|手机号|\d{11})/g;
  for (const m of fullText.matchAll(drainRe)) {
    add('V3', {
      title: `导流信息「${m[0].slice(0, 12)}」`,
      location: locate(fullText, m.index, paras),
      evidence: contextOf(fullText, m.index, m[0]),
      suggestion: '删除导流信息，平台会限流或直接不通过。',
      needsReview: true,
    });
  }
  const redRe = /(治病|治疗|治愈|降血压|降血糖|减肥|瘦身|提升视力|壮阳|稳赚|保本|收益率|保过|押题|提分|升学|垃圾|智商税|吊打|秒杀|完爆|取代人类|取代你的工作|让.{0,6}失业)/g;
  for (const m of fullText.matchAll(redRe)) {
    add('V4', {
      title: `类目红线「${m[0]}」`,
      location: locate(fullText, m.index, paras),
      evidence: contextOf(fullText, m.index, m[0]),
      suggestion: '这类表述属于高风险区，必须改写或删除。',
      needsReview: true,
    });
  }

  // X2 待核实资料被使用
  const pending = materials.filter((m) => m.kind === 'pending');
  const factMats = materials.filter((m) => m.kind === 'fact');
  const marked = fullText.includes('待核实');
  for (const m of pending) {
    const nerve = (m.content || '').split(/[。\n！？]/).map((s) => s.trim()).filter((s) => cleanChars(s) >= 8).slice(0, 3);
    const used = nerve.find((n) => fullText.includes(n.slice(0, 12)) || overlapRatio(n, fullText) >= 0.4);
    if (used && !marked) {
      add('X2', {
        title: '使用了「待核实」资料但正文没有标注',
        location: '整体',
        evidence: `资料：${(m.title || m.content).slice(0, 60)}`,
        suggestion: '在该句后标「⚠️ 待核实」，或先完成核实再写。',
      });
    }
  }
  // X3 真实性溯源
  const realRe = /(我试了|亲测|实测|真实体验|截图|翻车|上手|用了几天|我做了)/g;
  const realHits = [...fullText.matchAll(realRe)];
  if (realHits.length) {
    const traceable = factMats.length > 0 && factMats.some((m) => overlapRatio(m.content, fullText) > 0.25 || (m.source_url || '').length > 0);
    const ann = fullText.includes('⚠️ 真实性待补') || fullText.includes('真实性待补');
    if (!traceable || ann) {
      add('X3', {
        title: ann ? '有真实性标注，仍需补资料后才可归档' : '出现真实体验/截图/数据，但资料区找不到对应事实条目',
        location: locate(fullText, realHits[0].index, paras),
        evidence: contextOf(fullText, realHits[0].index, realHits[0][0]),
        suggestion: '到资料区补一条带出处的「事实」，或删掉这部分体验描述。',
      });
    }
  }

  return finish({ items, structure, parsed, platform, contentType, disabled, wordlib, note: null });
}

function finish(ctx) {
  const { items } = ctx;
  const stats = { total: items.length, block: 0, suggest: 0, info: 0, byGate: {} };
  for (const it of items) {
    stats[it.level] = (stats[it.level] || 0) + 1;
    stats.byGate[it.gate] = stats.byGate[it.gate] || { block: 0, suggest: 0, info: 0 };
    stats.byGate[it.gate][it.level] = (stats.byGate[it.gate][it.level] || 0) + 1;
  }
  const conclusion = stats.block ? 'block' : stats.suggest ? 'warn' : 'pass';
  return { ...ctx, stats, conclusion, gateNames: GATE_NAMES };
}

export function recomputeConclusion(items) {
  let block = 0, suggest = 0, info = 0;
  for (const it of items) {
    if (it.level === 'block') block++;
    else if (it.level === 'suggest') suggest++;
    else info++;
  }
  const stats = { total: items.length, block, suggest, info, byGate: {} };
  for (const it of items) {
    stats.byGate[it.gate] = stats.byGate[it.gate] || { block: 0, suggest: 0, info: 0 };
    stats.byGate[it.gate][it.level] = (stats.byGate[it.gate][it.level] || 0) + 1;
  }
  return { stats, conclusion: block ? 'block' : suggest ? 'warn' : 'pass' };
}

function ruleIdsByGate(rules, gate) {
  return [...rules.values()].filter((r) => r.gate === gate).map((r) => r.id);
}

function scopeOk(id, platform, contentType) {
  return true;
}

function hookHits(sentence) {
  const hits = [];
  if (/(当|在|坐在|打开|早上|晚上|凌晨|下班|上班|工位|开会|加班|办公室|家里|地铁|电脑前|屏幕前)/.test(sentence)) hits.push('具体场景');
  if (/(但是|但|却|反而|居然|其实|结果|没想到|不是.{0,12}而是|以前|之前|原来|花了.{0,10}才)/.test(sentence) || /[？?]/.test(sentence)) hits.push('反差冲突');
  if (/(别|不要|必须|一定要|千万|根本|真正|结论|建议|不推荐|最该|才是|别再)/.test(sentence)) hits.push('强主张');
  return hits;
}

function hasValuePoint(title) {
  if (!title) return false;
  if (/\d/.test(title)) return true;
  if (/(省钱|省时|提升|搞定|模板|教程|避坑|清单|方法|技巧|对比|实测|推荐|指南|分钟|步|免费|新手|小白|上班族|打工人|学生|设计师|运营|翻倍|效率)/.test(title)) return true;
  return false;
}

function endingHas(ending, word) {
  return (ending || '').includes(word);
}

function runTutorial({ add, fullText, parsed, platform, materials, R }) {
  const steps = collectSteps(parsed, platform);
  if (steps.length) {
    const vague = /(进行配置|完成设置|选择合适参数|按需调整|根据情况|适当优化|进行设置|自行调整)/;
    const vagueSteps = steps.filter((s) => vague.test(s));
    vagueSteps.slice(0, 3).forEach((s) => add('T1', {
      title: '步骤是空动作，落不了地',
      location: '步骤',
      evidence: s.slice(0, 100),
      suggestion: '写清「在哪个界面 → 点哪个按钮 → 输入什么 → 得到什么」。',
    }));
    const noResult = steps.filter((s) => cleanChars(s) >= 10 && !/(得到|出现|生成|保存|导出|完成|变成|显示|就能|结果是|看到)/.test(s));
    if (noResult.length && noResult.length === steps.length) {
      add('T1', {
        title: '所有步骤都没有写结果',
        location: '步骤',
        evidence: steps[0].slice(0, 100),
        suggestion: '每一步补一句「做完会看到什么」，否则读者不知道自己有没有做错。',
      });
    }
  }
  const pre = [
    /(版本|v\d+(\.\d+)*|Version)/i,
    /(免费|付费|会员|价格|多少钱|元\/月|订阅)/,
    /(账号|登录|注册|邮箱|手机号绑定)/,
    /(工具|软件|平台|网站|插件|模型|客户端)/,
  ];
  const hitPre = pre.filter((re) => re.test(fullText)).length;
  if (hitPre < 3) {
    add('T2', {
      title: `前置条件只写了 ${hitPre} 项，至少需要 3 项`,
      location: '开头或步骤前',
      evidence: '需写明：工具名、版本、是否付费、是否需账号',
      suggestion: '在正文开头补一段「你需要准备什么」，减少读者试错成本。',
    });
  }
  const vagueResult = /(效果很好|提升明显|非常好用|效率翻倍|秒出|一步到位|太好用了|惊艳)/.test(fullText);
  const verifiable = /(\d+\s*(秒|分钟|小时|倍|%|页)|截图|前后对比|实测|耗时|记录了|对比图)/.test(fullText);
  if (vagueResult && !verifiable) {
    add('T4', {
      title: '只有「效果很好」类结论，没有可核对的结果',
      location: '整体',
      evidence: (fullText.match(/(效果很好|提升明显|非常好用|效率翻倍|秒出|一步到位|太好用了|惊艳)/) || [''])[0],
      suggestion: '给出耗时、页数、前后对比或截图位置；没有实测就不要下效果结论。',
    });
  }
}

function runReview({ add, fullText, parsed, platform, materials, R }) {
  const dims = ['价格', '费用', '速度', '效果', '质量', '易用', '上手', '功能', '稳定', '兼容', '售后', '隐私', '准确', '时间', '成本', '体验', '续航', '性能', '容量', '噪音'];
  const found = dims.filter((d2) => fullText.includes(d2));
  if (found.length < 3) {
    add('T5', {
      title: `对比维度只有 ${found.length} 个，建议至少 3 个`,
      location: '整体',
      evidence: found.join('、') || '未识别到维度词',
      suggestion: '先定 3 个维度（例如价格 / 上手成本 / 输出质量），全文用同一套标准。',
    });
  }
  const numRe = /(\d+(\.\d+)?\s*(元|块|美元|万|GB|G|寸|英寸|小时|分钟|mAh|W|%))|(v?\d+\.\d+(\.\d+)*)/gi;
  const nums = [...new Set([...fullText.matchAll(numRe)].map((m) => m[0].replace(/\s/g, '')))];
  const unsourced = nums.filter((n) => !materials.some((m) => m.kind === 'fact' && (m.content || '').replace(/\s/g, '').includes(n)));
  if (unsourced.length) {
    add('T6', {
      title: `${unsourced.length} 个参数 / 价格 / 版本号在资料区找不到事实来源`,
      location: '整体',
      evidence: unsourced.slice(0, 6).join('、'),
      suggestion: '到资料区补官网参数页或价格页（带链接与检索日期），否则删掉具体数字。',
    });
  }
  const tail = platform === 'douyin' ? (parsed.script || []).slice(-2).join('') : platform === 'xhs' ? (parsed.body || '').slice(-300) : (parsed.ending || '');
  if (!/(适合|不适合|推荐|不建议|选它|别选|建议买|建议用|谁适合)/.test(tail)) {
    add('T7', {
      title: '结尾没有给「谁适合 / 谁不适合」的取舍',
      location: '结尾',
      evidence: tail.slice(0, 120),
      suggestion: '明确一句：什么人适合，什么人不适合，不要只罗列参数。',
    });
  }
}

function runOpinion({ add, fullText, parsed, platform, materials, R }) {
  const markers = (fullText.match(/第[一二三四五]、?|其一|其二|其三/g) || []).length;
  if (markers > (R('T8').params.max || 2)) {
    add('T8', {
      title: `并列主论点约 ${markers} 条，超过 2 条`,
      location: '整体',
      evidence: '',
      suggestion: '保留一个主论点，其余降级为支撑或删掉。',
    });
  }
  const claimParas = splitParagraphs(fullText).filter((p) => cleanChars(p) >= 25);
  const weak = claimParas.filter((p) => !materials.some((m) => overlapRatio(m.content, p) >= 0.2));
  if (materials.length && weak.length) {
    add('T9', {
      title: `${weak.length} 段没有资料条目支撑`,
      location: '整体',
      evidence: weak[0].slice(0, 100),
      suggestion: '为每段论点挂一条资料（事实或观点），否则删掉或标为「我的判断」。',
    });
  }
  if (!/(有人会说|你可能会说|反方|反对|争议|另一种看法|质疑|不支持|反对意见)/.test(fullText)) {
    add('T10', {
      title: '没有回应任何反方观点',
      location: '整体',
      evidence: '',
      suggestion: '加一段「有人会反对，说……」，再回应它，说服力会明显不同。',
    });
  }
  const sourceRe = /(据|来源|报告|数据显示|统计|调研|发布|白皮书|20\d{2})/;
  const numSent = splitSentences(fullText).filter((s) => /\d/.test(s) && /(%|亿|万|倍|元)/.test(s));
  const badNum = numSent.filter((s) => !sourceRe.test(s));
  if (badNum.length) {
    add('T11', {
      title: `${badNum.length} 句引用具体数字但没有来源与时间`,
      location: '整体',
      evidence: badNum[0].slice(0, 100),
      suggestion: '补「据 XX 报告（2026-09）」，或把数字改成范围与判断。',
    });
  }
  const guess = /(可能|大概率|估计|应该会|预测|将会|我觉得|我认为)/.test(fullText);
  const label = /(我的判断|我的推测|我判断|个人判断)/.test(fullText);
  if (guess && !label) {
    add('T12', {
      title: '推测与事实混写，没有标注「我的判断」',
      location: '整体',
      evidence: (fullText.match(/(可能|大概率|估计|应该会|预测|将会|我觉得|我认为)/) || [''])[0],
      suggestion: '所有推测句前加「我的判断：」，与资料支撑的事实分开。',
    });
  }
}

function collectSteps(parsed, platform) {
  if (platform === 'douyin') return (parsed.script || []).filter((p) => cleanChars(p) >= 12);
  if (platform === 'xhs') {
    return (parsed.body || '').split('\n').map((l) => l.trim())
      .filter((l) => /^(第?[一二三四五六七八九十0-9]+[、.)）]|[-*•]\s)/.test(l))
      .map((l) => l.replace(/^(第?[一二三四五六七八九十0-9]+[、.)）]|[-*•]\s*)/, ''));
  }
  return (parsed.chapters || []).map((c) => c.content);
}

function locate(text, index, paras) {
  let acc = 0;
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (index >= acc && index <= acc + p.length) {
      const sents = splitSentences(p);
      let sacc = 0;
      for (let j = 0; j < sents.length; j++) {
        if (index >= acc + sacc && index <= acc + sacc + sents[j].length) return `第 ${i + 1} 段第 ${j + 1} 句`;
        sacc += sents[j].length + 1;
      }
      return `第 ${i + 1} 段`;
    }
    acc += p.length + 2;
  }
  return '整体';
}

function locateSentence(paras, sent, unit) {
  for (let i = 0; i < paras.length; i++) {
    if ((paras[i] || '').includes(sent.slice(0, 12))) return `第 ${i + 1} ${unit}`;
  }
  return '';
}

function findDuplicates(sents, threshold) {
  const out = [];
  const list = sents.filter((s) => cleanChars(s) >= 12).slice(0, 120);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const sim = similarity(list[i], list[j]);
      if (sim >= threshold) out.push([list[i], list[j], sim]);
    }
  }
  return out;
}
