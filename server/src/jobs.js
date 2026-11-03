import { many, query } from './db.js';
import { closePeriod, sendClosingReminder, notifyPeriodOpened } from './services/orders.js';

// Runs every minute: announce periods that have opened, send 24-hour reminders, close periods.
export async function runJobs() {
  // 1. Announce periods whose opening time has arrived
  const opening = await many(
    `SELECT id FROM shipping_periods
      WHERE status = 'open' AND announced_at IS NULL AND opens_at <= now() AND closes_at > now()`
  );
  for (const p of opening) await notifyPeriodOpened(p.id);

  // 2. Reminder 24 hours before closing
  const closingSoon = await many(
    `SELECT id FROM shipping_periods
      WHERE status = 'open' AND reminder_sent_at IS NULL
        AND closes_at > now() AND closes_at <= now() + interval '24 hours'
        AND opens_at <= now() - interval '1 hour'`
  );
  for (const p of closingSoon) await sendClosingReminder(p.id);

  // 3. Close periods past their closing time
  const due = await many(`SELECT id FROM shipping_periods WHERE status = 'open' AND closes_at <= now()`);
  for (const p of due) {
    await closePeriod(p.id, null);
    await query(
      `INSERT INTO status_events (period_id, status, note) VALUES ($1, 'closed', 'Closed automatically at closing time')`,
      [p.id]
    );
    console.log(`[jobs] closed period ${p.id}`);
  }
}

export function startJobs() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runJobs(); } catch (e) { console.error('[jobs]', e); } finally { running = false; }
  };
  tick();
  return setInterval(tick, 60 * 1000);
}
