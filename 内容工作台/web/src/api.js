const base = '';

async function req(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.payload = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b || {}),
  patch: (u, b) => req('PATCH', u, b || {}),
  put: (u, b) => req('PUT', u, b || {}),
  del: (u) => req('DELETE', u),
};

export const PLATFORM = {
  douyin: { label: '抖音', form: '分镜脚本', color: '#2f6b4f' },
  xhs: { label: '小红书', form: '图文笔记', color: '#a53f36' },
  wechat: { label: '公众号', form: '长文章', color: '#33587a' },
};

export const LEVEL = {
  block: { label: '阻断', cls: 'lv-block' },
  suggest: { label: '建议', cls: 'lv-suggest' },
  info: { label: '提示', cls: 'lv-info' },
};

export const KIND = {
  fact: '事实',
  opinion: '观点',
  inference: '推断',
  pending: '待核实',
};

export function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

export function weekStart(dateStr) {
  const d = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  const day = d.getDay() || 7;
  const monday = new Date(d.getTime() - (day - 1) * 86400000);
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
}
