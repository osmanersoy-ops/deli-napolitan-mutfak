const { getOrders } = require('./_lib/store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Edge CDN Caching: Caches at Vercel Edge for 12s, preventing Adisyo 30s rate limits
  res.setHeader('Cache-Control', 's-maxage=12, stale-while-revalidate=25');

  try {
    const data = await getOrders(false);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message, orders: [] });
  }
};
