const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const ADISYO_BASE_URL = process.env.ADISYO_BASE_URL || 'https://ext.adisyo.com/api/External/v2';
const ADISYO_HEADERS = {
  'x-api-key': process.env.ADISYO_API_KEY || '',
  'x-api-secret': process.env.ADISYO_API_SECRET || '',
  'x-api-consumer': process.env.ADISYO_API_CONSUMER || '',
  'Content-Type': 'application/json'
};

// Pizza filtreleme kelimeleri
const PIZZA_KEYWORDS = (process.env.PIZZA_KEYWORDS || 'Pizza,Pizzalar,Napolitan,Calzone,Pizzetta')
  .split(',')
  .map(k => k.trim().toLowerCase());

// Bellekte tutulan aktif pizza siparişleri (Key: orderId)
const activeOrdersMap = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Ürünün pizza olup olmadığını kontrol eder
 */
function isPizzaProduct(product) {
  const cat = (product.categoryName || '').toLowerCase();
  const name = (product.productName || '').toLowerCase();
  return PIZZA_KEYWORDS.some(keyword => cat.includes(keyword) || name.includes(keyword));
}

/**
 * Adisyo sipariş nesnesinden fırın ekranına özel sadeleştirilmiş pizza siparişi üretir.
 * Eğer siparişte pizza yoksa null döner.
 */
function formatPizzaOrder(order) {
  if (!order || !Array.isArray(order.products)) return null;

  // Sipariş zaten hazırlandı veya kapandıysa alma
  const isFinished = order.statusId === 5 || 
                     (order.status && order.status.toLowerCase().includes('hazır')) ||
                     (order.status && order.status.toLowerCase().includes('kapandı')) ||
                     (order.status && order.status.toLowerCase().includes('iptal'));

  if (isFinished) return null;

  const pizzas = [];
  order.products.forEach(p => {
    if (isPizzaProduct(p)) {
      // Ürün notu ve çıkarılan malzemeleri birleştir
      let noteParts = [];
      if (p.productNote && p.productNote.trim()) {
        noteParts.push(p.productNote.trim());
      }
      if (Array.isArray(p.excludedItems) && p.excludedItems.length > 0) {
        noteParts.push(p.excludedItems.join(', ') + ' ÇIKAR');
      }
      if (Array.isArray(p.features) && p.features.length > 0) {
        const featureNames = p.features.map(f => f.name || f).filter(Boolean);
        if (featureNames.length > 0) noteParts.push(featureNames.join(', '));
      }

      pizzas.push({
        id: p.id,
        name: p.productName,
        qty: p.quantity || 1,
        note: noteParts.length > 0 ? noteParts.join(' • ') : null
      });
    }
  });

  if (pizzas.length === 0) return null;

  // Masa veya paket başlığı
  let displayTableName = order.tableName || 'Masa';
  let cleanOrderType = 'SALON';

  if (order.orderType && order.orderType.toLowerCase().includes('paket')) {
    cleanOrderType = 'PAKET';
    displayTableName = order.externalAppName ? `${order.externalAppName} #${order.orderNumber}` : `Paket #${order.orderNumber}`;
  } else if (order.orderType && order.orderType.toLowerCase().includes('gel')) {
    cleanOrderType = 'GEL-AL';
    displayTableName = `Gel-Al #${order.orderNumber}`;
  }

  const insertTime = order.insertDate ? new Date(order.insertDate).getTime() : Date.now();
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - insertTime) / 1000));

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    orderType: cleanOrderType,
    tableName: displayTableName,
    waiterName: order.waiterName || '',
    insertDate: order.insertDate || new Date().toISOString(),
    secondsElapsed: elapsedSeconds,
    pizzas: pizzas
  };
}

/**
 * Adisyo'dan tekil sipariş detayını çeker
 */
async function fetchAdisyoOrder(orderId) {
  try {
    const res = await axios.get(`${ADISYO_BASE_URL}/Order/${orderId}`, {
      headers: ADISYO_HEADERS,
      timeout: 8000
    });
    return res.data;
  } catch (error) {
    console.error(`[Adisyo API] Order/${orderId} hatası:`, error.response?.data || error.message);
    return null;
  }
}

/**
 * Adisyo'dan son siparişleri sorgular (Yedek senkronizasyon)
 */
async function reconcileRecentOrders() {
  if (!process.env.ADISYO_API_KEY) {
    return; // API anahtarları girilmemişse sorgulama yapma
  }

  try {
    const res = await axios.get(`${ADISYO_BASE_URL}/RecentOrders?orderType=TakeAway,Table,Retail&onlyRestaurantCourier=false`, {
      headers: ADISYO_HEADERS,
      timeout: 10000
    });

    const recentList = res.data?.data || [];
    const currentActiveIds = new Set();

    for (const rawOrder of recentList) {
      const formatted = formatPizzaOrder(rawOrder);
      if (formatted) {
        currentActiveIds.add(formatted.id);
        if (!activeOrdersMap.has(formatted.id)) {
          activeOrdersMap.set(formatted.id, formatted);
          io.emit('order_created', formatted);
          console.log(`[Reconcile] Yeni pizza siparişi eklendi: #${formatted.orderNumber} - ${formatted.tableName}`);
        } else {
          // Güncelleme kontrolü
          activeOrdersMap.set(formatted.id, formatted);
        }
      }
    }

    // Adisyo'da artık aktif olmayanları ekrandan düşür
    for (const [id, order] of activeOrdersMap.entries()) {
      if (!currentActiveIds.has(id)) {
        activeOrdersMap.delete(id);
        io.emit('order_removed', { id: id, orderNumber: order.orderNumber });
        console.log(`[Reconcile] Sipariş tamamlandı, ekrandan düşürüldü: #${order.orderNumber}`);
      }
    }
  } catch (error) {
    console.error('[Reconcile Hatası]:', error.response?.data || error.message);
  }
}

// -------------------------------------------------------------
// ADISYO WEBHOOK ENDPOINT
// Adisyo Panel > Webhooks kısmına bu URL verilir:
// https://siparis.delinapolitan.com/api/adisyo/webhook
// -------------------------------------------------------------
app.post('/api/adisyo/webhook', express.text({ type: '*/*' }), async (req, res) => {
  // Adisyo URL doğrulama el sıkışması kontrolü: Adisyo "adisyo" metni gönderir ve "adisyo" yanıtı bekler
  if (typeof req.body === 'string' && req.body.trim() === 'adisyo') {
    console.log('[Webhook Doğrulama] Adisyo servis URL doğrulama isteği başarıyla yanıtlandı.');
    return res.status(200).send('adisyo');
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch (e) {
      // JSON değilse ve bilinmeyen bir metinse
      return res.status(200).send('ok');
    }
  }

  const eventType = payload?.webhookEventType;
  const orderId = payload?.data?.id;

  console.log(`[Webhook Geldi] Tip: ${eventType}, Order ID: ${orderId}`);

  // Adisyo'ya anında 200 OK yanıtı dön (Webhook zaman aşımına uğramasın)
  res.status(200).json({ status: 'ok', received: true });

  if (!orderId) return;

  if (eventType === 'order.created' || eventType === 'order.updated') {
    const freshOrder = await fetchAdisyoOrder(orderId);
    if (!freshOrder) return;

    const formatted = formatPizzaOrder(freshOrder);

    if (formatted) {
      // Sipariş aktif ve pizza içeriyor
      activeOrdersMap.set(formatted.id, formatted);
      io.emit('order_created', formatted);
      console.log(`[Webhook] Ekran güncellendi: #${formatted.orderNumber} - ${formatted.tableName}`);
    } else {
      // Sipariş "Hazırlandı" veya kapandı; ya da hiç pizza içermiyor
      if (activeOrdersMap.has(orderId)) {
        const removed = activeOrdersMap.get(orderId);
        activeOrdersMap.delete(orderId);
        io.emit('order_removed', { id: orderId, orderNumber: removed.orderNumber });
        console.log(`[Webhook] Sipariş hazırlandı, ekrandan düşürüldü: #${removed.orderNumber}`);
      }
    }
  }
});

// REST Endpoint: Mevcut aktif siparişleri listele
app.get('/api/orders', (req, res) => {
  const list = Array.from(activeOrdersMap.values());
  // FIFO sıralaması: En eski sipariş en başta
  list.sort((a, b) => new Date(a.insertDate).getTime() - new Date(b.insertDate).getTime());
  res.json({ orders: list });
});

// Test amaçlı manuel sipariş simülasyonu endpoint'i
app.post('/api/test/new-order', (req, res) => {
  const mockId = Date.now();
  const mockOrder = {
    id: mockId,
    orderNumber: 180 + Math.floor(Math.random() * 50),
    orderType: Math.random() > 0.5 ? 'SALON' : 'PAKET',
    tableName: `Masa ${Math.floor(1 + Math.random() * 8)}`,
    waiterName: 'Test Garson',
    insertDate: new Date().toISOString(),
    secondsElapsed: 0,
    pizzas: [
      { id: mockId + 1, name: 'Margherita di Bufala', qty: 1, note: 'Fesleğen taze konsun' },
      { id: mockId + 2, name: 'Diavola', qty: 1, note: null }
    ]
  };
  activeOrdersMap.set(mockOrder.id, mockOrder);
  io.emit('order_created', mockOrder);
  res.json({ success: true, order: mockOrder });
});

// Test amaçlı ilk siparişi hazırla (düşür) endpoint'i
app.post('/api/test/drop-order', (req, res) => {
  if (activeOrdersMap.size === 0) {
    return res.json({ success: false, message: 'Düşürülecek sipariş yok' });
  }
  const firstId = activeOrdersMap.keys().next().value;
  const removed = activeOrdersMap.get(firstId);
  activeOrdersMap.delete(firstId);
  io.emit('order_removed', { id: firstId, orderNumber: removed.orderNumber });
  res.json({ success: true, removed });
});

// WebSocket Bağlantıları
io.on('connection', (socket) => {
  console.log(`[KDS Tablet Bağlandı] ID: ${socket.id}`);
  const list = Array.from(activeOrdersMap.values());
  list.sort((a, b) => new Date(a.insertDate).getTime() - new Date(b.insertDate).getTime());
  socket.emit('orders_init', list);

  socket.on('disconnect', () => {
    console.log(`[KDS Tablet Ayrıldı] ID: ${socket.id}`);
  });
});

// Belirlenen aralıkta (varsayılan 30s) arka plan Adisyo senkronizasyonu
const syncInterval = Math.max(25, parseInt(process.env.SYNC_INTERVAL_SECONDS || '30', 10));
setInterval(reconcileRecentOrders, syncInterval * 1000);

// Sunucuyu başlat
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🍕 Deli Napolitan Pizza KDS Sunucusu Başlatıldı!`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌐 Tablet Adresi: http://localhost:${PORT}`);
  console.log(`🔗 Adisyo Webhook: http://your-domain/api/adisyo/webhook`);
  console.log(`⏱️ Senkronizasyon Aralığı: ${syncInterval} saniye`);
  console.log(`=======================================================`);
  // İlk açılışta Adisyo'yu bir kez tara
  reconcileRecentOrders();
});
