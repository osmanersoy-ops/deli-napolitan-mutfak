const fs = require('fs');

const ADISYO_BASE_URL = process.env.ADISYO_BASE_URL || 'https://ext.adisyo.com/api/External/v2';
const ADISYO_API_KEY = process.env.ADISYO_API_KEY || '25b80b3556ca3a15353dd2fd312062fad27adcf5a1de51b75bdadea1fa8214ab';
const ADISYO_API_SECRET = process.env.ADISYO_API_SECRET || '65e70574-2b17-42a1-b093-4128ad9aff44';
const ADISYO_API_CONSUMER = process.env.ADISYO_API_CONSUMER || 'Deli Napolitan';

// Sadece pizza ve salata çeşitlerini filtrelemek için anahtar kelimeler
const PIZZA_KEYWORDS = ['pizza', 'pizzalar', 'napolitan', 'calzone', 'pizzetta'];
const SALAD_KEYWORDS = ['salata', 'salatalar', 'salad'];

// Warm container global state
let cachedOrders = [];
let lastFetchTime = 0;
let lastSyncTimeString = null;
let lastSyncStatus = 'Başlatılıyor...';
let isFetching = false;
let lastSyncSuccess = false;
let lastAdisyoSyncTime = 0;
let isQuotaProtected = false;
let readyProductIds = new Set();
const unreadyMap = new Map(); // pid -> timestamp
let internalBreadRequests = [];
const dismissedBreadIds = new Set();
const preparedOrderIds = new Set();

const CACHE_FILE = '/tmp/kds_cached_orders.json';
const READY_FILE = '/tmp/kds_ready.json';
const LAST_CALL_FILE = '/tmp/kds_last_call.json';
const BREAD_FILE = '/tmp/kds_bread_requests.json';
const DISMISSED_BREAD_FILE = '/tmp/kds_dismissed_bread.json';
const PREPARED_FILE = '/tmp/kds_prepared_orders.json';

function loadPreparedOrders() {
  try {
    if (fs.existsSync(PREPARED_FILE)) {
      const arr = JSON.parse(fs.readFileSync(PREPARED_FILE, 'utf8'));
      if (Array.isArray(arr)) {
        arr.forEach(id => {
          const num = Number(id);
          if (!isNaN(num)) preparedOrderIds.add(num);
        });
      }
    }
  } catch (e) {}
}

function savePreparedOrders() {
  try {
    fs.writeFileSync(PREPARED_FILE, JSON.stringify(Array.from(preparedOrderIds)), 'utf8');
  } catch (e) {}
}

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

function loadDismissedBread() {
  try {
    if (fs.existsSync(DISMISSED_BREAD_FILE)) {
      const arr = JSON.parse(fs.readFileSync(DISMISSED_BREAD_FILE, 'utf8'));
      if (Array.isArray(arr)) {
        const now = Date.now();
        arr.forEach(id => {
          const sId = String(id);
          // 24 saatten eski kapatılmış id'leri temizle
          const ts = Number(sId.replace('bread_', ''));
          if (!ts || isNaN(ts) || (now - ts) < (24 * 3600 * 1000)) {
            dismissedBreadIds.add(sId);
          }
        });
      }
    }
  } catch (e) {}
}

function saveDismissedBread() {
  try {
    fs.writeFileSync(DISMISSED_BREAD_FILE, JSON.stringify(Array.from(dismissedBreadIds)), 'utf8');
  } catch (e) {}
}

function loadBreadRequests() {
  loadDismissedBread();
  try {
    if (fs.existsSync(BREAD_FILE)) {
      const data = JSON.parse(fs.readFileSync(BREAD_FILE, 'utf8'));
      if (Array.isArray(data)) {
        const now = Date.now();
        // 2 saatten eski veya kapatılmış ekmek taleplerini temizle
        internalBreadRequests = data.filter(b => {
          if (!b || !b.id || dismissedBreadIds.has(String(b.id))) return false;
          if (!b.insertDate) return false;
          let dateStr = b.insertDate;
          if (!dateStr.includes('+') && !dateStr.includes('Z')) dateStr += '+03:00';
          const dt = new Date(dateStr);
          return (now - dt.getTime()) < (2 * 3600 * 1000);
        });
      }
    }
  } catch (e) {}
}

function saveBreadRequests() {
  try {
    fs.writeFileSync(BREAD_FILE, JSON.stringify(internalBreadRequests), 'utf8');
  } catch (e) {}
}

// Yerel /tmp disk önbelleğini yükle
function loadDiskCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        const now = Date.now();
        // 3 saatten eski (dünden kalan) verileri disk önbelleğinden temizle
        const filtered = data.filter(o => {
          if (!o || !o.insertDate) return false;
          let dateStr = o.insertDate;
          if (!dateStr.includes('+') && !dateStr.includes('Z')) dateStr += '+03:00';
          const dt = new Date(dateStr);
          return (now - dt.getTime()) < (3 * 3600 * 1000);
        });
        if (filtered.length > 0) {
          cachedOrders = filtered;
        }
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

  loadBreadRequests();
  loadPreparedOrders();
}

// Yerel /tmp disk önbelleğine kaydet (boş diziyle üzerine yazmayı allowEmpty=true olmadıkça engelle)
function saveDiskCache(allowEmpty = false) {
  try {
    if (Array.isArray(cachedOrders) && (cachedOrders.length > 0 || allowEmpty)) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(cachedOrders), 'utf8');
    }
  } catch (e) {}
  try {
    fs.writeFileSync(READY_FILE, JSON.stringify(Array.from(readyProductIds)), 'utf8');
  } catch (e) {}
  saveBreadRequests();
  saveDismissedBread();
  savePreparedOrders();
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

function isSaladProduct(p) {
  const cat = normalizeTurkish(p.categoryName || '');
  const name = normalizeTurkish(p.productName || '');
  return SALAD_KEYWORDS.some(k => cat.includes(k) || name.includes(k));
}

function formatOrder(order) {
  if (!order) return null;
  if (order.isBreadRequest) {
    return order;
  }
  if (!Array.isArray(order.products)) return null;

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
  const saladProducts = [];

  for (const p of order.products) {
    const pid = String(p.id);
    const pname = p.productName || 'Ürün';
    const catName = p.categoryName || 'Genel';
    const qty = parseInt(p.quantity || 1, 10);
    const isPizza = isPizzaProduct(p);
    const isSalad = !isPizza && isSaladProduct(p);
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
      isSalad,
      qty,
      note: notes.length > 0 ? notes.join(' • ') : null,
      isReady
    };

    allProducts.push(item);
    if (isPizza) {
      pizzaProducts.push(item);
    } else if (isSalad) {
      saladProducts.push(item);
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

  // 3 saatten (10800 saniye / 180 dakika) eski siparişler dünden kalmış veya kapanmış adisyonlardır; ekrana basılmaz
  if (elapsed > 10800) {
    return null;
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
    pizzas: pizzaProducts,  // Mutfak ekranı için pizzalar
    salads: saladProducts,  // Mutfak ekranı için salatalar (ince turuncu transparan görünüm)
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

// Arka plan yedek tarama (En az 35 saniye aralıkla ve kota korumalı)
async function fetchFromAdisyo(force = false) {
  const now = Date.now();
  const lastCall = getLastAdisyoCallTime();

  if (!force && (now - lastCall < 35000)) {
    return cachedOrders;
  }
  // Eğer force (Yenile butonu) ise bile en az 10 saniye aralık koy ki ardışık basışlar kotayı aşmasın
  if (force && (now - lastCall < 10000)) {
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
      // Sadece son 3 saat içinde açılmış canlı siparişleri al (dünden kalanları süpür)
      const nowTs = Date.now();
      cachedOrders = data.data.filter(o => {
        if (!o || !o.insertDate) return false;
        let dateStr = o.insertDate;
        if (!dateStr.includes('+') && !dateStr.includes('Z')) dateStr += '+03:00';
        const dt = new Date(dateStr);
        return (nowTs - dt.getTime()) < (3 * 3600 * 1000);
      });
      saveDiskCache(true);
      setLastAdisyoCallTime(Date.now());
      lastSyncSuccess = true;
      isQuotaProtected = false;
      lastAdisyoSyncTime = Date.now();
      try {
        lastSyncTimeString = new Intl.DateTimeFormat('tr-TR', {
          timeZone: 'Europe/Istanbul',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).format(new Date());
      } catch (e) {
        lastSyncTimeString = new Date().toLocaleTimeString('tr-TR');
      }
      lastSyncStatus = 'Canlı Bağlı';
    } else if (text.includes('601') || response.status === 400 || response.status === 429) {
      // 45 saniye boyunca Adisyo kotasını ferahlatmak için bekleme uygula
      setLastAdisyoCallTime(Date.now() + 45000);
      lastSyncStatus = 'Adisyo kota koruması (45s)';
      isQuotaProtected = true;
      lastSyncSuccess = false;
      loadDiskCache();
    } else {
      lastSyncSuccess = false;
      loadDiskCache();
    }
  } catch (err) {
    console.error('[Adisyo Fetch Error]', err);
    lastSyncSuccess = false;
    loadDiskCache();
  } finally {
    isFetching = false;
  }

  return cachedOrders;
}

function getOrdersPayload() {
  loadDiskCache();
  loadBreadRequests();

  const formattedAdisyo = cachedOrders
    .map(formatOrder)
    .filter(Boolean);

  const activeBreads = internalBreadRequests.filter(b => b && b.id && !dismissedBreadIds.has(String(b.id)));
  const allOrders = [...activeBreads, ...formattedAdisyo];

  // KURAL: En eski sipariş sol başta (FIFO), yeni gelenler sağa eklenir (Ekmek talepleri de aynı sıraya girer)
  allOrders.sort((a, b) => new Date(a.insertDate) - new Date(b.insertDate));

  return {
    orders: allOrders,
    count: allOrders.length,
    rawCount: cachedOrders.length,
    breadCount: activeBreads.length,
    preparedOrderIds: Array.from(preparedOrderIds),
    dismissedBreadIds: Array.from(dismissedBreadIds),
    readyProductIds: Array.from(readyProductIds),
    lastSyncTime: lastSyncTimeString || 'Canlı',
    status: lastSyncStatus,
    isQuotaProtected: isQuotaProtected || (lastSyncStatus && lastSyncStatus.includes('kota')),
    lastSyncSuccess: lastSyncSuccess,
    hasSyncedWithAdisyo: (lastAdisyoSyncTime > 0)
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ready-ids, x-bread-requests');

  // Anti-cache & edge protection (Ekranların önbelleğe takılmasını engelle)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  loadDiskCache();

  // Multi-container ekmek talebi senkronizasyonu
  const clientBreadHeader = req.headers['x-bread-requests'];
  if (clientBreadHeader) {
    try {
      const incomingBread = JSON.parse(decodeURIComponent(clientBreadHeader));
      if (Array.isArray(incomingBread) && incomingBread.length > 0) {
        let changed = false;
        incomingBread.forEach(ib => {
          const bid = String(ib?.id || '');
          if (bid && !dismissedBreadIds.has(bid) && !internalBreadRequests.some(b => String(b.id) === bid)) {
            internalBreadRequests.push(ib);
            changed = true;
          }
        });
        if (changed) saveBreadRequests();
      }
    } catch (e) {}
  }

  // İstemcilerden gelen bilinen hazır ürün ID'lerini birleştir (Multi-device / multi-container sync)
  const clientReadyHeader = req.headers['x-ready-ids'] || req.query?.ready;
  if (clientReadyHeader) {
    const now = Date.now();
    const ids = String(clientReadyHeader).split(',').map(s => s.trim()).filter(Boolean);
    let changed = false;
    ids.forEach(id => {
      const unreadyTs = unreadyMap.get(id) || 0;
      if (now - unreadyTs > 30000 && !readyProductIds.has(id)) {
        readyProductIds.add(id);
        changed = true;
      }
    });
    if (changed) saveDiskCache(false);
  }

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
  // 1.5. EKMEK TALEBİ YÖNETİMİ (Sadece Servis ve Mutfak Ekranı - Asla Adisyo'ya Gitmez!)
  // ==========================================
  if (action === 'create-bread-request') {
    loadBreadRequests();
    loadDiskCache();
    if (cachedOrders.length === 0) {
      await fetchFromAdisyo(false);
    }
    const rawTable = body.tableName || req.query?.tableName || 'EKMEK TALEBİ';
    const cleanTable = String(rawTable).trim() || 'EKMEK TALEBİ';
    const nowStr = new Date().toISOString();
    const breadId = 'bread_' + Date.now();
    const prodId = 'bread_prod_' + Date.now();

    const breadOrder = {
      id: breadId,
      orderNumber: 'EKM',
      orderType: 'EKMEK',
      tableName: cleanTable.toUpperCase().includes('EKMEK') ? cleanTable : `${cleanTable} (Ekmek)`,
      waiterName: 'Servis',
      insertDate: nowStr,
      secondsElapsed: 0,
      orderNote: 'Servis Masadan Ekmek İstedi',
      isBreadRequest: true,
      products: [
        {
          id: prodId,
          name: '1 x Ekmek',
          category: 'Ekmek',
          isPizza: true,
          qty: 1,
          note: null,
          isReady: false
        }
      ],
      pizzas: [
        {
          id: prodId,
          name: '1 x Ekmek',
          qty: 1,
          note: null,
          isReady: false
        }
      ],
      pizzaCount: 1,
      readyPizzaCount: 0,
      allPizzasReady: false,
      productCount: 1,
      readyProductCount: 0,
      allProductsReady: false
    };

    internalBreadRequests.unshift(breadOrder);
    saveBreadRequests();
  saveDismissedBread();
    return res.status(200).json({ success: true, order: breadOrder, ...getOrdersPayload() });
  }

  if (action === 'dismiss-bread-request') {
    loadDismissedBread();
    loadBreadRequests();
    loadDiskCache();
    const oid = String(body.orderId || req.query?.orderId || '');
    if (oid) {
      dismissedBreadIds.add(oid);
      saveDismissedBread();
      internalBreadRequests = internalBreadRequests.filter(b => String(b.id) !== oid);
      saveBreadRequests();
    }
    return res.status(200).json({ success: true, ...getOrdersPayload() });
  }

  // ==========================================
  // 2. ÜRÜN HAZIR İŞARETLEME (toggle-ready)
  // ==========================================
  if (action === 'toggle-ready' || body.productId) {
    const pid = String(body.productId);
    if (pid.startsWith('bread_')) {
      loadDismissedBread();
      loadBreadRequests();
      loadDiskCache();
      const matchingBread = internalBreadRequests.find(b => 
        String(b.id) === String(body.orderId) || (b.products && b.products.some(p => String(p.id) === pid))
      );
      if (matchingBread) {
        dismissedBreadIds.add(String(matchingBread.id));
        saveDismissedBread();
      }
      internalBreadRequests = internalBreadRequests.filter(b => {
        if (matchingBread && String(b.id) === String(matchingBread.id)) return false;
        return !b.products.some(p => String(p.id) === pid);
      });
      saveBreadRequests();
      return res.status(200).json({ 
        success: true, 
        productId: pid, 
        isReady: true, 
        isBreadRequest: true, 
        ...getOrdersPayload() 
      });
    }
    if (body.isReady === true) {
      readyProductIds.add(pid);
      unreadyMap.delete(pid);
    } else if (body.isReady === false) {
      readyProductIds.delete(pid);
      unreadyMap.set(pid, Date.now());
    } else {
      if (readyProductIds.has(pid)) {
        readyProductIds.delete(pid);
        unreadyMap.set(pid, Date.now());
      } else {
        readyProductIds.add(pid);
        unreadyMap.delete(pid);
      }
    }
    saveDiskCache();
    return res.status(200).json({ 
      success: true, 
      productId: pid, 
      isReady: readyProductIds.has(pid),
      readyProductIds: Array.from(readyProductIds)
    });
  }

  // ==========================================
  // 3. ADİSYON TÜMÜ HAZIR (Adisyo Prepared Bildirimi)
  // ==========================================
  if (action === 'mark-all-ready' || action === 'notify-adisyo' || (body.orderId && req.method === 'POST')) {
    const oidStr = String(body.orderId || '');
    if (oidStr.startsWith('bread_')) {
      loadDismissedBread();
      loadBreadRequests();
      loadDiskCache();
      dismissedBreadIds.add(oidStr);
      saveDismissedBread();
      internalBreadRequests = internalBreadRequests.filter(b => String(b.id) !== oidStr);
      saveBreadRequests();
      return res.status(200).json({ success: true, orderId: oidStr, isBreadRequest: true, ...getOrdersPayload() });
    }
    const oid = Number(body.orderId);
    if (oid) {
      loadPreparedOrders();
      preparedOrderIds.add(oid);
      savePreparedOrders();
      isQuotaProtected = false;
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

    // O siparişe ait ürünleri de hazır hafızasından temizle
    const finishedOrder = cachedOrders.find(o => o.id === oid);
    if (finishedOrder && Array.isArray(finishedOrder.products)) {
      finishedOrder.products.forEach(p => {
        readyProductIds.delete(String(p.id));
        unreadyMap.delete(String(p.id));
      });
    }

    // Bizim kuyruktan da anında kaldır
    cachedOrders = cachedOrders.filter(o => o.id !== oid);
    saveDiskCache(true);
    return res.status(200).json({ success: true, orderId: oid, ...getOrdersPayload() });
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
  if (now - lastCall >= 35000) {
    await fetchFromAdisyo(false);
  }

  const payload = getOrdersPayload();

  // KRİTİK GÜVENLİK: Sadece kota sınırındayken VE henüz hiç başarılı tarama yapılmamışken 429 dön.
  // Ancak masalar meşru şekilde kapatıldıysa veya Adisyo başarılı taranmışsa asla 429 dönme!
  if (payload.count === 0 && (payload.isQuotaProtected || (payload.status && payload.status.includes('kota'))) && !payload.lastSyncSuccess && preparedOrderIds.size === 0) {
    return res.status(429).json({
      ...payload,
      error: 'Adisyo kota korumasında (beklemede)'
    });
  }

  return res.status(200).json(payload);
};
