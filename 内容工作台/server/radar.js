import fs from 'node:fs';
import path from 'node:path';

export function importRadar(dir) {
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, error: `雷达目录不存在：${dir}`, path: dir, added: 0, items: [] };
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  if (!files.length) return { ok: false, error: '雷达目录下没有 .md 文件', path: dir, added: 0, items: [] };
  const items = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const text = fs.readFileSync(full, 'utf8');
    const heads = [...text.matchAll(/^#{1,4}\s*(.+)$/gm)];
    const chunks = [];
    if (heads.length) {
      heads.forEach((h, i) => {
        const start = h.index + h[0].length;
        const end = heads[i + 1] ? heads[i + 1].index : text.length;
        chunks.push({ title: h[1].trim(), body: text.slice(start, end) });
      });
    } else {
      chunks.push({ title: path.basename(f, '.md'), body: text });
    }
    for (const c of chunks) {
      if (/^(选题池|内容规划|目录|索引|说明)/.test(c.title)) continue;
      const url = (c.body.match(/https?:\/\/[^\s)）\]]+/) || [])[0] || '';
      const date = (c.body.match(/20\d{2}-\d{2}-\d{2}/) || [])[0] || '';
      const reason = (c.body.match(/理由[：:]\s*(.+)/) || c.body.match(/为什么[：:]\s*(.+)/) || [])[1] || '';
      items.push({ title: c.title.replace(/^[#\s]+/, '').slice(0, 60), url, date, reason: reason.trim(), ref: `${f}#${c.title}` });
    }
  }
  return { ok: true, path: dir, files: files.length, items };
}
