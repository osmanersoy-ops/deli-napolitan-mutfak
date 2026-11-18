const ADISYO_BASE_URL = process.env.ADISYO_BASE_URL || 'https://ext.adisyo.com/api/External/v2';
const ADISYO_API_KEY = process.env.ADISYO_API_KEY || '25b80b3556ca3a15353dd2fd312062fad27adcf5a1de51b75bdadea1fa8214ab';
const ADISYO_API_SECRET = process.env.ADISYO_API_SECRET || '65e70574-2b17-42a1-b093-4128ad9aff44';
const ADISYO_API_CONSUMER = process.env.ADISYO_API_CONSUMER || 'Deli Napolitan';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { orderId } = req.body || {};
  if (!orderId) {
    return res.status(400).json({ error: 'Eksik orderId' });
  }

  try {
    const oid = Number(orderId);
    if (oid && oid < 1000000000000) {
      await fetch(`${ADISYO_BASE_URL}/Prepared`, {
        method: 'POST',
        headers: {
          'x-api-key': ADISYO_API_KEY,
          'x-api-secret': ADISYO_API_SECRET,
          'x-api-consumer': ADISYO_API_CONSUMER,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Deli-Napolitan-KDS)'
        },
        body: JSON.stringify({ orderId: oid })
      });
    }
    return res.status(200).json({ success: true, orderId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
