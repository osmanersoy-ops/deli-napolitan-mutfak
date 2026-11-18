const { fetchFromAdisyo, getOrdersPayload } = require('./orders.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    await fetchFromAdisyo(true);
    return res.status(200).json(getOrdersPayload());
  } catch (e) {
    return res.status(200).json({ success: true });
  }
};
