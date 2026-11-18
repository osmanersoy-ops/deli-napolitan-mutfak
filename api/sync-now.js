const { getOrders } = require('./_lib/store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const data = await getOrders(true);
    return res.status(200).json({ success: true, count: data.count, status: data.status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
