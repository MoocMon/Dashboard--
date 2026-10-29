import React, { useMemo, useState } from 'react';
import { api, PLATFORM, fmtDate } from '../api.js';
import { Modal, Field, Pill, Empty, StatusDot } from '../components.jsx';

const TYPES = ['教程', '测评', '观点'];
const STATUSES = ['', '待整理', '资料就绪', '创作中', '待质检', '已归档', '已搁置'];

export default function Topics({ topics, reload, openTopic, notify }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: '', source: '', angle: '', content_type: '教程',
    platforms: ['douyin', 'xhs', 'wechat'], priority: 2, schedule_date: '', tags: '',
  });
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => topics.filter((t) => {
    if (status && t.status !== status) return false;
    if (!q) return true;
    return [t.name, t.source, t.angle, t.tags].join(' ').toLowerCase().includes(q.toLowerCase());
  }), [topics, q, status]);

  const submit = async () => {
    if (!form.name.trim()) return notify('选题名称必填', 'err');
    if (!form.platforms.length) return notify('至少选一个目标平台', 'err');
    setBusy(true);
    try {
      const r = await api.post('/api/topics', form);
      setCreating(false);
      setForm({ ...form, name: '', source: '', angle: '', schedule_date: '', tags: '' });
      await reload();
      notify(r.duplicate ? `已创建（存在同名选题「${r.duplicate}」）` : '选题已创建');
      openTopic(r.topic.id);
    } catch (e) {
      notify(e.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>选题池</h1>
          <p className="sub">一个选题一个内容类型，三平台共用。目标平台决定详情页的稿件卡数量。</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}>+ 新建选题</button>
      </div>

      <div className="toolbar">
        <input className="search" placeholder="搜索选题 / 来源 / 标签" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s || '全部状态'}</option>)}
        </select>
        <span className="count">{list.length} 个选题</span>
      </div>

      {list.length === 0 ? (
        <Empty>还没有选题。先在候选池里采纳一条，或直接新建。</Empty>
      ) : (
        <div className="topic-grid">
          {list.map((t) => (
            <article key={t.id} className="topic-card" onClick={() => openTopic(t.id)}>
              <div className="tc-top">
                <span className="tc-type">{t.content_type || '未设类型'}</span>
                <span className="tc-status"><StatusDot status={t.status} />{t.status}</span>
              </div>
              <h3>{t.name}</h3>
              {t.angle && <p className="tc-angle">{t.angle}</p>}
              <div className="tc-meta">
                {t.platforms.map((p) => (
                  <span key={p} className={`plat-dot ${p}`} title={PLATFORM[p]?.label}>{PLATFORM[p]?.label}</span>
                ))}
                {t.schedule_date && <span className="tc-date">{fmtDate(t.schedule_date)}</span>}
              </div>
              {t.tags && <div className="tc-tags">{t.tags.split(/[,，\s]+/).filter(Boolean).map((tag) => <Pill key={tag}>{tag}</Pill>)}</div>}
            </article>
          ))}
        </div>
      )}

      {creating && (
        <Modal title="新建选题" onClose={() => setCreating(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setCreating(false)}>取消</button>
            <button className="btn primary" disabled={busy} onClick={submit}>{busy ? '创建中…' : '创建选题'}</button>
          </>
        }>
          <Field label="选题名称" required hint="≤60 字">
            <input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：AI 做 PPT，哪些环节真的能省时间" />
          </Field>
          <div className="row2">
            <Field label="内容类型" required hint="选题级，三平台共用">
              <select value={form.content_type} onChange={(e) => setForm({ ...form, content_type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="优先级">
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>
                <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
              </select>
            </Field>
          </div>
          <Field label="立意" hint="≤120 字，一句话说清这个选题要证明什么">
            <textarea rows={2} maxLength={120} value={form.angle} onChange={(e) => setForm({ ...form, angle: e.target.value })} />
          </Field>
          <Field label="来源">
            <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="链接、笔记、聊天记录里的出处" />
          </Field>
          <Field label="目标平台">
            <div className="checks">
              {Object.entries(PLATFORM).map(([k, v]) => (
                <label key={k} className="check">
                  <input type="checkbox" checked={form.platforms.includes(k)}
                    onChange={(e) => setForm({ ...form, platforms: e.target.checked ? [...form.platforms, k] : form.platforms.filter((x) => x !== k) })} />
                  {v.label}
                </label>
              ))}
            </div>
          </Field>
          <div className="row2">
            <Field label="计划发布日">
              <input type="date" value={form.schedule_date} onChange={(e) => setForm({ ...form, schedule_date: e.target.value })} />
            </Field>
            <Field label="标签" hint="逗号分隔">
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="AI工具, 效率" />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
