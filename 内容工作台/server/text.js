const PUNCT = /[\s，。！？；：、""''（）()【】《》〈〉…—\-·,.!?;:'"()\[\]{}<>\/\\|@#$%^&*+=~`_]/;

export function cleanChars(text = '') {
  return [...text].filter((ch) => !PUNCT.test(ch)).length;
}

export function splitParagraphs(text = '') {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export function splitSentences(text = '') {
  return text
    .replace(/\n+/g, '。')
    .split(/[。！？!?；;]+/)
    .map((s) => s.trim().replace(/^[-*•\d.、)\s]+/, '').trim())
    .filter((s) => cleanChars(s) > 0);
}

export function splitLines(text = '') {
  return text.split('\n').map((l) => l.trim());
}

const STOP = new Set(['我们', '你们', '他们', '这个', '那个', '什么', '怎么', '就是', '其实', '因为', '所以', '但是', '如果', '可以', '一个', '没有', '不是', '自己', '现在', '已经', '还是', '然后', '这样', '那样', '时候', '东西', '事情', '问题', '所以']);

export function bigrams(text = '') {
  const chars = [...text].filter((ch) => !PUNCT.test(ch));
  const out = new Set();
  for (let i = 0; i < chars.length - 1; i++) {
    const g = chars[i] + chars[i + 1];
    if (!STOP.has(g)) out.add(g);
  }
  return out;
}

export function overlapRatio(a = '', b = '') {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return hit / A.size;
}

export function similarity(a = '', b = '') {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const g of A) if (B.has(g)) hit++;
  return (2 * hit) / (A.size + B.size);
}

export function countMatches(text, words = []) {
  const hits = [];
  for (const w of words) {
    let from = 0;
    while (from <= text.length) {
      const idx = text.indexOf(w, from);
      if (idx === -1) break;
      hits.push({ word: w, index: idx });
      from = idx + Math.max(1, w.length);
    }
  }
  return hits.sort((x, y) => x.index - y.index);
}

export function contextOf(text, index, word, span = 25) {
  const start = Math.max(0, index - span);
  const end = Math.min(text.length, index + word.length + span);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\n/g, ' ') + (end < text.length ? '…' : '');
}

export function inQuotes(text, index) {
  const pairs = [['「', '」'], ['“', '”'], ['『', '』'], ['"', '"']];
  for (const [open, close] of pairs) {
    const before = text.lastIndexOf(open, index);
    if (before === -1) continue;
    const after = text.indexOf(close, index);
    if (after !== -1 && before < index && index < after) return true;
  }
  return false;
}

export function quoteSpans(text) {
  const spans = [];
  const re = /[「“『"]([^」”』"]{1,200})[」”』"]/g;
  let m;
  while ((m = re.exec(text))) spans.push([m.index, m.index + m[0].length]);
  return spans;
}

export function sect(rules, id) {
  return rules.find((r) => r.id === id);
}
