const { fetchFromAdisyo } = require('./orders.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Adisyo Webhook handshake: expects text "adisyo"
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

  // Incoming webhook event from Adisyo
  try {
    fetchFromAdisyo(true).catch(e => console.error('[Webhook Refresh Error]', e));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  } catch (err) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  }
};
