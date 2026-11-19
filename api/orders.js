const ADISYO_BASE_URL = process.env.ADISYO_BASE_URL || 'https://ext.adisyo.com/api/External/v2';
const ADISYO_API_KEY = process.env.ADISYO_API_KEY || '25b80b3556ca3a15353dd2fd312062fad27adcf5a1de51b75bdadea1fa8214ab';
const ADISYO_API_SECRET = process.env.ADISYO_API_SECRET || '65e70574-2b17-42a1-b093-4128ad9aff44';
const ADISYO_API_CONSUMER = process.env.ADISYO_API_CONSUMER || 'Deli Napolitan';

// Sadece pizza çeşitlerini filtrelemek için anahtar kelimeler
const PIZZA_KEYWORDS = ['pizza', 'pizzalar', 'napolitan', 'calzone', 'pizzetta'];

// Warm container global state
let cachedOrders = [];
let lastFetchTime = 0;
let lastSyncTimeString = null;
let lastSyncStatus = 'Başlatılıyor...';
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

function formatOrderForKitchen(order) {
  if (!order || !Array.isArray(order.products)) return null;

  const statusStr = normalizeTurkish(order.status || '');
  const statusId = order.statusId || 0;

  // Hazırlandı (3), Kapandı (5), İptal veya preparedDate varsa mutfak ekranından otomatik düşer
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

  // YALNIZCA PİZZA ÜRÜNLERİ FİLTRELENİR
  const pizzaProducts = [];

  for (const p of order.products) {
    if (!isPizzaProduct(p)) continue;

    const pid = String(p.id);
    const pname = p.productName || 'Pizza';
    const qty = parseInt(p.quantity || 1, 10);

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

    pizzaProducts.push({
      id: pid,
      name: pname,
      qty,
      note: notes.length > 0 ? notes.join(' • ') : null
    });
  }

  // İçinde hiç pizza yoksa (örneğin sadece içecek/tatlıysa) bu adisyon mutfak ekranına basılmaz
  if (pizzaProducts.length === 0) {
    return null;
  }

  // Masa Adı ve Sipariş Türü
  let tableName = order.tableName || 'Masa';
  const orderTypeRaw = normalizeTurkish(order.orderType || '');
  let orderType = 'SALON';

  if (orderTypeRaw.includes('paket')) {
    orderType = 'PAKET';
    tableName = order.externalAppName ? `${order.externalAppName}` : `PAKET`;
  } else if (orderTypeRaw.includes('gel')) {
    orderType = 'GEL-AL';
    tableName = `GEL-AL`;
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

  const totalPizzaCount = pizzaProducts.reduce((sum, item) => sum + item.qty, 0);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType,
    tableName,
    waiterName: order.waiterName || '',
    insertDate,
    secondsElapsed: elapsed,
    pizzas: pizzaProducts,
    pizzaCount: totalPizzaCount
  };
}

async function fetchFromAdisyo(force = false) {
  const now = Date.now();

  // ADİSYO KURALI: En az 25 saniye geçmeden istek atılmaz (Kota koruması)
  if (!force && now - lastFetchTime < 25000) {
    return cachedOrders;
  }

  if (isFetching) return cachedOrders;
  isFetching = true;
  lastFetchTime = Date.now();

  const url = `${ADISYO_BASE_URL}/RecentOrders?orderType=TakeAway,Table,Retail&onlyRestaurantCourier=false`;
  try {
    const response = await fetch(url, {
      headers: {
        'x-api-key': ADISYO_API_KEY,
        'x-api-secret': ADISYO_API_SECRET,
        'x-api-consumer': ADISYO_API_CONSUMER,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Deli-Napolitan-Kitchen-Display)'
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
      lastFetchTime = Date.now();
      lastSyncStatus = 'Adisyo kota koruması (25s)';
    }
  } catch (err) {
    console.error('[Adisyo Fetch Error]', err);
  } finally {
    isFetching = false;
  }

  return cachedOrders;
}

function getKitchenOrdersPayload() {
  const formatted = cachedOrders
    .map(formatOrderForKitchen)
    .filter(Boolean);

  // KURAL: "yeni sipariş ekranın solunda sol başa gelsin"
  // Bu yüzden tarihe göre azalan (en yeni ilk sırada / sol başta) sıralanır!
  formatted.sort((a, b) => new Date(b.insertDate) - new Date(a.insertDate));

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

  // Anti-cache headers
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const action = req.query?.action || req.body?.action;

  // Manuel anlık yenileme isteği
  if (action === 'sync-now') {
    await fetchFromAdisyo(true);
    return res.status(200).json(getKitchenOrdersPayload());
  }

  // Normal periyodik sorgulama
  const now = Date.now();
  if (now - lastFetchTime >= 25000) {
    await fetchFromAdisyo(false);
  }

  return res.status(200).json(getKitchenOrdersPayload());
};
