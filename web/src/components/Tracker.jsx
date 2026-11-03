import { STAGES, shortDate } from '../format.js';

// The shipment journey: one stop per stage, filled up to where the batch is now.
export default function Tracker({ periodStatus, events = [], createdAt }) {
  const keys = STAGES.map((s) => s.key);
  let idx = periodStatus === 'completed' ? keys.length - 1 : keys.indexOf(periodStatus);
  if (idx < 0) idx = 0;

  const when = (key) => {
    if (key === 'open') return createdAt;
    const ev = [...events].reverse().find((e) => e.status === key);
    return ev?.created_at;
  };

  const fill = idx === 0 ? 0 : (idx / (keys.length - 1)) * 83.34;

  return (
    <div className="route" aria-label={`Shipment progress: ${STAGES[idx].label}`}>
      <div className="track-fill" style={{ width: `${fill}%` }} aria-hidden="true" />
      <ol>
        {STAGES.map((s, i) => {
          const state = i < idx ? 'done' : i === idx ? (periodStatus === 'completed' ? 'done' : 'now') : '';
          const w = i <= idx ? when(s.key) : null;
          return (
            <li key={s.key} className={state} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="stop" />
              <span>
                <span className="lbl">{s.short}</span>
                {w && <span className="when">{shortDate(w)}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
