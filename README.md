# 🍕 Deli Napolitan — Pizza Mutfak Ekranı (KDS) & Adisyo Entegrasyonu

Bu proje, **Deli Napolitan** fırını için Adisyo POS sistemine bağlı, gerçek zamanlı (WebSocket) çalışan, pasif (sadece izleme amaçlı) pizza mutfak ekranıdır (`siparis.delinapolitan.com`).

---

## ⚡ Özellikler

* **Otomatik Pizza Filtreleme:** Adisyo'dan gelen adisyonlardaki meşrubat, salata ve tatlılar elenir; ekrana **yalnızca Pizzalar** yansır.
* **FIFO Sıralama:** En önce gelen sipariş (fırına girmesi en acil olan) daima en başta (sol üstte) durur.
* **Canlı Zaman Sayaçları:** 0-5 dk yeşil, 5-10 dk sarı, 10+ dk kırmızı yanıp sönen alarm (Gecikiyor!).
* **Adisyo ile Çift Yönlü Düşme:** Adisyo mutfak ekranında "Hazır" veya "Tümü Hazır" butonuna basıldığında kart bu ekrandan animasyonla otomatik düşer.
* **Alerjen ve Özel Not Vurgusu:** Malzeme çıkarma (*"MANTARSIZ"*) veya ekleme notları büyük kırmızı uyarı kutucuklarıyla görünür.
* **Samsung Tablet (Yatay) Optimizasyonu:** Fullscreen modu, unlu/aydınlık fırın ortamında 3 metreden okunabilen yüksek kontrastlı beyaz tema.
* **Çift Katmanlı Senkronizasyon (Fail-safe):** Webhook anlık bildirim yapar; ayrıca internet kesintilerine karşı her 30 saniyede bir Adisyo `/RecentOrders` API'si ile kendini doğrular.

---

## 🛠️ 1. Adım: Adisyo API Bilgilerini Alma

1. [pos.adisyo.com](https://pos.adisyo.com) paneline yönetici olarak giriş yapın.
2. **Ayarlar > Entegrasyonlar / API** sekmesine gidin.
3. Buradan şu 3 bilgiyi kopyalayın:
   * **API Key (`x-api-key`)**
   * **API Secret (`x-api-secret`)**
   * **Consumer Key (`x-api-consumer`)**
4. Proje klasöründeki `.env` dosyasını açıp bu bilgileri yapıştırın:
   ```env
   ADISYO_API_KEY=aldiginiz_api_key
   ADISYO_API_SECRET=aldiginiz_api_secret
   ADISYO_API_CONSUMER=aldiginiz_consumer_key
   ```

---

## 🌐 2. Adım: Adisyo Webhook Tanımlama

Adisyo'da sipariş açıldığında veya hazır basıldığında anında ekrana düşmesi için:
1. Adisyo panelinde **Ayarlar > Webhook** (veya Entegrasyonlar) bölümüne gidin.
2. Yeni webhook ekleyin:
   * **URL:** `https://siparis.delinapolitan.com/api/adisyo/webhook`
   * **Olaylar (Events):**
     * `order.created` (Yeni sipariş açıldığında)
     * `order.updated` (Hazır basıldığında veya durum değiştiğinde)

---

## 🚀 3. Adım: `siparis.delinapolitan.com` Canlıya Alma (Hosting Seçenekleri)

Canlı WebSocket bağlantısı ve Webhook dinleyicisi için Node.js çalıştırabilen bir ortama ihtiyacımız vardır. En pratik 2 yöntem:

### Yöntem A: Render.com (En Hızlı & Otomatik — 3 Dakika)
1. Bu klasörü (`Pizza-KDS`) GitHub hesabınıza (`osmanersoy-ops/deli-napolitan-kds`) private repo olarak yükleyin.
2. [Render.com](https://render.com)'a ücretsiz üye olup **"New Web Service"** deyin.
3. GitHub reponuzu seçin.
   * **Runtime:** Node
   * **Build Command:** `npm install`
   * **Start Command:** `node server.js`
4. **Environment Variables** bölümüne `.env` içindeki Adisyo anahtarlarınızı ekleyin.
5. **Deploy** butonuna basın. Render size `https://deli-kds.onrender.com` gibi ücretsiz bir HTTPS adresi verir.
6. **Custom Domain:** Render ayarlarından `siparis.delinapolitan.com` alan adınızı ekleyin.
7. Alan adı yönetim panelinizden (Squarespace/Cloudflare/Natro) `siparis` CNAME kaydını Render'a yönlendirin.

### Yöntem B: Kendi VPS Sunucunuz (Ubuntu / Nginx)
Eğer mevcut bir Linux sunucunuz varsa:
```bash
git clone https://github.com/osmanersoy-ops/deli-napolitan-kds.git
cd deli-napolitan-kds
npm install
pm2 start server.js --name "pizza-kds"
```
Nginx üzerinden `siparis.delinapolitan.com` için port 3000'e proxy yönlendirmesi ve Let's Encrypt SSL kurulumu yapılır.

---

## 📱 4. Adım: Samsung Tablet Kurulumu

1. Samsung tableti mutfakta fırının yanına yatay (landscape) olarak yerleştirin.
2. Google Chrome uygulamasını açıp `https://siparis.delinapolitan.com` adresine gidin.
3. Sağ üstteki **"⛶ Tam Ekran"** butonuna basın.
4. **İpucu (Ekran Kapanmasını Önleme):**
   * Tablet Ayarları > **Ekran > Ekran Zaman Aşımı** ayarını maksimuma getirin (veya "Şarj olurken uyanık kal" geliştirici seçeneğini açın).
   * Chrome menüsünden **"Ana Ekrana Ekle"** diyerek ekrana tek tıkla açılan bir uygulama simgesi yerleştirebilirsiniz.
