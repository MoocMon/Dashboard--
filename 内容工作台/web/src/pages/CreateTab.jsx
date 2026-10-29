import React, { useEffect, useState } from 'react';
import { api, PLATFORM, fmtTime, LEVEL } from '../api.js';
import { Modal, Field, Pill, CopyBtn, Empty, StatusDot, HighlightedText } from '../components.jsx';

function parseOutlineSections(text) {
  const out = {};
  const re = /^#{2,4}\s*(.+)$/gm;
  const heads = [];
  let m;
  while ((m = re.exec(text))) heads.push({ title: m[1].trim(), start: m.index + m[0].length });
  heads.forEach((h, i) => {
    const body = text.slice(h.start, i + 1 < heads.length ? heads[i + 1].start : text.length).trim();
    const k = /钩子/.test(h.title) ? 'hook'
      : /核心论点|论点/.test(h.title) ? 'thesis'
        : /结构/.test(h.title) ? 'structure'
          : /假设|待验证/.test(h.title) ? 'assumptions'
            : /发布文案/.test(h.title) ? 'post_copy'
              : /封面/.test(h.title) ? 'cover_copy' : null;
    if (k && !out[k]) out[k] = body;
  });
  if (out.hook) {
    const first = out.hook.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
    out.hook = first.replace(/^\d+[.、)]\s*/, '').replace(/[｜|]\s*命中[:：].*$/, '').trim();
  }
  for (const k of ['thesis', 'post_copy', 'cover_copy']) if (out[k]) out[k] = out[k].split('\n')[0].trim();
  return out;
}

export default function CreateTab({ data, reload, notify, llm }) {
  const { topic, drafts, outline, materials } = data;
  const [platform, setPlatform] = useState(drafts[0]?.platform || 'douyin');
  const draft = drafts.find((d) => d.platform === platform);
  const [detail, setDetail] = useState(null);
  const [promptModal, setPromptModal] = useState(null);
  const [outlineModal, setOutlineModal] = useState(false);
  const [editor, setEditor] = useState(null);
  const [qcResult, setQcResult] = useState(null);
  const [more, setMore] = useState(false);
  const [generating, setGenerating] = useState(null);  // 'outline' | 'script' | 'draft' | null

  const loadDetail = async () => {
    if (!draft) { setDetail(null); return; }
    try { setDetail(await api.get(`/api/drafts/${draft.id}`)); } catch (e) { notify(e.message, 'err'); }
  };
  useEffect(() => { loadDetail(); setQcResult(null); setEditor(null); }, [platform, draft?.id]);

  if (!draft) return <Empty>该选题没有此平台稿件。</Empty>;

  const hasMaterials = materials.length > 0;

  const openPrompt = async (kind) => {
    try {
      const r = await api.post(`/api/drafts/${draft.id}/prompt`, { kind, node: {} });
      setPromptModal({ kind, ...r, fill: '' });
    } catch (e) { notify(e.message, 'err'); }
  };

  const aiGenerate = async (kind) => {
    if (!llm?.enabled) {
      notify('AI 自动出稿未启用，请到「设置 → LLM 自动生成」开启并填 API Key', 'err');
      return;
    }
    setGenerating(kind);
    try {
      if (kind === 'outline') {
        // 大纲独立路由，存进 outlines 表，不碰 draft versions
        const r = await api.post(`/api/topics/${topic.id}/outline/generate`);
        notify(`大纲已生成：${r.outline.hook ? '有钩子' : ''}${r.outline.thesis ? ' · 有论点' : ''}，请确认方向`);
        await reload();
      } else {
        // 稿件走原有 generate 路由
        const r = await api.post(`/api/drafts/${draft.id}/generate`, { kind });
        const label = kind === 'script' ? '分镜脚本' : `${PLATFORM[platform].label}正文`;
        if (r.saved) {
          notify(`${label}已生成并保存为 v${r.version_no}${r.structure?.ok ? '' : '（结构未通过）'}`);
          await loadDetail();
          await reload();
        } else {
          notify(`${label}已生成（未自动保存）`);
          setEditor(r.text);
        }
      }
    } catch (e) {
      notify(e.message, 'err');
    } finally {
      setGenerating(null);
    }
  };

  const saveVersion = async (raw, extra = {}) => {
    try {
      const r = await api.post(`/api/drafts/${draft.id}/versions`, { raw_text: raw, origin: extra.origin || 'generated', prompt_snapshot: extra.snapshot || '' });
      notify(`已保存 v${r.version.version_no}${r.structure.ok ? '，结构通过' : '，结构未通过'}`);
      setPromptModal(null);
      await loadDetail();
      await reload();
      return r;
    } catch (e) { notify(e.message, 'err'); return null; }
  };

  const runQc = async () => {
    const v = detail?.current;
    if (!v) return notify('还没有正文版本', 'err');
    try {
      const r = await api.post(`/api/versions/${v.id}/qc`);
      setQcResult(r.report);
      await loadDetail();
      notify(r.report.conclusion === 'block' ? '质检完成：存在阻断项' : r.report.conclusion === 'warn' ? '质检完成：有建议项' : '质检完成：通过', r.report.conclusion === 'block' ? 'err' : 'ok');
    } catch (e) { notify(e.message, 'err'); }
  };

  const [repairing, setRepairing] = useState(false);
  const aiRepair = async () => {
    const v = detail?.current;
    if (!v) return notify('还没有正文版本', 'err');
    if (!v.qc) return notify('先跑一次质检才能修', 'err');
    if (!llm?.enabled) return notify('AI 自动修复需要先启用 LLM（设置页）', 'err');
    setRepairing(true);
    try {
      const r = await api.post(`/api/versions/${v.id}/repair`, { rounds: 3 });
      const prevQc = v.qc;
      const newQc = r.qc;
      const improved = (prevQc?.stats?.block || 0) - (newQc?.stats?.block || 0);
      const sugImproved = (prevQc?.stats?.suggest || 0) - (newQc?.stats?.suggest || 0);
      setQcResult(newQc);
      await loadDetail();
      await reload();
      const rounds = (r.rounds || []).filter((x) => x.block !== undefined).length;
      const parts = [`v${r.version.version_no} 已生成`, `${rounds} 轮`];
      if (improved > 0) parts.push(`阻断 -${improved}`);
      else if (newQc.stats.block > 0) parts.push(`仍有阻断 ${newQc.stats.block}`);
      if (sugImproved > 0) parts.push(`建议 -${sugImproved}`);
      notify(parts.join(' · ') + (newQc.conclusion === 'pass' ? ' ✅ 通过' : ''), newQc.conclusion === 'block' ? 'err' : 'ok');
    } catch (e) {
      notify(e.message, 'err');
      await loadDetail();
    } finally { setRepairing(false); }
  };

  const saveEdit = async () => {
    const v = detail?.current;
    if (!v) return;
    try {
      const r = await api.put(`/api/versions/${v.id}`, { raw_text: editor });
      notify(`已保存 v${r.version.version_no}${r.structure.ok ? '' : '（结构未通过）'}`);
      setEditor(null);
      await loadDetail();
      await reload();
    } catch (e) { notify(e.message, 'err'); }
  };

  return (
    <div className="two-col wide-left">
      <div className="col">
        <div className="card">
          <div className="card-head"><h3>平台稿件</h3><span className="dim">同一份资料，三次重组</span></div>
          <div className="draft-list">
            {drafts.map((d) => (
              <button key={d.id} className={`draft-row ${d.platform === platform ? 'on' : ''}`} onClick={() => setPlatform(d.platform)}>
                <span className={`plat-dot ${d.platform}`}>{PLATFORM[d.platform]?.label}</span>
                <span className="dr-form">{PLATFORM[d.platform]?.form}</span>
                <span className="dr-status"><StatusDot status={d.status} />{d.status}</span>
                <span className="dr-ver">{d.current_version ? `v${d.current_version.version_no}` : '—'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>生成条件</h3></div>
          <ul className="cond">
            <li className={hasMaterials ? 'ok' : 'bad'}>{hasMaterials ? `资料 ${materials.length} 条` : '资料区为空，禁止生成'}</li>
            <li className={topic.content_type ? 'ok' : 'bad'}>{topic.content_type ? `内容类型：${topic.content_type}` : '未设内容类型，T 规则不跑'}</li>
            {platform === 'douyin' && <li className={outline?.status === 'confirmed' ? 'ok' : 'bad'}>{outline?.status === 'confirmed' ? '大纲已确认方向' : '抖音需先确认大纲'}</li>}
            <li className="ok">账号：{topic.account || 'AKA张猩猩'}</li>
          </ul>
        </div>

        {platform === 'douyin' && (
          <div className="card">
            <div className="card-head">
              <h3>大纲</h3>
              {outline && <Pill tone={outline.status === 'confirmed' ? 'green' : outline.status === 'rejected' ? 'red' : 'amber'}>{outline.status === 'confirmed' ? '已确认' : outline.status === 'rejected' ? '已否' : '待确认'}</Pill>}
            </div>
            {!outline ? (
              <div className="stack">
                <p className="hint">抖音必须先出大纲，人工确认方向后才能写分镜。</p>
                <div className="inline">
                  <button className="btn primary" disabled={!hasMaterials || generating} onClick={() => aiGenerate('outline')}>
                    {generating === 'outline' ? '生成中…' : llm?.enabled ? 'AI 一键出大纲' : 'AI 一键出大纲（未启用）'}
                  </button>
                  <button className="btn ghost" disabled={!hasMaterials || generating} onClick={() => openPrompt('outline')}>提示词工作流</button>
                </div>
              </div>
            ) : (
              <div className="stack outline-box">
                <div><span className="mini-label">钩子</span><p>{outline.hook}</p></div>
                <div><span className="mini-label">核心论点</span><p>{outline.thesis}</p></div>
                {outline.structure && <div><span className="mini-label">结构</span><pre className="pre">{outline.structure}</pre></div>}
                {outline.assumptions && <div><span className="mini-label">待验证</span><pre className="pre">{outline.assumptions}</pre></div>}
                <div className="inline">
                  <span className="dim">发布文案：{outline.post_copy || '—'}</span>
                  <span className="dim">封面：{outline.cover_copy || '—'}</span>
                </div>
                {outline.status === 'rejected' && <p className="err-text">已否：{outline.reject_reason}</p>}
                <div className="inline">
                  {outline.status !== 'confirmed' && (
                    <>
                      <button className="btn primary small" onClick={async () => {
                        await api.patch(`/api/outlines/${outline.id}`, { status: 'confirmed' });
                        await reload(); notify('方向已确认，可以生成分镜');
                      }}>确认方向</button>
                      <button className="btn ghost small" onClick={async () => {
                        const reason = window.prompt('否掉这个方向的原因（会留在记录里）');
                        if (!reason) return;
                        await api.patch(`/api/outlines/${outline.id}`, { status: 'rejected', reject_reason: reason });
                        await reload(); notify('已记录否定原因');
                      }}>否掉</button>
                    </>
                  )}
                  <button className="btn ghost small" onClick={() => setOutlineModal(true)}>手工填 / 改大纲</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="col">
        <div className="card">
          <div className="card-head">
            <div className="inline">
              <h3>{PLATFORM[platform].label} · {PLATFORM[platform].form}</h3>
              {detail?.current && <span className="dim">v{detail.current.version_no} · {fmtTime(detail.current.created_at)} · {detail.current.origin === 'generated' ? '生成' : detail.current.origin === 'rollback' ? '回滚' : '人工'}</span>}
            </div>
            <div className="inline">
              <button className="btn ghost small" onClick={() => setMore(!more)}>更多设置</button>
              <button className="btn primary small" disabled={!hasMaterials || generating} onClick={() => aiGenerate(platform === 'douyin' ? 'script' : 'draft')}>
                {generating ? '生成中…' : llm?.enabled ? 'AI 一键出稿' : 'AI 一键出稿（未启用）'}
              </button>
              <button className="btn small" disabled={!hasMaterials || generating} onClick={() => openPrompt(platform === 'douyin' ? 'script' : 'draft')}>
                {detail?.current ? '手动再写一版' : '手动提示词'}
              </button>
            </div>
          </div>

          {more && (
            <div className="more-box">
              <label className="check"><input type="checkbox" checked={!!draft.ad} onChange={async (e) => {
                await api.patch(`/api/drafts/${draft.id}`, { ad: e.target.checked }); await loadDetail(); await reload();
              }} />投流（勾选后 CTA 改为禁互动引导）</label>
              <label className="check"><input type="checkbox" checked={!!draft.sponsor} onChange={async (e) => {
                await api.patch(`/api/drafts/${draft.id}`, { sponsor: e.target.checked }); await loadDetail(); await reload();
              }} />商单（互动引导需附风险报批标记）</label>
              <p className="hint">默认只按自然流量口径判定。</p>
            </div>
          )}

          {detail?.current ? (
            <div className="stack">
              {detail.current.structure && !detail.current.structure.ok && (
                <div className="struct-warn">
                  <b>结构未通过：</b>
                  {detail.current.structure.problems.map((p, i) => <div key={i}>· {p.message}</div>)}
                  <div className="dim">已识别：{detail.current.structure.recognized.join(' / ') || '无'}</div>
                </div>
              )}
              {detail.current.parsed?.chars > 0 && (
                <div className="metrics">
                  <span>{detail.current.parsed.chars} 字</span>
                  {platform === 'douyin' && <span>约 {Math.round(detail.current.parsed.chars / 7)} 秒</span>}
                  {platform === 'douyin' && <span>{detail.current.parsed.scenes?.length || 0} 场</span>}
                  {platform === 'xhs' && <span>{detail.current.parsed.images?.length || 0} 张配图 / {detail.current.parsed.tags?.length || 0} 标签</span>}
                  {platform === 'wechat' && <span>{detail.current.parsed.chapters?.length || 0} 章</span>}
                </div>
              )}

              {editor === null ? (
                <>
                  {(() => {
                    const items = (detail.current.qc?.items || []).filter((it) => it.level !== 'info');
                    const nb = items.filter((it) => it.level === 'block').length;
                    const ns = items.filter((it) => it.level === 'suggest').length;
                    return (
                      <>
                        {items.length > 0 && (
                          <div className="hl-legend">
                            <span className="hl-tag block">阻断 {nb}</span>
                            <span className="hl-tag suggest">建议 {ns}</span>
                            <span className="dim">正文里标色的句子就是质检点名的问题句</span>
                          </div>
                        )}
                        <HighlightedText text={detail.current.raw_text} items={items} />
                      </>
                    );
                  })()}
                  <div className="inline">
                    <button className="btn ghost small" onClick={() => setEditor(detail.current.raw_text)}>编辑</button>
                    <button className="btn small" onClick={runQc}>跑质检</button>
                    <button
                      className="btn primary small"
                      onClick={aiRepair}
                      disabled={repairing || !detail.current.qc || detail.current.qc.conclusion === 'pass'}
                      title={!detail.current.qc ? '先跑一次质检' : detail.current.qc.conclusion === 'pass' ? '已经通过，不用修' : '让 AI 按质检问题修复'}
                    >{repairing ? 'AI 修复中…' : '🤖 AI 自动修复'}</button>
                    <CopyBtn text={detail.current.raw_text} label="复制正文" />
                    <span className={`qc-mini ${detail.current.qc?.conclusion || ''}`}>
                      {detail.current.qc ? `上次质检：${detail.current.qc.conclusion === 'block' ? '有阻断' : detail.current.qc.conclusion === 'warn' ? '有建议' : '通过'}` : '未质检'}
                    </span>
                  </div>
                </>
              ) : (
                <div className="stack">
                  <textarea className="editor" rows={22} value={editor} onChange={(e) => setEditor(e.target.value)} />
                  <div className="inline end">
                    <span className="dim">{editor.length} 字符</span>
                    <button className="btn ghost small" onClick={() => setEditor(null)}>取消</button>
                    <button className="btn primary small" onClick={saveEdit}>保存为新版本</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="stack">
              <Empty>{platform === 'douyin' ? '还没有分镜脚本。先确认大纲，再生成提示词。' : '还没有内容。点右上角生成提示词，复制到外部 AI，再把结果贴回来。'}</Empty>
              <button className="btn ghost small" onClick={() => setEditor('')}>手工写一版</button>
              {editor === '' && (
                <div className="stack">
                  <textarea className="editor" rows={18} value={''} onChange={(e) => setEditor(e.target.value)} placeholder="按输出格式手写，例如 ## 标题 / ## 正文 …" />
                  <div className="inline end">
                    <button className="btn ghost small" onClick={() => setEditor(null)}>取消</button>
                    <button className="btn primary small" onClick={() => saveVersion(editor, { origin: 'manual' })}>保存版本</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {qcResult && (
            <div className="qc-inline">
              <div className="card-head">
                <h4>本次质检：{qcResult.conclusion === 'block' ? '有阻断' : qcResult.conclusion === 'warn' ? '有建议' : '通过'}</h4>
                <span className="dim">{qcResult.stats.total} 条 · 阻断 {qcResult.stats.block || 0} / 建议 {qcResult.stats.suggest || 0} / 提示 {qcResult.stats.info || 0}</span>
              </div>
              {qcResult.items.slice(0, 6).map((it, i) => (
                <div key={i} className="qc-line">
                  <span className={`lv ${LEVEL[it.level].cls}`}>{LEVEL[it.level].label}</span>
                  <span className="ql-name">{it.rule} {it.title}</span>
                  <span className="ql-loc">{it.location}</span>
                </div>
              ))}
              {qcResult.items.length > 6 && <p className="hint">还有 {qcResult.items.length - 6} 条，到「质检」页处理。</p>}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head"><h3>版本记录</h3></div>
          {detail?.versions?.length ? (
            <div className="ver-mini">
              {detail.versions.slice(0, 6).map((v) => (
                <div key={v.id} className="vm-row">
                  <span className="vm-no">v{v.version_no}</span>
                  <span className="vm-time">{fmtTime(v.created_at)}</span>
                  <span className="vm-origin">{v.origin === 'generated' ? '生成' : v.origin === 'rollback' ? '回滚' : '人工'}</span>
                  <span className={`vm-qc ${v.qc?.conclusion || ''}`}>{v.qc ? (v.qc.conclusion === 'block' ? '阻断' : v.qc.conclusion === 'warn' ? '建议' : '通过') : '—'}</span>
                </div>
              ))}
            </div>
          ) : <p className="hint">暂无版本</p>}
        </div>
      </div>

      {promptModal && (
        <PromptModal
          state={promptModal}
          platform={platform}
          topicId={topic.id}
          onClose={() => setPromptModal(null)}
          onChange={setPromptModal}
          onSubmit={(raw) => saveVersion(raw, { origin: 'generated', snapshot: promptModal.snapshot })}
          onOutlineSaved={async () => { setPromptModal(null); await reload(); notify('大纲已保存，去确认方向'); }}
          notify={notify}
        />
      )}

      {outlineModal && (
        <OutlineModal
          topicId={topic.id}
          current={outline}
          onClose={() => setOutlineModal(false)}
          onSaved={async () => { setOutlineModal(false); await reload(); notify('大纲已保存'); }}
          notify={notify}
        />
      )}
    </div>
  );
}

function PromptModal({ state, platform, topicId, onClose, onChange, onSubmit, onOutlineSaved, notify }) {
  const [fill, setFill] = useState(state.fill || '');
  const [parsedOutline, setParsedOutline] = useState(null);
  const [fields, setFields] = useState({ hook: '', thesis: '', structure: '', assumptions: '', post_copy: '', cover_copy: '' });
  const isOutline = state.kind === 'outline';

  const analyze = () => {
    if (isOutline) {
      const p = parseOutlineSections(fill);
      setParsedOutline(p);
      setFields({ ...fields, ...p });
    }
  };

  const saveOutline = async () => {
    if (!fields.hook && !fields.thesis && !fields.structure) return notify('先粘贴内容并点「从粘贴内容提取」', 'err');
    try {
      await api.post(`/api/topics/${topicId}/outlines`, fields);
      onOutlineSaved();
    } catch (e) { notify(e.message, 'err'); }
  };

  return (
    <Modal title={isOutline ? '生成大纲 · 提示词工作流' : '生成正文 · 提示词工作流'} width={900} onClose={onClose}
      footer={isOutline ? (
        <>
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn" onClick={analyze}>从粘贴内容提取</button>
          <button className="btn primary" disabled={!parsedOutline} onClick={saveOutline}>保存大纲</button>
        </>
      ) : (
        <>
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={!fill.trim()} onClick={() => onSubmit(fill)}>保存为新版本</button>
        </>
      )}
    >
      <div className="prompt-grid">
        <div>
          <div className="card-head">
            <h4>① 复制 Prompt 到外部 AI</h4>
            <CopyBtn text={state.prompt} label="复制 Prompt" />
          </div>
          <pre className="prompt-box">{state.prompt}</pre>
          <p className="hint">模板：{state.template?.name} v{state.template?.version_no}{state.missing?.length ? ` · 缺失变量：${state.missing.join('、')}` : ''}</p>
        </div>
        <div>
          <div className="card-head"><h4>② 把 AI 结果贴回来</h4></div>
          <textarea className="editor" rows={16} value={fill} onChange={(e) => setFill(e.target.value)} placeholder="整段粘贴 AI 输出，系统按标题解析结构" />
          {parsedOutline && (
            <div className="outline-fields">
              {[['hook', '钩子'], ['thesis', '核心论点'], ['structure', '结构'], ['assumptions', '待验证假设'], ['post_copy', '发布文案'], ['cover_copy', '封面文案']].map(([k, label]) => (
                <Field key={k} label={label}>
                  {k === 'structure' || k === 'assumptions'
                    ? <textarea rows={3} value={fields[k]} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />
                    : <input value={fields[k]} onChange={(e) => setFields({ ...fields, [k]: e.target.value })} />}
                </Field>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function OutlineModal({ topicId, current, onClose, onSaved, notify }) {
  const [f, setF] = useState({
    hook: current?.hook || '', thesis: current?.thesis || '', structure: current?.structure || '',
    assumptions: current?.assumptions || '', post_copy: current?.post_copy || '', cover_copy: current?.cover_copy || '',
  });
  const save = async () => {
    try {
      if (current) {
        await api.patch(`/api/outlines/${current.id}`, f);
      } else {
        await api.post(`/api/topics/${topicId}/outlines`, f);
      }
      onSaved();
    } catch (e) { notify(e.message, 'err'); }
  };
  return (
    <Modal title="大纲内容" width={760} onClose={onClose} footer={
      <>
        <button className="btn ghost" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={save}>保存</button>
      </>
    }>
      <Field label="钩子（第一句）"><input value={f.hook} onChange={(e) => setF({ ...f, hook: e.target.value })} /></Field>
      <Field label="核心论点"><input value={f.thesis} onChange={(e) => setF({ ...f, thesis: e.target.value })} /></Field>
      <Field label="结构"><textarea rows={5} value={f.structure} onChange={(e) => setF({ ...f, structure: e.target.value })} /></Field>
      <Field label="待验证假设"><textarea rows={3} value={f.assumptions} onChange={(e) => setF({ ...f, assumptions: e.target.value })} /></Field>
      <div className="row2">
        <Field label="发布文案"><input value={f.post_copy} onChange={(e) => setF({ ...f, post_copy: e.target.value })} /></Field>
        <Field label="封面文案" hint="≤12 字"><input value={f.cover_copy} onChange={(e) => setF({ ...f, cover_copy: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
