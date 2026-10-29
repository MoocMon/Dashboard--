import React, { useEffect, useState } from 'react';
import { api, PLATFORM, weekStart, fmtDate } from '../api.js';
import { Empty, Pill, StatusDot } from '../components.jsx';

const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

export default function Schedule({ notify, reload, openTopic }) {
  const [start, setStart] = useState(weekStart());
  const [data, setData] = useState(null);
  const [drag, setDrag] = useState(null);
  const [dropTarget, setDropTarget] = useState('');
  const [dates, setDates] = useState({});

  const load = async () => {
    try { setData(await api.get(`/api/schedule?start=${start}&days=7`)); } catch (e) { notify(e.message, 'err'); }
  };
  useEffect(() => { load(); }, [start]);

  const shift = (days) => {
    const d = new Date(`${start}T00:00:00`);
    d.setDate(d.getDate() + days);
    setStart(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  };

  const drop = async (date) => {
    if (!drag) return;
    try {
      await api.post('/api/schedule/move', { topic_id: drag.topic_id, platform: drag.platform, date });
      notify(`${drag.topic} 已排到 ${date}`);
      setDrag(null);
      setDropTarget('');
      await load();
      await reload();
    } catch (e) { notify(e.message, 'err'); }
  };

  if (!data) return <div className="page"><div className="loading">加载中…</div></div>;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>排期看板</h1>
          <p className="sub">一题多平台各占一条。拖拽只改日期，不改状态。临期未归档标红。</p>
        </div>
        <div className="inline">
          <button className="btn ghost small" onClick={() => shift(-7)}>← 上周</button>
          <button className="btn ghost small" onClick={() => setStart(weekStart())}>本周</button>
          <button className="btn ghost small" onClick={() => shift(7)}>下周 →</button>
        </div>
      </div>

      {data.conflicts.length > 0 && (
        <div className="notice warn">
          同平台同日超过 2 条：{data.conflicts.map((c) => `${c.date} ${PLATFORM[c.platform]?.label} ${c.count} 条`).join('；')}
        </div>
      )}

      <div className="week">
        {data.days.map((day, i) => {
          const isToday = day.date === today;
          return (
            <div
              key={day.date}
              className={`day ${isToday ? 'today' : ''} ${dropTarget === day.date ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(day.date); }}
              onDragLeave={() => setDropTarget('')}
              onDrop={() => drop(day.date)}
            >
              <div className="day-head">
                <span>{WD[i]}</span>
                <b>{day.date.slice(5)}</b>
                {isToday && <em>今天</em>}
              </div>
              <div className="day-body">
                {day.entries.length === 0 && <p className="day-empty">—</p>}
                {day.entries.map((e) => (
                  <div
                    key={e.id}
                    className={`sched-card ${e.platform} ${e.overdue ? 'overdue' : ''}`}
                    draggable
                    onDragStart={() => setDrag({ topic_id: e.topic_id, platform: e.platform, topic: e.topic })}
                    onClick={() => openTopic(e.topic_id)}
                    title={`${e.topic} · ${e.status}`}
                  >
                    <div className="sc-plat">{PLATFORM[e.platform]?.label}</div>
                    <div className="sc-name">{e.topic}</div>
                    <div className="sc-status"><StatusDot status={e.status} />{e.status}{e.overdue ? ' · 已过期' : ''}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="card-head"><h3>待排期</h3><span className="dim">{data.unscheduled.length} 个选题没有日期</span></div>
        {data.unscheduled.length === 0 ? <p className="hint">全部选题都已排期。</p> : (
          <div className="unsched">
            {data.unscheduled.map((u) => (
              <div key={u.topic_id} className="us-row">
                <button className="link" onClick={() => openTopic(u.topic_id)}>{u.topic}</button>
                <span className="dim">{u.status}</span>
                <input type="date" value={dates[u.topic_id] || ''} onChange={(e) => setDates({ ...dates, [u.topic_id]: e.target.value })} />
                <button className="btn ghost small" onClick={async () => {
                  if (!dates[u.topic_id]) return notify('先选日期', 'err');
                  try {
                    await api.patch(`/api/topics/${u.topic_id}`, { schedule_date: dates[u.topic_id] });
                    notify('已排期');
                    await load(); await reload();
                  } catch (e) { notify(e.message, 'err'); }
                }}>排期</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
