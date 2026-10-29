import React, { useEffect, useState } from 'react';
import { api, fmtTime, PLATFORM } from '../api.js';
import { Modal, Field, Pill, CopyBtn } from '../components.jsx';

const GATE_NAME = { 1: '① 结构', 2: '② 去 AI 味', 3: '③ 转化与收尾', 4: '④ 违禁词' };
const LEVELS = { block: '阻断', suggest: '建议', info: '提示' };

export default function Settings({ boot, reload, notify }) {
  const [s, setS] = useState(null);
  const [test, setTest] = useState(null);
  const [rules, setRules] = useState([]);
  const [prompts, setPrompts] = useState([]);
  const [promptModal, setPromptModal] = useState(null);
  const [editRule, setEditRule] = useState(null);
  const [wl, setWl] = useState([]);
  const [wlForm, setWlForm] = useState({ word: '', reason: '' });
  const [gate, setGate] = useState(1);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const [st, r, p, w] = await Promise.all([
        api.get('/api/settings').catch(() => null),
        api.get('/api/rules'),
        api.get('/api/prompts'),
        api.get('/api/whitelist'),
      ]);
      setRules(r);
      setPrompts(p);
      setWl(w);
    } catch (e) { notify(e.message, 'err'); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (boot) setS({ ...boot.settings }); }, [boot]);

  const saveSettings = async () => {
    try {
      await api.put('/api/settings', s);
      await reload();
      notify('设置已保存');
    } catch (e) { notify(e.message, 'err'); }
  };

  const ruleList = rules.filter((r) => r.gate === gate);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>规范与设置</h1>
          <p className="sub">改动即时生效于新的质检；历史报告会标「规则已变更」。</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>路径与默认值</h3>
          <div className="inline">
            <button className="btn ghost small" onClick={async () => setTest(await api.post('/api/settings/test'))}>检测路径</button>
            <button className="btn primary small" onClick={saveSettings}>保存</button>
          </div>
        </div>
        {s && (
          <div className="grid2">
            <Field label="账号"><input value={s.account} onChange={(e) => setS({ ...s, account: e.target.value })} /></Field>
            <Field label="语速（字/秒）"><input value={s.chars_per_sec} onChange={(e) => setS({ ...s, chars_per_sec: e.target.value })} /></Field>
            <Field label="Obsidian 库路径"><input value={s.obsidian_vault} onChange={(e) => setS({ ...s, obsidian_vault: e.target.value })} /></Field>
            <Field label="归档子目录"><input value={s.obsidian_subdir} onChange={(e) => setS({ ...s, obsidian_subdir: e.target.value })} /></Field>
            <Field label="违禁词库路径" hint="直读，不复制不写回"><input value={s.wordlib_path} onChange={(e) => setS({ ...s, wordlib_path: e.target.value })} /></Field>
            <Field label="选题雷达目录"><input value={s.radar_dir} onChange={(e) => setS({ ...s, radar_dir: e.target.value })} /></Field>
            <Field label="抖音最短（秒）"><input value={s.douyin_min_sec} onChange={(e) => setS({ ...s, douyin_min_sec: e.target.value })} /></Field>
            <Field label="抖音最长（秒）"><input value={s.douyin_max_sec} onChange={(e) => setS({ ...s, douyin_max_sec: e.target.value })} /></Field>
          </div>
        )}
        {test && (
          <div className="notice ok">
            <div>归档目录：{test.obsidian_dir}（{test.exists ? '存在' : '不存在'}，{test.writable ? '可写' : '不可写'}）</div>
            <div>词库：{test.wordlib.error || `${test.wordlib.count} 词，更新于 ${fmtTime(test.wordlib.mtime)}`}</div>
            <div>雷达目录：{test.radar}（{test.radar_exists ? '存在' : '不存在'}）</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>LLM 自动生成</h3>
          <label className="check">
            <input type="checkbox" checked={s?.llm_enabled === '1'} onChange={(e) => setS({ ...s, llm_enabled: e.target.checked ? '1' : '0' })} />
            <b>启用</b>
          </label>
        </div>
        {s && boot?.llm && (
          <div className="stack">
            <div className="llm-status inline">
              <span className={`pill ${boot.llm.enabled ? 'ok' : 'warn'}`}>
                {boot.llm.enabled ? `● ${boot.llm.providerLabel} · ${boot.llm.model} 已就绪` : boot.llm.hasKey ? '已填 Key 但未启用' : '未填 API Key'}
              </span>
              <button className="btn ghost small" disabled={s.llm_enabled !== '1'} onClick={async () => {
                const r = await api.post('/api/llm/test');
                notify(r.ok ? `连通成功：${r.text}` : `连通失败：${r.error}`, r.ok ? 'ok' : 'err');
              }}>测试连通性</button>
              <button className="btn ghost small" onClick={saveSettings}>保存 LLM 设置</button>
            </div>
            <div className="grid2">
              <Field label="服务商">
                <select value={s.llm_provider} onChange={(e) => {
                  const p = boot.llm.presets[e.target.value];
                  setS({ ...s, llm_provider: e.target.value, llm_base_url: p.base_url || s.llm_base_url, llm_model: p.model || s.llm_model });
                }}>
                  {Object.entries(boot.llm.presets).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
                <div className="hint">{boot.llm.presets[s.llm_provider]?.hint}</div>
              </Field>
              <Field label="API Key" hint="只存在本机 SQLite，不外发">
                <input type="password" value={s.llm_api_key} placeholder="sk-... 或空则不改" onChange={(e) => setS({ ...s, llm_api_key: e.target.value })} />
              </Field>
              <Field label="Base URL"><input value={s.llm_base_url} onChange={(e) => setS({ ...s, llm_base_url: e.target.value })} /></Field>
              <Field label="模型名"><input value={s.llm_model} onChange={(e) => setS({ ...s, llm_model: e.target.value })} /></Field>
            </div>
            <div className="notice info">
              <b>豆包免费额度说明：</b>豆包网页版/APP 没有公开 API。火山方舟（console.volcengine.com/ark）是官方 API 入口，注册送免费额度。也可换 DeepSeek / Kimi / 通义 / 任意 OpenAI 兼容代理，base_url 和 model 切换即可。
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h3>规则</h3><span className="dim">共 {rules.length} 条，已启用 {rules.filter((r) => r.enabled).length} 条</span></div>
        <div className="toolbar">
          {[1, 2, 3, 4].map((g) => (
            <button key={g} className={`chip ${gate === g ? 'on' : ''}`} onClick={() => setGate(g)}>{GATE_NAME[g]}</button>
          ))}
        </div>
        <table className="tbl">
          <thead><tr><th>ID</th><th>检查项</th><th>平台</th><th>类型</th><th>级别</th><th>启用</th><th>参数</th></tr></thead>
          <tbody>
            {ruleList.map((r) => (
              <tr key={r.id} className={r.enabled ? '' : 'off'}>
                <td className="mono">{r.id}</td>
                <td><b>{r.name}</b><div className="dim small-text">{r.description}</div></td>
                <td>{r.scope === 'all' ? '全部' : PLATFORM[r.scope]?.label || r.scope}</td>
                <td>{r.content_type === 'all' ? '全部' : r.content_type}</td>
                <td>
                  <select value={r.level} onChange={async (e) => {
                    await api.patch(`/api/rules/${r.id}`, { level: e.target.value });
                    await load();
                  }}>
                    {Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td>
                  <input type="checkbox" checked={r.enabled} onChange={async (e) => {
                    try {
                      await api.patch(`/api/rules/${r.id}`, { enabled: e.target.checked });
                      await load();
                      notify('规则已更新');
                    } catch (err) { notify(err.message, 'err'); }
                  }} />
                </td>
                <td>{Object.keys(r.params || {}).length ? <button className="link" onClick={() => setEditRule(r)}>编辑</button> : <span className="dim">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-head"><h3>Prompt 模板</h3><span className="dim">改完立即用于新生成的提示词</span></div>
        <div className="prompt-list">
          {prompts.map((p) => (
            <div key={`${p.key}-${p.version_no}`} className={`prompt-row ${p.active ? 'on' : ''}`}>
              <div>
                <b>{p.name}</b>
                <div className="dim">{p.key} · v{p.version_no} · {p.variables.join(' ')}</div>
              </div>
              <div className="inline">
                <button className="btn ghost small" onClick={async () => {
                  const body = await api.get(`/api/prompts/${p.key}`);
                  setPromptModal(body);
                }}>编辑</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>违禁词白名单</h3><span className="dim">只存排除词，原词库不受影响</span></div>
        <div className="inline">
          <input placeholder="要排除的词" value={wlForm.word} onChange={(e) => setWlForm({ ...wlForm, word: e.target.value })} />
          <input placeholder="理由" value={wlForm.reason} onChange={(e) => setWlForm({ ...wlForm, reason: e.target.value })} />
          <button className="btn small" onClick={async () => {
            if (!wlForm.word) return notify('缺少词', 'err');
            await api.post('/api/whitelist', wlForm);
            setWlForm({ word: '', reason: '' });
            await load();
            notify('已加入白名单');
          }}>加入</button>
        </div>
        <div className="wl-list">
          {wl.map((w) => (
            <span key={w.id} className="wl-item">{w.word}<i>{w.reason}</i>
              <button className="icon-btn" onClick={async () => { await api.del(`/api/whitelist/${w.id}`); await load(); }}>✕</button>
            </span>
          ))}
          {wl.length === 0 && <p className="hint">没有白名单词。</p>}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>数据</h3></div>
        <div className="inline">
          <button className="btn ghost" disabled={busy === 'export'} onClick={async () => {
            setBusy('export');
            try { const r = await api.post('/api/export'); notify(`已导出到 ${r.path}`); } catch (e) { notify(e.message, 'err'); } finally { setBusy(''); }
          }}>{busy === 'export' ? '导出中…' : '全量导出（JSON + Markdown）'}</button>
          <button className="btn ghost" onClick={async () => {
            try { const r = await api.post('/api/backup'); notify(`已备份：${r.path}`); } catch (e) { notify(e.message, 'err'); }
          }}>立即备份</button>
          <span className="dim">每日启动自动备份，保留 7 份</span>
        </div>
      </div>

      {editRule && (
        <Modal title={`${editRule.id} · ${editRule.name} 参数`} onClose={() => setEditRule(null)} footer={
          <>
            <button className="btn ghost" onClick={() => setEditRule(null)}>取消</button>
            <button className="btn primary" onClick={async () => {
              try {
                const params = JSON.parse(editRule._text || JSON.stringify(editRule.params));
                await api.patch(`/api/rules/${editRule.id}`, { params });
                setEditRule(null); await load(); notify('参数已保存');
              } catch (e) { notify('参数必须是合法 JSON', 'err'); }
            }}>保存</button>
          </>
        }>
          <p className="hint">直接编辑 JSON。例如 H2：{`{"charsPerSec":7,"minSec":180,"maxSec":300,"tolerance":0.1}`}</p>
          <textarea className="editor" rows={8} defaultValue={JSON.stringify(editRule.params, null, 2)}
            onChange={(e) => setEditRule({ ...editRule, _text: e.target.value })} />
        </Modal>
      )}

      {promptModal && (
        <Modal title={`编辑模板 · ${promptModal.name}`} width={900} onClose={() => setPromptModal(null)} footer={
          <>
            <button className="btn ghost" onClick={() => setPromptModal(null)}>取消</button>
            <button className="btn primary" onClick={async () => {
              try {
                await api.put(`/api/prompts/${promptModal.key}`, { body: promptModal.body });
                setPromptModal(null); await load(); notify('模板已更新');
              } catch (e) { notify(e.message, 'err'); }
            }}>保存新版本</button>
          </>
        }>
          <div className="inline">
            <span className="dim">必含变量：{promptModal.variables.map((v) => `{{${v}}}`).join(' ')}</span>
            <CopyBtn text={promptModal.body} label="复制模板" />
          </div>
          <textarea className="editor" rows={26} value={promptModal.body} onChange={(e) => setPromptModal({ ...promptModal, body: e.target.value })} />
          <div className="ver-list">
            {promptModal.versions.map((v) => (
              <div key={v.version_no} className="ver-row">
                <span>v{v.version_no} · {fmtTime(v.created_at)}</span>
                {v.version_no !== promptModal.version_no && (
                  <button className="link" onClick={async () => {
                    if (!confirm(`回滚到 v${v.version_no}？会生成一个新版本。`)) return;
                    await api.post(`/api/prompts/${promptModal.key}/rollback`, { version_no: v.version_no });
                    setPromptModal(null); await load(); notify('已回滚');
                  }}>回滚到此版</button>
                )}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
