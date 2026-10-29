import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './db.js';

export async function fetchUrl(url) {
  if (!/^https?:\/\//i.test(url)) return { ok: false, category: '地址无效', error: '只支持 http / https 链接' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    if (res.status === 401 || res.status === 403 || res.status === 412) {
      return { ok: false, category: '需要登录 / 反爬拦截', error: `服务器返回 ${res.status}，请手动粘贴正文` };
    }
    if (!res.ok) return { ok: false, category: '网络不可达', error: `服务器返回 ${res.status}` };
    const html = await res.text();
    const { JSDOM } = await import('jsdom');
    const { Readability } = await import('@mozilla/readability');
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    if (!article || !article.textContent || article.textContent.trim().length < 80) {
      return { ok: false, category: '页面无正文', error: '可能是动态渲染页面或纯图片页，请手动粘贴' };
    }
    return {
      ok: true,
      title: article.title || dom.window.document.title || url,
      text: article.textContent.replace(/\n{3,}/g, '\n\n').trim(),
      byline: article.byline || '',
    };
  } catch (e) {
    return { ok: false, category: e.name === 'AbortError' ? '网络不可达（超时）' : '抓取失败', error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

export async function parseUpload({ name, base64 }) {
  const buf = Buffer.from(base64 || '', 'base64');
  if (!buf.length) return { ok: false, category: '文件为空', error: '没有读到内容' };
  if (buf.length > 20 * 1024 * 1024) return { ok: false, category: '文件过大', error: '超过 20MB，请拆分后导入' };
  const ext = path.extname(name || '').toLowerCase();
  const saveDir = path.join(DATA_DIR, 'uploads');
  await fs.mkdir(saveDir, { recursive: true });
  const saved = path.join(saveDir, `${Date.now()}-${name.replace(/[\\/]/g, '_')}`);
  await fs.writeFile(saved, buf);
  try {
    if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
      return { ok: true, text: buf.toString('utf8'), title: name, filePath: saved };
    }
    if (ext === '.docx') {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return { ok: true, text: value.trim(), title: name, filePath: saved };
    }
    if (ext === '.pdf') {
      const mod = await import('pdf-parse');
      const pdfParse = mod.default || mod;
      const data = await pdfParse(buf);
      if (data.numpages > 100) {
        return { ok: false, category: '页数过多', error: `${data.numpages} 页，建议按章节分段导入`, filePath: saved };
      }
      const text = (data.text || '').trim();
      if (text.length < 40) return { ok: false, category: '可能是扫描件', error: '没有提取到文字，需要 OCR 后再导入', filePath: saved };
      return { ok: true, text, title: name, filePath: saved, pages: data.numpages };
    }
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
      return { ok: true, text: '', title: name, filePath: saved, imageOnly: true };
    }
    if (ext === '.doc') return { ok: false, category: '格式不支持', error: '旧版 .doc 无法解析，请另存为 .docx 或粘贴文本', filePath: saved };
    return { ok: false, category: '格式不支持', error: `不支持 ${ext || '未知'} 格式`, filePath: saved };
  } catch (e) {
    return { ok: false, category: '解析失败', error: e.message, filePath: saved };
  }
}
