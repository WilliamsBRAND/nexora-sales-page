// NEXORA â€” Manual Registration API (/api/register)
// Saves manual payer registration to Supabase and Google Sheet webhook.
import { getDb, json } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return json(res, 405, { ok: false, error: 'Method not allowed. Use POST.' });
  }

  const body = req.body || {};
  const name = (body.name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const heardFrom = (body.heardFrom || '').trim();
  const heardFromOther = (body.heardFromOther || '').trim();
  const moduleInterest = (body.moduleInterest || '').trim();
  const paymentProof = (body.paymentProof || '').trim();

  // Basic validation
  if (!name) return json(res, 400, { ok: false, error: 'Full name is required.' });
  if (!email || !email.includes('@')) return json(res, 400, { ok: false, error: 'Valid email address is required.' });
  if (!phone) return json(res, 400, { ok: false, error: 'Phone/WhatsApp number is required.' });
  if (!heardFrom) return json(res, 400, { ok: false, error: 'Please specify where you heard about NEXORA.' });
  if (!moduleInterest) return json(res, 400, { ok: false, error: 'Please select your module interest.' });

  const finalSource = heardFrom === 'Other' && heardFromOther ? `Other: ${heardFromOther}` : heardFrom;
  const reference = `MANUAL-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  const db = getDb();
  let dbSaved = false;

  // 1. Save to Supabase
  if (db) {
    try {
      const { data: offers } = await db.from('offers').select('id, product_id').eq('slug', 'nexora').maybeSingle();
      const productId = offers?.product_id || offers?.id || 'eee0450d-cf16-4ebc-bd24-92dae50eb378';

      const orderPayload = {
        product_id: productId,
        customer_email: email,
        customer_name: name,
        paystack_reference: reference,
        amount_kobo: 749000,
        status: 'manual_verified',
        webhook_event: JSON.stringify({
          phone,
          heard_from: finalSource,
          module_interest: moduleInterest,
          payment_proof: paymentProof || 'Manual Bank Transfer',
          registered_at: new Date().toISOString(),
        }),
      };

      const { error: insErr } = await db.from('orders').insert(orderPayload);
      if (!insErr) dbSaved = true;
      else console.error('[api/register] DB insert error:', insErr);
    } catch (dbErr) {
      console.error('[api/register] Supabase error:', dbErr);
    }
  }

  // 2. Post to Google Sheet Webhook (Apps Script)
  const sheetWebhook = process.env.SHEET_WEBHOOK_URL || '';
  let sheetLogged = false;

  if (sheetWebhook) {
    try {
      const fp = new URL(sheetWebhook);
      fp.searchParams.set('name', name);
      fp.searchParams.set('email', email);
      fp.searchParams.set('phone', phone);
      fp.searchParams.set('amount', '7490');
      fp.searchParams.set('reference', reference);
      fp.searchParams.set('status', 'manual_registration');
      fp.searchParams.set('source', `Manual Transfer Form (${finalSource})`);
      fp.searchParams.set('module_interest', moduleInterest);
      fp.searchParams.set('proof', paymentProof || 'N/A');

      const payload = {
        name,
        email,
        phone,
        amount: '7490',
        reference,
        status: 'manual_registration',
        source: `Manual Transfer Form (${finalSource})`,
        heard_from: finalSource,
        module_interest: moduleInterest,
        proof: paymentProof || 'N/A',
        timestamp: new Date().toISOString(),
      };

      const r = await fetch(fp.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      sheetLogged = r.ok;
    } catch (sheetErr) {
      console.error('[api/register] Google Sheet webhook error:', sheetErr);
    }
  }

  return json(res, 200, {
    ok: true,
    message: 'Registration successful',
    data: {
      name,
      email,
      reference,
      dbSaved,
      sheetLogged,
    },
  });
}