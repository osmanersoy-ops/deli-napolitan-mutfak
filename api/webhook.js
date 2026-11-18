import { getOrders } from './_lib/store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const queryStr = JSON.stringify(req.query || {});

  if (
    req.method === 'GET' ||
    bodyText.toLowerCase().includes('handshake') ||
    queryStr.toLowerCase().includes('handshake') ||
    Object.keys(req.body || {}).length === 0
  ) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  }

  try {
    getOrders(true).catch(e => console.error('[Webhook Sync Error]', e));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  } catch (err) {
    console.error('[Webhook Error]', err);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  }
}
