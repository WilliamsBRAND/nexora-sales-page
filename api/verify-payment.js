// NEXORA — server-side Paystack transaction verification + paid confirmation.
// This runs ONLY on Vercel (secret key is never exposed to the browser).

const PAYSTACK_VERIFY = "https://api.paystack.co/transaction/verify/";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(body));
}

function paystackVerifyUrl(secretKey, reference) {
  return PAYSTACK_VERIFY + encodeURIComponent(reference);
}

export default async function handler(req, res) {
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

  const status = data.status;
  const amount = parseInt(data.amount, 10);

  if (status !== "success") {
    return json(res, 200, {
      ok: false,
      paid: false,
      status,
      message: "Payment has not been completed.",
    });
  }

  const expectedAmount = parseInt(process.env.PAYSTACK_AMOUNT_KOBO || "517800", 10);

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
  const source = partner ? `Affiliate (${partner})` : "Ads (Sales Page)";
  const customerEmail = email || data.customer?.email || "";
  const customerName = name || (data.customer?.first_name ? (data.customer.first_name + " " + (data.customer.last_name || "")).trim() : "");
  const amountNaira = String(data.amount / 100);

  if (sheetWebhook) {
    try {
      const fp = new URL(sheetWebhook);
      fp.searchParams.set("email", customerEmail);
      fp.searchParams.set("name", customerName);
      fp.searchParams.set("amount", amountNaira);
      fp.searchParams.set("reference", reference);
      fp.searchParams.set("status", status);
      fp.searchParams.set("partner", partner || "");
      fp.searchParams.set("source", source);

      const payload = {
        name: customerName,
        email: customerEmail,
        amount: amountNaira,
        reference: reference,
        status: status,
        partner: partner || "",
        source: source
      };

      const sr = await fetch(fp.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      logged = sr.ok;
    } catch (err) {
      logged = false;
    }
  }

  return json(res, 200, {
    ok: true,
    paid: true,
    status: "success",
    reference,
    amount: data.amount,
    currency: data.currency,
    customer: {
      email: customerEmail,
      name: customerName,
    },
    paid_at: data.paid_at,
    partner: partner || null,
    source,
    sheet_logged: logged,
  });
}
