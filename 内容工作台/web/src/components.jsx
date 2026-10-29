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
