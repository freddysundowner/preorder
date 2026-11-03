import { Link } from 'react-router-dom';
import { useApi } from '../../hooks.js';
import { useAuth } from '../../auth.jsx';
import { kes, date, timeLeft, STAGE_LABEL } from '../../format.js';
import { Err, Loading } from '../../components/ui.jsx';

export default function Overview() {
  const { user } = useAuth();
  const { data, error, loading } = useApi('/admin/overview');
  if (loading) return <Loading />;
  if (error) return <Err msg={error} />;
  const { open, openStats, counts, shipping } = data;
  const left = open && timeLeft(open.closes_at);
  const isAdmin = user.role === 'admin';

  return (
    <div className="stack">
      <h1>Overview</h1>

      {open ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>{open.name}</h2>
              <p className="muted small" style={{ margin: 0 }}>
                Open for orders · closes {date(open.closes_at, true)}
                {left && <> ({left.d > 0 ? `${left.d}d ${left.h}h` : `${left.h}h ${left.m}m`} left)</>}
              </p>
            </div>
            {isAdmin && <Link className="btn btn-ghost btn-sm" to={`/admin/periods/${open.id}`}>Manage round</Link>}
          </div>
          <div className="stats" style={{ marginBottom: 0 }}>
            <div className="stat"><div className="v">{openStats.orders}</div><div className="k">Orders</div></div>
            <div className="stat"><div className="v">{openStats.paid_orders}</div><div className="k">Paid</div></div>
            <div className="stat"><div className="v">{openStats.unpaid_orders}</div><div className="k">Awaiting payment</div></div>
            <div className="stat"><div className="v num">{kes(openStats.collected_kes)}</div><div className="k">Collected</div></div>
            <div className="stat"><div className="v num">{kes(openStats.outstanding_kes)}</div><div className="k">Outstanding</div></div>
          </div>
        </section>
      ) : (
        <section className="panel">
          <h2>No round is open for orders</h2>
          {isAdmin && <Link className="btn" to="/admin/periods">Create a shipping round</Link>}
        </section>
      )}

      <div className="stats">
        <Link to="/admin/collections" className={`stat ${counts.awaiting_collection ? 'alert-stat' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="v">{counts.awaiting_collection}</div><div className="k">Waiting to be collected</div>
        </Link>
        {isAdmin && (
          <Link to="/admin/payments?tab=unmatched" className={`stat ${counts.unmatched_payments ? 'alert-stat' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="v">{counts.unmatched_payments}</div><div className="k">Payments to match</div>
          </Link>
        )}
        <Link to="/admin/orders?status=refund_pending" className={`stat ${counts.refunds_pending ? 'alert-stat' : ''}`} style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="v">{counts.refunds_pending}</div><div className="k">Refunds due</div>
        </Link>
        <div className="stat"><div className="v">{counts.customers}</div><div className="k">Customers</div></div>
      </div>

      <section className="panel">
        <h2>Shipments on the way</h2>
        {!shipping.length ? <p className="muted">No closed rounds are being shipped.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Round</th><th>Stage</th><th>Expected</th><th className="num">Paid orders</th></tr></thead>
              <tbody>
                {shipping.map((s) => (
                  <tr key={s.id}>
                    <td>{isAdmin ? <Link to={`/admin/periods/${s.id}`}>{s.name}</Link> : s.name}</td>
                    <td><span className="badge badge-blue">{STAGE_LABEL[s.status]}</span></td>
                    <td>{s.eta_date ? date(s.eta_date) : '—'}</td>
                    <td className="num">{s.paid_orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
