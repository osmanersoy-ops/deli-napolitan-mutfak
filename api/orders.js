const fs = require('fs');

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

const CACHE_FILE = '/tmp/kds_cached_orders.json';

// Yerel /tmp disk önbelleğini yükle
function loadDiskCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0 && cachedOrders.length === 0) {
        cachedOrders = data;
      }
    }
  } catch (e) {}
}

// Yerel /tmp disk önbelleğine kaydet
function saveDiskCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedOrders), 'utf8');
  } catch (e) {}
}

loadDiskCache();

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

// Tek bir siparişi ID ile Adisyo'dan çek (Limit: 1 saniyede 4 çağrı - Webhook için optimize)
async function fetchOrderById(orderId) {
  try {
    const url = `${ADISYO_BASE_URL}/Order/${orderId}`;
    const res = await fetch(url, {
      headers: {
        'x-api-key': ADISYO_API_KEY,
        'x-api-secret': ADISYO_API_SECRET,
        'x-api-consumer': ADISYO_API_CONSUMER,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Deli-Napolitan-Kitchen-Display)'
      }
    });
    if (res.ok) {
      const json = await res.json();
      return json.data || json;
    }
  } catch (e) {
    console.error('[fetchOrderById Error]', e);
  }
  return null;
}

// Arka plan yedek tarama (En az 25 saniye aralıkla)
async function fetchFromAdisyo(force = false) {
  const now = Date.now();

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
      saveDiskCache();
      lastFetchTime = Date.now();
      try {
        lastSyncTimeString = new Intl.DateTimeFormat('tr-TR', {
          timeZone: 'Europe/Istanbul',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(new Date());
      } catch (e) {
        lastSyncTimeString = new Date().toLocaleTimeString('tr-TR');
      }
      lastSyncStatus = 'Canlı Webhook & API Bağlı';
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
  loadDiskCache();
  const formatted = cachedOrders
    .map(formatOrderForKitchen)
    .filter(Boolean);

  // KURAL: Yeni sipariş ekranın solunda sol başa gelsin (En yeni ilk sırada)
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

  // Anti-cache headers (Tarayıcı ve ara sunucu önbelleğini engelle)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  loadDiskCache();

  const url = req.url || '';
  const body = req.body || {};
  const action = req.query?.action || body?.action;

  // ==========================================
  // 1. WEBHOOK ALICISI (Adisyo Anlık Bildirim)
  // ==========================================
  if (url.includes('webhook') || action === 'webhook') {
    const bodyText = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {});

    // Adisyo Handshake / Doğrulama Kontrolü (Adisyo panelinden eklerken 'adisyo' yanıtı bekler)
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
      const payload = req.body;
      let incomingList = [];

      if (Array.isArray(payload)) {
        incomingList = payload;
      } else if (payload?.data && Array.isArray(payload.data)) {
        incomingList = payload.data;
      } else if (payload?.data && (payload.data.id || payload.data.orderId)) {
        incomingList = [payload.data];
      } else if (payload?.order && (payload.order.id || payload.order.orderId)) {
        incomingList = [payload.order];
      } else if (payload?.id || payload?.orderId) {
        incomingList = [payload];
      }

      for (let incoming of incomingList) {
        const orderId = incoming.id || incoming.orderId;
        if (!orderId) continue;

        // Sipariş hazırlandı veya kapandıysa kuyruktan derhal düşür
        const statusStr = normalizeTurkish(incoming.status || '');
        const statusId = incoming.statusId || 0;
        const isFinished = (
          incoming.preparedDate != null ||
          statusId === 3 ||
          statusId === 5 ||
          statusStr.includes('hazırlandı') ||
          statusStr.includes('kapan') ||
          statusStr.includes('iptal')
        );

        if (isFinished) {
          cachedOrders = cachedOrders.filter(o => o.id !== orderId);
          saveDiskCache();
          continue;
        }

        // Eğer webhook gövdesinde ürün detayları yoksa tekil API ile anında çek
        if (!Array.isArray(incoming.products) || incoming.products.length === 0) {
          const fullOrder = await fetchOrderById(orderId);
          if (fullOrder && fullOrder.id) {
            incoming = fullOrder;
          }
        }

        // Kuyruğu güncelle veya sol başa yeni sipariş olarak ekle
        const idx = cachedOrders.findIndex(o => o.id === orderId);
        if (idx >= 0) {
          cachedOrders[idx] = incoming;
        } else {
          cachedOrders.unshift(incoming);
        }
      }

      saveDiskCache();

      try {
        lastSyncTimeString = new Intl.DateTimeFormat('tr-TR', {
          timeZone: 'Europe/Istanbul',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(new Date());
      } catch (e) {
        lastSyncTimeString = new Date().toLocaleTimeString('tr-TR');
      }
      lastSyncStatus = 'Canlı Webhook Bağlı';
    } catch (err) {
      console.error('[Webhook Processing Error]', err);
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send('adisyo');
  }

  // ==========================================
  // 2. MANUEL YENİLEME (sync-now)
  // ==========================================
  if (action === 'sync-now') {
    await fetchFromAdisyo(true);
    return res.status(200).json(getKitchenOrdersPayload());
  }

  // ==========================================
  // 3. MUTFAK EKRANI SORGULAMA (GET /api/orders)
  // ==========================================
  const now = Date.now();
  // Arka planda 25 saniyede bir genel tarama (Webhook kaçırılırsa emniyet kilidi)
  if (now - lastFetchTime >= 25000 || cachedOrders.length === 0) {
    await fetchFromAdisyo(false);
  }

  return res.status(200).json(getKitchenOrdersPayload());
};
