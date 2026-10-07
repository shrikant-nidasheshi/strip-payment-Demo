# Stripe Payment Demo (Test Mode)

Simple demo: **Stripe.js Elements → PaymentMethod → Express backend → PaymentIntent → result screen.**

## Run it
```bash
npm install
cp .env.example .env      # then paste your Stripe TEST keys
npm start
```
Open http://localhost:3000

Get keys at https://dashboard.stripe.com/test/apikeys (`pk_test_...` and `sk_test_...`).

## Test cards
| Card | Result |
|---|---|
| 4242 4242 4242 4242 | Success |
| 4000 0000 0000 0002 | Declined |
| 4000 0000 0000 9995 | Insufficient funds |
| 4000 0025 0000 3155 | Requires 3D Secure |

Any future expiry, any 3-digit CVC.

## API (backend)
- `GET  /api/config` – publishable key + currency
- `POST /api/payments` – body `{ paymentMethodId, amount (cents), name }` → creates & confirms PaymentIntent
- `GET  /api/payments/:id` – retrieve PaymentIntent status

## Postman
Import `postman/Stripe_Payment_Demo.postman_collection.json`, create an environment with `STRIPE_SECRET_KEY`, run 01 → 02 → 03.

## Structure
```
server.js          Express API + Stripe calls
public/index.html  Payment page
public/style.css   Styling
public/app.js      Stripe Elements + checkout logic
postman/           Postman collection
```
Security: secret key only in `.env` (git-ignored); raw card data never reaches the server.
