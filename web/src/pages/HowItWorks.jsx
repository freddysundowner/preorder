import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function HowItWorks() {
  const { info } = useAuth();
  const steps = [
    ['Pick your items', 'Browse the current round and add what you want to your cart.'],
    ['Order and pay by M-Pesa', 'Check out with your phone number, then pay before the round closes.'],
    ['We ship the whole batch', 'Once the round closes we order from our supplier and ship everything together. You get an SMS at every stage.'],
    ['Pick up your order', `When your order arrives we text you a pickup code. Show that code at ${info.shopLocation || 'the shop'} to collect it.`],
  ];
  return (
    <div className="how">
      <header className="how-head">
        <span className="sf-eyebrow">How it works</span>
        <h1>Preorder today, collect when it lands</h1>
        <p>Four simple steps from checkout to pickup.</p>
      </header>
      <ol className="how-steps">
        {steps.map(([t, d], i) => (
          <li key={t}>
            <span className="how-n">{String(i + 1).padStart(2, '0')}</span>
            <h3>{t}</h3>
            <p>{d}</p>
          </li>
        ))}
      </ol>
      <div className="how-cta">
        <div><h2>Ready to order?</h2><p>See what's in the current round.</p></div>
        <Link className="btn" to="/">Start shopping</Link>
      </div>
    </div>
  );
}
