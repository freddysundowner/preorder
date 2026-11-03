import { ask } from '../../components/Dialogs.jsx';
import { useState } from 'react';
import { api } from '../../api.js';
import { useApi, useAction } from '../../hooks.js';
import { useAuth } from '../../auth.jsx';
import { date, phone } from '../../format.js';
import { Err, Ok, Loading } from '../../components/ui.jsx';

const ROLE = { admin: 'Admin', staff: 'Shop staff', customer: 'Customer' };

export default function People() {
  const { user } = useAuth();
  const [tab, setTab] = useState('team');
  const team = useApi('/admin/users');
  const auditLog = useApi(tab === 'activity' ? '/admin/audit' : null);
  const [form, setForm] = useState({ name: '', phone: '', role: 'staff' });
  const [msg, setMsg] = useState(null);
  const { busy, error, run } = useAction();

  const add = (e) => {
    e.preventDefault();
    setMsg(null);
    run(async () => {
      await api('/admin/users', { method: 'POST', body: form });
      setMsg(`${form.name || form.phone} can now log in as ${ROLE[form.role].toLowerCase()} with their phone number.`);
      setForm({ name: '', phone: '', role: 'staff' });
      team.reload();
    });
  };
  const changeRole = (u, role) => run(async () => { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { role } }); team.reload(); });

  const users = team.data?.users || [];
  const staff = users.filter((u) => u.role !== 'customer');
  const customers = users.filter((u) => u.role === 'customer');

  return (
    <div className="stack">
      <h1>People</h1>
      <div className="tabs" role="tablist">
        {[['team', 'Team'], ['customers', `Customers (${customers.length})`], ['activity', 'Activity log']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <Ok msg={msg} />
      <Err msg={error || team.error} />

      {tab === 'team' && (
        <>
          <form className="panel" onSubmit={add}>
            <h2>Add a team member</h2>
            <p className="small muted">Shop staff can use the collection desk and look up orders. Admins can do everything.</p>
            <div className="form-row">
              <label className="field"><span>Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="field"><span>Phone</span><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required /></label>
              <label className="field"><span>Role</span>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="staff">Shop staff</option><option value="admin">Admin</option>
                </select>
              </label>
            </div>
            <button className="btn" disabled={busy}>Add team member</button>
          </form>
          <section className="panel">
            {team.loading && !team.data ? <Loading /> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th /></tr></thead>
                <tbody>{staff.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name || '—'}{u.id === user.id && <span className="small muted"> (you)</span>}</td>
                    <td>{phone(u.phone)}</td>
                    <td>{ROLE[u.role]}</td>
                    <td className="right">{u.id !== user.id && <button className="linkbtn small" onClick={async () => (await ask(`Remove ${u.name || phone(u.phone)} from the team?`, { confirmLabel: 'Remove access', danger: true })) && changeRole(u, 'customer')}>Remove access</button>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}

      {tab === 'customers' && (
        <section className="panel">
          {!customers.length ? <div className="empty"><p>No customers yet.</p></div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Phone</th><th>Joined</th><th className="num">Paid orders</th></tr></thead>
              <tbody>{customers.map((u) => (
                <tr key={u.id}><td>{u.name || '—'}</td><td>{phone(u.phone)}</td><td>{date(u.created_at)}</td><td className="num">{u.paid_orders}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === 'activity' && (
        <section className="panel">
          {!auditLog.data ? <Loading /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
              <tbody>{auditLog.data.rows.map((a) => (
                <tr key={a.id}>
                  <td className="small" style={{ whiteSpace: 'nowrap' }}>{date(a.created_at, true)}</td>
                  <td className="small">{a.actor_name || 'System'}</td>
                  <td className="small">{a.action}{a.entity_id ? ` #${a.entity_id}` : ''}</td>
                  <td className="small muted" style={{ maxWidth: 360, wordBreak: 'break-word' }}>{a.data ? JSON.stringify(a.data) : ''}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}
    </div>
  );
}
