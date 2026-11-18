const fs = require('fs');

const ADISYO_BASE_URL = process.env.ADISYO_BASE_URL || 'https://ext.adisyo.com/api/External/v2';
const ADISYO_API_KEY = process.env.ADISYO_API_KEY || '25b80b3556ca3a15353dd2fd312062fad27adcf5a1de51b75bdadea1fa8214ab';
const ADISYO_API_SECRET = process.env.ADISYO_API_SECRET || '65e70574-2b17-42a1-b093-4128ad9aff44';
const ADISYO_API_CONSUMER = process.env.ADISYO_API_CONSUMER || 'Deli Napolitan';

const PIZZA_KEYWORDS = ['pizza', 'pizzalar', 'napolitan', 'calzone', 'pizzetta'];

// Global state in container memory
let cachedOrders = [];
let lastFetchTime = 0;
let lastSyncTimeString = null;
let lastSyncStatus = 'Başlatılıyor...';
let readyProductIds = new Set();
let isFetching = false;

// File persistence in /tmp
const STATE_FILE = '/tmp/kds_state.json';

function tryLoadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (Array.isArray(data.cachedOrders) && cachedOrders.length === 0) {
        cachedOrders = data.cachedOrders;
      }
      if (typeof data.lastFetchTime === 'number' && data.lastFetchTime > lastFetchTime) {
        lastFetchTime = data.lastFetchTime;
      }
      if (data.lastSyncTimeString && !lastSyncTimeString) {
        lastSyncTimeString = data.lastSyncTimeString;
      }
      if (data.lastSyncStatus && lastSyncStatus === 'Başlatılıyor...') {
        lastSyncStatus = data.lastSyncStatus;
      }
      if (Array.isArray(data.readyProductIds)) {
        data.readyProductIds.forEach(id => readyProductIds.add(id));
      }
    }
  } catch (e) {}
}

function trySaveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      cachedOrders,
      lastFetchTime,
      lastSyncTimeString,
      lastSyncStatus,
      readyProductIds: Array.from(readyProductIds)
    }), 'utf8');
  } catch (e) {}
}

function normalizeTurkish(text) {
  if (!text) return '';
  return text
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .replace(/Ğ/g, 'ğ')
    .replace(/Ü/g, 'ü')
    .replace(/Ş/g, 'ş')
    .replace(/Ö/g, 'ö')
    .toLowerCase();
}

function isPizzaProduct(p) {
  const cat = normalizeTurkish(p.categoryName || '');
  const name = normalizeTurkish(p.productName || '');
  return PIZZA_KEYWORDS.some(k => cat.includes(k) || name.includes(k));
}

function formatOrder(order) {
  if (!order || !Array.isArray(order.products)) return null;

  const statusStr = normalizeTurkish(order.status || '');
  const statusId = order.statusId || 0;

  // Hazırlandı (3), Kapandı (5), İptal veya preparedDate varsa mutfak ve servisten düşer
  const isFinished = (
    order.preparedDate != null ||
    statusId === 3 ||
    statusId === 5 ||
    statusStr.includes('hazırlandı') ||
    statusStr.includes('kapan') ||
    statusStr.includes('iptal')
  );

  if (isFinished) {
    return null;
  }

  const allProducts = [];
  const pizzaProducts = [];

  for (const p of order.products) {
    const pid = String(p.id);
    const pname = p.productName || 'Ürün';
    const catName = p.categoryName || 'Genel';
    const qty = parseInt(p.quantity || 1, 10);
    const isPizza = isPizzaProduct(p);
    const isReady = readyProductIds.has(pid);

    const notes = [];
    if (p.productNote && String(p.productNote).trim()) {
      notes.push(String(p.productNote).trim());
    }
    if (Array.isArray(p.excludedItems) && p.excludedItems.length > 0) {
      notes.push(p.excludedItems.join(', ') + ' ÇIKAR');
    }
    if (Array.isArray(p.features) && p.features.length > 0) {
      const featNames = p.features.map(f => (typeof f === 'object' ? f.name : f)).filter(Boolean);
      if (featNames.length > 0) notes.push(featNames.join(', '));
    }

    const item = {
      id: pid,
      name: pname,
      category: catName,
      isPizza,
      qty,
      note: notes.length > 0 ? notes.join(' • ') : null,
      isReady
    };

    allProducts.push(item);
    if (isPizza) {
      pizzaProducts.push(item);
    }
  }

  if (allProducts.length === 0) return null;

  const totalPizzas = pizzaProducts.length;
  const readyPizzas = pizzaProducts.filter(p => p.isReady).length;
  const allPizzasReady = totalPizzas > 0 && readyPizzas === totalPizzas;

  const totalProducts = allProducts.length;
  const readyProducts = allProducts.filter(p => p.isReady).length;
  const allProductsReady = totalProducts > 0 && readyProducts === totalProducts;

  let tableName = order.tableName || 'Masa';
  const orderTypeRaw = normalizeTurkish(order.orderType || '');
  let orderType = 'SALON';

  if (orderTypeRaw.includes('paket')) {
    orderType = 'PAKET';
    tableName = order.externalAppName ? `${order.externalAppName} #${order.orderNumber}` : `Paket #${order.orderNumber}`;
  } else if (orderTypeRaw.includes('gel')) {
    orderType = 'GEL-AL';
    tableName = `Gel-Al #${order.orderNumber}`;
  }

  const insertDate = order.insertDate || new Date().toISOString();
  let elapsed = 0;
  try {
    let dateStr = insertDate;
    if (!dateStr.includes('+') && !dateStr.includes('Z')) {
      dateStr += '+03:00';
    }
    const dt = new Date(dateStr);
    elapsed = Math.max(0, Math.floor((Date.now() - dt.getTime()) / 1000));
  } catch (e) {
    elapsed = 0;
  }

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType,
    tableName,
    waiterName: order.waiterName || '',
    insertDate,
    secondsElapsed: elapsed,
    products: allProducts,
    pizzas: pizzaProducts,
    pizzaCount: totalPizzas,
    readyPizzaCount: readyPizzas,
    allPizzasReady,
    productCount: totalProducts,
    readyProductCount: readyProducts,
    allProductsReady
  };
}

async function fetchFromAdisyo(force = false) {
  tryLoadState();
  const now = Date.now();

  // KESİN ADİSYO KURALI: En az 30 saniye geçmeden ASLA istek atılmaz!
  if (!force && now - lastFetchTime < 30000) {
    return cachedOrders;
  }

  if (isFetching) return cachedOrders;
  isFetching = true;
  lastFetchTime = Date.now(); // Mutex kilidi: sonraki istekleri hemen beklemeye al

  const url = `${ADISYO_BASE_URL}/RecentOrders?orderType=TakeAway,Table,Retail&onlyRestaurantCourier=false`;
  try {
    const response = await fetch(url, {
      headers: {
        'x-api-key': ADISYO_API_KEY,
        'x-api-secret': ADISYO_API_SECRET,
        'x-api-consumer': ADISYO_API_CONSUMER,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Deli-Napolitan-KDS)'
      }
    });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) {}

    if (response.ok && Array.isArray(data.data)) {
      cachedOrders = data.data;
      lastFetchTime = Date.now();
      try {
        lastSyncTimeString = new Intl.DateTimeFormat('tr-TR', {
          timeZone: 'Europe/Istanbul',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).format(new Date());
      } catch (e) {
        lastSyncTimeString = new Date().toLocaleTimeString('tr-TR');
      }
      lastSyncStatus = 'Canlı Bağlı';
      trySaveState();
    } else if (text.includes('601')) {
      // 601 Kota uyarısı: Sayacı sıfırla ki en az 30s beklesin
      lastFetchTime = Date.now();
      lastSyncStatus = 'Adisyo kota koruması (30s)';
      trySaveState();
    }
  } catch (err) {
    console.error('[Adisyo Fetch Error]', err);
  } finally {
    isFetching = false;
  }

  return cachedOrders;
}

function getOrdersPayload() {
  const formatted = cachedOrders
    .map(formatOrder)
    .filter(Boolean)
    .sort((a, b) => new Date(a.insertDate) - new Date(b.insertDate));

  return {
    orders: formatted,
    count: formatted.length,
    rawCount: cachedOrders.length,
    lastSyncTime: lastSyncTimeString || 'Canlı',
    status: lastSyncStatus
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  tryLoadState();

  const url = req.url || '';
  const body = req.body || {};

  // 1. WEBHOOK ENDPOINT: /api/webhook
  if (url.includes('/api/webhook') || url.includes('webhook')) {
    const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});
    if (
      req.method === 'GET' ||
      bodyText.toLowerCase().includes('handshake') ||
      !req.body ||
      Object.keys(req.body).length === 0
    ) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send('adisyo');
    }

    try {
      const incomingOrder = body?.data || (body?.id && body?.products ? body : null);
      if (incomingOrder && incomingOrder.id) {
        const existingIdx = cachedOrders.findIndex(o => o.id === incomingOrder.id);
        if (existingIdx >= 0) {
          cachedOrders[existingIdx] = incomingOrder;
        } else {
          cachedOrders.push(incomingOrder);
        }
        try {
          lastSyncTimeString = new Intl.DateTimeFormat('tr-TR', {
            timeZone: 'Europe/Istanbul',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
          }).format(new Date());
        } catch (e) {
          lastSyncTimeString = new Date().toLocaleTimeString('tr-TR');
        }
        lastSyncStatus = 'Webhook Anlık Bağlı';
        trySaveState();
      } else {
        await fetchFromAdisyo(false);
      }
    } catch (e) {}

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  }

  // 2. TOGGLE READY: /api/toggle-ready
  if (url.includes('toggle-ready')) {
    const { productId } = body;
    if (!productId) return res.status(400).json({ error: 'Eksik productId' });
    const pid = String(productId);
    if (readyProductIds.has(pid)) {
      readyProductIds.delete(pid);
    } else {
      readyProductIds.add(pid);
    }
    trySaveState();
    return res.status(200).json({ success: true, productId: pid, isReady: readyProductIds.has(pid) });
  }

  // 3. MARK ALL READY / NOTIFY ADISYO: /api/mark-all-ready or /api/notify-adisyo
  if (url.includes('mark-all-ready') || url.includes('notify-adisyo')) {
    const { orderId } = body;
    if (!orderId) return res.status(400).json({ error: 'Eksik orderId' });
    const oid = Number(orderId);

    // Adisyo POS'a bildir (Masa mavi renge döner / Hazırlandı)
    try {
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
    } catch (err) {
      console.error('[Adisyo Prepared Error]', err);
    }

    // Önbellekten kaldır
    cachedOrders = cachedOrders.filter(o => o.id !== oid);
    trySaveState();
    return res.status(200).json({ success: true, orderId: oid });
  }

  // 4. SYNC NOW: /api/sync-now
  if (url.includes('sync-now')) {
    await fetchFromAdisyo(true);
    return res.status(200).json(getOrdersPayload());
  }

  // 5. DEFAULT: ORDERS LIST (/api/orders)
  res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=10');
  const now = Date.now();
  if (now - lastFetchTime >= 30000) {
    await fetchFromAdisyo(false);
  }

  return res.status(200).json(getOrdersPayload());
};

module.exports.fetchFromAdisyo = fetchFromAdisyo;
module.exports.getOrdersPayload = getOrdersPayload;
module.exports.formatOrder = formatOrder;
