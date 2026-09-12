// NEXORA — Verified Customer Feedback & Review API
import { getDb, json } from './_db.js';

const INITIAL_REVIEWS = [];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = getDb();

  if (req.method === 'GET') {
    try {
      let dbReviews = [];
      if (db) {
        // Query marketing_materials for reviews
        const { data: mats, error: qErr } = await db.from('marketing_materials')
          .select('id, title, url, created_at')
          .like('url', 'review:%')
          .order('created_at', { ascending: false });

        if (mats && mats.length) {
          dbReviews = mats.map(m => {
            try {
              const raw = m.url.startsWith('review:') ? m.url.slice(7) : m.url;
              const parsed = JSON.parse(decodeURIComponent(raw));
              const txt = parsed.review || parsed.comment || parsed.feedback || '';
              return {
                id: m.id,
                name: parsed.name || m.title || 'Verified Learner',
                role: parsed.role || 'Verified Purchase',
                rating: parsed.rating || 5,
                comment: txt,
                review: txt,
                avatar: parsed.avatar || parsed.photo || '',
                verified: true,
                date: parsed.date || m.created_at,
              };
            } catch (e) {
              return null;
            }
          }).filter(Boolean);
        }
      }

      // Combine user submitted reviews first, followed by curated baseline
      const normalizedInitial = INITIAL_REVIEWS.map(r => ({
        ...r,
        review: r.comment || r.review,
        avatar: r.avatar || ''
      }));
      const combined = [...dbReviews, ...normalizedInitial];
      return json(res, 200, { ok: true, reviews: combined, total: combined.length });
    } catch (e) {
      const normalizedInitial = INITIAL_REVIEWS.map(r => ({
        ...r,
        review: r.comment || r.review,
        avatar: r.avatar || ''
      }));
      return json(res, 200, { ok: true, reviews: normalizedInitial, total: normalizedInitial.length });
    }
  }

  if (req.method === 'POST') {
    const { name, email, rating, comment, feedback, review, role, reference, avatar, photo } = req.body || {};
    const reviewerName = String(name || '').trim();
    const reviewText = String(review || comment || feedback || '').trim();
    const starRating = Math.min(5, Math.max(1, parseInt(rating, 10) || 5));
    const userRole = String(role || 'Verified Pre-Order Purchase').trim();
    const userAvatar = String(avatar || photo || '').trim();

    if (!reviewerName) {
      return json(res, 400, { error: 'Please enter your name.' });
    }
    if (!reviewText) {
      return json(res, 400, { error: 'Please enter your review / feedback.' });
    }

    const reviewObj = {
      name: reviewerName,
      email: email || '',
      rating: starRating,
      comment: reviewText,
      review: reviewText,
      avatar: userAvatar,
      role: userRole,
      reference: reference || '',
      verified: true,
      date: new Date().toISOString()
    };

    if (db) {
      let productId = 'eee0450d-cf16-4ebc-bd24-92dae50eb378';
      try {
        const { data: prod } = await db.from('products').select('id').eq('slug', 'nexora').maybeSingle();
        if (prod && prod.id) productId = prod.id;
      } catch (e) {}

      const urlData = 'review:' + encodeURIComponent(JSON.stringify(reviewObj));

      try {
        await db.from('marketing_materials').insert({
          product_id: productId,
          type: 'asset',
          title: reviewerName,
          url: urlData
        });
      } catch (e) {
        console.error('Database review insert warning:', e);
      }
    }

    // Feedbacks stored in Supabase only — excluded from Google Sheet per settings

    return json(res, 200, {
      ok: true,
      message: 'Thank you! Your review has been submitted and published.',
      review: reviewObj
    });
  }

  return json(res, 405, { error: 'Method not allowed' });
}
