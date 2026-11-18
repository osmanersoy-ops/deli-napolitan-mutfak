const { getOrders } = require('./_lib/store');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Adisyo Webhook Handshake Verification
  // Adisyo sends a GET or POST test request and expects exact plain text response "adisyo"
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

  // Incoming webhook event (order created / updated)
  try {
    const payload = req.body;
    console.log('[Adisyo Webhook]', payload?.event || payload?.action || 'Event received');

    // Trigger fresh order sync
    getOrders(true).catch(e => console.error('[Webhook Sync Error]', e));

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  } catch (err) {
    console.error('[Webhook Error]', err);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  }
};
