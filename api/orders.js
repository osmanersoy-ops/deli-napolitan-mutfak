const ADISYO_BASE_URL = process.env.ADISYO_BASE_URL || 'https://ext.adisyo.com/api/External/v2';
const ADISYO_API_KEY = process.env.ADISYO_API_KEY || '25b80b3556ca3a15353dd2fd312062fad27adcf5a1de51b75bdadea1fa8214ab';
const ADISYO_API_SECRET = process.env.ADISYO_API_SECRET || '65e70574-2b17-42a1-b093-4128ad9aff44';
const ADISYO_API_CONSUMER = process.env.ADISYO_API_CONSUMER || 'Deli Napolitan';

const PIZZA_KEYWORDS = ['pizza', 'pizzalar', 'napolitan', 'calzone', 'pizzetta'];

// Global container cache
let cachedOrders = [];
let lastFetchTime = 0;
let lastSyncTimeString = null;
let lastSyncStatus = 'Başlatılıyor...';
let readyProductIds = new Set();

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
    statusStr.includes('hazır') ||
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
  if (!force && now - lastFetchTime < 25000 && cachedOrders.length > 0) {
    return cachedOrders;
  }

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
      // 601 Adisyo kota uyarısı
      lastFetchTime = Date.now() - 5000;
      lastSyncStatus = 'Adisyo kota koruması (30s)';
    }
  } catch (err) {
    console.error('[Adisyo Fetch Error]', err);
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
    lastSyncTime: lastSyncTimeString || 'Canlı',
    status: `Bağlı (${formatted.length} bekleyen adisyon)`
  };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Edge cache: 12s cache, 25s stale
  res.setHeader('Cache-Control', 's-maxage=12, stale-while-revalidate=25');

  const now = Date.now();
  // Adisyo 30 sn kota kuralı: 26 saniye veya ilk yükleme
  if (now - lastFetchTime > 26000 || cachedOrders.length === 0) {
    await fetchFromAdisyo(false);
  }

  return res.status(200).json(getOrdersPayload());
}

function updateCachedOrder(order) {
  if (!order || !order.id) return;
  const existingIdx = cachedOrders.findIndex(o => o.id === order.id);
  if (existingIdx >= 0) {
    cachedOrders[existingIdx] = order;
  } else {
    cachedOrders.push(order);
  }
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
}

module.exports = handler;
module.exports.default = handler;
module.exports.fetchFromAdisyo = fetchFromAdisyo;
module.exports.getOrdersPayload = getOrdersPayload;
module.exports.updateCachedOrder = updateCachedOrder;
