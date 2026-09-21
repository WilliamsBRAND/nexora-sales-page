// NEXORA — Registration API (/api/register)
// Saves lead/VIP registration to Supabase, logs to Google Sheets, and routes to custom Partner WhatsApp funnel if set.
import { getDb, json } from './_db.js';

const MASTER_WA_GROUP = 'https://chat.whatsapp.com/LNC6ABmpaFN5b6we3ZuEpp';

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
  const rawAmount = String(body.amountPaid || body.amount || '0').trim();
  const heardFrom = (body.heardFrom || 'Free Launch Event Registration').trim();
  const heardFromOther = (body.heardFromOther || '').trim();
  const moduleInterest = (body.moduleInterest || 'All 6 Modules + Bonuses').trim();
  const paymentProof = (body.paymentProof || '').trim();
  const partner = (body.partner || body.pp || body.ref || '').trim();
  const tier = (body.tier || 'free_vip_pass').trim();

  // Basic validation
  if (!name) return json(res, 400, { ok: false, error: 'Full name is required.' });
  if (!email || !email.includes('@')) return json(res, 400, { ok: false, error: 'Valid email address is required.' });
  if (!phone || phone.length < 7) return json(res, 400, { ok: false, error: 'Phone/WhatsApp number is required.' });

  // Clean and parse amount paid (0 for free launch event)
  const numericAmount = rawAmount.replace(/[^0-9.]/g, '');
  const amountNumber = parseFloat(numericAmount) || 0;
  const finalAmountString = String(amountNumber);
  const amountKobo = Math.round(amountNumber * 100);

  const finalSource = heardFrom === 'Other' && heardFromOther ? `Other: ${heardFromOther}` : heardFrom;
  const reference = `NEX-${tier === 'free_vip_pass' ? 'VIP' : 'REG'}-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;

  const db = getDb();
  let dbSaved = false;
  let redirectUrl = MASTER_WA_GROUP;

  // 1. Check for Partner's Custom WhatsApp Group Funnel URL
  if (db && partner) {
    try {
      const cleanPartner = String(partner).trim();
      const upperPartner = cleanPartner.toUpperCase();
      
      // Try direct wa_funnel:CODE lookup
      const { data: waRow } = await db.from('marketing_materials')
        .select('url')
        .or(`title.eq.wa_funnel:${upperPartner},title.ilike.wa_funnel:${cleanPartner}`)
        .maybeSingle();

      if (waRow && waRow.url && waRow.url.trim()) {
        redirectUrl = waRow.url.trim();
      } else {
        // Fallback: check if partner is an ID or uuid, find code, then lookup wa_funnel
        const { data: pRow } = await db.from('partners')
          .select('code')
          .or(`code.ilike.${cleanPartner},id.eq.${cleanPartner}`)
          .maybeSingle();
        if (pRow && pRow.code) {
          const { data: waRow2 } = await db.from('marketing_materials')
            .select('url')
            .eq('title', `wa_funnel:${pRow.code.toUpperCase()}`)
            .maybeSingle();
          if (waRow2 && waRow2.url && waRow2.url.trim()) {
            redirectUrl = waRow2.url.trim();
          }
        }
      }
    } catch (waErr) {
      console.error('[api/register] Partner WhatsApp lookup error:', waErr);
    }
  }

  // 2. Save Registration to Supabase
  if (db) {
    try {
      const { data: offers } = await db.from('offers').select('id, product_id').eq('slug', 'nexora').maybeSingle();
      const productId = offers?.product_id || offers?.id || 'eee0450d-cf16-4ebc-bd24-92dae50eb378';

      const orderPayload = {
        product_id: productId,
        customer_email: email,
        customer_name: name,
        paystack_reference: reference,
        amount_kobo: amountKobo,
        status: 'verified',
        webhook_event: JSON.stringify({
          phone,
          amount_paid_raw: rawAmount,
          amount_paid_naira: finalAmountString,
          channel: tier === 'free_vip_pass' ? 'Free VIP Launch Pass' : 'Manual Registration',
          heard_from: finalSource,
          module_interest: moduleInterest,
          payment_proof: paymentProof || (amountKobo > 0 ? 'Manual Bank Transfer' : 'Free VIP Registration'),
          partner: partner || null,
          redirect_url: redirectUrl,
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

  // 3. Post to Google Sheet Webhook (Apps Script)
  const sheetWebhook = process.env.SHEET_WEBHOOK_URL || '';
  let sheetLogged = false;

  if (sheetWebhook) {
    try {
      const fp = new URL(sheetWebhook);
      fp.searchParams.set('name', name);
      fp.searchParams.set('email', email);
      fp.searchParams.set('phone', phone);
      fp.searchParams.set('amount', finalAmountString);
      fp.searchParams.set('reference', reference);
      fp.searchParams.set('status', tier === 'free_vip_pass' ? 'vip_registered' : 'manual_registration');
      fp.searchParams.set('source', 'Launch Event Checkout');
      fp.searchParams.set('channel', tier === 'free_vip_pass' ? 'Free Launch Event' : 'Manual Registration');
      fp.searchParams.set('partner', partner || 'None');
      fp.searchParams.set('module_interest', moduleInterest);
      fp.searchParams.set('proof', paymentProof || 'Free VIP Registration');

      const payload = {
        name,
        email,
        phone,
        amount: finalAmountString,
        reference,
        status: tier === 'free_vip_pass' ? 'vip_registered' : 'manual_registration',
        channel: tier === 'free_vip_pass' ? 'Free Launch Event' : 'Manual Registration',
        source: 'Launch Event Checkout',
        partner: partner || 'None',
        heard_from: finalSource,
        module_interest: moduleInterest,
        proof: paymentProof || 'Free VIP Registration',
        redirect_url: redirectUrl,
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
    redirectUrl,
    data: {
      name,
      email,
      phone,
      amount: finalAmountString,
      reference,
      partner: partner || null,
      redirectUrl,
      dbSaved,
      sheetLogged,
    },
  });
}
