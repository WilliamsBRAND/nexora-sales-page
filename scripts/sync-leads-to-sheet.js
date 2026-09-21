// Sync all NEXORA registrations from Supabase orders to the new Google Sheet via gws CLI
import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://pkdpaltivlcdwvvbkjbf.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const spreadsheetId = '1yT3W-DVkxXPoC-8KTJar2NPk7B8TpB7a-Dh_rIZWYrA';

async function sync() {
  if (!supabaseKey) {
    console.error('SUPABASE_SERVICE_KEY is required in .env');
    return;
  }

  const db = createClient(supabaseUrl, supabaseKey);
  
  // 1. Fetch all orders for NEXORA
  const { data: offers } = await db.from('offers').select('id, product_id').eq('slug', 'nexora').maybeSingle();
  const productId = offers?.product_id || offers?.id || 'eee0450d-cf16-4ebc-bd24-92dae50eb378';

  const { data: orders, error } = await db.from('orders')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching orders:', error);
    return;
  }

  console.log(`Found ${orders?.length || 0} registrations in Supabase.`);
  if (!orders || !orders.length) return;

  const rows = [];
  for (const o of orders) {
    let meta = {};
    try {
      meta = typeof o.webhook_event === 'string' ? JSON.parse(o.webhook_event) : (o.webhook_event || {});
    } catch (e) {}

    const name = o.customer_name || '-';
    const email = o.customer_email || '-';
    const phone = meta.phone || '-';
    const partner = meta.partner || 'None';
    const redirectUrl = meta.redirect_url || 'https://chat.whatsapp.com/LqRRlc5SI4A8pQjlEf1hgg';
    const reference = o.paystack_reference || '-';
    const status = o.status || 'verified';
    const timestamp = o.created_at || meta.registered_at || new Date().toISOString();

    rows.push([name, email, phone, timestamp, partner, redirectUrl, reference, status]);
  }

  // 2. Append to Google Sheet using gws
  const payload = {
    values: rows
  };

  const payloadJson = JSON.stringify(payload).replace(/"/g, '\\"');
  const paramsJson = JSON.stringify({
    spreadsheetId,
    range: 'Sheet1!A2:H',
    valueInputOption: 'USER_ENTERED'
  }).replace(/"/g, '\\"');

  const cmd = `gws sheets spreadsheets values update --params "${paramsJson}" --json "${payloadJson}"`;
  try {
    const out = execSync(cmd, { encoding: 'utf8' });
    console.log('Successfully synced to Google Sheet:', out);
  } catch (err) {
    console.error('Error updating Google Sheet via gws:', err.stdout || err.message);
  }
}

sync();
