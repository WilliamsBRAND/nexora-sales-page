// NEXORA â€” server-side Paystack transaction verification + paid confirmation.
// This runs ONLY on Vercel (secret key is never exposed to the browser).
//
// Flow: checkout.html -> Paystack inline -> redirect to /thank-you.html?ref=REF
//       thank-you.html -> GET /api/verify-payment?reference=REF&email=..&name=..
//       This function verifies the transaction with Paystack's secret key,
//       then POSTs the verified row to the Apps Script webhook (Google Sheet).
//
// NOTE: Commission recording is NOT done here. The partners-platform Paystack
// webhook (https://partners.tomidewilliams.com/api/paystack-webhook) is the
// single authoritative source of truth for orders + commissions.

const PAYSTACK_VERIFY = "https://api.paystack.co/transaction/verify/";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // Only allow GET (simple, idempotent) â€” could also accept POST.
  const url = new URL(req.url, `http://${req.headers.host}`);
  const reference = url.searchParams.get("reference") || "";
  const email = url.searchParams.get("email") || "";
  const name = url.searchParams.get("name") || "";
  const partner = url.searchParams.get("pp") || "";
  const offerSlug = url.searchParams.get("offer") || "nexora";

  const secretKey = process.env.PAYSTACK_SECRET_KEY || "";

  if (!reference) {
    return json(res, 400, { ok: false, error: "Missing reference." });
  }

  if (!secretKey) {
    return json(res, 500, { ok: false, error: "Paystack secret key not configured on server." });
  }

  let tx;
  try {
    const r = await fetch(paystackVerifyUrl(secretKey, reference), {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    tx = await r.json();
  } catch (err) {
    return json(res, 502, { ok: false, error: "Could not reach Paystack: " + err.message });
  }

  const data = tx && tx.data;
  if (!tx || tx.status !== true || !data) {
    return json(res, 400, { ok: false, error: (tx && tx.message) || "Verification failed." });
  }

  const status = data.status; // success | failed | abandoned | pending
  const amount = parseInt(data.amount, 10);

  if (status !== "success") {
    return json(res, 200, {
      ok: false,
      paid: false,
      status,
      message: "Payment has not been completed.",
    });
  }

  const expectedAmount = parseInt(process.env.PAYSTACK_AMOUNT_KOBO || "749000", 10);

  if (amount !== expectedAmount) {
    return json(res, 200, {
      ok: false,
      paid: false,
      status: "amount_mismatch",
      message: "Payment amount does not match the NEXORA pre-order price.",
    });
  }

  // Verified: success + correct amount. Log to Google Sheet via Apps Script webhook.
  const sheetWebhook = process.env.SHEET_WEBHOOK_URL || "";
  let logged = false;
  if (sheetWebhook) {
    try {
      const fp = new URL(sheetWebhook);
      fp.searchParams.set("email", email || data.customer?.email || "");
      fp.searchParams.set("name", name || "");
      fp.searchParams.set("amount", String(data.amount / 100));
      fp.searchParams.set("reference", reference);
      fp.searchParams.set("status", status);
      fp.searchParams.set("partner", partner || "");
      const sr = await fetch(fp.toString(), { method: "POST" });
      logged = sr.ok;
    } catch (err) {
      logged = false;
    }
  }

  // Commissions are NOT recorded here anymore. The partners-platform
  // (https://partners.tomidewilliams.com/api/paystack-webhook) is the single,
  // authoritative source of truth for orders + commissions via its Paystack
  // webhook. The legacy conversions/offers tables are no longer written.
  let commissionRecorded = false;

  return json(res, 200, {
    ok: true,
    paid: true,
    status,
    reference,
    logged,
    commissionRecorded,
    customer: data.customer ? data.customer.email : email,
    amount: data.amount / 100,
  });
}

// tiny helper kept inline to avoid accidental secret-key in any client bundle
function paystackVerifyUrl(secret, reference) {
  return PAYSTACK_VERIFY + encodeURIComponent(reference);
}


