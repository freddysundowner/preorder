import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi } from '../hooks.js';
import { kes } from '../format.js';
import { ProductImage, Err, Loading } from '../components/ui.jsx';

export default function ComingSoon() {
  const { data, error, loading, reload } = useApi('/proposed-items');
  const { user } = useAuth();
  const nav = useNavigate();

  const toggle = async (item) => {
    if (!user) return nav('/login', { state: { from: '/coming-soon' } });
    await api(`/proposed-items/${item.id}/interest`, { method: item.my_qty ? 'DELETE' : 'POST', body: item.my_qty ? undefined : { qty: 1 } });
    reload();
  };

  if (loading && !data) return <Loading />;
  if (error) return <Err msg={error} />;

  const items = [...data.items].sort((a, b) => b.interest_count - a.interest_count);
  const top = Math.max(1, ...items.map((i) => i.interest_count));

  return (
    <>
      <header className="cs-head">
        <span className="sf-eyebrow">Coming soon</span>
        <h1>Help us pick the next round</h1>
        <p>These items could be in a future shipment. Tell us which ones you'd order and we'll bring in the most wanted.</p>
      </header>

      {!items.length ? (
        <div className="panel empty"><p>No upcoming items yet. Check back soon.</p></div>
      ) : (
        <div className="sf-grid cs-grid">
          {items.map((it, i) => {
            const wanted = !!it.my_qty;
            return (
              <article className="sf-card cs-card" key={it.id}>
                <div className="sf-card-media">
                  <ProductImage src={it.image_url} name={it.name} />
                  {i === 0 && it.interest_count > 0 && <span className="sf-badge">Most wanted</span>}
                </div>
                <h3>{it.name}</h3>
                {it.description && <p className="cs-desc">{it.description}</p>}
                <div className="sf-price">{it.est_price_kes ? <>Around {kes(it.est_price_kes)}</> : 'Price to be confirmed'}</div>
                <div className="cs-meter" aria-hidden="true"><span style={{ width: `${Math.max(4, (it.interest_count / top) * 100)}%` }} /></div>
                <div className="cs-foot">
                  <span className="muted small">{it.interest_count} {it.interest_count === 1 ? 'person wants' : 'people want'} this</span>
                  <button className={`btn btn-sm ${wanted ? 'btn-ghost' : 'btn-dark'}`} onClick={() => toggle(it)} aria-pressed={wanted}>
                    {wanted ? '✓ I want this' : 'I want this'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
