import React, { useEffect, useState } from 'react';
import { api, fmtTime } from './api.js';
import { Toast } from './components.jsx';
import Topics from './pages/Topics.jsx';
import Topic from './pages/Topic.jsx';
import Snippets from './pages/Snippets.jsx';
import Schedule from './pages/Schedule.jsx';
import Candidates from './pages/Candidates.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { key: 'topics', label: '选题池', hint: '选题与资料' },
  { key: 'snippets', label: '素材库', hint: '跨选题复用' },
  { key: 'schedule', label: '排期', hint: '周视图' },
  { key: 'candidates', label: '候选池', hint: '雷达 + 补充' },
  { key: 'settings', label: '设置', hint: '规则与模板' },
];

export default function App() {
  const [boot, setBoot] = useState(null);
  const [view, setView] = useState('topics');
  const [topicId, setTopicId] = useState(null);
  const [topics, setTopics] = useState([]);
  const [toast, setToast] = useState(null);

  const notify = (text, type = 'ok') => setToast({ text, type });

  const loadBoot = async () => {
    try { setBoot(await api.get('/api/bootstrap')); } catch (e) { notify(e.message, 'err'); }
  };
  const loadTopics = async () => {
    try { setTopics(await api.get('/api/topics')); } catch (e) { notify(e.message, 'err'); }
  };
  const reload = async () => { await Promise.all([loadBoot(), loadTopics()]); };

  useEffect(() => { reload(); }, []);

  const go = (key) => { setView(key); setTopicId(null); };
  const openTopic = (id) => { setTopicId(id); setView('topics'); };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">张</div>
          <div>
            <b>内容工作台</b>
            <span>AKA张猩猩 · 三平台</span>
          </div>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.key} className={view === n.key && !topicId ? 'on' : ''} onClick={() => go(n.key)}>
              <span>{n.label}</span><i>{n.hint}</i>
            </button>
          ))}
        </nav>
        <div className="side-status">
          {boot && (
            <>
              <div className="ss-row">
                <span>词库</span>
                <b className={boot.wordlib.error ? 'err-text' : ''}>{boot.wordlib.error ? '不可用' : `${boot.wordlib.count} 词`}</b>
              </div>
              {boot.wordlib.mtime && <div className="ss-sub">更新 {fmtTime(boot.wordlib.mtime)}</div>}
              <div className="ss-row">
                <span>Obsidian</span>
                <b className={boot.obsidian.exists ? '' : 'warn-text'}>{boot.obsidian.exists ? '可归档' : '目录未建'}</b>
              </div>
              <div className="ss-sub">选题 {boot.counts.topics} · 已归档 {boot.counts.archived}</div>
              <div className="ss-sub">待定候选 {boot.counts.candidates}</div>
            </>
          )}
        </div>
      </aside>

      <main className="main">
        {view === 'topics' && (topicId
          ? <Topic id={topicId} onBack={() => setTopicId(null)} notify={notify} reload={reload} llm={boot?.llm} />
          : <Topics topics={topics} reload={reload} openTopic={openTopic} notify={notify} />)}
        {view === 'snippets' && <Snippets topics={topics} notify={notify} openTopic={openTopic} />}
        {view === 'schedule' && <Schedule notify={notify} reload={reload} openTopic={openTopic} />}
        {view === 'candidates' && <Candidates notify={notify} reload={reload} openTopic={openTopic} />}
        {view === 'settings' && <Settings boot={boot} reload={reload} notify={notify} />}
      </main>

      <Toast msg={toast} onDone={() => setToast(null)} />
    </div>
  );
}
