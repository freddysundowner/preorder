import 'dotenv/config';

const env = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);

export const config = {
  port: Number(env('PORT', 4000)),
  databaseUrl: env('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/preorder'),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  webOrigin: env('WEB_ORIGIN', 'http://localhost:5173'),
  publicApiUrl: env('PUBLIC_API_URL', 'http://localhost:4000'),
  adminPhone: env('ADMIN_PHONE', '0700000000'),
  adminName: env('ADMIN_NAME', 'Admin'),
  businessName: env('BUSINESS_NAME', 'Preorder Shop'),
  shopLocation: env('SHOP_LOCATION', 'our Nairobi shop'),
  collectionTitle: env('COLLECTION_TITLE', 'Available for preorder'),
  storeHeadline: env('STORE_HEADLINE', 'Preorder now. Collect when it lands.'),
  storeTagline: env('STORE_TAGLINE', 'Pay with M-Pesa, follow your order by SMS, and pick it up with a code.'),
  paybillNumber: env('PAYBILL_NUMBER', '000000'),
  email: {
    enabled: env('EMAIL_ENABLED', 'false') === 'true',
    brevoApiKey: env('BREVO_API_KEY', ''),
    senderName: env('EMAIL_SENDER_NAME', ''),
    senderEmail: env('EMAIL_SENDER_EMAIL', ''),
    replyTo: env('EMAIL_REPLY_TO', ''),
  },
  sms: {
    provider: env('SMS_PROVIDER', 'console'),
    blessedApiKey: env('BLESSED_API_KEY', ''),
    blessedSenderId: env('BLESSED_SENDER_ID', ''),
    blessedEndpoint: env('BLESSED_ENDPOINT', 'https://sms.blessedtexts.com/api/sms/v1/sendsms'),
    username: env('AT_USERNAME', 'sandbox'),
    apiKey: env('AT_API_KEY', ''),
    senderId: env('AT_SENDER_ID', ''),
    sandbox: env('AT_SANDBOX', 'true') === 'true',
  },
  payments: {
    // mock = payments succeed by themselves (testing) | daraja = Safaricom direct | sunpay = SunPay
    provider: env('PAYMENT_PROVIDER', env('MPESA_MODE', 'mock') === 'mock' ? 'mock' : 'daraja'),
    sunpayApiKey: env('SUNPAY_API_KEY', ''),
    sunpayBaseUrl: env('SUNPAY_BASE_URL', 'https://api.sunpay.co.ke/api/v1'),
    sunpayWebhookSecret: env('SUNPAY_WEBHOOK_SECRET', ''),
    settleType: env('SUNPAY_SETTLE_TYPE', 'none'),
    settleShortcode: env('SUNPAY_SETTLE_SHORTCODE', ''),
    settleAccount: env('SUNPAY_SETTLE_ACCOUNT', ''),
  },
  mpesa: {
    mode: env('MPESA_MODE', 'sandbox') === 'mock' ? 'sandbox' : env('MPESA_MODE', 'sandbox'),
    consumerKey: env('MPESA_CONSUMER_KEY', ''),
    consumerSecret: env('MPESA_CONSUMER_SECRET', ''),
    shortcode: env('MPESA_SHORTCODE', '174379'),
    passkey: env('MPESA_PASSKEY', ''),
    transactionType: env('MPESA_TRANSACTION_TYPE', 'CustomerPayBillOnline'),
    callbackSecret: env('MPESA_CALLBACK_SECRET', 'dev-callback-secret'),
  },
};

