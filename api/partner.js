import { getDb, json } from './_db.js';

function generateCode(name) {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  const rand = Math.random().toString(36).slice(2, 6);
  return (base + rand).slice(0, 12);
}

export default async function handler(req, res) {
  const db = getDb();
  if (!db) return json(res, 500, { error: 'Database not configured.' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const action = url.searchParams.get('action') || '';

  try {
    switch (action) {
      case 'register':
        return await register(req, res, db, url);
      case 'login':
        return await login(req, res, db, url);
      case 'stats':
        return await stats(req, res, db, url);
      case 'commissions':
        return await commissions(req, res, db, url);
      case 'payouts':
        return await payouts(req, res, db, url);
      default:
        return json(res, 400, { error: 'Unknown action. Valid: register, login, stats, commissions, payouts.' });
    }
  } catch (e) {
    return json(res, 500, { error: 'Server error: ' + (e.message || '') });
  }
}

async function register(req, res, db, url) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const { name, email, phone } = req.body || {};
  if (!name || !email) return json(res, 400, { error: 'Name and email are required.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Invalid email.' });

  const { data: existing } = await db.from('partners').select('id').eq('email', email.toLowerCase()).maybeSingle();
  if (existing) return json(res, 409, { error: 'An account with this email already exists.' });

  let code = generateCode(name);
  for (let i = 0; i < 10; i++) {
    const { data: dup } = await db.from('partners').select('id').eq('code', code).maybeSingle();
    if (!dup) break;
    code = generateCode(name);
  }

  const { data, error } = await db.from('partners').insert({
    code, name: name.trim(), email: email.toLowerCase().trim(), phone: phone || null,
  }).select('id, code, name, email').single();

  if (error) return json(res, 500, { error: 'Failed to create account.' });
  const siteUrl = process.env.SITE_URL || 'https://nexora.tomidewilliams.com';
  return json(res, 200, { ok: true, ...data, siteUrl });
}

async function login(req, res, db, url) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const { email } = req.body || {};
  if (!email) return json(res, 400, { error: 'Email is required.' });

  const { data } = await db.from('partners')
    .select('id, code, name, email').eq('email', email.toLowerCase().trim()).eq('status', 'active').maybeSingle();

  if (!data) return json(res, 404, { error: 'No active partner account found with that email.' });
  const siteUrl = process.env.SITE_URL || 'https://nexora.tomidewilliams.com';
  return json(res, 200, { ok: true, ...data, siteUrl });
}

async function stats(req, res, db, url) {
  const partnerId = url.searchParams.get('partner_id');
  if (!partnerId) return json(res, 400, { error: 'partner_id required.' });

  const [clicksRes, convRes] = await Promise.all([
    db.from('referrals').select('id', { count: 'exact', head: true }).eq('partner_id', partnerId),
    db.from('conversions').select('commission_kobo, status').eq('partner_id', partnerId),
  ]);
  const clicks = clicksRes.count || 0;
  const conversions = convRes.data || [];
  const earned = conversions.filter(c => c.status === 'approved' || c.status === 'paid').reduce((s, c) => s + c.commission_kobo, 0);
  const pending = conversions.filter(c => c.status === 'pending').reduce((s, c) => s + c.commission_kobo, 0);
  return json(res, 200, { ok: true, clicks, conversions: conversions.length, earned_kobo: earned, pending_kobo: pending });
}

async function commissions(req, res, db, url) {
  const partnerId = url.searchParams.get('partner_id');
  if (!partnerId) return json(res, 400, { error: 'partner_id required.' });

  const { data } = await db.from('conversions')
    .select('id, offer_id, customer_email, amount_kobo, commission_kobo, status, created_at')
    .eq('partner_id', partnerId).order('created_at', { ascending: false }).limit(50);

  const offerIds = [...new Set((data || []).map(c => c.offer_id).filter(Boolean))];
  let offerMap = {};
  if (offerIds.length) {
    const { data: offers } = await db.from('offers').select('id, name').in('id', offerIds);
    (offers || []).forEach(o => { offerMap[o.id] = o.name; });
  }
  const commissionsList = (data || []).map(c => ({ ...c, offer_name: offerMap[c.offer_id] || '-' }));
  return json(res, 200, { ok: true, commissions: commissionsList });
}

async function payouts(req, res, db, url) {
  const partnerId = url.searchParams.get('partner_id');
  if (!partnerId) return json(res, 400, { error: 'partner_id required.' });

  const { data } = await db.from('payouts')
    .select('id, amount_kobo, paystack_transfer_ref, status, created_at')
    .eq('partner_id', partnerId).order('created_at', { ascending: false }).limit(50);
  return json(res, 200, { ok: true, payouts: data || [] });
}
