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

  if (statusId === 3 || statusId === 5 || statusStr.includes('hazır') || statusStr.includes('kapan') || statusStr.includes('iptal')) {
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
    const dt = new Date(insertDate);
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

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  res.setHeader('Cache-Control', 's-maxage=12, stale-while-revalidate=25');

  const now = Date.now();
  if (now - lastFetchTime > 16000 || cachedOrders.length === 0) {
    try {
      const url = `${ADISYO_BASE_URL}/RecentOrders?orderType=TakeAway,Table,Retail&onlyRestaurantCourier=false`;
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

      if (response.ok && data.data) {
        cachedOrders = data.data;
        lastFetchTime = now;
        const d = new Date();
        lastSyncTimeString = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
        lastSyncStatus = `Bağlı (${cachedOrders.length} aktif adisyon)`;
      } else if (text.includes('601')) {
        lastSyncStatus = 'Adisyo kota koruması aktif';
      }
    } catch (err) {
      console.error('[Adisyo Error]', err);
    }
  }

  const formatted = cachedOrders
    .map(formatOrder)
    .filter(Boolean)
    .sort((a, b) => new Date(a.insertDate) - new Date(b.insertDate));

  return res.status(200).json({
    orders: formatted,
    count: formatted.length,
    lastSyncTime: lastSyncTimeString || 'Canlı',
    status: lastSyncStatus
  });
}

module.exports = handler;
module.exports.default = handler;
