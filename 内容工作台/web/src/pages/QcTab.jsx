import React, { useEffect, useState } from 'react';
import { api, PLATFORM, LEVEL, fmtTime } from '../api.js';
import { Empty, Pill, CopyBtn, StatusDot } from '../components.jsx';

const GATES = [
  { n: 1, name: '① 结构' },
  { n: 2, name: '② 去 AI 味' },
  { n: 3, name: '③ 转化与收尾' },
  { n: 4, name: '④ 违禁词与红线' },
];

export default function QcTab({ data, reload, notify }) {
  const { drafts } = data;
  const [platform, setPlatform] = useState(drafts[0]?.platform || 'douyin');
  const draft = drafts.find((d) => d.platform === platform);
  const [detail, setDetail] = useState(null);
  const [running, setRunning] = useState(false);
  const [viewVersion, setViewVersion] = useState(null);

  const load = async () => {
    if (!draft) return;
    try {
      const d = await api.get(`/api/drafts/${draft.id}`);
      setDetail(d);
      setViewVersion(d.current?.id || null);
    } catch (e) { notify(e.message, 'err'); }
  };
  useEffect(() => { load(); }, [platform, draft?.id]);

  const run = async () => {
    if (!detail?.current) return notify('还没有正文版本', 'err');
    setRunning(true);
    try {
      const r = await api.post(`/api/versions/${detail.current.id}/qc`);
      await load();
      await reload();
      notify(r.report.conclusion === 'block' ? '质检完成：存在阻断项' : r.report.conclusion === 'warn' ? '质检完成：有建议项' : '质检完成：通过', r.report.conclusion === 'block' ? 'err' : 'ok');
    } catch (e) { notify(e.message, 'err'); } finally { setRunning(false); }
  };

  if (!draft) return <Empty>该选题没有此平台稿件。</Empty>;

  if (!detail?.current) return <Empty>还没有正文版本，先到「创作」生成一版。</Empty>;

  const version = viewVersion === detail.current.id ? detail.current : detail.versions.find((v) => v.id === viewVersion);
  const isCurrent = version?.id === detail.current.id;
  const report = isCurrent ? detail.current.qc : null;

  const ignore = async (item) => {
    const reason = window.prompt(`忽略「${item.rule} ${item.title}」的理由（会记录）`);
    if (!reason) return;
    try {
      await api.post(`/api/qc/${report.id}/ignore`, { rule_id: item.rule, evidence: item.evidence, reason });
      await load();
      await reload();
      notify('已忽略并记录理由');
    } catch (e) { notify(e.message, 'err'); }
  };

  const copyList = () => {
    const head = `# ${data.topic.name} · ${PLATFORM[platform].label} · v${detail.current.version_no}\n质检结论：${report.conclusion}\n`;
    const body = report.items.map((it) => `[${LEVEL[it.level].label}] ${it.rule} ${it.title}\n  位置：${it.location}\n  证据：${it.evidence}\n  建议：${it.suggestion}`).join('\n\n');
    return head + '\n' + body;
  };

  return (
    <div className="two-col wide-left">
      <div className="col">
        <div className="card">
          <div className="card-head"><h3>选择稿件</h3></div>
          <div className="draft-list">
            {drafts.map((d) => (
              <button key={d.id} className={`draft-row ${d.platform === platform ? 'on' : ''}`} onClick={() => setPlatform(d.platform)}>
                <span className={`plat-dot ${d.platform}`}>{PLATFORM[d.platform]?.label}</span>
                <span className="dr-form">{d.qc ? (d.qc.conclusion === 'block' ? '有阻断' : d.qc.conclusion === 'warn' ? '有建议' : '通过') : '未质检'}</span>
                <span className="dr-status"><StatusDot status={d.status} />{d.status}</span>
                <span className="dr-ver">{d.current_version ? `v${d.current_version.version_no}` : '—'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>版本</h3></div>
          <div className="ver-mini">
            {detail.versions.map((v) => (
              <button key={v.id} className={`vm-row ${viewVersion === v.id ? 'on' : ''}`} onClick={() => setViewVersion(v.id)}>
                <span className="vm-no">v{v.version_no}</span>
                <span className="vm-time">{fmtTime(v.created_at)}</span>
                <span className={`vm-qc ${v.qc?.conclusion || ''}`}>{v.qc ? (v.qc.conclusion === 'block' ? '阻断' : v.qc.conclusion === 'warn' ? '建议' : '通过') : '未质检'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>执行</h3></div>
          <div className="stack">
            <p className="hint">四闸顺序固定：结构 → 去 AI 味 → 转化收尾 → 违禁词。结构未通过时不跑后三闸。</p>
            <button className="btn primary" disabled={running || !isCurrent} onClick={run}>{running ? '质检中…' : '对新版本跑质检'}</button>
            {report && <CopyBtn text={copyList()} label="复制问题清单" />}
          </div>
        </div>
      </div>

      <div className="col">
        {!report ? (
          <Empty>{isCurrent ? '这个版本还没有质检报告。点左侧「跑质检」。' : '历史版本没有绑定报告，选择当前版本查看。'}</Empty>
        ) : (
          <>
            <div className={`qc-summary ${report.conclusion}`}>
              <div className="qs-main">
                <b>{report.conclusion === 'block' ? '存在阻断项' : report.conclusion === 'warn' ? '通过，但有建议' : '全部通过'}</b>
                <span className="dim">{fmtTime(report.created_at)} · 规则 {report.rules_fingerprint}{report.stale ? ' · 规则已变更' : ''}</span>
              </div>
              <div className="qs-nums">
                <span className="block">阻断 {report.stats?.block || 0}</span>
                <span className="suggest">建议 {report.stats?.suggest || 0}</span>
                <span className="info">提示 {report.stats?.info || 0}</span>
              </div>
            </div>

            {GATES.map((g) => {
              const items = report.items.filter((it) => it.gate === g.n);
              return (
                <div key={g.n} className="gate">
                  <div className="gate-head">
                    <h4>{g.name}</h4>
                    <span className="dim">{items.length} 条</span>
                  </div>
                  {items.length === 0 ? <p className="hint">无问题</p> : items.map((it, i) => (
                    <div key={i} className={`qc-item ${it.level}`}>
                      <div className="qi-head">
                        <span className={`lv ${LEVEL[it.level].cls}`}>{LEVEL[it.level].label}</span>
                        <span className="qi-rule">{it.rule}</span>
                        <span className="qi-title">{it.title}</span>
                        {it.needsReview && <Pill tone="amber">需人工判定</Pill>}
                        <span className="qi-loc">{it.location}</span>
                      </div>
                      {it.evidence && <div className="qi-evidence">{it.evidence}</div>}
                      {it.suggestion && <div className="qi-suggest">→ {it.suggestion}</div>}
                      <div className="qi-foot">
                        <button className="link" onClick={() => ignore(it)}>忽略并填理由</button>
                        <CopyBtn text={`${it.rule} ${it.title}\n位置：${it.location}\n证据：${it.evidence}\n建议：${it.suggestion}`} label="复制这条" />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
            <p className="disclaimer">质检只能发现本方案列出的可判定问题，不能识别所有违规内容，也不保证平台审核通过。违禁词命中只代表「必审」。</p>
          </>
        )}
      </div>
    </div>
  );
}
