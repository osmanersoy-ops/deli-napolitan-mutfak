const fs = require('fs');

const STATE_FILE = '/tmp/kds_state.json';

// In-memory state for fast local access
let memState = {
  cachedOrders: [],
  lastFetchTime: 0,
  lastSyncTimeString: null,
  lastSyncStatus: 'Başlatılıyor...',
  readyProductIds: new Set()
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data.cachedOrders)) memState.cachedOrders = data.cachedOrders;
      if (typeof data.lastFetchTime === 'number') memState.lastFetchTime = data.lastFetchTime;
      if (data.lastSyncTimeString) memState.lastSyncTimeString = data.lastSyncTimeString;
      if (data.lastSyncStatus) memState.lastSyncStatus = data.lastSyncStatus;
      if (Array.isArray(data.readyProductIds)) memState.readyProductIds = new Set(data.readyProductIds);
    }
  } catch (e) {
    console.error('[State Load Error]', e);
  }
  return memState;
}

function saveState(patch) {
  try {
    if (patch) {
      if (patch.cachedOrders !== undefined) memState.cachedOrders = patch.cachedOrders;
      if (patch.lastFetchTime !== undefined) memState.lastFetchTime = patch.lastFetchTime;
      if (patch.lastSyncTimeString !== undefined) memState.lastSyncTimeString = patch.lastSyncTimeString;
      if (patch.lastSyncStatus !== undefined) memState.lastSyncStatus = patch.lastSyncStatus;
      if (patch.readyProductIds !== undefined) memState.readyProductIds = patch.readyProductIds;
    }

    const data = {
      cachedOrders: memState.cachedOrders,
      lastFetchTime: memState.lastFetchTime,
      lastSyncTimeString: memState.lastSyncTimeString,
      lastSyncStatus: memState.lastSyncStatus,
      readyProductIds: Array.from(memState.readyProductIds || [])
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(data), 'utf8');
  } catch (e) {
    console.error('[State Save Error]', e);
  }
}

module.exports = {
  loadState,
  saveState,
  memState
};
