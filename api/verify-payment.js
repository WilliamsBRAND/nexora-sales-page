// NEXORA â€” server-side Paystack transaction verification + payment logging.
// This runs ONLY on Vercel (secret key is never exposed to the browser).
//
// Flow: checkout.html -> Paystack inline -> redirect to /thank-you.html?ref=REF
//       thank-you.html -> GET /api/verify-payment?reference=REF&email=..&name=..
//       This function verifies the transaction with Paystack's secret key,
//       then POSTs the verified row to the Apps Script webhook (Google Sheet).

import { createClient } from "@supabase/supabase-js";

const PAYSTACK_VERIFY = "https://api.paystack.co/transaction/verify/";

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify(body));
}

function getDb() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key);
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

  // Record commission in Supabase if partner code is present
  let commissionRecorded = false;
  if (partner) {
    const db = getDb();
    if (db) {
      try {
        const { data: partnerRow } = await db
          .from("partners")
          .select("id")
          .eq("code", partner)
          .eq("status", "active")
          .maybeSingle();

        // Look up offer for commission rate
        let commissionRate = 0.30;
        let offerId = null;
        const { data: offerRow } = await db
          .from("offers")
          .select("id, commission_rate")
          .eq("slug", offerSlug)
          .eq("status", "active")
          .maybeSingle();
        if (offerRow) {
          commissionRate = offerRow.commission_rate;
          offerId = offerRow.id;
        }

        if (partnerRow) {
          const amountKobo = parseInt(data.amount, 10);
          const commissionKobo = Math.round(amountKobo * commissionRate);
          const customerEmail = email || data.customer?.email || "";
          const customerName = name || "";

          // Idempotency: if this exact Paystack reference is already recorded, never touch it.
          const { data: refMatch } = await db
            .from("conversions")
            .select("id")
            .eq("paystack_reference", reference)
            .maybeSingle();

          if (refMatch) {
            // Already recorded for this reference — nothing to do.
            commissionRecorded = true;
          } else {
            // Dedup: same email + same partner + same offer within 24h = skip
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const dedupQuery = db.from("conversions")
              .select("id")
              .eq("partner_id", partnerRow.id)
              .eq("customer_email", customerEmail.toLowerCase())
              .gte("created_at", oneDayAgo);
            if (offerId) dedupQuery.eq("offer_id", offerId);
            const { data: existingConv } = await dedupQuery.maybeSingle();

            if (!existingConv) {
              await db.from("conversions").insert({
                partner_id: partnerRow.id,
                offer_id: offerId,
                customer_email: customerEmail.toLowerCase(),
                customer_name: customerName,
                paystack_reference: reference,
                amount_kobo: amountKobo,
                commission_kobo: commissionKobo,
                status: "pending",
              });
              commissionRecorded = true;
            }
          }
        }
      } catch (err) {
        commissionRecorded = false;
      }
    }
  }

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


