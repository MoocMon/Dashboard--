import React, { useEffect, useState } from 'react';
import { api, KIND, fmtTime } from '../api.js';
import { Empty, Pill, Field, Modal } from '../components.jsx';

export default function Snippets({ topics, notify, openTopic }) {
  const [list, setList] = useState([]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ text: '', kind: 'fact', source: '', tags: '' });
  const [cite, setCite] = useState(null);

  const load = async () => {
    try { setList(await api.get('/api/snippets')); } catch (e) { notify(e.message, 'err'); }
  };
  useEffect(() => { load(); }, []);

  const filtered = list.filter((s) => !q || (s.text + s.tags + s.source).includes(q));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>素材库</h1>
          <p className="sub">跨选题复用。引用时把内容快照进选题，之后改源素材不影响已定稿内容。</p>
        </div>
        <button className="btn primary" onClick={() => { setEditing('new'); setForm({ text: '', kind: 'fact', source: '', tags: '' }); }}>+ 新建片段</button>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="搜索片段 / 标签 / 来源" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="count">{filtered.length} 条</span>
      </div>

      {filtered.length === 0 ? <Empty>还没有素材。在选题资料区点 ☆ 可存入素材库。</Empty> : (
        <div className="snippet-grid">
          {filtered.map((s) => (
            <div key={s.id} className={`snippet-card ${s.disabled ? 'disabled' : ''}`}>
              <div className="sc-top"><Pill>{KIND[s.kind]}</Pill>{s.disabled && <Pill tone="red">已停用</Pill>}<span className="dim">引用 {s.cite_count} 次</span></div>
              <p className="sc-text">{s.text}</p>
              <div className="dim sc-meta">{s.source || '无出处'} · {fmtTime(s.created_at)}</div>
              <div className="inline">
                <button className="btn ghost small" onClick={() => setCite(s)}>引用到选题</button>
                <button className="link" onClick={() => { setEditing(s.id); setForm({ text: s.text, kind: s.kind, source: s.source, tags: s.tags }); }}>编辑</button>
                <button className="link danger" onClick={async () => {
                  if (!confirm('删除这个片段？仍被引用时只会停用。')) return;
                  const r = await api.del(`/api/snippets/${s.id}`);
                  await load();
                  notify(r.disabled ? '已被引用，已停用' : '已删除');
                }}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={editing === 'new' ? '新建素材片段' : '编辑素材片段'} onClose={() => setEditing(null)} footer={
          <>
            <button className="btn ghost" onClick={() => setEditing(null)}>取消</button>
            <button className="btn primary" onClick={async () => {
              if (!form.text.trim()) return notify('内容为空', 'err');
              try {
                if (editing === 'new') await api.post('/api/snippets', form);
                else await api.patch(`/api/snippets/${editing}`, form);
                setEditing(null); await load(); notify('已保存');
              } catch (e) { notify(e.message, 'err'); }
            }}>保存</button>
          </>
        }>
          <Field label="片段内容" required><textarea rows={5} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
          <div className="row2">
            <Field label="分类"><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="标签"><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
          </div>
          <Field label="来源"><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
        </Modal>
      )}

      {cite && (
        <Modal title="引用到选题" onClose={() => setCite(null)}>
          <p className="hint">引用会把这段内容复制一份到选题资料区，源素材后续修改不影响它。</p>
          <div className="cite-list">
            {topics.map((t) => (
              <button key={t.id} className="cite-row" onClick={async () => {
                try {
                  await api.post(`/api/snippets/${cite.id}/cite`, { topic_id: t.id });
                  setCite(null);
                  await load();
                  notify(`已引用到「${t.name}」`);
                } catch (e) { notify(e.message, 'err'); }
              }}>
                <span>{t.name}</span><span className="dim">{t.status}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
