import { markAllProductsReady, markOrderPreparedInAdisyo, memoryActiveOrders } from './_lib/store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { orderId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: 'Eksik orderId' });
  }

  try {
    const order = memoryActiveOrders[orderId] || memoryActiveOrders[String(orderId)];
    const productIds = order && Array.isArray(order.products)
      ? order.products.map(p => p.id)
      : [];

    await markAllProductsReady(orderId, productIds);

    // Call Adisyo Prepared in background
    markOrderPreparedInAdisyo(orderId).catch(err => {
      console.error('[Prepared Error]', err);
    });

    return res.status(200).json({ success: true, orderId, adisyoNotified: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
