import React, { useEffect, useMemo, useState } from 'react';
import { api, PLATFORM, fmtTime } from '../api.js';
import { Empty, Pill } from '../components.jsx';

function lcsDiff(aArr, bArr) {
  const n = aArr.length, m = bArr.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = aArr[i] === bArr[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aArr[i] === bArr[j]) { rows.push({ type: 'same', a: aArr[i], b: bArr[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', a: aArr[i] }); i++; }
    else { rows.push({ type: 'add', b: bArr[j] }); j++; }
  }
  while (i < n) { rows.push({ type: 'del', a: aArr[i] }); i++; }
  while (j < m) { rows.push({ type: 'add', b: bArr[j] }); j++; }
  return rows;
}

const para = (t) => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

export default function VersionsTab({ data, notify }) {
  const { drafts } = data;
  const [platform, setPlatform] = useState(drafts[0]?.platform || 'douyin');
  const draft = drafts.find((d) => d.platform === platform);
  const [detail, setDetail] = useState(null);
  const [left, setLeft] = useState(null);
  const [right, setRight] = useState(null);
  const [rawLeft, setRawLeft] = useState('');
  const [rawRight, setRawRight] = useState('');
  const [view, setView] = useState('diff');

  const load = async () => {
    if (!draft) return;
    try {
      const d = await api.get(`/api/drafts/${draft.id}`);
      setDetail(d);
      const v = d.versions;
      if (v.length) {
        setLeft(v[1]?.id || v[0].id);
        setRight(v[0].id);
      } else { setLeft(null); setRight(null); }
    } catch (e) { notify(e.message, 'err'); }
  };
  useEffect(() => { load(); }, [platform, draft?.id]);

  useEffect(() => {
    if (!detail) return;
    const loadRaw = async (vid, setter) => {
      if (!vid) return setter('');
      const r = await api.get(`/api/versions/${vid}`);
      setter(r.raw_text || '');
    };
    loadRaw(left, setRawLeft);
    loadRaw(right, setRawRight);
  }, [left, right, detail]);

  if (!draft) return <Empty>该选题没有此平台稿件。</Empty>;

  const rows = useMemo(() => (view === 'diff' ? lcsDiff(para(rawLeft), para(rawRight)) : []), [rawLeft, rawRight, view]);
  const changed = rows.filter((r) => r.type !== 'same').length;

  return (
    <div className="stack-page">
      <div className="card">
        <div className="card-head">
          <h3>版本</h3>
          <div className="checks">
            {drafts.map((d) => (
              <label key={d.id} className="check">
                <input type="radio" checked={platform === d.platform} onChange={() => setPlatform(d.platform)} />
                {PLATFORM[d.platform]?.label}
              </label>
            ))}
          </div>
        </div>
        {!detail?.versions.length ? <Empty>还没有版本。</Empty> : (
          <>
            <div className="ver-table">
              <div className="vt-head">
                <span>版本</span><span>时间</span><span>来源</span><span>字数</span><span>质检</span><span>对比</span>
              </div>
              {detail.versions.map((v) => (
                <div key={v.id} className="vt-row">
                  <span className="vm-no">v{v.version_no} {v.id === detail.current?.id && <b className="cur">当前</b>}</span>
                  <span>{fmtTime(v.created_at)}</span>
                  <span>{v.origin === 'generated' ? '生成' : v.origin === 'rollback' ? '回滚' : '人工'}</span>
                  <span>{v.chars || '—'}</span>
                  <span className={`vm-qc ${v.qc?.conclusion || ''}`}>{v.qc ? (v.qc.conclusion === 'block' ? '阻断' : v.qc.conclusion === 'warn' ? '建议' : '通过') : '未质检'}</span>
                  <span className="vt-diff">
                    <label className="check"><input type="radio" name="l" checked={left === v.id} onChange={() => setLeft(v.id)} />左</label>
                    <label className="check"><input type="radio" name="r" checked={right === v.id} onChange={() => setRight(v.id)} />右</label>
                    {v.id !== detail.current?.id && (
                      <button className="link" onClick={async () => {
                        if (!confirm(`回滚到 v${v.version_no}？回滚也会产生一个新版本。`)) return;
                        await api.post(`/api/drafts/${draft.id}/rollback`, { version_id: v.id });
                        await load();
                        notify('已生成回滚版本');
                      }}>回滚</button>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <div className="inline" style={{ marginTop: 12 }}>
              <button className={`btn small ${view === 'diff' ? 'primary' : 'ghost'}`} onClick={() => setView('diff')}>并排对比</button>
              <button className={`btn small ${view === 'a' ? 'primary' : 'ghost'}`} onClick={() => setView('a')}>只看左</button>
              <button className={`btn small ${view === 'b' ? 'primary' : 'ghost'}`} onClick={() => setView('b')}>只看右</button>
              {view === 'diff' && <span className="dim">差异 {changed} 处（段落级）</span>}
            </div>
          </>
        )}
      </div>

      {detail?.versions.length > 0 && view === 'diff' && (
        <div className="card">
          <div className="card-head"><h3>对比</h3><span className="dim">左 v{detail.versions.find((v) => v.id === left)?.version_no} ↔ 右 v{detail.versions.find((v) => v.id === right)?.version_no}</span></div>
          <div className="diff">
            {rows.map((r, i) => (
              r.type === 'same' ? (
                <div key={i} className="diff-row same"><div className="d-cell">{r.a}</div><div className="d-cell">{r.b}</div></div>
              ) : r.type === 'del' ? (
                <div key={i} className="diff-row"><div className="d-cell del">{r.a}</div><div className="d-cell" /></div>
              ) : (
                <div key={i} className="diff-row"><div className="d-cell" /><div className="d-cell add">{r.b}</div></div>
              )
            ))}
          </div>
        </div>
      )}

      {view !== 'diff' && (
        <div className="card">
          <pre className="raw-text">{view === 'a' ? rawLeft : rawRight}</pre>
        </div>
      )}
    </div>
  );
}
