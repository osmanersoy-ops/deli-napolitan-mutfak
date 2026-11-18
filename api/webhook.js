const { loadState, saveState } = require('./state.js');
const { fetchFromAdisyo } = require('./orders.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
  const queryStr = JSON.stringify(req.query || {});

  // Adisyo Webhook handshake: expects exact plain text "adisyo"
  if (
    req.method === 'GET' ||
    bodyText.toLowerCase().includes('handshake') ||
    queryStr.toLowerCase().includes('handshake') ||
    !req.body ||
    Object.keys(req.body).length === 0
  ) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  }

  // Incoming webhook event from Adisyo (order created / updated)
  try {
    const payload = req.body;
    const incomingOrder = payload?.data || (payload?.id && payload?.products ? payload : null);

    if (incomingOrder && incomingOrder.id) {
      const state = loadState();
      const existingIdx = state.cachedOrders.findIndex(o => o.id === incomingOrder.id);
      if (existingIdx >= 0) {
        state.cachedOrders[existingIdx] = incomingOrder;
      } else {
        state.cachedOrders.push(incomingOrder);
      }
      let timeStr;
      try {
        timeStr = new Intl.DateTimeFormat('tr-TR', {
          timeZone: 'Europe/Istanbul',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).format(new Date());
      } catch (e) {
        timeStr = new Date().toLocaleTimeString('tr-TR');
      }
      saveState({
        cachedOrders: state.cachedOrders,
        lastSyncTimeString: timeStr,
        lastSyncStatus: 'Webhook Anlık Bağlı'
      });
    } else {
      await fetchFromAdisyo(false);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  } catch (err) {
    console.error('[Webhook Error]', err);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  }
};
