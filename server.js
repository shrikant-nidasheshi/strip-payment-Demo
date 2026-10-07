require('dotenv').config();
const express = require('express');
const path = require('path');
const Stripe = require('stripe');

const { STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY } = process.env;
const CURRENCY = (process.env.CURRENCY || 'usd').toLowerCase();
const PORT = process.env.PORT || 3000;

if (!STRIPE_SECRET_KEY || (!STRIPE_SECRET_KEY.startsWith('sk_test_') && !STRIPE_SECRET_KEY.startsWith('rk_test_'))) {
  console.error('\n❌ Set a Stripe TEST secret key (sk_test_... or rk_test_...) in .env  (see .env.example)\n');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Only the publishable key + currency are sent to the browser
app.get('/api/config', (req, res) => {
  res.json({ publishableKey: STRIPE_PUBLISHABLE_KEY, currency: CURRENCY });
});

// Shape the PaymentIntent into what the frontend needs
const toResult = (pi) => ({
  id: pi.id,
  status: pi.status,
  amount: pi.amount,
  currency: pi.currency,
  chargeId: pi.latest_charge || null,
  paymentMethodId: typeof pi.payment_method === 'string' ? pi.payment_method : null,
  clientSecret: pi.status === 'requires_action' ? pi.client_secret : undefined,
  created: pi.created || Math.floor(Date.now() / 1000),
});

// Create + confirm a PaymentIntent from a PaymentMethod ID
app.post('/api/payments', async (req, res) => {
  const { paymentMethodId, amount, name } = req.body || {};

  if (!paymentMethodId || !String(paymentMethodId).startsWith('pm_'))
    return res.status(400).json({ error: 'A valid paymentMethodId is required.' });
  if (!Number.isInteger(amount) || amount < 50 || amount > 99999900)
    return res.status(400).json({ error: 'Amount must be an integer in cents (minimum 50).' });

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount,
        currency: CURRENCY,
        payment_method: paymentMethodId,
        confirm: true,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        description: `Demo payment${name ? ' - ' + String(name).slice(0, 60) : ''}`,
      },
      // Stops accidental duplicate charges if the browser retries
      req.get('Idempotency-Key') ? { idempotencyKey: req.get('Idempotency-Key') } : undefined
    );
    res.json(toResult(pi));
  } catch (err) {
    if (err.type === 'StripeCardError') {
      // Declined card: safe, human-readable message from Stripe
      return res.status(402).json({
        error: err.message,
        code: err.code,
        decline_code: err.decline_code,
        paymentIntentId: err.payment_intent && err.payment_intent.id,
      });
    }
    console.error('Stripe error:', err.type, err.message);
    if (err.type === 'StripeAuthenticationError')
      return res.status(500).json({ error: 'Server payment configuration error.' });
    res.status(502).json({ error: 'Could not reach the payment provider. Please retry.' });
  }
});

// Retrieve a PaymentIntent (used for verification)
app.get('/api/payments/:id', async (req, res) => {
  try {
    res.json(toResult(await stripe.paymentIntents.retrieve(req.params.id)));
  } catch (err) {
    res.status(404).json({ error: 'Payment not found.' });
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`\n✅ Stripe demo running at http://localhost:${PORT}\n`));
}

module.exports = app;
