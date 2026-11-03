// In-browser stand-in for the API, used only by the demo build.
// It follows the same rules as server/src (payments, batch status, closing, collection).

const KEY = 'preorder_demo_v1';
const BIZ = 'Preorder Shop';
const SHOP = 'our Nairobi shop';
const PAYBILL = '522533';
export const DEMO_ADMIN_PHONE = '0700000001';

const STAGES = ['open', 'closed', 'in_transit', 'ready_for_collection', 'completed'];
const STAGE_LABELS = {
  open: 'Open for orders', closed: 'Orders closed', in_transit: 'On the way',
  ready_for_collection: 'Ready for collection', completed: 'Completed',
};

// ---------- helpers ----------
const now = () => new Date().toISOString();
const ago = (days, hours = 0) => new Date(Date.now() - (days * 864e5 + hours * 36e5)).toISOString();
const ahead = (days, hours = 0) => new Date(Date.now() + days * 864e5 + hours * 36e5).toISOString();
const dateOnly = (iso) => iso.slice(0, 10);
const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE');
const fmtDate = (d) => {
  if (!d) return '';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T12:00:00') : new Date(d);
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });
};
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const int = (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; };
const displayPhone = (p) => (p && p.startsWith('254') ? '0' + p.slice(3) : p || '');
function normalizePhone(input) {
  if (!input) return null;
  let p = String(input).replace(/[\s\-()+]/g, '');
  if (/^0[17]\d{8}$/.test(p)) p = '254' + p.slice(1);
  else if (/^[17]\d{8}$/.test(p)) p = '254' + p;
  return /^254[17]\d{8}$/.test(p) ? p : null;
}
class HttpErr extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m) => new HttpErr(400, m);
const notFound = (m = 'Not found') => new HttpErr(404, m);

// ---------- store ----------
let db = null;
let memoryOnly = false;

function load() {
  if (db) return db;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) db = JSON.parse(raw);
  } catch { memoryOnly = true; }
  if (!db) db = seed();
  return db;
}
function save() {
  if (memoryOnly) return;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { memoryOnly = true; }
}
export function resetDemo() {
  db = seed();
  save();
}
const nextId = (table) => { db.seq[table] = (db.seq[table] || 0) + 1; return db.seq[table]; };
function insert(table, row) { const r = { id: nextId(table), ...row }; db[table].push(r); return r; }

// ---------- SMS ----------
function sms(list, template) {
  const msgs = (Array.isArray(list) ? list : [list]).filter((m) => m && m.phone && m.body);
  for (const m of msgs) {
    insert('sms', { user_id: m.userId || null, phone: m.phone, template, body: m.body, status: 'Success', sent_at: now() });
  }
  if (msgs.length && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('demo:sms', { detail: { template, messages: msgs } }));
  }
}
function audit(actorId, action, entity, entityId, data) {
  insert('audit', { actor_id: actorId || null, action, entity, entity_id: entityId == null ? null : String(entityId), data: data || null, created_at: now() });
}

// ---------- seed ----------
function seed() {
  db = {
    seq: {}, users: [], otps: [], periods: [], products: [], cart: [], orders: [], items: [], payments: [],
    events: [], proposed: [], interests: [], sms: [], audit: [], orderSeq: 1001,
  };
  const u = (name, phone, role = 'customer', days = 40) =>
    insert('users', { name, phone: normalizePhone(phone), email: null, role, sms_opt_in: true, created_at: ago(days) });
  const admin = u('Fred (Admin)', DEMO_ADMIN_PHONE, 'admin', 60);
  u('Mary Akinyi', '0745111222', 'staff', 50);
  const people = [
    u('Grace Wambui', '0711223344'), u('Kevin Otieno', '0722334455'), u('Faith Chebet', '0733445566'),
    u('Brian Mwangi', '0744556677'), u('Esther Njeri', '0755667788'), u('Dennis Kiprop', '0766778899'),
    u('Lucy Atieno', '0777889900', 'customer', 10), u('Samuel Kamau', '0788990011', 'customer', 6),
  ];

  const period = (name, opensDays, closesDays, status, etaDays) =>
    insert('periods', {
      name, opens_at: ago(opensDays), closes_at: closesDays < 0 ? ahead(-closesDays) : ago(closesDays), status,
      eta_date: etaDays == null ? null : dateOnly(etaDays < 0 ? ahead(-etaDays) : ago(etaDays)),
      reminder_sent_at: null, announced_at: ago(opensDays), created_by: admin.id, created_at: ago(opensDays + 1),
    });
  const product = (p, name, description, price, extra = {}) =>
    insert('products', { period_id: p.id, name, description, price_kes: price, image_url: null, min_qty: null, max_qty: 10, status: 'active', created_at: p.created_at, ...extra });
  const event = (p, status, daysAgo, eta) =>
    insert('events', { period_id: p.id, status, note: null, eta_date: eta || p.eta_date, created_by: admin.id, created_at: ago(daysAgo) });

  // Make an order with items; pay it fully if paid=true
  const order = (user, p, lines, { paid = true, daysAgo = 20, partial = 0, receipt } = {}) => {
    const total = lines.reduce((s, [pr, q]) => s + pr.price_kes * q, 0);
    const o = insert('orders', {
      order_no: `PO${db.orderSeq++}`, user_id: user.id, period_id: p.id, total_kes: total,
      paid_kes: paid ? total : partial, refund_due_kes: 0, payment_status: paid ? 'paid' : 'unpaid',
      pickup_code: null, collected_at: null, collected_by_name: null, collected_by_phone: null, released_by: null,
      paid_at: paid ? ago(daysAgo - 0.1) : null, created_at: ago(daysAgo),
    });
    for (const [pr, q] of lines) insert('items', { order_id: o.id, product_id: pr.id, product_name: pr.name, qty: q, unit_price_kes: pr.price_kes, status: 'active' });
    if (paid || partial) {
      insert('payments', {
        order_id: o.id, method: 'stk', checkout_request_id: null, mpesa_receipt: receipt || 'S' + digits(2) + Math.random().toString(36).slice(2, 9).toUpperCase(),
        phone: user.phone, amount_kes: paid ? total : partial, status: 'approved', result_desc: null, approved_by: null,
        approved_at: ago(daysAgo - 0.1), created_at: ago(daysAgo - 0.1),
      });
    }
    return o;
  };

  // October: arrived, ready for collection
  const oct = period('October shipment', 52, 38, 'ready_for_collection', 2);
  const o1 = product(oct, 'Non-stick cookware set', '7 pieces, induction compatible.', 5800);
  const o2 = product(oct, 'Bluetooth speaker', 'Waterproof, 12-hour battery.', 2600);
  const o3 = product(oct, 'Ladies sandals', 'Sizes 36 to 41, three colours.', 1400);
  event(oct, 'closed', 38); event(oct, 'in_transit', 27); event(oct, 'ready_for_collection', 2);
  const ready = [
    order(people[0], oct, [[o1, 1], [o3, 2]], { daysAgo: 45 }),
    order(people[1], oct, [[o2, 2]], { daysAgo: 44 }),
    order(people[2], oct, [[o1, 1]], { daysAgo: 41 }),
    order(people[3], oct, [[o3, 1], [o2, 1]], { daysAgo: 40 }),
  ];
  ready.forEach((o, i) => {
    o.pickup_code = ['482916', '730551', '119384', '605227'][i];
    const usr = db.users.find((x) => x.id === o.user_id);
    insert('sms', { user_id: usr.id, phone: usr.phone, template: 'ready_for_collection', status: 'Success', sent_at: ago(2),
      body: `${BIZ}: Your order ${o.order_no} is ready for collection at ${SHOP}. Pickup code: ${o.pickup_code}. Show this code when collecting.` });
  });
  Object.assign(ready[2], { collected_at: ago(1, 3), collected_by_name: 'Faith Chebet', collected_by_phone: people[2].phone, released_by: 2 });

  // November: in transit
  const nov = period('November shipment', 30, 16, 'in_transit', -9);
  const n1 = product(nov, 'Standing fan 16"', 'Three speeds, remote control.', 3900);
  const n2 = product(nov, 'Kids bicycle', 'Ages 5 to 8, training wheels.', 7200, { min_qty: 5 });
  const n3 = product(nov, 'Hair dryer 2000W', 'Two heat settings, cool shot.', 1800);
  event(nov, 'closed', 16); event(nov, 'in_transit', 8);
  order(people[4], nov, [[n1, 2]], { daysAgo: 28 });
  order(people[5], nov, [[n2, 1], [n3, 1]], { daysAgo: 25 });
  order(people[0], nov, [[n3, 2]], { daysAgo: 22 });
  order(people[6], nov, [[n2, 2]], { daysAgo: 19 });
  order(people[1], nov, [[n1, 1], [n2, 2]], { daysAgo: 18 });

  // December: open for orders
  const dec = period('December shipment', 3, -11, 'open', -40);
  const d = [
    product(dec, 'Air fryer 6L', 'Digital touch panel, 1500W, non-stick basket.', 6500, { min_qty: 10 }),
    product(dec, 'Wireless earbuds', 'Bluetooth 5.3, 30-hour battery with case.', 2200),
    product(dec, "Men's sneakers", 'Breathable mesh, sizes 40 to 45.', 2800),
    product(dec, 'Kids school bag', 'Water resistant, padded straps.', 1500),
    product(dec, 'Electric kettle 1.8L', 'Stainless steel, auto shut-off.', 1900),
    product(dec, 'Phone tripod with remote', 'Extends to 1.6m, bluetooth shutter.', 1200),
  ];
  order(people[2], dec, [[d[0], 2], [d[4], 1]], { daysAgo: 2.5 });
  order(people[3], dec, [[d[1], 1]], { daysAgo: 2 });
  order(people[7], dec, [[d[0], 1], [d[2], 1]], { daysAgo: 1.5 });
  order(people[4], dec, [[d[3], 3]], { paid: false, daysAgo: 1 });
  order(people[5], dec, [[d[0], 1]], { paid: false, partial: 3000, daysAgo: 0.8 });

  // A Paybill payment with a wrong account number, waiting to be matched
  insert('payments', {
    order_id: null, method: 'paybill', checkout_request_id: null, mpesa_receipt: 'SKD4' + 'T7QW2LZ', phone: people[4].phone,
    amount_kes: 4500, status: 'unmatched', result_desc: 'Account "ESTHER" not found', approved_by: null, approved_at: null, created_at: ago(0, 5),
  });

  // Coming soon
  const prop = [
    insert('proposed', { name: 'Robot vacuum cleaner', description: 'Auto-charging, app control.', image_url: null, est_price_kes: 18000, active: true, created_at: ago(9) }),
    insert('proposed', { name: 'Solar power bank 20000mAh', description: 'Dual USB, built-in torch.', image_url: null, est_price_kes: 2400, active: true, created_at: ago(8) }),
    insert('proposed', { name: 'Ladies handbags (assorted)', description: 'Faux leather, three colours.', image_url: null, est_price_kes: 2500, active: true, created_at: ago(5) }),
  ];
  [[0, 2], [0, 4], [1, 0], [1, 1], [1, 3], [1, 5], [1, 6], [2, 2], [2, 7]].forEach(([pi, ui]) =>
    insert('interests', { proposed_item_id: prop[pi].id, user_id: people[ui].id, qty: 1, created_at: ago(3) }));

  // A few historic SMS for the log
  for (const o of db.orders.filter((x) => x.period_id === nov.id)) {
    const usr = db.users.find((x) => x.id === o.user_id);
    insert('sms', { user_id: usr.id, phone: usr.phone, template: 'status_in_transit', status: 'Success', sent_at: ago(3),
      body: `${BIZ}: Good news, your November shipment preorder is in transit. Expected arrival: ${fmtDate(nov.eta_date)}.` });
  }
  db.sms.sort((a, b) => a.sent_at.localeCompare(b.sent_at));
  return db;
}

// ---------- lookups ----------
const userById = (id) => db.users.find((u) => u.id === id);
const periodById = (id) => db.periods.find((p) => p.id === id);
const productById = (id) => db.products.find((p) => p.id === id);
const orderById = (id) => db.orders.find((o) => o.id === id);
const itemsOf = (oid) => db.items.filter((i) => i.order_id === oid);
const publicUser = (u) => ({ id: u.id, name: u.name, phone: u.phone, email: u.email, role: u.role, sms_opt_in: u.sms_opt_in });

function currentPeriod() {
  const t = Date.now();
  return db.periods
    .filter((p) => p.status === 'open' && new Date(p.opens_at) <= t && new Date(p.closes_at) > t)
    .sort((a, b) => a.closes_at.localeCompare(b.closes_at))[0] || null;
}

// ---------- business rules (mirror server/src/services/orders.js) ----------
function applyPayment(orderId, amount, receipt) {
  const o = orderById(orderId);
  const u = userById(o.user_id);
  const paid = o.paid_kes + amount;
  let body;
  if (['cancelled', 'refund_pending', 'refunded'].includes(o.payment_status)) {
    o.payment_status = 'refund_pending'; o.refund_due_kes += amount;
    body = `${BIZ}: We received ${kes(amount)} for order ${o.order_no}, but this order is closed. A refund will be processed.`;
  } else if (paid >= o.total_kes) {
    if (paid > o.total_kes) o.refund_due_kes += paid - o.total_kes;
    o.payment_status = 'paid'; o.paid_at = o.paid_at || now();
    body = `${BIZ}: Payment of ${kes(amount)} received for order ${o.order_no}${receipt ? ` (${receipt})` : ''}. Your order is confirmed. Thank you!`;
  } else {
    body = `${BIZ}: Payment of ${kes(amount)} received for order ${o.order_no}. Balance ${kes(o.total_kes - paid)}.`;
  }
  o.paid_kes = paid;
  sms({ userId: u.id, phone: u.phone, body }, 'payment_received');
}

function paidActiveOrders(periodId) {
  return db.orders.filter((o) => o.period_id === periodId && o.payment_status === 'paid' && !o.collected_at);
}

function closePeriod(p, actorId) {
  if (p.status !== 'open') return;
  p.status = 'closed';
  const msgs = [];
  for (const o of db.orders.filter((x) => x.period_id === p.id && x.payment_status === 'unpaid')) {
    const u = userById(o.user_id);
    o.payment_status = o.paid_kes > 0 ? 'refund_pending' : 'cancelled';
    o.refund_due_kes += o.paid_kes;
    msgs.push({ userId: u.id, phone: u.phone, body: o.paid_kes > 0
      ? `${BIZ}: Orders have closed and order ${o.order_no} was not fully paid. It has been cancelled and your ${kes(o.paid_kes)} will be refunded.`
      : `${BIZ}: Orders have closed. Order ${o.order_no} was not paid and has been cancelled.` });
  }
  db.cart = db.cart.filter((c) => productById(c.product_id)?.period_id !== p.id);
  audit(actorId, 'period.closed', 'period', p.id, { cancelledOrders: msgs.length });
  sms(msgs, 'unpaid_cancelled');
}

function announce(p) {
  p.announced_at = now();
  sms(db.users.filter((u) => u.role === 'customer' && u.sms_opt_in).map((u) => ({
    userId: u.id, phone: u.phone, body: `${BIZ}: New items are open for preorder (${p.name}). Order before ${fmtDate(p.closes_at)}.`,
  })), 'period_opened');
}

function remind(p) {
  p.reminder_sent_at = now();
  const ids = new Set([
    ...db.orders.filter((o) => o.period_id === p.id && o.payment_status === 'unpaid').map((o) => o.user_id),
    ...db.cart.filter((c) => productById(c.product_id)?.period_id === p.id).map((c) => c.user_id),
  ]);
  const users = [...ids].map(userById).filter((u) => u.sms_opt_in);
  sms(users.map((u) => ({ userId: u.id, phone: u.phone,
    body: `${BIZ}: Orders for ${p.name} close on ${fmtDate(p.closes_at)}. Complete your order and payment to secure your items.` })), 'closing_reminder');
  return users.length;
}

const SHIPPING_MSG = {
  in_transit: (n) => `your ${n} preorder is on the way.`,
};

function setPeriodStatus(p, newStatus, { etaDate, note, actorId }) {
  if (!STAGES.includes(newStatus)) throw bad('Unknown status');
  const from = STAGES.indexOf(p.status);
  const to = STAGES.indexOf(newStatus);
  const etaChanged = etaDate !== undefined && (etaDate || null) !== (p.eta_date || null);
  if (to < from) throw bad(`Cannot move back from "${STAGE_LABELS[p.status]}" to "${STAGE_LABELS[newStatus]}"`);
  if (to === from && !etaChanged && !note) throw bad('Nothing to update');
  if (from === 0 && to > 1) throw bad('Close the period for orders before moving to shipping stages');

  const prev = p.status;
  if (newStatus === 'closed' && p.status !== 'closed') closePeriod(p, actorId);
  else { p.status = newStatus; if (etaDate) p.eta_date = etaDate; }
  if (etaDate) p.eta_date = etaDate;

  insert('events', { period_id: p.id, status: newStatus, note: note || null, eta_date: p.eta_date || null, created_by: actorId, created_at: now() });
  audit(actorId, 'period.status', 'period', p.id, { from: prev, to: newStatus, etaDate, note });

  if (to < STAGES.indexOf('in_transit')) return;
  const orders = paidActiveOrders(p.id);
  if (newStatus === 'ready_for_collection') {
    sms(orders.map((o) => {
      const u = userById(o.user_id);
      if (o.fulfilment === 'delivery') {
        return { userId: u.id, phone: u.phone, body: `${BIZ}: Your order ${o.order_no} has arrived and will be delivered to ${o.delivery_address}. We will call ${displayPhone(o.delivery_phone || u.phone)} to arrange the delivery. No code is needed.` };
      }
      o.pickup_code = digits(6);
      return { userId: u.id, phone: u.phone, body: `${BIZ}: Your order ${o.order_no} is ready for collection at ${SHOP}. Pickup code: ${o.pickup_code}. Show this code when collecting.` };
    }), 'ready_for_collection');
    return;
  }
  if (newStatus === 'completed') return;
  const eta = p.eta_date ? ` Expected arrival: ${fmtDate(p.eta_date)}.` : '';
  let body;
  if (to === from && etaChanged) body = `${BIZ}: Update on your ${p.name} preorder.${eta || ' The arrival date has changed.'}`;
  else if (SHIPPING_MSG[newStatus]) body = `${BIZ}: Good news, ${SHIPPING_MSG[newStatus](p.name)}${eta}`;
  else return;
  if (note) body += ` ${note}`;
  sms(orders.map((o) => { const u = userById(o.user_id); return { userId: u.id, phone: u.phone, body }; }), `status_${newStatus}`);
}

function cancelProduct(pr, actorId) {
  pr.status = 'cancelled';
  db.cart = db.cart.filter((c) => c.product_id !== pr.id);
  const msgs = [];
  for (const it of db.items.filter((i) => i.product_id === pr.id && i.status === 'active')) {
    it.status = 'cancelled';
    const o = orderById(it.order_id);
    const amount = it.qty * it.unit_price_kes;
    const newTotal = o.total_kes - amount;
    let refund = 0;
    if (o.payment_status === 'paid') {
      refund = Math.min(amount, o.paid_kes);
      if (newTotal <= 0) o.payment_status = 'refund_pending';
    } else if (o.payment_status === 'unpaid') {
      if (o.paid_kes > newTotal) refund = o.paid_kes - Math.max(newTotal, 0);
      if (newTotal <= 0) o.payment_status = o.paid_kes > 0 ? 'refund_pending' : 'cancelled';
      else if (o.paid_kes >= newTotal) o.payment_status = 'paid';
    }
    o.total_kes = Math.max(newTotal, 0);
    o.refund_due_kes += refund;
    const u = userById(o.user_id);
    msgs.push({ userId: u.id, phone: u.phone, body: `${BIZ}: Sorry, ${pr.name} in order ${o.order_no} will not be shipped this round.` +
      (refund > 0 ? ` A refund of ${kes(refund)} will be processed.` : ' It has been removed from your order.') });
  }
  audit(actorId, 'product.cancelled', 'product', pr.id, { orders: msgs.length });
  sms(msgs, 'product_cancelled');
  return msgs.length;
}

// Periodic jobs, run before every request in the demo
function runJobs() {
  const t = Date.now();
  for (const p of db.periods) {
    if (p.status !== 'open') continue;
    if (!p.announced_at && new Date(p.opens_at) <= t && new Date(p.closes_at) > t) announce(p);
    if (!p.reminder_sent_at && new Date(p.closes_at) > t && new Date(p.closes_at) - t <= 864e5 && t - new Date(p.opens_at) >= 36e5) remind(p);
    if (new Date(p.closes_at) <= t) {
      closePeriod(p, null);
      insert('events', { period_id: p.id, status: 'closed', note: 'Closed automatically at closing time', eta_date: p.eta_date, created_by: null, created_at: now() });
    }
  }
}

// ---------- shaping responses ----------
const DELIVERY_FEE = 300;
const isReady = (o, p) => (o.fulfilment === 'delivery' ? ['ready_for_collection', 'completed'].includes(p.status) : !!o.pickup_code);

function completeIfAllCollected(p, actorId) {
  if (p.status === 'ready_for_collection' && !db.orders.some((x) => x.period_id === p.id && x.payment_status === 'paid' && !x.collected_at)) {
    p.status = 'completed';
    insert('events', { period_id: p.id, status: 'completed', note: 'All orders collected', eta_date: p.eta_date || null, created_by: actorId, created_at: now() });
  }
}

function orderDetail(o) {
  const p = periodById(o.period_id);
  const u = userById(o.user_id);
  const { pickup_code, ...rest } = o;
  return {
    ...rest, ready: isReady(o, p), period_name: p.name, period_status: p.status, eta_date: p.eta_date, closes_at: p.closes_at,
    customer_name: u.name, customer_phone: u.phone,
    items: itemsOf(o.id),
    payments: db.payments.filter((x) => x.order_id === o.id).slice().reverse(),
    events: db.events.filter((e) => e.period_id === o.period_id && e.created_at >= o.created_at),
  };
}
function cartFor(userId) {
  const period = currentPeriod();
  if (!period) return { period: null, items: [], total: 0 };
  const items = db.cart
    .filter((c) => c.user_id === userId)
    .map((c) => ({ c, p: productById(c.product_id) }))
    .filter(({ p }) => p && p.period_id === period.id && p.status === 'active')
    .map(({ c, p }) => ({ id: c.id, qty: c.qty, product_id: p.id, name: p.name, price_kes: p.price_kes, image_url: p.image_url, max_qty: p.max_qty }));
  return { period, items, total: items.reduce((s, i) => s + i.qty * i.price_kes, 0) };
}
const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const qtyFor = (productId, status) => sumBy(
  db.items.filter((i) => i.product_id === productId && i.status === 'active' && orderById(i.order_id)?.payment_status === status), (i) => i.qty);

// ---------- routes ----------
const routes = [];
const route = (method, pattern, opts, fn) => {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, fn, ...opts });
};

route('GET', '/info', { open: true }, () => ({ businessName: BIZ, shopLocation: SHOP, collectionTitle: 'Available for preorder', storeHeadline: 'Preorder now. Collect when it lands.', storeTagline: 'Pay with M-Pesa, follow your order by SMS, and pick it up with a code.', paybillNumber: PAYBILL, mpesaMode: 'mock', deliveryFeeKes: DELIVERY_FEE }));

// auth
route('POST', '/auth/request-otp', { open: true }, ({ body }) => {
  const phone = normalizePhone(body.phone);
  if (!phone) throw bad('Enter a valid Safaricom/Airtel number, e.g. 0712345678');
  const code = digits(6);
  db.otps.push({ phone, code, attempts: 0, expires: Date.now() + 6e5, used: false });
  const user = db.users.find((u) => u.phone === phone);
  return { ok: true, isNew: !user, devCode: code };
});
route('POST', '/auth/verify-otp', { open: true }, ({ body }) => {
  const phone = normalizePhone(body.phone);
  const code = String(body.code || '').trim();
  if (!phone || !code) throw bad('Enter your phone number and the code');
  const otp = db.otps.filter((o) => o.phone === phone && !o.used && o.expires > Date.now()).pop();
  if (!otp) throw bad('Code expired. Request a new one.');
  if (otp.attempts >= 5) throw bad('Too many wrong attempts. Request a new code.');
  if (otp.code !== code) { otp.attempts++; throw bad('Wrong code'); }
  otp.used = true;
  const name = String(body.name || '').trim() || null;
  let user = db.users.find((u) => u.phone === phone);
  if (!user) user = insert('users', { name, phone, email: null, role: 'customer', sms_opt_in: true, created_at: now() });
  else if (name && !user.name) user.name = name;
  return { token: 'demo.' + user.id, user: publicUser(user) };
});
route('GET', '/auth/me', ({ user }) => ({ user: publicUser(user) }));
route('PATCH', '/auth/me', ({ user, body }) => {
  if (body.name?.trim()) user.name = body.name.trim();
  if (body.email?.trim()) user.email = body.email.trim();
  if (typeof body.sms_opt_in === 'boolean') user.sms_opt_in = body.sms_opt_in;
  return { user: publicUser(user) };
});

// shop
route('GET', '/periods/current', { open: true }, () => {
  const period = currentPeriod();
  if (!period) {
    const next = db.periods.filter((p) => p.status === 'open' && new Date(p.opens_at) > Date.now())
      .sort((a, b) => a.opens_at.localeCompare(b.opens_at))[0] || null;
    return { period: null, products: [], next };
  }
  return { period, products: db.products.filter((p) => p.period_id === period.id && p.status === 'active') };
});
route('GET', '/cart', ({ user }) => cartFor(user.id));
route('POST', '/cart/items', ({ user, body }) => {
  const productId = int(body.productId), qty = int(body.qty);
  if (!productId || qty == null || qty < 0) throw bad('Invalid product or quantity');
  const period = currentPeriod();
  if (!period) throw bad('Orders are closed right now');
  const p = productById(productId);
  if (!p || p.period_id !== period.id || p.status !== 'active') throw notFound('This product is not available');
  if (p.max_qty && qty > p.max_qty) throw bad(`You can order at most ${p.max_qty} of this item`);
  const existing = db.cart.find((c) => c.user_id === user.id && c.product_id === productId);
  if (qty === 0) db.cart = db.cart.filter((c) => c !== existing);
  else if (existing) existing.qty = qty;
  else insert('cart', { user_id: user.id, product_id: productId, qty });
  return cartFor(user.id);
});
route('POST', '/orders/checkout', ({ user, body }) => {
  const cart = cartFor(user.id);
  if (!cart.period) throw bad('Orders are closed right now');
  if (!cart.items.length) throw bad('Your cart is empty');
  const delivery = body?.fulfilment === 'delivery';
  const address = String(body?.delivery_address || '').trim();
  if (delivery && address.length < 5) throw bad('Enter your delivery address');
  const fee = delivery ? DELIVERY_FEE : 0;
  const o = insert('orders', {
    order_no: `PO${db.orderSeq++}`, user_id: user.id, period_id: cart.period.id, total_kes: cart.total + fee, paid_kes: 0,
    fulfilment: delivery ? 'delivery' : 'pickup', delivery_address: delivery ? address : null,
    delivery_phone: delivery ? normalizePhone(body.delivery_phone) || user.phone : null, delivery_fee_kes: fee, delivered_at: null,
    refund_due_kes: 0, payment_status: 'unpaid', pickup_code: null, collected_at: null, collected_by_name: null,
    collected_by_phone: null, released_by: null, paid_at: null, created_at: now(),
  });
  for (const it of cart.items) insert('items', { order_id: o.id, product_id: it.product_id, product_name: it.name, qty: it.qty, unit_price_kes: it.price_kes, status: 'active' });
  const ids = new Set(cart.items.map((i) => i.product_id));
  db.cart = db.cart.filter((c) => !(c.user_id === user.id && ids.has(c.product_id)));
  audit(user.id, 'order.created', 'order', o.id, { total: o.total_kes });
  sms({ userId: user.id, phone: user.phone,
    body: `${BIZ}: Order ${o.order_no} received. Total ${kes(o.total_kes)}. Pay via M-Pesa Paybill ${PAYBILL}, Account ${o.order_no}, before ${fmtDate(cart.period.closes_at)}.` }, 'invoice');
  return { order: o };
});
route('GET', '/orders', ({ user }) => ({
  orders: db.orders.filter((o) => o.user_id === user.id).slice().reverse().map((o) => {
    const p = periodById(o.period_id);
    const { pickup_code, ...rest } = o;
    return { ...rest, ready: isReady(o, p), period_name: p.name, period_status: p.status, eta_date: p.eta_date, closes_at: p.closes_at,
      item_count: itemsOf(o.id).filter((i) => i.status === 'active').length };
  }),
}));
route('GET', '/orders/:id', ({ user, params }) => {
  const o = orderById(int(params.id));
  if (!o || o.user_id !== user.id) throw notFound('Order not found');
  return { order: orderDetail(o) };
});
route('POST', '/orders/:id/cancel', ({ user, params }) => {
  const o = orderById(int(params.id));
  if (!o || o.user_id !== user.id) throw notFound('Order not found');
  if (periodById(o.period_id).status !== 'open') throw bad('Orders have closed, so this order can no longer be cancelled');
  if (!['unpaid', 'paid'].includes(o.payment_status)) throw bad('This order is already cancelled');
  o.payment_status = o.paid_kes > 0 ? 'refund_pending' : 'cancelled';
  o.refund_due_kes += o.paid_kes;
  audit(user.id, 'order.cancelled', 'order', o.id, { by: 'customer' });
  sms({ userId: user.id, phone: user.phone, body: `${BIZ}: Order ${o.order_no} has been cancelled.` + (o.paid_kes > 0 ? ` Your ${kes(o.paid_kes)} will be refunded.` : '') }, 'order_cancelled');
  return { ok: true };
});
route('POST', '/orders/:id/pay', ({ user, params, body }) => {
  const o = orderById(int(params.id));
  if (!o || o.user_id !== user.id) throw notFound('Order not found');
  if (o.payment_status !== 'unpaid') throw bad('This order does not need payment');
  if (periodById(o.period_id).status !== 'open') throw bad('Orders have closed for this period');
  const phone = normalizePhone(body.phone || user.phone);
  if (!phone) throw bad('Enter a valid M-Pesa phone number');
  const amount = o.total_kes - o.paid_kes;
  const checkout = 'ws_CO_DEMO_' + Date.now();
  const pay = insert('payments', { order_id: o.id, method: 'stk', checkout_request_id: checkout, mpesa_receipt: null, phone, amount_kes: amount,
    status: 'pending', result_desc: null, approved_by: null, approved_at: null, created_at: now() });
  // Simulate the customer entering their PIN
  setTimeout(() => {
    load();
    if (pay.status !== 'pending') return;
    const receipt = 'S' + Math.random().toString(36).slice(2, 11).toUpperCase();
    Object.assign(pay, { status: 'approved', mpesa_receipt: receipt, approved_at: now(), result_desc: 'The service request is processed successfully.' });
    applyPayment(o.id, amount, receipt);
    save();
  }, 4000);
  return { payment: { id: pay.id, status: 'pending', amount_kes: amount }, message: 'Check your phone and enter your M-Pesa PIN to complete payment.' };
});
route('GET', '/proposed-items', { open: true }, ({ user }) => ({
  items: db.proposed.filter((p) => p.active).slice().reverse().map((p) => ({
    ...p, interest_count: db.interests.filter((i) => i.proposed_item_id === p.id).length,
    my_qty: db.interests.find((i) => i.proposed_item_id === p.id && i.user_id === user?.id)?.qty || null,
  })),
}));
route('POST', '/proposed-items/:id/interest', ({ user, params, body }) => {
  const id = int(params.id);
  if (!db.proposed.find((p) => p.id === id && p.active)) throw notFound('Item not found');
  const qty = Math.max(1, Math.min(100, int(body.qty) || 1));
  const ex = db.interests.find((i) => i.proposed_item_id === id && i.user_id === user.id);
  if (ex) ex.qty = qty; else insert('interests', { proposed_item_id: id, user_id: user.id, qty, created_at: now() });
  return { ok: true };
});
route('DELETE', '/proposed-items/:id/interest', ({ user, params }) => {
  db.interests = db.interests.filter((i) => !(i.proposed_item_id === int(params.id) && i.user_id === user.id));
  return { ok: true };
});

// ---------- admin ----------
const A = { role: 'admin' };
const S = { role: 'staff' };

route('GET', '/admin/overview', S, () => {
  const open = db.periods.filter((p) => p.status === 'open').sort((a, b) => a.closes_at.localeCompare(b.closes_at))[0] || null;
  let openStats = null;
  if (open) {
    const os = db.orders.filter((o) => o.period_id === open.id);
    openStats = {
      orders: os.length,
      paid_orders: os.filter((o) => o.payment_status === 'paid').length,
      unpaid_orders: os.filter((o) => o.payment_status === 'unpaid').length,
      collected_kes: sumBy(os.filter((o) => ['paid', 'unpaid'].includes(o.payment_status)), (o) => o.paid_kes),
      outstanding_kes: sumBy(os.filter((o) => o.payment_status === 'unpaid'), (o) => o.total_kes - o.paid_kes),
    };
  }
  return {
    open, openStats,
    counts: {
      unmatched_payments: db.payments.filter((p) => p.status === 'unmatched').length,
      refunds_pending: db.orders.filter((o) => o.payment_status === 'refund_pending').length,
      awaiting_collection: db.orders.filter((o) => o.pickup_code && !o.collected_at && o.payment_status === 'paid').length,
      customers: db.users.filter((u) => u.role === 'customer').length,
    },
    shipping: db.periods.filter((p) => !['open', 'completed'].includes(p.status))
      .sort((a, b) => b.closes_at.localeCompare(a.closes_at))
      .map((p) => ({ id: p.id, name: p.name, status: p.status, eta_date: p.eta_date,
        paid_orders: db.orders.filter((o) => o.period_id === p.id && o.payment_status === 'paid').length })),
  };
});

function periodInput(b) {
  const name = String(b.name || '').trim();
  const o = b.opens_at ? new Date(b.opens_at) : null;
  const c = b.closes_at ? new Date(b.closes_at) : null;
  if (!name) throw bad('Give the period a name, e.g. "December shipment"');
  if (!o || isNaN(o) || !c || isNaN(c)) throw bad('Set the opening and closing dates');
  if (c <= o) throw bad('Closing date must be after the opening date');
  return { name, opens_at: o.toISOString(), closes_at: c.toISOString(), eta_date: b.eta_date || null };
}
route('GET', '/admin/periods', A, () => ({
  periods: db.periods.slice().sort((a, b) => b.opens_at.localeCompare(a.opens_at)).map((p) => {
    const os = db.orders.filter((o) => o.period_id === p.id);
    const paid = os.filter((o) => o.payment_status === 'paid');
    return { ...p, product_count: db.products.filter((x) => x.period_id === p.id && x.status === 'active').length,
      order_count: os.length, paid_count: paid.length, paid_kes: sumBy(paid, (o) => o.total_kes) };
  }),
}));
route('POST', '/admin/periods', A, ({ user, body }) => {
  const p = insert('periods', { ...periodInput(body), status: 'open', reminder_sent_at: null, announced_at: null, created_by: user.id, created_at: now() });
  audit(user.id, 'period.created', 'period', p.id, { name: p.name });
  return { period: p };
});
route('GET', '/admin/periods/:id', A, ({ params }) => {
  const p = periodById(int(params.id));
  if (!p) throw notFound();
  const os = db.orders.filter((o) => o.period_id === p.id);
  return {
    period: p,
    products: db.products.filter((x) => x.period_id === p.id).map((x) => ({ ...x, paid_qty: qtyFor(x.id, 'paid'), unpaid_qty: qtyFor(x.id, 'unpaid') })),
    events: db.events.filter((e) => e.period_id === p.id).slice().reverse().map((e) => ({ ...e, by_name: userById(e.created_by)?.name || null })),
    stats: {
      orders: os.length, paid: os.filter((o) => o.payment_status === 'paid').length,
      unpaid: os.filter((o) => o.payment_status === 'unpaid').length, collected: os.filter((o) => o.collected_at).length,
      paid_kes: sumBy(os.filter((o) => o.payment_status === 'paid'), (o) => o.total_kes),
    },
  };
});
route('PATCH', '/admin/periods/:id', A, ({ user, params, body }) => {
  const p = periodById(int(params.id));
  if (!p) throw notFound();
  Object.assign(p, periodInput({ ...p, ...body }));
  audit(user.id, 'period.updated', 'period', p.id, { name: p.name });
  return { period: p };
});
route('POST', '/admin/periods/:id/status', A, ({ user, params, body }) => {
  const p = periodById(int(params.id));
  if (!p) throw notFound('Period not found');
  setPeriodStatus(p, body.status, {
    etaDate: body.eta_date === undefined ? undefined : body.eta_date || null,
    note: body.note ? String(body.note).trim().slice(0, 160) : null, actorId: user.id,
  });
  runJobs();
  return { period: p };
});
route('POST', '/admin/periods/:id/remind', A, ({ user, params }) => {
  const p = periodById(int(params.id));
  if (!p || p.status !== 'open') throw bad('Reminders can only be sent while a period is open');
  const sent = remind(p);
  audit(user.id, 'period.reminder', 'period', p.id, { sent });
  return { sent };
});
function supplierRows(pid) {
  return db.products.filter((x) => x.period_id === pid).map((x) => {
    const its = db.items.filter((i) => i.product_id === x.id && i.status === 'active' && orderById(i.order_id).payment_status === 'paid');
    return { id: x.id, name: x.name, price_kes: x.price_kes, min_qty: x.min_qty, status: x.status,
      qty: sumBy(its, (i) => i.qty), value_kes: sumBy(its, (i) => i.qty * i.unit_price_kes), orders: new Set(its.map((i) => i.order_id)).size };
  });
}
route('GET', '/admin/periods/:id/supplier-summary', A, ({ params, query }) => {
  const p = periodById(int(params.id));
  if (!p) throw notFound();
  const rows = supplierRows(p.id);
  if (query.format === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    return { __text: [
      ['Product', 'Quantity', 'Orders', 'Unit price (KES)', 'Value (KES)', 'Supplier minimum', 'Status'].map(esc).join(','),
      ...rows.map((x) => [x.name, x.qty, x.orders, x.price_kes, x.value_kes, x.min_qty ?? '', x.status].map(esc).join(',')),
    ].join('\n') };
  }
  return { period: p, rows };
});

function productInput(b) {
  const name = String(b.name || '').trim();
  const price = int(b.price_kes);
  if (!name) throw bad('Enter a product name');
  if (!price || price <= 0) throw bad('Enter a price in KES');
  return { name, price_kes: price, description: b.description ? String(b.description).trim() : null,
    image_url: b.image_url ? String(b.image_url).trim() : null, min_qty: int(b.min_qty) || null, max_qty: int(b.max_qty) || null };
}
route('POST', '/admin/products', A, ({ user, body }) => {
  const p = periodById(int(body.period_id));
  if (!p) throw bad('Choose a shipping period');
  if (p.status !== 'open') throw bad('This period is closed; add products to a new period');
  const pr = insert('products', { period_id: p.id, ...productInput(body), status: 'active', created_at: now() });
  audit(user.id, 'product.created', 'product', pr.id, { name: pr.name });
  return { product: pr };
});
route('PATCH', '/admin/products/:id', A, ({ user, params, body }) => {
  const pr = productById(int(params.id));
  if (!pr) throw notFound();
  Object.assign(pr, productInput({ ...pr, ...body }));
  audit(user.id, 'product.updated', 'product', pr.id, { name: pr.name });
  return { product: pr };
});
route('POST', '/admin/products/:id/cancel', A, ({ user, params }) => {
  const pr = productById(int(params.id));
  if (!pr) throw notFound('Product not found');
  return { ok: true, ordersAffected: cancelProduct(pr, user.id) };
});
route('DELETE', '/admin/products/:id', A, ({ user, params }) => {
  const id = int(params.id);
  if (db.items.some((i) => i.product_id === id)) throw bad('This product is on orders. Cancel it instead, so customers are refunded and told.');
  db.products = db.products.filter((p) => p.id !== id);
  audit(user.id, 'product.deleted', 'product', id);
  return { ok: true };
});

route('GET', '/admin/payments', A, ({ query }) => ({
  payments: db.payments.filter((p) => !query.status || p.status === query.status).slice().reverse().map((p) => {
    const o = p.order_id ? orderById(p.order_id) : null;
    return { ...p, order_no: o?.order_no || null, customer_name: o ? userById(o.user_id).name : null };
  }),
}));
const findOrderByNo = (no) => {
  const o = db.orders.find((x) => x.order_no === String(no || '').trim().toUpperCase());
  if (!o) throw bad('No order with that number');
  return o;
};
route('POST', '/admin/payments/manual', A, ({ user, body }) => {
  const o = findOrderByNo(body.order_no);
  const amount = int(body.amount_kes);
  const receipt = String(body.mpesa_receipt || '').trim().toUpperCase() || null;
  if (!amount || amount <= 0) throw bad('Enter the amount paid');
  if (receipt && db.payments.some((p) => p.mpesa_receipt === receipt)) throw bad('This M-Pesa receipt has already been recorded');
  insert('payments', { order_id: o.id, method: 'manual', checkout_request_id: null, mpesa_receipt: receipt, phone: null, amount_kes: amount,
    status: 'approved', result_desc: body.note || null, approved_by: user.id, approved_at: now(), created_at: now() });
  applyPayment(o.id, amount, receipt);
  audit(user.id, 'payment.manual', 'order', o.id, { amount, receipt });
  return { ok: true };
});
route('POST', '/admin/payments/:id/match', A, ({ user, params, body }) => {
  const o = findOrderByNo(body.order_no);
  const p = db.payments.find((x) => x.id === int(params.id));
  if (!p || p.status !== 'unmatched') throw bad('Only unmatched payments can be matched');
  Object.assign(p, { order_id: o.id, status: 'approved', approved_by: user.id, approved_at: now() });
  applyPayment(o.id, p.amount_kes, p.mpesa_receipt);
  audit(user.id, 'payment.matched', 'payment', p.id, { order: o.order_no });
  return { ok: true };
});
route('POST', '/admin/payments/:id/reject', A, ({ user, params, body }) => {
  const p = db.payments.find((x) => x.id === int(params.id));
  if (!p || !['pending', 'unmatched'].includes(p.status)) throw bad('Only pending or unmatched payments can be rejected');
  p.status = 'rejected'; p.result_desc = body.note || p.result_desc; p.approved_by = user.id;
  audit(user.id, 'payment.rejected', 'payment', p.id);
  return { ok: true };
});

route('GET', '/admin/orders', S, ({ query }) => {
  const q = String(query.q || '').trim().toLowerCase();
  const ph = normalizePhone(q);
  return {
    orders: db.orders.slice().reverse().filter((o) => {
      const u = userById(o.user_id);
      if (query.periodId && o.period_id !== int(query.periodId)) return false;
      if (query.status && !(o.payment_status === query.status || (query.status === 'collected' && o.collected_at)
        || (query.status === 'to_deliver' && o.fulfilment === 'delivery' && o.payment_status === 'paid' && !o.collected_at && periodById(o.period_id).status === 'ready_for_collection'))) return false;
      if (q && !(o.order_no.toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q) || u.phone === ph)) return false;
      return true;
    }).map((o) => {
      const u = userById(o.user_id); const p = periodById(o.period_id);
      return { id: o.id, order_no: o.order_no, total_kes: o.total_kes, paid_kes: o.paid_kes, refund_due_kes: o.refund_due_kes,
        payment_status: o.payment_status, created_at: o.created_at, collected_at: o.collected_at, collected_by_name: o.collected_by_name,
        fulfilment: o.fulfilment || 'pickup', delivery_address: o.delivery_address || null, delivered_at: o.delivered_at || null,
        customer_name: u.name, customer_phone: u.phone, period_name: p.name, period_status: p.status };
    }),
  };
});
route('GET', '/admin/orders/:id', S, ({ params }) => {
  const o = orderById(int(params.id));
  if (!o) throw notFound();
  return { order: orderDetail(o) };
});
route('POST', '/admin/orders/:id/refunded', A, ({ user, params }) => {
  const o = orderById(int(params.id));
  if (!o || o.refund_due_kes <= 0) throw bad('No refund is due on this order');
  o.refund_due_kes = 0;
  if (o.payment_status === 'refund_pending') o.payment_status = 'refunded';
  audit(user.id, 'order.refunded', 'order', o.id);
  return { order: o };
});

route('POST', '/admin/orders/:id/delivered', S, ({ user, params }) => {
  const o = orderById(int(params.id));
  if (!o) throw notFound('Order not found');
  const p = periodById(o.period_id);
  if (o.fulfilment !== 'delivery') throw bad('This is a pickup order');
  if (o.payment_status !== 'paid') throw bad('This order is not paid');
  if (o.collected_at) throw bad('This order is already delivered');
  if (p.status !== 'ready_for_collection') throw bad('The goods have not arrived yet. Mark the round ready first.');
  Object.assign(o, { delivered_at: now(), collected_at: now(), collected_by_name: 'Delivered', released_by: user.id });
  audit(user.id, 'order.delivered', 'order', o.id, {});
  const c = userById(o.user_id);
  sms({ userId: c.id, phone: c.phone, body: `${BIZ}: Order ${o.order_no} has been delivered. Thank you for shopping with us.` }, 'delivered');
  completeIfAllCollected(p, user.id);
  return { order: o };
});

route('GET', '/admin/collections/lookup', S, ({ query }) => {
  const q = String(query.q || '').trim();
  if (!q) return { orders: [] };
  const ph = normalizePhone(q);
  return {
    orders: db.orders.filter((o) => o.payment_status === 'paid' && o.fulfilment !== 'delivery' && (o.order_no === q.toUpperCase() || userById(o.user_id).phone === ph))
      .slice().reverse().map((o) => {
        const u = userById(o.user_id);
        return { id: o.id, order_no: o.order_no, total_kes: o.total_kes, payment_status: o.payment_status, collected_at: o.collected_at,
          collected_by_name: o.collected_by_name, ready: !!o.pickup_code, customer_name: u.name, customer_phone: u.phone,
          period_name: periodById(o.period_id).name,
          items: itemsOf(o.id).filter((i) => i.status === 'active').map((i) => ({ name: i.product_name, qty: i.qty })) };
      }),
  };
});
route('POST', '/admin/collections', S, ({ user, body }) => {
  const o = db.orders.find((x) => x.order_no === String(body.order_no || '').trim().toUpperCase());
  if (!o) throw notFound('Order not found');
  if (o.payment_status !== 'paid') throw bad('This order is not paid');
  if (o.fulfilment === 'delivery') throw bad('This is a delivery order. Mark it delivered from the Orders page.');
  if (o.collected_at) throw bad(`Already collected on ${fmtDate(o.collected_at)} by ${o.collected_by_name}`);
  if (!o.pickup_code) throw bad('This order is not ready for collection yet');
  if (String(body.code || '').trim() !== o.pickup_code) throw bad('Wrong pickup code');
  const name = String(body.collected_by_name || '').trim();
  if (!name) throw bad('Enter the name of the person collecting');
  const ph = normalizePhone(body.collected_by_phone) || null;
  Object.assign(o, { collected_at: now(), collected_by_name: name, collected_by_phone: ph, released_by: user.id });
  audit(user.id, 'order.collected', 'order', o.id, { name });
  completeIfAllCollected(periodById(o.period_id), user.id);
  const c = userById(o.user_id);
  sms({ userId: c.id, phone: c.phone, body: `${BIZ}: Order ${o.order_no} was collected by ${ph ? `${name}, ${displayPhone(ph)}` : name} on ${fmtDate(o.collected_at)}. Thank you for shopping with us.` }, 'collected');
  return { order: o };
});

route('GET', '/admin/proposed-items', A, () => ({
  items: db.proposed.map((p) => {
    const ints = db.interests.filter((i) => i.proposed_item_id === p.id);
    return { ...p, interested: ints.length, total_qty: sumBy(ints, (i) => i.qty) };
  }).sort((a, b) => (b.active - a.active) || (b.interested - a.interested) || (b.id - a.id)),
}));
route('POST', '/admin/proposed-items', A, ({ user, body }) => {
  const name = String(body.name || '').trim();
  if (!name) throw bad('Enter a name');
  const item = insert('proposed', { name, description: body.description || null, image_url: body.image_url || null,
    est_price_kes: int(body.est_price_kes) || null, active: true, created_at: now() });
  audit(user.id, 'proposed.created', 'proposed_item', item.id);
  return { item };
});
route('PATCH', '/admin/proposed-items/:id', A, ({ params, body }) => {
  const item = db.proposed.find((p) => p.id === int(params.id));
  if (!item) throw notFound();
  if (typeof body.active === 'boolean') item.active = body.active;
  if (body.name) item.name = body.name;
  return { item };
});
route('DELETE', '/admin/proposed-items/:id', A, ({ params }) => {
  const id = int(params.id);
  db.proposed = db.proposed.filter((p) => p.id !== id);
  db.interests = db.interests.filter((i) => i.proposed_item_id !== id);
  return { ok: true };
});

route('GET', '/admin/sms', A, () => {
  const list = db.sms.filter((m) => m.template !== 'otp');
  return {
    messages: list.slice().reverse().slice(0, 300).map((m) => ({ ...m, user_name: userById(m.user_id)?.name || null })),
    stats: { total: list.length, last_30_days: list.filter((m) => Date.now() - new Date(m.sent_at) < 30 * 864e5).length,
      failed: list.filter((m) => /fail|reject/i.test(m.status)).length },
  };
});
route('GET', '/admin/audit', A, () => ({
  rows: db.audit.slice().reverse().slice(0, 300).map((a) => ({ ...a, actor_name: userById(a.actor_id)?.name || null })),
}));
route('GET', '/admin/users', A, ({ query }) => ({
  users: db.users.filter((u) => !query.role || u.role === query.role)
    .sort((a, b) => ({ admin: 0, staff: 1, customer: 2 }[a.role] - { admin: 0, staff: 1, customer: 2 }[b.role]) || b.id - a.id)
    .map((u) => ({ ...publicUser(u), created_at: u.created_at,
      paid_orders: db.orders.filter((o) => o.user_id === u.id && o.payment_status === 'paid').length })),
}));
route('POST', '/admin/users', A, ({ user, body }) => {
  const phone = normalizePhone(body.phone);
  if (!phone) throw bad('Enter a valid phone number');
  if (!['staff', 'admin', 'customer'].includes(body.role)) throw bad('Choose a role');
  let u = db.users.find((x) => x.phone === phone);
  if (u) { u.role = body.role; u.name = u.name || String(body.name || '').trim() || null; }
  else u = insert('users', { name: String(body.name || '').trim() || null, phone, email: null, role: body.role, sms_opt_in: true, created_at: now() });
  audit(user.id, 'user.role', 'user', u.id, { role: body.role });
  return { user: publicUser(u) };
});
route('PATCH', '/admin/users/:id', A, ({ user, params, body }) => {
  const id = int(params.id);
  if (id === user.id) throw bad("You can't change your own role");
  const u = userById(id);
  if (!u) throw notFound();
  u.role = body.role;
  audit(user.id, 'user.role', 'user', id, { role: body.role });
  return { user: publicUser(u) };
});

// ---------- entry point ----------
export async function handle(method, fullPath, body, token) {
  load();
  await new Promise((r) => setTimeout(r, 120)); // feel like a network call
  const [path, qs] = fullPath.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  try {
    runJobs();
    const r = routes.find((x) => x.method === method && x.re.test(path));
    if (!r) throw notFound();
    const m = path.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let user = null;
    if (!r.open) {
      const uid = token && token.startsWith('demo.') ? Number(token.slice(5)) : null;
      user = uid ? userById(uid) : null;
      if (!user) throw new HttpErr(401, 'Please log in');
      if (r.role && !(user.role === 'admin' || user.role === r.role)) throw new HttpErr(403, 'Not allowed');
    }
    const data = r.fn({ user, params, body: body || {}, query });
    save();
    return { status: 200, data };
  } catch (e) {
    save();
    if (e instanceof HttpErr) return { status: e.status, data: { error: e.message } };
    console.error(e);
    return { status: 500, data: { error: 'Something went wrong. Please try again.' } };
  }
}
