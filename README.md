# Preorder System

Customers order imported goods during a shipping round, pay by M-Pesa, follow the shipment by SMS and collect at the shop with a pickup code. Admins run rounds, approve payments, move the whole batch through shipping stages and release orders at the collection desk.

- `server/` – Node.js + Express API on PostgreSQL
- `web/` – React (Vite) app for customers and admin

## Run it locally

You need Node.js 20+ and PostgreSQL 14+.

```bash
# 1. Database
createdb preorder

# 2. API
cd server
cp .env.example .env          # set DATABASE_URL and ADMIN_PHONE at least
npm install
npm run seed -- --demo        # creates the admin account + sample products (drop --demo for a clean start)
npm run dev                   # http://localhost:4000

# 3. Web app (second terminal)
cd web
npm install
npm run dev                   # http://localhost:5173
```

Log in with the `ADMIN_PHONE` number. In development (`SMS_PROVIDER=console`) the login code is shown on screen and every SMS is printed in the API terminal, so you don't need real SMS or M-Pesa to try it. With `MPESA_MODE=mock`, pressing "Pay with M-Pesa" marks the order paid after about 4 seconds.

## Clickable demo

`cd web && npm run build:demo` builds `web/dist-demo/preorder-demo.html`: the same app with the server simulated in the browser (sample data, fake M-Pesa, SMS shown as pop-ups). It's for showing the client, not for real use. The real build (`npm run build`) contains none of the demo code.

## Going live

1. **Build the web app:** `cd web && npm run build`. The API serves `web/dist` automatically, so you only need to run one process: `cd server && npm start`.
2. **Host:** any VPS or Railway/Render. Put it behind HTTPS (Safaricom requires HTTPS callback URLs). Set `PUBLIC_API_URL` to the public address and `WEB_ORIGIN` to the same address.
3. **Database:** migrations run automatically when the API starts (`003_simplify_stages.sql` converts old Draft and shipping stages).
4. **SMS (Africa's Talking):** set `SMS_PROVIDER=africastalking`, `AT_USERNAME`, `AT_API_KEY`, `AT_SANDBOX=false` and `AT_SENDER_ID` once your sender ID is approved. Set the delivery-report URL in the Africa's Talking dashboard to `https://YOUR-DOMAIN/api/webhooks/sms/delivery`.
5. **M-Pesa (Daraja):** set `MPESA_MODE=sandbox` first, then `production`, with your consumer key/secret, shortcode, passkey and a random `MPESA_CALLBACK_SECRET`. Use `CustomerBuyGoodsOnline` as `MPESA_TRANSACTION_TYPE` if you use a Till.
6. **Paybill payments made from the M-Pesa menu:** register the C2B URLs once by calling `POST /api/admin/mpesa/register-c2b` as an admin (for example with curl and your login token). Customers use the order number (e.g. `PO1001`) as the account number. Payments with a wrong account number land in Admin → Payments → Unmatched, where you apply them to the right order.
7. **Change `JWT_SECRET`** to a long random string.

## How it works

**A shipping round** has products, an opening time and a closing time. Its status moves the whole batch:

Open for orders → Orders closed → On the way → Ready for collection → Completed

- A new round is open as soon as you create it. Customers can order from the opening time, and opted-in customers get an SMS then.
- 24 hours before closing, customers with unpaid orders or full carts get a reminder.
- At closing time the round closes automatically. Unpaid orders are cancelled (part-paid ones are marked for refund) and those customers are told by SMS.
- **On the way** (one button, optional arrival date) sends one bulk SMS to every paid customer. Changing only the arrival date also notifies them.
- **Ready for collection** sends each paid customer their own 6-digit pickup code.
- The round completes by itself once every paid order is collected or delivered.
- **Pickup orders:** at the collection desk, staff search by phone or order number, enter the code, record who collected, and the customer gets a confirmation SMS.
- **Delivery orders:** the customer gives an address and phone at checkout (and pays `DELIVERY_FEE_KES` if you set one). When the round is ready they get an SMS saying it will be delivered, with no code. Staff open the order in Admin → Orders and press **Mark delivered**, and the customer gets a confirmation SMS. Use the "Deliveries to make" filter to see what is left.

So a paid customer gets three SMS: payment received, goods on the way, and ready (with a code for pickup, or a delivery notice).

**Payments:** M-Pesa STK push from the order page, Paybill from the M-Pesa menu (account = order number), or recorded manually by an admin. Payments are matched to orders automatically and each M-Pesa code is only counted once. Overpayments and payments on cancelled orders are recorded as refunds due.

**Supplier minimums:** if a product doesn't reach its minimum, cancel it on the round page. It's removed from every order, paid customers get a refund recorded, and everyone affected gets an SMS. Mark refunds as sent from the order details.

**Coming soon:** add items you're considering; customers tap "I want this" and you see counts to decide what to import next.

**Roles:** Admin (everything) and Shop staff (collection desk and order lookup). Add team members in Admin → People.

## Defaults you may want to change

These came from assumptions in the plan; confirm them with the client:

| Behaviour | Where to change it |
| --- | --- |
| Full payment upfront (part payments are allowed but the order only counts once fully paid) | `server/src/services/orders.js` → `applyPayment` |
| Customers can cancel until the round closes | `server/src/routes/shop.js` → `/orders/:id/cancel` |
| Reminder 24 hours before closing | `server/src/jobs.js` |
| SMS wording | `server/src/services/orders.js` and `server/src/routes/shop.js` |
| Business name, shop location, Paybill number, delivery fee | `server/.env` |

## Project layout

```
server/
  migrations/001_init.sql   database tables
  src/index.js              app entry, serves web/dist in production
  src/jobs.js               announce / remind / auto-close, every minute
  src/routes/               auth, shop (customer), admin, webhooks
  src/services/             orders (business rules), mpesa, sms
web/
  src/pages/                customer screens
  src/pages/admin/          admin screens
  src/components/           tracker, layout, shared UI
```
