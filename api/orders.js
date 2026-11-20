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
let readyProductIds = new Set();

const CACHE_FILE = '/tmp/kds_cached_orders.json';
const READY_FILE = '/tmp/kds_ready.json';
const LAST_CALL_FILE = '/tmp/kds_last_call.json';

function getLastAdisyoCallTime() {
  try {
    if (fs.existsSync(LAST_CALL_FILE)) {
      const val = Number(fs.readFileSync(LAST_CALL_FILE, 'utf8'));
      if (val > 0) return val;
    }
  } catch (e) {}
  return lastFetchTime || 0;
}

function setLastAdisyoCallTime(ts) {
  lastFetchTime = ts;
  try {
    fs.writeFileSync(LAST_CALL_FILE, String(ts), 'utf8');
  } catch (e) {}
}

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

  try {
    if (fs.existsSync(READY_FILE)) {
      const arr = JSON.parse(fs.readFileSync(READY_FILE, 'utf8'));
      if (Array.isArray(arr)) {
        arr.forEach(id => readyProductIds.add(String(id)));
      }
    }
  } catch (e) {}
}

// Yerel /tmp disk önbelleğine kaydet (boş diziyle üzerine yazmayı engelle)
function saveDiskCache() {
  try {
    if (Array.isArray(cachedOrders) && cachedOrders.length > 0) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedOrders), 'utf8');
    }
  } catch (e) {}
  try {
    fs.writeFileSync(READY_FILE, JSON.stringify(Array.from(readyProductIds)), 'utf8');
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
    if (p.description && String(p.description).trim()) {
      notes.push(String(p.description).trim());
    }
    if (p.productNote && String(p.productNote).trim()) {
      const pn = String(p.productNote).trim();
      if (!notes.includes(pn)) notes.push(pn);
    }
    if (p.note && String(p.note).trim()) {
      const n = String(p.note).trim();
      if (!notes.includes(n)) notes.push(n);
    }
    if (p.notes && String(p.notes).trim()) {
      const n2 = String(p.notes).trim();
      if (!notes.includes(n2)) notes.push(n2);
    }
    if (p.comment && String(p.comment).trim()) {
      const c = String(p.comment).trim();
      if (!notes.includes(c)) notes.push(c);
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

  // Masa Adı ve Sipariş Türü
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

  const totalPizzas = pizzaProducts.length;
  const readyPizzas = pizzaProducts.filter(p => p.isReady).length;
  const allPizzasReady = totalPizzas > 0 && readyPizzas === totalPizzas;

  const totalProducts = allProducts.length;
  const readyProducts = allProducts.filter(p => p.isReady).length;
  const allProductsReady = totalProducts > 0 && readyProducts === totalProducts;

  const orderNotes = [];
  if (order.orderNote && String(order.orderNote).trim()) {
    orderNotes.push(String(order.orderNote).trim());
  }
  if (order.description && String(order.description).trim()) {
    const od = String(order.description).trim();
    if (!orderNotes.includes(od)) orderNotes.push(od);
  }
  if (order.note && String(order.note).trim()) {
    const on = String(order.note).trim();
    if (!orderNotes.includes(on)) orderNotes.push(on);
  }
  const fullOrderNote = orderNotes.length > 0 ? orderNotes.join(' • ') : null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType,
    tableName,
    waiterName: order.waiterName || '',
    insertDate,
    secondsElapsed: elapsed,
    orderNote: fullOrderNote,
    products: allProducts, // Servis ekranı için TÜM ürünler (içecek, salata, tatlı dahil)
    pizzas: pizzaProducts,  // Mutfak ekranı için YALNIZCA pizzalar
    pizzaCount: totalPizzas,
    readyPizzaCount: readyPizzas,
    allPizzasReady,
    productCount: totalProducts,
    readyProductCount: readyProducts,
    allProductsReady
  };
}

// Tek bir siparişi ID ile Adisyo'dan çek
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

// Arka plan yedek tarama (En az 25 saniye aralıkla ve kota korumalı)
async function fetchFromAdisyo(force = false) {
  const now = Date.now();
  const lastCall = getLastAdisyoCallTime();

  if (!force && (now - lastCall < 25000)) {
    return cachedOrders;
  }

  if (isFetching) return cachedOrders;
  isFetching = true;
  setLastAdisyoCallTime(Date.now());

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
      setLastAdisyoCallTime(Date.now());
      try {
        lastSyncTimeString = new Intl.DateTimeFormat('tr-TR', {
          timeZone: 'Europe/Istanbul',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(new Date());
      } catch (e) {
        lastSyncTimeString = new Date().toLocaleTimeString('tr-TR');
      }
      lastSyncStatus = 'Canlı Bağlı';
    } else if (text.includes('601')) {
      // 30 saniye boyunca Adisyo kotasını ferahlatmak için bekleme uygula
      setLastAdisyoCallTime(Date.now() + 15000);
      lastSyncStatus = 'Adisyo kota koruması (25s)';
      loadDiskCache();
    }
  } catch (err) {
    console.error('[Adisyo Fetch Error]', err);
  } finally {
    isFetching = false;
  }

  return cachedOrders;
}

function getOrdersPayload() {
  loadDiskCache();
  const formatted = cachedOrders
    .map(formatOrder)
    .filter(Boolean);

  // KURAL: En eski sipariş sol üst başta olsun (FIFO), yeni gelenler sağa ve aşağıya aksın
  formatted.sort((a, b) => new Date(a.insertDate) - new Date(b.insertDate));

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

  // Anti-cache & edge protection
  res.setHeader('Cache-Control', 'public, s-maxage=3, stale-while-revalidate=5');
  res.setHeader('Pragma', 'no-cache');

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

    // Adisyo Handshake / Doğrulama Kontrolü ('adisyo' düz metin yanıtı)
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
          try {
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedOrders), 'utf8');
          } catch (e) {}
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
  // 2. ÜRÜN HAZIR İŞARETLEME (toggle-ready)
  // ==========================================
  if (action === 'toggle-ready' || body.productId) {
    const pid = String(body.productId);
    if (typeof body.isReady === 'boolean') {
      if (body.isReady) {
        readyProductIds.add(pid);
      } else {
        readyProductIds.delete(pid);
      }
    } else {
      if (readyProductIds.has(pid)) {
        readyProductIds.delete(pid);
      } else {
        readyProductIds.add(pid);
      }
    }
    saveDiskCache();
    return res.status(200).json({ success: true, productId: pid, isReady: readyProductIds.has(pid) });
  }

  // ==========================================
  // 3. ADİSYON TÜMÜ HAZIR (Adisyo Prepared Bildirimi)
  // ==========================================
  if (action === 'mark-all-ready' || action === 'notify-adisyo' || (body.orderId && req.method === 'POST')) {
    const oid = Number(body.orderId);
    if (oid) {
      try {
        await fetch(`${ADISYO_BASE_URL}/Prepared`, {
          method: 'POST',
          headers: {
            'x-api-key': ADISYO_API_KEY,
            'x-api-secret': ADISYO_API_SECRET,
            'x-api-consumer': ADISYO_API_CONSUMER,
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Deli-Napolitan-Kitchen-Display)'
          },
          body: JSON.stringify({ orderId: oid })
        });
      } catch (err) {
        console.error('[Adisyo Prepared API Error]', err);
      }
    }

    // Bizim kuyruktan da anında kaldır
    cachedOrders = cachedOrders.filter(o => o.id !== oid);
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedOrders), 'utf8');
    } catch (e) {}
    return res.status(200).json({ success: true, orderId: oid });
  }

  // ==========================================
  // 4. MANUEL YENİLEME (sync-now)
  // ==========================================
  if (action === 'sync-now') {
    await fetchFromAdisyo(true);
    return res.status(200).json(getOrdersPayload());
  }

  // ==========================================
  // 5. GENEL SORGULAMA (GET /api/orders)
  // ==========================================
  const now = Date.now();
  const lastCall = getLastAdisyoCallTime();
  if (now - lastCall >= 25000 || (cachedOrders.length === 0 && now - lastCall >= 6000)) {
    await fetchFromAdisyo(cachedOrders.length === 0);
  }

  const payload = getOrdersPayload();

  // KRİTİK GÜVENLİK: Eğer Adisyo kota hatası verdiyse ve elimizde sipariş yoksa,
  // 200 dönüp ekranı sildirme! 429 dön ki istemciler mevcut adisyonları korusun.
  if (payload.count === 0 && payload.status && payload.status.includes('kota')) {
    return res.status(429).json({ error: 'Adisyo kota beklemede', status: payload.status });
  }

  return res.status(200).json(payload);
};
