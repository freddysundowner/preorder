// Creates the first admin account and, with --demo, sample data to click around with.
import { config } from './config.js';
import { pool, one } from './db.js';
import { migrate } from './migrate.js';
import { normalizePhone } from './util.js';

await migrate();

const phone = normalizePhone(config.adminPhone);
if (!phone) {
  console.error('ADMIN_PHONE in .env is not a valid Kenyan number');
  process.exit(1);
}
await pool.query(
  `INSERT INTO users (phone, name, role) VALUES ($1,$2,'admin')
   ON CONFLICT (phone) DO UPDATE SET role = 'admin'`,
  [phone, config.adminName]
);
console.log(`Admin account ready: ${config.adminPhone} (log in with this number)`);

if (process.argv.includes('--demo')) {
  const existing = await one('SELECT id FROM shipping_periods LIMIT 1');
  if (existing) {
    console.log('Demo data skipped: periods already exist');
  } else {
    const period = await one(
      `INSERT INTO shipping_periods (name, opens_at, closes_at, eta_date, status)
       VALUES ('December shipment', now() - interval '1 day', now() + interval '14 days',
               (now() + interval '35 days')::date, 'open') RETURNING id`
    );
    const products = [
      ['Air fryer 6L', 'Digital touch panel, 1500W, non-stick basket.', 6500],
      ['Wireless earbuds', 'Bluetooth 5.3, 30-hour battery with case.', 2200],
      ['Men\'s sneakers', 'Breathable mesh, sizes 40 to 45.', 2800],
      ['Kids school bag', 'Water resistant, padded straps.', 1500],
      ['Electric kettle 1.8L', 'Stainless steel, auto shut-off.', 1900],
      ['Phone tripod with remote', 'Extends to 1.6m, bluetooth shutter.', 1200],
    ];
    for (const [name, desc, price] of products) {
      await pool.query(
        `INSERT INTO products (period_id, name, description, price_kes, max_qty) VALUES ($1,$2,$3,$4,10)`,
        [period.id, name, desc, price]
      );
    }
    for (const [name, desc, price] of [
      ['Robot vacuum cleaner', 'Auto-charging, app control.', 18000],
      ['Ladies handbags (assorted)', 'Faux leather, three colours.', 2500],
      ['Solar power bank 20000mAh', 'Dual USB, built-in torch.', 2400],
    ]) {
      await pool.query(
        `INSERT INTO proposed_items (name, description, est_price_kes) VALUES ($1,$2,$3)`,
        [name, desc, price]
      );
    }
    console.log('Demo data added: one open period with 6 products, 3 proposed items');
  }
}
await pool.end();
