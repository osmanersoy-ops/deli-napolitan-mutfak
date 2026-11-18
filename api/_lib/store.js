/**
 * Deli Napolitan KDS - Adisyo API & State Management
 * Works seamlessly in Vercel Serverless Functions with optional Upstash/Vercel KV
 */

const ADISYO_BASE_URL = process.env.ADISYO_BASE_URL || 'https://ext.adisyo.com/api/External/v2';
const ADISYO_API_KEY = process.env.ADISYO_API_KEY || '25b80b3556ca3a15353dd2fd312062fad27adcf5a1de51b75bdadea1fa8214ab';
const ADISYO_API_SECRET = process.env.ADISYO_API_SECRET || '65e70574-2b17-42a1-b093-4128ad9aff44';
const ADISYO_API_CONSUMER = process.env.ADISYO_API_CONSUMER || 'Deli Napolitan';

const PIZZA_KEYWORDS = ['pizza', 'pizzalar', 'napolitan', 'calzone', 'pizzetta'];

// KV Config (Supports Vercel KV / Upstash Redis if configured)
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Local container memory fallback
export const memoryActiveOrders = {};
export const memoryReadyProductIds = new Set();
let memoryLastSyncTime = null;
let memoryLastSyncStatus = 'Başlatılıyor...';
let memoryLastFetchTimestamp = 0;

/**
 * Turkish lowercase normalization
 */
export function normalizeTurkish(text) {
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

/**
 * Check if product is a pizza
 */
export function isPizzaProduct(p) {
  const cat = normalizeTurkish(p.categoryName || '');
  const name = normalizeTurkish(p.productName || '');
  return PIZZA_KEYWORDS.some(k => cat.includes(k) || name.includes(k));
}

/**
 * KV Helper methods (Upstash REST API)
 */
async function kvCommand(endpoint, body = null) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const opts = {
      headers: { Authorization: `Bearer ${KV_TOKEN}` }
    };
    if (body) {
      opts.method = 'POST';
      opts.headers['Content-Type'] = 'application/json';
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(`${KV_URL}/${endpoint}`, opts);
    const data = await res.json();
    return data.result;
  } catch (err) {
    console.error('[KV Error]', err);
    return null;
  }
}

/**
 * Get ready product IDs set
 */
export async function getReadyProductIds() {
  if (KV_URL && KV_TOKEN) {
    const members = await kvCommand('smembers/kds_ready_products');
    if (Array.isArray(members)) {
      return new Set(members.map(String));
    }
  }
  return memoryReadyProductIds;
}

/**
 * Toggle ready state of a product
 */
export async function toggleProductReady(productId) {
  const pid = String(productId);
  let isReady = false;

  if (KV_URL && KV_TOKEN) {
    const isMember = await kvCommand(`sismember/kds_ready_products/${encodeURIComponent(pid)}`);
    if (isMember === 1) {
      await kvCommand(`srem/kds_ready_products/${encodeURIComponent(pid)}`);
      isReady = false;
    } else {
      await kvCommand(`sadd/kds_ready_products/${encodeURIComponent(pid)}`);
      isReady = true;
    }
  } else {
    if (memoryReadyProductIds.has(pid)) {
      memoryReadyProductIds.delete(pid);
      isReady = false;
    } else {
      memoryReadyProductIds.add(pid);
      isReady = true;
    }
  }

  return isReady;
}

/**
 * Mark all products in an order ready
 */
export async function markAllProductsReady(orderId, productIds = []) {
  if (KV_URL && KV_TOKEN && productIds.length > 0) {
    for (const pid of productIds) {
      await kvCommand(`sadd/kds_ready_products/${encodeURIComponent(String(pid))}`);
    }
  } else {
    for (const pid of productIds) {
      memoryReadyProductIds.add(String(pid));
    }
  }
}

/**
 * Mark order as Prepared in Adisyo POS
 */
export async function markOrderPreparedInAdisyo(orderId) {
  if (!orderId) return { success: false, message: 'Eksik orderId' };

  const oid = Number(orderId);
  if (isNaN(oid)) return { success: false, message: 'Geçersiz orderId' };

  // Simulated test order
  if (oid > 1000000000000) {
    console.log(`[Test Siparişi] #${orderId} simüle edildi, Adisyo'da Hazırlandı.`);
    return { success: true, mock: true };
  }

  const url = `${ADISYO_BASE_URL}/Prepared`;
  const headers = {
    'x-api-key': ADISYO_API_KEY,
    'x-api-secret': ADISYO_API_SECRET,
    'x-api-consumer': ADISYO_API_CONSUMER,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Deli-Napolitan-KDS)'
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderId: oid })
    });
    const data = await res.json();
    console.log(`[Adisyo Prepared Başarılı] Sipariş #${orderId} Adisyo POS'a bildirildi.`);
    return { success: true, data };
  } catch (err) {
    console.error(`[Adisyo Prepared Hata] #${orderId}:`, err);
    return { success: false, error: err.message };
  }
}

/**
 * Format raw order for KDS & Service displays
 */
export function formatOrder(order, readySet) {
  if (!order || !Array.isArray(order.products)) return null;

  const statusStr = normalizeTurkish(order.status || '');
  const statusId = order.statusId || 0;

  // 3 = Hazırlandı, 5 = Kapandı, iptal
  const isFinished = (
    statusId === 3 ||
    statusId === 5 ||
    statusStr.includes('hazır') ||
    statusStr.includes('kapan') ||
    statusStr.includes('iptal')
  );
  if (isFinished) return null;

  const allProducts = [];
  const pizzaProducts = [];

  for (const p of order.products) {
    const pid = String(p.id);
    const pname = p.productName || 'Ürün';
    const catName = p.categoryName || 'Genel';
    const qty = parseInt(p.quantity || 1, 10);
    const isPizza = isPizzaProduct(p);
    const isReady = readySet.has(pid);

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

/**
 * Fetch orders from Adisyo with 15-20s rate limit guard
 */
export async function getOrders(forceSync = false) {
  const now = Date.now();
  const timeSinceLastFetch = (now - memoryLastFetchTimestamp) / 1000;

  // Rate limit protection: Adisyo allows 1 request every 20-30s
  if (!forceSync && timeSinceLastFetch < 18 && Object.keys(memoryActiveOrders).length > 0) {
    const readySet = await getReadyProductIds();
    const formatted = Object.values(memoryActiveOrders)
      .map(o => formatOrder(o, readySet))
      .filter(Boolean)
      .sort((a, b) => new Date(a.insertDate) - new Date(b.insertDate));

    return {
      orders: formatted,
      count: formatted.length,
      lastSyncTime: memoryLastSyncTime,
      status: memoryLastSyncStatus,
      cached: true
    };
  }

  const url = `${ADISYO_BASE_URL}/RecentOrders?orderType=TakeAway,Table,Retail&onlyRestaurantCourier=false`;
  const headers = {
    'x-api-key': ADISYO_API_KEY,
    'x-api-secret': ADISYO_API_SECRET,
    'x-api-consumer': ADISYO_API_CONSUMER,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Deli-Napolitan-KDS)'
  };

  try {
    const res = await fetch(url, { headers });
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = {};
    }

    if (res.ok && data.data) {
      const orders = data.data || [];
      const currentActiveIds = new Set();

      for (const o of orders) {
        const oid = o.id;
        const statusStr = normalizeTurkish(o.status || '');
        const statusId = o.statusId || 0;
        const isFinished = (
          statusId === 3 ||
          statusId === 5 ||
          statusStr.includes('hazır') ||
          statusStr.includes('kapan') ||
          statusStr.includes('iptal')
        );

        if (!isFinished) {
          currentActiveIds.add(oid);
          memoryActiveOrders[oid] = o;
        }
      }

      // Remove completed orders
      for (const oid of Object.keys(memoryActiveOrders)) {
        if (!currentActiveIds.has(Number(oid)) && !currentActiveIds.has(String(oid))) {
          delete memoryActiveOrders[oid];
        }
      }

      const d = new Date();
      memoryLastSyncTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      memoryLastSyncStatus = `Bağlı (${Object.keys(memoryActiveOrders).length} aktif adisyon)`;
      memoryLastFetchTimestamp = now;
    } else if (text.includes('601')) {
      // Adisyo rate limit hit: keep current orders safely
      memoryLastSyncStatus = 'Adisyo kota beklemesi (30s)';
    }
  } catch (err) {
    console.error('[Adisyo Fetch Error]', err);
    if (!memoryLastSyncTime) {
      memoryLastSyncStatus = `Adisyo bekleniyor: ${err.message}`;
    }
  }

  const readySet = await getReadyProductIds();
  const formatted = Object.values(memoryActiveOrders)
    .map(o => formatOrder(o, readySet))
    .filter(Boolean)
    .sort((a, b) => new Date(a.insertDate) - new Date(b.insertDate));

  return {
    orders: formatted,
    count: formatted.length,
    lastSyncTime: memoryLastSyncTime,
    status: memoryLastSyncStatus,
    cached: false
  };
}
