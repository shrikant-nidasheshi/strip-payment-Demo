(async function () {
  const $ = (id) => document.getElementById(id);
  const money = (cents, cur = 'usd') =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: cur.toUpperCase() }).format(cents / 100);

  const formatDateTime = (timestamp) => {
    const d = timestamp ? new Date(timestamp * 1000) : new Date();
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Map raw Stripe decline / error codes to human-readable banking explanations
  const humanizeReason = (code, declineCode) => {
    const key = declineCode || code;
    switch (key) {
      case 'insufficient_funds':
        return {
          title: 'Insufficient Funds',
          desc: 'The card issuer declined the charge due to insufficient balance. Please choose another payment method or fund the account.',
        };
      case 'card_declined':
      case 'generic_decline':
      case 'do_not_honor':
        return {
          title: 'Card Declined by Bank',
          desc: 'The card was declined by your bank/issuing authority. Please contact your bank or use a different card.',
        };
      case 'expired_card':
        return {
          title: 'Card Expired',
          desc: 'The card expiration date provided has expired. Please check the date or use a valid card.',
        };
      case 'incorrect_cvc':
        return {
          title: 'Incorrect Security Code',
          desc: 'The 3-digit security code (CVC) provided does not match. Please verify and retry.',
        };
      case 'processing_error':
        return {
          title: 'Bank Processing Error',
          desc: 'A temporary processing timeout occurred with the card issuer. Please try again in a few moments.',
        };
      case 'authentication_required':
        return {
          title: 'Authentication Required',
          desc: '3D Secure customer verification could not be completed. Please authorize the transaction with your banking app.',
        };
      default:
        return {
          title: 'Transaction Failed',
          desc: 'The transaction could not be authorized by the payment network. Please try another card.',
        };
    }
  };

  // ---- Load config & init Stripe ----
  const cfg = await (await fetch('/api/config')).json();
  if (!cfg.publishableKey || (!cfg.publishableKey.startsWith('pk_test_') && !cfg.publishableKey.startsWith('pk_live_'))) {
    document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif;color:#fff">Set STRIPE_PUBLISHABLE_KEY (pk_test_...) in your .env file and restart.</p>';
    return;
  }
  const stripe = Stripe(cfg.publishableKey);
  const elements = stripe.elements({ fonts: [{ cssSrc: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600' }] });
  const style = {
    base: { color: '#eef0ff', fontFamily: 'Inter, sans-serif', fontSize: '15px', '::placeholder': { color: '#5d6390' } },
    invalid: { color: '#ff5d73' },
  };
  const fields = {
    cardNumber: elements.create('cardNumber', { style, showIcon: true }),
    cardExpiry: elements.create('cardExpiry', { style }),
    cardCvc: elements.create('cardCvc', { style }),
  };

  let activeCardBrand = 'CARD';

  Object.entries(fields).forEach(([key, el]) => {
    el.mount('#' + key);
    el.on('focus', () => $(key).classList.add('focus'));
    el.on('blur', () => $(key).classList.remove('focus'));
    el.on('change', (e) => {
      $('err-' + key).textContent = e.error ? e.error.message : '';
      $(key).classList.toggle('invalid', !!e.error);
      if (key === 'cardNumber') {
        activeCardBrand = e.brand && e.brand !== 'unknown' ? e.brand.toUpperCase() : 'CARD';
        $('cvBrand').textContent = activeCardBrand;
      }
    });
  });

  // ---- UI wiring ----
  const amountEl = $('amount'), nameEl = $('name'), btn = $('payBtn');
  const currentCents = () => Math.round(parseFloat(amountEl.value || '0') * 100);

  function refreshAmount() {
    const c = currentCents();
    const txt = isFinite(c) && c > 0 ? money(c, cfg.currency) : '$0.00';
    $('cvAmount').textContent = txt;
    $('btnAmount').textContent = txt;
    document.querySelectorAll('.chips button').forEach((b) =>
      b.classList.toggle('active', Math.round(b.dataset.amt * 100) === c));
  }
  amountEl.addEventListener('input', refreshAmount);
  nameEl.addEventListener('input', () => ($('cvName').textContent = nameEl.value.trim() || 'YOUR NAME'));
  document.querySelectorAll('.chips button').forEach((b) =>
    b.addEventListener('click', () => { amountEl.value = Number(b.dataset.amt).toFixed(2); refreshAmount(); }));
  refreshAmount();

  document.querySelectorAll('.hint').forEach((h) =>
    h.addEventListener('click', () => {
      navigator.clipboard?.writeText(h.dataset.card);
      toast('Card number copied — paste it into the form');
    }));

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }
  const setLoading = (on) => { btn.disabled = on; btn.classList.toggle('loading', on); };

  // ---- Validation ----
  function validate() {
    let ok = true;
    const c = currentCents();
    $('err-amount').textContent = ''; $('err-name').textContent = '';
    amountEl.classList.remove('invalid'); nameEl.classList.remove('invalid');
    if (!c || c < 50) { $('err-amount').textContent = 'Enter an amount of at least $0.50.'; amountEl.classList.add('invalid'); ok = false; }
    if (nameEl.value.trim().length < 2) { $('err-name').textContent = 'Cardholder name is required.'; nameEl.classList.add('invalid'); ok = false; }
    return ok;
  }

  // ---- Render Real Payment Gateway Confirmation / Receipt ----
  function showGatewayResult({
    success,
    title,
    message,
    amountCents,
    currency,
    statusText,
    badgeType,
    details = [],
  }) {
    $('payForm').classList.add('hidden');
    $('result').classList.remove('hidden');

    // Header & Icon
    $('resIcon').className = 'icon ' + (success ? 'ok' : 'bad');
    $('resIcon').innerHTML = success
      ? `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
      : `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

    $('resTitle').textContent = title;
    $('resMsg').textContent = message;

    // Visual Card feedback
    $('cardVisual').className = 'card-visual ' + (success ? 'ok' : 'bad');

    // Top Receipt summary
    $('resAmountLabel').textContent = success ? 'Amount Paid' : 'Attempted Amount';
    $('resAmountDisplay').innerHTML = `${money(amountCents, currency)} <span class="receipt-curr">${(currency || 'usd').toUpperCase()}</span>`;

    const badge = $('resStatusBadge');
    badge.className = 'receipt-status-badge ' + badgeType;
    $('resStatusText').textContent = statusText;

    // Detail Items
    const detailsContainer = $('resDetails');
    detailsContainer.innerHTML = details.map((item) => {
      const copyAttr = item.copyable ? `data-copy="${item.value}" title="Click to copy"` : '';
      const copyIcon = item.copyable ? `
        <svg class="copy-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
        </svg>` : '';
      
      const valHtml = item.highlight
        ? `<span class="val-highlight ${item.highlight}">${item.display || item.value}</span>`
        : `<span class="val-text">${item.display || item.value}</span>`;

      return `
        <div class="receipt-row ${item.fullWidth ? 'full-width' : ''}">
          <span class="row-label">${item.label}</span>
          <div class="row-value ${item.copyable ? 'is-copyable' : ''}" ${copyAttr}>
            ${valHtml}
            ${copyIcon}
          </div>
        </div>
      `;
    }).join('');

    // Attach copy click listeners
    detailsContainer.querySelectorAll('.is-copyable').forEach((el) => {
      el.addEventListener('click', () => {
        const val = el.getAttribute('data-copy');
        if (val) {
          navigator.clipboard?.writeText(val);
          toast('Transaction Reference copied to clipboard');
        }
      });
    });
  }

  // Print button
  $('printBtn').addEventListener('click', () => {
    window.print();
  });

  // Make another payment
  $('againBtn').addEventListener('click', () => {
    $('result').classList.add('hidden');
    $('payForm').classList.remove('hidden');
    $('cardVisual').className = 'card-visual';
    Object.values(fields).forEach((f) => f.clear());
    $('cvBrand').textContent = 'CARD';
    $('cvNumber').textContent = '•••• •••• •••• ••••';
    idempotencyKey = crypto.randomUUID();
  });

  // ---- Submit Payment ----
  let idempotencyKey = crypto.randomUUID();

  $('payForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);

    const cardholderName = nameEl.value.trim();
    const amountInCents = currentCents();

    try {
      // Step 1: Stripe.js creates PaymentMethod
      const { paymentMethod, error } = await stripe.createPaymentMethod({
        type: 'card',
        card: fields.cardNumber,
        billing_details: { name: cardholderName },
      });

      if (error) {
        setLoading(false);
        return;
      }

      const cardBrand = (paymentMethod?.card?.brand || activeCardBrand || 'Card').toUpperCase();
      const cardLast4 = paymentMethod?.card?.last4 || '••••';
      const paymentMethodLabel = `${cardBrand} ending in •••• ${cardLast4}`;

      // Step 2: Backend creates and confirms PaymentIntent
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          paymentMethodId: paymentMethod.id,
          amount: amountInCents,
          name: cardholderName,
        }),
      });

      let data = await res.json();

      if (!res.ok) {
        const reason = humanizeReason(data.code, data.decline_code);
        showGatewayResult({
          success: false,
          title: 'Payment Declined',
          message: data.error || reason.desc,
          amountCents: amountInCents,
          currency: cfg.currency,
          statusText: 'DECLINED',
          badgeType: 'bad',
          details: [
            { label: 'Transaction ID', value: data.paymentIntentId || `REF-${Date.now().toString(36).toUpperCase()}`, copyable: true },
            { label: 'Payment Method', value: paymentMethodLabel },
            { label: 'Bank Status', value: reason.title, highlight: 'bad' },
            { label: 'Date & Time', value: formatDateTime() },
            { label: 'Cardholder', value: cardholderName },
            { label: 'Resolution', value: reason.desc, fullWidth: true },
          ],
        });
        idempotencyKey = crypto.randomUUID();
        return setLoading(false);
      }

      // Step 3 (if needed): 3D Secure verification
      if (data.status === 'requires_action' && data.clientSecret) {
        const r = await stripe.handleNextAction({ clientSecret: data.clientSecret });
        if (r.error) {
          const reason = humanizeReason('authentication_required');
          showGatewayResult({
            success: false,
            title: 'Authentication Failed',
            message: r.error.message || '3D Secure verification failed.',
            amountCents: amountInCents,
            currency: data.currency || cfg.currency,
            statusText: 'FAILED',
            badgeType: 'bad',
            details: [
              { label: 'Transaction ID', value: data.id, copyable: true },
              { label: 'Payment Method', value: paymentMethodLabel },
              { label: 'Failure Reason', value: reason.title, highlight: 'bad' },
              { label: 'Date & Time', value: formatDateTime(data.created) },
              { label: 'Cardholder', value: cardholderName },
            ],
          });
          return setLoading(false);
        }
        const check = await fetch('/api/payments/' + data.id);
        data = await check.json();
      }

      const success = data.status === 'succeeded';

      if (success) {
        showGatewayResult({
          success: true,
          title: 'Payment Successful',
          message: `Thank you, ${cardholderName}! Your transaction has been confirmed.`,
          amountCents: data.amount,
          currency: data.currency,
          statusText: 'COMPLETED',
          badgeType: 'ok',
          details: [
            { label: 'Transaction ID', value: data.id, copyable: true },
            { label: 'Payment Method', value: paymentMethodLabel },
            { label: 'Date & Time', value: formatDateTime(data.created) },
            { label: 'Cardholder', value: cardholderName },
            ...(data.chargeId ? [{ label: 'Gateway Auth Ref', value: data.chargeId, copyable: true }] : []),
            { label: 'Payment Gateway', value: 'Stripe Secure Pay (Test Mode)' },
          ],
        });
      } else {
        showGatewayResult({
          success: false,
          title: 'Payment ' + data.status.replace(/_/g, ' ').toUpperCase(),
          message: 'The transaction is in status: ' + data.status,
          amountCents: data.amount,
          currency: data.currency,
          statusText: data.status.toUpperCase(),
          badgeType: 'bad',
          details: [
            { label: 'Transaction ID', value: data.id, copyable: true },
            { label: 'Payment Method', value: paymentMethodLabel },
            { label: 'Date & Time', value: formatDateTime(data.created) },
            { label: 'Cardholder', value: cardholderName },
          ],
        });
      }
    } catch (err) {
      showGatewayResult({
        success: false,
        title: 'Connection Error',
        message: 'Could not communicate with the payment server. Please verify your connection and try again.',
        amountCents: amountInCents,
        currency: cfg.currency,
        statusText: 'NETWORK ERROR',
        badgeType: 'bad',
        details: [
          { label: 'Error Detail', value: 'Gateway service unavailable' },
          { label: 'Date & Time', value: formatDateTime() },
        ],
      });
    } finally {
      setLoading(false);
    }
  });
})();

