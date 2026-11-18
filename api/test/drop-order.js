import { memoryActiveOrders } from '../_lib/store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let removed = null;
  const keys = Object.keys(memoryActiveOrders);
  if (keys.length > 0) {
    removed = memoryActiveOrders[keys[0]];
    delete memoryActiveOrders[keys[0]];
  }

  return res.status(200).json({ success: true, removed });
}
