import React, { useState } from 'react';
import { api, PLATFORM, fmtTime } from '../api.js';
import { Empty, Pill, Modal } from '../components.jsx';

export default function ArchiveTab({ data, reload, notify }) {
  const { drafts, topic, archives } = data;
  const [conflict, setConflict] = useState(null);
  const [busy, setBusy] = useState(false);

  const doArchive = async (draft, mode, createDir = false) => {
    const vid = draft.current_version?.id;
    if (!vid) return notify('该平台还没有版本', 'err');
    setBusy(true);
    try {
      const r = await api.post(`/api/versions/${vid}/archive`, { mode, createDir });
      notify(r.message || `已写入 ${r.path}`);
      setConflict(null);
      await reload();
    } catch (e) {
      const p = e.payload || {};
      if (p.status === 'need-dir') {
        if (confirm(`Obsidian 目录不存在：\n${p.dir}\n\n现在创建？`)) return doArchive(draft, mode, true);
        notify('已取消归档', 'err');
      } else if (p.status === 'conflict') {
        setConflict({ draft, ...p });
      } else notify(e.message, 'err');
    } finally { setBusy(false); }
  };

  return (
    <div className="two-col">
      <div className="col">
        {drafts.map((d) => (
          <div key={d.id} className="card">
            <div className="card-head">
              <h3><span className={`plat-dot ${d.platform}`}>{PLATFORM[d.platform]?.label}</span> 归档</h3>
              <Pill tone={d.archived ? 'green' : 'gray'}>{d.archived ? '已归档' : '未归档'}</Pill>
            </div>
            <div className="stack">
              <div className="dim">
                当前版本：{d.current_version ? `v${d.current_version.version_no}` : '—'} ·
                质检：{d.qc ? (d.qc.conclusion === 'block' ? '有阻断（不可归档）' : d.qc.conclusion === 'warn' ? '有建议（可归档）' : '通过') : '未质检'}
              </div>
              {d.archived ? (
                <div className="arch-path">{d.archived.path}<div className="dim">{fmtTime(d.archived.created_at)}</div></div>
              ) : null}
              <button className="btn primary small" disabled={busy || !d.current_version || d.qc?.conclusion === 'block' || !d.qc}
                onClick={() => doArchive(d, 'abort')}>
                {d.archived ? '重新写入（校验指纹）' : '归档到 Obsidian'}
              </button>
              {!d.qc && <p className="hint">先完成质检才能归档。</p>}
              {d.qc?.conclusion === 'block' && <p className="hint err-text">有阻断项，处理或忽略后才可归档。</p>}
            </div>
          </div>
        ))}

        <div className="card">
          <div className="card-head"><h3>归档记录</h3></div>
          {archives.length === 0 ? <p className="hint">还没有归档记录。</p> : archives.map((a) => (
            <div key={a.id} className="arch-row">
              <div className="arch-path">{a.path}</div>
              <div className="dim">{fmtTime(a.created_at)} · 指纹 {a.fingerprint}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="col">
        <div className="card">
          <div className="card-head"><h3>写入规则</h3></div>
          <ul className="rules-list">
            <li>应用是唯一真相源，Obsidian 里的文件是成品副本。</li>
            <li>写入 <code>内容工作台/02-稿件/&lt;选题&gt;/</code>，同名文件带版本号。</li>
            <li>每次写入校验文件指纹：本地被手改过就中止，让你选覆盖 / 另存 / 中止。</li>
            <li>同时更新 <code>00-索引/选题索引.md</code> 与 <code>03-排期/周.md</code>。</li>
            <li>不写回旧的「抖音视频账号分析」库。</li>
          </ul>
        </div>
        <div className="card">
          <div className="card-head"><h3>选题信息</h3></div>
          <div className="kv">
            <span>选题ID</span><b>{topic.id}</b>
            <span>内容类型</span><b>{topic.content_type || '未设置'}</b>
            <span>账号</span><b>{topic.account}</b>
            <span>排期</span><b>{topic.schedule_date || '待排期'}</b>
            <span>标签</span><b>{topic.tags || '—'}</b>
          </div>
        </div>
      </div>

      {conflict && (
        <Modal title="文件已被手改，指纹不一致" width={680} onClose={() => setConflict(null)} footer={<button className="btn ghost" onClick={() => setConflict(null)}>取消</button>}>
          <p>本地文件：</p>
          <pre className="pre">{conflict.path}</pre>
          <div className="kv">
            <span>本地指纹</span><b>{conflict.localFingerprint}</b>
            <span>应用指纹</span><b>{conflict.appFingerprint}</b>
          </div>
          <p className="hint">覆盖会用应用内容替换本地改动；另存会写一个带序号的新文件，不覆盖你手改的版本。</p>
          <div className="inline">
            <button className="btn primary" onClick={() => doArchive(conflict.draft, 'overwrite')}>覆盖（以应用为准）</button>
            <button className="btn" onClick={() => doArchive(conflict.draft, 'new-file')}>另存新文件</button>
            <button className="btn ghost" onClick={() => setConflict(null)}>中止（保留手改）</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
