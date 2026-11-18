const { loadState, saveState } = require('./state.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { productId } = req.body || {};
  if (!productId) {
    return res.status(400).json({ error: 'Eksik productId' });
  }

  const pid = String(productId);
  const state = loadState();
  const set = state.readyProductIds;

  if (set.has(pid)) {
    set.delete(pid);
  } else {
    set.add(pid);
  }

  saveState({ readyProductIds: set });

  return res.status(200).json({
    success: true,
    productId: pid,
    isReady: set.has(pid)
  });
};
