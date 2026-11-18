import { memoryActiveOrders } from '../_lib/store.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const mockId = Date.now();
  const mockOrder = {
    id: mockId,
    orderNumber: 140 + (mockId % 30),
    orderType: mockId % 2 === 0 ? 'Masa Siparişi' : 'Paket Sipariş',
    tableName: `Masa ${(mockId % 12) + 1}`,
    waiterName: 'Deli Garson',
    insertDate: new Date().toISOString(),
    statusId: 1,
    status: 'Sipariş Alındı',
    products: [
      {
        id: mockId + 1,
        productName: 'Acı Reçel Dana Brisket',
        categoryName: 'PİZZALAR',
        quantity: 1,
        productNote: 'Acısı bol olsun',
        excludedItems: [],
        features: []
      },
      {
        id: mockId + 2,
        productName: 'Margherita',
        categoryName: 'PİZZALAR',
        quantity: 1,
        productNote: null,
        excludedItems: [],
        features: []
      },
      {
        id: mockId + 3,
        productName: 'Burrata Roka Salata',
        categoryName: 'SALATALAR',
        quantity: 1,
        productNote: 'Sos ayrı gelsin',
        excludedItems: [],
        features: []
      },
      {
        id: mockId + 4,
        productName: 'Coca Cola Zero',
        categoryName: 'İÇECEKLER',
        quantity: 2,
        productNote: 'Buzlu ve limonlu',
        excludedItems: [],
        features: []
      }
    ]
  };

  memoryActiveOrders[mockId] = mockOrder;
  return res.status(200).json({ success: true, order: mockOrder });
}
