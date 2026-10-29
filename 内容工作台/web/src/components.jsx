import React, { useEffect, useState } from 'react';

export function Modal({ title, children, onClose, width = 720, footer }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Toast({ msg, onDone }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return <div className={`toast ${msg.type || 'ok'}`}>{msg.text}</div>;
}

export function Pill({ tone = 'gray', children }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Field({ label, hint, children, required }) {
  return (
    <label className="field">
      <span className="field-label">{label}{required && <em>*</em>}{hint && <i>{hint}</i>}</span>
      {children}
    </label>
  );
}

export function CopyBtn({ text, label = '复制' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn ghost small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text || '');
        } catch {
          const ta = document.createElement('textarea');
          ta.value = text || '';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          ta.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? '已复制' : label}
    </button>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Spinner({ text = '加载中…' }) {
  return <div className="loading">{text}</div>;
}

export function StatusDot({ status }) {
  const tone = {
    已归档: 'green', 可归档: 'green', 资料就绪: 'blue', 创作中: 'amber', 待质检: 'amber',
    待修改: 'red', 待确认方向: 'amber', 待大纲: 'gray', 未开始: 'gray', 已搁置: 'gray', 已放弃: 'gray',
  }[status] || 'gray';
  return <span className={`status-dot ${tone}`} title={status} />;
}

export function Seg({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 在正文里定位质检证据（先逐字找，再忽略空白差异找）
function findRanges(text, evidence) {
  const ev = String(evidence || '').trim();
  if (!text || ev.length < 2) return [];
  const out = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf(ev, from);
    if (i < 0) break;
    out.push([i, i + ev.length]);
    from = i + ev.length;
    if (out.length >= 20) break;
  }
  if (out.length) return out;
  const re = new RegExp(escRe(ev).replace(/\\?\s+/g, '\\s*'), 'g');
  let m;
  while ((m = re.exec(text))) {
    out.push([m.index, m.index + m[0].length]);
    if (!m[0].length) re.lastIndex += 1;
    if (out.length >= 20) break;
  }
  return out;
}

// 正文 + 质检问题句高亮：阻断=红，建议=黄
export function HighlightedText({ text = '', items = [], className = 'raw-text' }) {
  const spans = [];
  for (const it of items || []) {
    if (!it || it.level === 'info') continue;
    for (const [s, e] of findRanges(text, it.evidence)) {
      spans.push({ s, e, level: it.level, rule: it.rule, title: it.title });
    }
  }
  spans.sort((a, b) => a.s - b.s || b.e - a.e || (a.level === 'block' ? -1 : 1));
  const kept = [];
  let end = -1;
  for (const sp of spans) {
    if (sp.s < end) continue;
    kept.push(sp);
    end = sp.e;
  }
  const nodes = [];
  let last = 0;
  kept.forEach((sp, i) => {
    if (sp.s > last) nodes.push(text.slice(last, sp.s));
    nodes.push(
      <mark key={i} className={`hl ${sp.level}`} title={`${sp.rule || ''} ${sp.title || ''}`}>
        {text.slice(sp.s, sp.e)}
      </mark>
    );
    last = sp.e;
  });
  if (last < text.length) nodes.push(text.slice(last));
  return <pre className={className}>{nodes}</pre>;
}
