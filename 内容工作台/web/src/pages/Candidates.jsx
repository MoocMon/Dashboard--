import React, { useEffect, useState } from 'react';
import { api, fmtDate, fmtTime } from '../api.js';
import { Modal, Field, Pill, Empty } from '../components.jsx';

export default function Candidates({ notify, reload, openTopic }) {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState('pending');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [adopt, setAdopt] = useState(null);
  const [form, setForm] = useState({ title: '', source_url: '', source_name: '', retrieved_at: new Date().toISOString().slice(0, 10), reason: '' });

  const load = async () => {
    try { setList(await api.get(`/api/candidates${status ? `?status=${status}` : ''}`)); } catch (e) { notify(e.message, 'err'); }
  };
  useEffect(() => { load(); }, [status]);

  const add = async () => {
    try {
      await api.post('/api/candidates', form);
      setAdding(false);
      setForm({ ...form, title: '', source_url: '', reason: '' });
      await load();
      notify('候选已入库');
    } catch (e) { notify(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>候选池</h1>
          <p className="sub">候选必须带来源链接与检索日期；系统不做热度打分，也不给「推荐选题」。</p>
        </div>
        <div className="inline">
          <button className="btn ghost" disabled={importing} onClick={async () => {
            setImporting(true);
            try { setResult(await api.post('/api/candidates/import')); await load(); } catch (e) { notify(e.message, 'err'); }
            finally { setImporting(false); }
          }}>{importing ? '导入中…' : '从选题雷达导入'}</button>
          <button className="btn primary" onClick={() => setAdding(true)}>+ 补充候选</button>
        </div>
      </div>

      {result && (
        <div className={`notice ${result.ok ? 'ok' : 'warn'}`}>
          {result.ok ? `导入完成：新增 ${result.added} 条，重复 ${result.duplicate} 条，共扫描 ${result.total} 条（${result.files} 个文件）。` : `未导入：${result.error}`}
          {!result.ok && result.path && <div className="dim">路径：{result.path}</div>}
        </div>
      )}

      <div className="toolbar">
        {[['pending', '待定'], ['adopted', '已采纳'], ['discarded', '已丢弃'], ['', '全部']].map(([k, label]) => (
          <button key={k} className={`chip ${status === k ? 'on' : ''}`} onClick={() => setStatus(k)}>{label}</button>
        ))}
        <span className="count">{list.length} 条</span>
      </div>

      {list.length === 0 ? <Empty>候选池是空的。可从雷达导入，或手动补一条带链接的候选。</Empty> : (
        <div className="cand-list">
          {list.map((c) => (
            <div key={c.id} className="cand-item">
              <div className="ci-main">
                <div className="ci-title">{c.title}<Pill tone={c.origin === 'radar' ? 'blue' : 'gray'}>{c.origin === 'radar' ? '雷达' : '手动'}</Pill></div>
                <div className="ci-meta">
                  <a href={c.source_url} target="_blank" rel="noreferrer">{c.source_url || '无链接'}</a>
                  <span className="dim">检索 {fmtDate(c.retrieved_at)}</span>
                  <span className="dim">{fmtTime(c.created_at)}</span>
                </div>
                {c.reason && <p className="ci-reason">{c.reason}</p>}
              </div>
              <div className="ci-acts">
                {c.status === 'pending' ? (
                  <>
                    <button className="btn primary small" onClick={() => setAdopt({ ...c, name: c.title, angle: c.reason, content_type: '教程' })}>采纳</button>
                    <button className="btn ghost small" onClick={async () => {
                      await api.post(`/api/candidates/${c.id}/discard`);
                      await load(); notify('已丢弃');
                    }}>丢弃</button>
                  </>
                ) : <Pill tone={c.status === 'adopted' ? 'green' : 'gray'}>{c.status === 'adopted' ? '已采纳' : '已丢弃'}</Pill>}
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <Modal title="补充候选" onClose={() => setAdding(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setAdding(false)}>取消</button>
            <button className="btn primary" onClick={add}>入库</button>
          </>
        }>
          <Field label="标题" required><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="来源链接" required hint="无来源不入库"><input value={form.source_url} onChange={(e) => setForm({ ...form, source_url: e.target.value })} placeholder="https://…" /></Field>
          <div className="row2">
            <Field label="来源名称"><input value={form.source_name} onChange={(e) => setForm({ ...form, source_name: e.target.value })} /></Field>
            <Field label="检索日期" required><input type="date" value={form.retrieved_at} onChange={(e) => setForm({ ...form, retrieved_at: e.target.value })} /></Field>
          </div>
          <Field label="为什么值得写"><textarea rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
        </Modal>
      )}

      {adopt && (
        <Modal title="采纳为正式选题" onClose={() => setAdopt(null)} footer={
          <>
            <button className="btn ghost" onClick={() => setAdopt(null)}>取消</button>
            <button className="btn primary" onClick={async () => {
              try {
                const r = await api.post(`/api/candidates/${adopt.id}/adopt`, { name: adopt.name, angle: adopt.angle, content_type: adopt.content_type });
                setAdopt(null);
                await load(); await reload();
                notify('已转为正式选题');
                openTopic(r.topic.id);
              } catch (e) { notify(e.message, 'err'); }
            }}>采纳并打开</button>
          </>
        }>
          <Field label="选题名称" hint="可顺手改标题"><input value={adopt.name} onChange={(e) => setAdopt({ ...adopt, name: e.target.value })} /></Field>
          <Field label="立意"><textarea rows={2} value={adopt.angle} onChange={(e) => setAdopt({ ...adopt, angle: e.target.value })} /></Field>
          <Field label="内容类型">
            <select value={adopt.content_type} onChange={(e) => setAdopt({ ...adopt, content_type: e.target.value })}>
              {['教程', '测评', '观点'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <p className="hint">来源链接会一并带入选题的来源字段。</p>
        </Modal>
      )}
    </div>
  );
}
