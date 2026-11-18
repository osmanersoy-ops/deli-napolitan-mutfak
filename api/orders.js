const ADISYO_BASE_URL = process.env.ADISYO_BASE_URL || 'https://ext.adisyo.com/api/External/v2';
const ADISYO_API_KEY = process.env.ADISYO_API_KEY || '25b80b3556ca3a15353dd2fd312062fad27adcf5a1de51b75bdadea1fa8214ab';
const ADISYO_API_SECRET = process.env.ADISYO_API_SECRET || '65e70574-2b17-42a1-b093-4128ad9aff44';
const ADISYO_API_CONSUMER = process.env.ADISYO_API_CONSUMER || 'Deli Napolitan';

const PIZZA_KEYWORDS = ['pizza', 'pizzalar', 'napolitan', 'calzone', 'pizzetta'];

// Global state in warm container memory
let cachedOrders = [];
let lastFetchTime = 0;
let lastSyncTimeString = null;
let lastSyncStatus = 'Başlatılıyor...';
let readyProductIds = new Set();
let isFetching = false;

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
  const now = Date.now();

  // KESİN ADİSYO KURALI: En az 30 saniye geçmeden ASLA istek atılmaz!
  if (!force && now - lastFetchTime < 30000) {
    return cachedOrders;
  }

  if (isFetching) return cachedOrders;
  isFetching = true;
  lastFetchTime = Date.now(); // Mutex kilidi: Sonraki istekler hemen beklemeye geçer

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
    } else if (text.includes('601')) {
      // 601 Kota uyarısı
      lastFetchTime = Date.now();
      lastSyncStatus = 'Adisyo kota koruması (30s)';
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

  const url = req.url || '';
  const body = req.body || {};
  const action = req.query?.action || body?.action;

  // 1. TOGGLE READY: action === 'toggle-ready' veya body.productId
  if (action === 'toggle-ready' || body.productId) {
    const pid = String(body.productId);
    if (readyProductIds.has(pid)) {
      readyProductIds.delete(pid);
    } else {
      readyProductIds.add(pid);
    }
    return res.status(200).json({ success: true, productId: pid, isReady: readyProductIds.has(pid) });
  }

  // 2. MARK ALL READY / NOTIFY ADISYO: action === 'mark-all-ready' veya 'notify-adisyo' veya body.orderId (POST)
  if (action === 'mark-all-ready' || action === 'notify-adisyo' || (body.orderId && req.method === 'POST')) {
    const oid = Number(body.orderId);
    if (oid && oid < 1000000000000) {
      try {
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
      } catch (err) {
        console.error('[Adisyo Prepared Error]', err);
      }
    }

    cachedOrders = cachedOrders.filter(o => o.id !== oid);
    return res.status(200).json({ success: true, orderId: oid });
  }

  // 3. SYNC NOW: action === 'sync-now'
  if (action === 'sync-now') {
    await fetchFromAdisyo(true);
    return res.status(200).json(getOrdersPayload());
  }

  // 4. DEFAULT: GET ORDERS LIST
  res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=10');
  const now = Date.now();
  if (now - lastFetchTime >= 30000) {
    await fetchFromAdisyo(false);
  }

  return res.status(200).json(getOrdersPayload());
};

module.exports.fetchFromAdisyo = fetchFromAdisyo;
module.exports.getOrdersPayload = getOrdersPayload;
