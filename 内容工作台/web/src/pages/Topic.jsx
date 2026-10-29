import React, { useEffect, useState } from 'react';
import { api, PLATFORM, KIND, fmtTime, fmtDate } from '../api.js';
import { Modal, Field, Pill, Empty, StatusDot, Seg } from '../components.jsx';
import CreateTab from './CreateTab.jsx';
import QcTab from './QcTab.jsx';
import VersionsTab from './VersionsTab.jsx';
import ArchiveTab from './ArchiveTab.jsx';

const KINDS = ['fact', 'opinion', 'inference', 'pending'];

export default function Topic({ id, onBack, notify, reload, llm }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('materials');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);

  const load = async () => {
    try {
      const d = await api.get(`/api/topics/${id}`);
      setData(d);
      setForm({
        name: d.topic.name, source: d.topic.source, angle: d.topic.angle,
        content_type: d.topic.content_type, priority: d.topic.priority,
        schedule_date: d.topic.schedule_date || '', tags: d.topic.tags,
        platforms: d.topic.platforms, status: d.topic.status,
      });
    } catch (e) {
      notify(e.message, 'err');
    }
  };

  useEffect(() => { load(); }, [id]);

  if (!data) return <div className="page"><div className="loading">加载中…</div></div>;
  const t = data.topic;

  const saveEdit = async () => {
    try {
      await api.patch(`/api/topics/${id}`, form);
      setEditing(false);
      await load();
      await reload();
      notify('选题已更新');
    } catch (e) { notify(e.message, 'err'); }
  };

  const remove = async () => {
    if (!confirm(`删除选题「${t.name}」？已归档的 Obsidian 文件会保留。`)) return;
    try {
      const r = await api.del(`/api/topics/${id}`);
      await reload();
      notify(r.keptObsidianFiles ? '已删除索引，Obsidian 文件保留' : '选题已删除');
      onBack();
    } catch (e) { notify(e.message, 'err'); }
  };

  return (
    <div className="page">
      <div className="crumb">
        <button className="link" onClick={onBack}>← 选题池</button>
        <span className="crumb-id">{t.id}</span>
      </div>

      <div className="topic-head">
        <div className="th-main">
          <div className="th-title">
            <h1>{t.name}</h1>
            <StatusDot status={t.status} />
            <span className="th-status">{t.status}</span>
          </div>
          <div className="th-meta">
            <Pill tone="type">{t.content_type || '未设类型'}</Pill>
            {t.platforms.map((p) => <span key={p} className={`plat-dot ${p}`}>{PLATFORM[p]?.label}</span>)}
            {t.schedule_date ? <span className="dim">计划 {fmtDate(t.schedule_date)}</span> : <span className="dim">未排期</span>}
            {t.tags && <span className="dim">#{t.tags.split(/[,，\s]+/).filter(Boolean).join(' #')}</span>}
          </div>
          {t.angle && <p className="th-angle">立意：{t.angle}</p>}
          {t.source && <p className="th-angle dim">来源：{t.source}</p>}
        </div>
        <div className="th-actions">
          <button className="btn ghost small" onClick={() => setEditing(true)}>编辑</button>
          <button className="btn ghost small danger" onClick={remove}>删除</button>
        </div>
      </div>

      <div className="tabs">
        {[['materials', '资料区'], ['create', '创作'], ['qc', '质检'], ['versions', '版本'], ['archive', '归档']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'materials' && <Materials data={data} reload={load} notify={notify} />}
      {tab === 'create' && <CreateTab data={data} reload={load} notify={notify} llm={llm} />}
      {tab === 'qc' && <QcTab data={data} reload={load} notify={notify} />}
      {tab === 'versions' && <VersionsTab data={data} notify={notify} />}
      {tab === 'archive' && <ArchiveTab data={data} reload={load} notify={notify} />}

      {editing && form && (
        <Modal title="编辑选题" onClose={() => setEditing(false)} footer={
          <>
            <button className="btn ghost" onClick={() => setEditing(false)}>取消</button>
            <button className="btn primary" onClick={saveEdit}>保存</button>
          </>
        }>
          <Field label="选题名称" required><input value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="row2">
            <Field label="内容类型" hint="三平台共用">
              <select value={form.content_type} onChange={(e) => setForm({ ...form, content_type: e.target.value })}>
                <option value="">未设置</option>
                {['教程', '测评', '观点'].map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </Field>
            <Field label="优先级">
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}>
                <option value={1}>高</option><option value={2}>中</option><option value={3}>低</option>
              </select>
            </Field>
          </div>
          <Field label="立意"><textarea rows={2} maxLength={120} value={form.angle} onChange={(e) => setForm({ ...form, angle: e.target.value })} /></Field>
          <Field label="来源"><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
          <Field label="目标平台" hint="取消勾选会隐藏该平台稿件卡（已有版本时不删除）">
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
            <Field label="计划发布日"><input type="date" value={form.schedule_date || ''} onChange={(e) => setForm({ ...form, schedule_date: e.target.value })} /></Field>
            <Field label="状态" hint="仅可手动设为已搁置">
              <select value={form.status === '已搁置' ? '已搁置' : 'auto'} onChange={(e) => setForm({ ...form, status: e.target.value === '已搁置' ? '已搁置' : 'auto' })}>
                <option value="auto">自动推导（{t.status}）</option>
                <option value="已搁置">已搁置</option>
              </select>
            </Field>
          </div>
          <Field label="标签"><input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
        </Modal>
      )}
    </div>
  );
}

function Materials({ data, reload, notify }) {
  const [mode, setMode] = useState('paste');
  const [kind, setKind] = useState('fact');
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [url, setUrl] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState(null);
  const [snippets, setSnippets] = useState([]);
  const [snipQ, setSnipQ] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => { if (mode === 'snippet') api.get('/api/snippets').then(setSnippets).catch(() => {}); }, [mode]);

  const saveMaterial = async (payload) => {
    try {
      await api.post(`/api/topics/${data.topic.id}/materials`, payload);
      await reload();
      notify('资料已保存');
      return true;
    } catch (e) { notify(e.message, 'err'); return false; }
  };

  const addPaste = async () => {
    if (!content.trim()) return notify('内容为空', 'err');
    const ok = await saveMaterial({ kind, content, title, source_url: source });
    if (ok) { setContent(''); setTitle(''); }
  };

  const doFetch = async () => {
    if (!url.trim()) return notify('请输入链接', 'err');
    setFetching(true);
    setFetchResult(null);
    try {
      const r = await api.post('/api/fetch/url', { url });
      setFetchResult(r);
      if (r.ok) { setContent(r.text); setTitle(r.title); setSource(url); }
      else notify(`${r.category}：${r.error}`, 'err');
    } catch (e) { notify(e.message, 'err'); } finally { setFetching(false); }
  };

  const onFile = async (file) => {
    if (!file) return;
    const base64 = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.readAsDataURL(file);
    });
    try {
      const r = await api.post('/api/fetch/file', { name: file.name, base64 });
      setPreview({ ...r, name: file.name });
      if (r.ok && r.text) { setContent(r.text); setTitle(r.title || file.name); }
      else if (!r.ok) notify(`${r.category}：${r.error}`, 'err');
    } catch (e) { notify(e.message, 'err'); }
  };

  const groups = KINDS.map((k) => ({ kind: k, list: data.materials.filter((m) => m.kind === k) }));

  return (
    <div className="two-col">
      <div className="col">
        <div className="card">
          <div className="card-head">
            <h3>添加资料</h3>
            <Seg value={mode} onChange={setMode} options={[
              { value: 'paste', label: '粘贴文本' }, { value: 'link', label: '链接抓取' },
              { value: 'file', label: '导入文件' }, { value: 'snippet', label: '素材库' },
            ]} />
          </div>

          {mode === 'link' && (
            <div className="stack">
              <div className="inline">
                <input className="grow" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} />
                <button className="btn" disabled={fetching} onClick={doFetch}>{fetching ? '抓取中…' : '抓取正文'}</button>
              </div>
              <p className="hint">抓取失败会区分「需要登录 / 网络不可达 / 页面无正文 / 解析失败」，失败时手动粘贴即可。</p>
            </div>
          )}

          {mode === 'file' && (
            <div className="stack">
              <input type="file" accept=".txt,.md,.docx,.pdf,.png,.jpg,.jpeg" onChange={(e) => onFile(e.target.files?.[0])} />
              <p className="hint">支持 TXT / MD / DOCX / PDF；图片只登记不解析。超过 20MB 或 100 页会提示分段导入。</p>
            </div>
          )}

          {mode === 'snippet' && (
            <div className="stack">
              <input value={snipQ} placeholder="搜索素材" onChange={(e) => setSnipQ(e.target.value)} />
              <div className="snippet-list">
                {snippets.filter((s) => !snipQ || (s.text + s.tags).includes(snipQ)).map((s) => (
                  <div key={s.id} className="snippet-item">
                    <div className="si-text">{s.text.slice(0, 110)}</div>
                    <div className="si-meta">
                      <Pill>{KIND[s.kind]}</Pill>
                      {s.tags && <span className="dim">{s.tags}</span>}
                      <span className="dim">引用 {s.cite_count} 次</span>
                      <button className="btn ghost small" onClick={async () => {
                        try {
                          await api.post(`/api/snippets/${s.id}/cite`, { topic_id: data.topic.id });
                          await reload();
                          notify('已引用并快照到本选题');
                        } catch (e) { notify(e.message, 'err'); }
                      }}>引用</button>
                    </div>
                  </div>
                ))}
                {snippets.length === 0 && <p className="hint">素材库为空。资料条目右上角可「存入素材库」。</p>}
              </div>
            </div>
          )}

          {(mode === 'paste' || mode === 'link' || mode === 'file') && (
            <div className="stack">
              <div className="inline">
                <span className="mini-label">归入</span>
                <Seg value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: KIND[k] }))} />
              </div>
              <input value={title} placeholder="资料标题（可选）" onChange={(e) => setTitle(e.target.value)} />
              <input value={source} placeholder="来源链接 / 出处（事实类必填）" onChange={(e) => setSource(e.target.value)} />
              <textarea rows={7} value={content} placeholder="粘贴正文…" onChange={(e) => setContent(e.target.value)} />
              <div className="inline end">
                {content && <span className="dim">{content.length} 字符</span>}
                <button className="btn primary" onClick={addPaste}>保存资料</button>
              </div>
            </div>
          )}
        </div>

        {preview && !preview.ok && (
          <div className="card warn-card">
            <h4>{preview.name} 导入失败：{preview.category}</h4>
            <p>{preview.error}</p>
            <button className="btn ghost small" onClick={() => setPreview(null)}>知道了</button>
          </div>
        )}

        <div className="card">
          <div className="card-head"><h3>完整度</h3><span className="dim">{data.completeness.ready ? '资料已分类，可进创作' : '还有资料未分类'}</span></div>
          <div className="comp">
            {KINDS.map((k) => <div key={k} className="comp-item"><b>{data.completeness[k]}</b><span>{KIND[k]}</span></div>)}
          </div>
        </div>
      </div>

      <div className="col">
        {data.materials.length === 0 && <Empty>资料区为空。至少补 1 条事实，才能生成提示词。</Empty>}
        {groups.map((g) => g.list.length > 0 && (
          <div key={g.kind} className="mat-group">
            <h4>{KIND[g.kind]}<span className="dim">（{g.list.length}）</span></h4>
            {g.list.map((m) => (
              <div key={m.id} className="mat-item">
                <div className="mi-head">
                  <div className="mi-title">{m.title || m.content.split('\n')[0].slice(0, 40) || '未命名'}</div>
                  <div className="mi-acts">
                    <select value={m.kind} onChange={async (e) => {
                      await api.patch(`/api/materials/${m.id}`, { kind: e.target.value });
                      await reload();
                    }}>
                      {KINDS.map((k) => <option key={k} value={k}>{KIND[k]}</option>)}
                    </select>
                    <button className="icon-btn" title="存入素材库" onClick={async () => {
                      try { await api.post(`/api/materials/${m.id}/to-snippet`, {}); notify('已存入素材库'); } catch (e) { notify(e.message, 'err'); }
                    }}>☆</button>
                    <button className="icon-btn" title="删除" onClick={async () => {
                      if (!confirm('删除这条资料？')) return;
                      await api.del(`/api/materials/${m.id}`);
                      await reload();
                    }}>✕</button>
                  </div>
                </div>
                <p className="mi-content">{m.content.slice(0, 260)}{m.content.length > 260 ? '…' : ''}</p>
                <div className="mi-meta">
                  {m.source_url ? <a href={m.source_url} target="_blank" rel="noreferrer">{m.source_url.slice(0, 48)}</a> : <span className="dim">无出处</span>}
                  <span className="dim">{fmtTime(m.created_at)}</span>
                  {m.snippet && <Pill tone="green">来自素材库</Pill>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
