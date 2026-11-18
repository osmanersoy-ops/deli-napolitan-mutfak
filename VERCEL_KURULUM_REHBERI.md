# 🍕 Deli Napolitan | Mutfak & Servis Ekranı (Vercel Dağıtım Rehberi)

Tıpkı diğer projelerinizde (`deli-napolitan-menu`, `deli-napolitan-web`, `deli-napolitan-kariyer`) olduğu gibi, mutfak ve servis sistemimiz için de **GitHub + Vercel** entegrasyonu tamamen hazırlandı ve GitHub reponuz otomatik olarak oluşturuldu!

---

## 🔗 GitHub Reposu Hazırlandı
- **Repo Adresi:** [https://github.com/osmanersoy-ops/deli-napolitan-mutfak](https://github.com/osmanersoy-ops/deli-napolitan-mutfak)
- **Durum:** Güncel kodlar, Vercel Serverless fonksiyonları (`/api/*`), arayüzler (`/mutfak`, `/servis`, portal) ve Adisyo entegrasyonu `main` branch'ine yüklendi.

---

## 🚀 3 Adımda Vercel & Alan Adı Kurulumu

### 1. Adım: Vercel'e Projeyi Ekleyin (1 Dakika)
1. Tarayıcınızda [vercel.com](https://vercel.com) adresine girin.
2. Sağ üstteki **"Add New..."** butonuna tıklayıp **"Project"** seçin.
3. GitHub repolarınız listesinden **`deli-napolitan-mutfak`** projesini bulun ve sağındaki **"Import"** butonuna basın.
4. **Environment Variables (Ortam Değişkenleri)** alanına (isteğe bağlı, kod içine de güvenli default olarak eklenmiştir) şunları ekleyebilirsiniz:
   - `ADISYO_API_KEY`: `25b80b3556ca3a15353dd2fd312062fad27adcf5a1de51b75bdadea1fa8214ab`
   - `ADISYO_API_SECRET`: `65e70574-2b17-42a1-b093-4128ad9aff44`
   - `ADISYO_API_CONSUMER`: `Deli Napolitan`
   - `ADISYO_BASE_URL`: `https://ext.adisyo.com/api/External/v2`
5. Mavi **"Deploy"** butonuna basın! Yaklaşık 15-20 saniye içinde sistem yayına girecektir.

---

### 2. Adım: `mutfak.delinapolitan.com` Alan Adını Bağlayın (1 Dakika)
1. Vercel'de projenizin sayfasına girip üst menüden **"Settings"** -> sol menüden **"Domains"** sekmesine tıklayın.
2. Alan adı kutusuna `mutfak.delinapolitan.com` yazıp **"Add"** butonuna basın.
3. Vercel size bir CNAME kaydı gösterecektir:
   - **Type:** `CNAME`
   - **Name:** `mutfak`
   - **Value:** `cname.vercel-dns.com`
4. Alan adınızı yönettiğiniz panelde (Google Cloud DNS / Google Domains / Squarespace DNS):
   - Yeni bir DNS kaydı ekleyin:
   - Tür: `CNAME`
   - İsim / Alt Alan Adı: `mutfak`
   - Değer / Hedef: `cname.vercel-dns.com`
   - TTL: `300` (veya standart)
5. Kaydettikten birkaç dakika sonra SSL sertifikası otomatik onaylanacak ve `https://mutfak.delinapolitan.com` anında açılacaktır!

---

### 3. Adım: Adisyo Webhook Entegrasyonu (Sıfır Gecikme - 1 Dakika)
Siparişlerin gecikmesiz olarak ekrana düşmesi için:
1. **Adisyo Yönetim Paneli**'ne gidin.
2. **Ayarlar / Entegrasyonlar -> Webhooks** bölümünü açın.
3. Webhook URL'si olarak şu adresi girip kaydedin:
   ```
   https://mutfak.delinapolitan.com/api/adisyo/webhook
   ```
4. Adisyo test bağlantısı yaptığında sunucumuz `"adisyo"` yanıtını vererek doğrulamayı anında tamamlayacaktır.

---

## 💡 İsteğe Bağlı: Vercel KV (Tek Tıkla Tabletler Arası Ortak Hafıza)
Mutfaktaki tablet ile servis bankosundaki tabletin "Hazır" basılan pizzaları anlık olarak ortak hafızada senkronize görmesi için:
1. Vercel proje panelinizde **"Storage"** sekmesine tıklayın.
2. **"Create Database"** butonuna basıp **"KV"** seçin.
3. `deli-napolitan-mutfak` projenizi seçip **"Connect"** deyin.
*(Kodumuz Vercel KV bağlantısını otomatik tanıyacak şekilde hazırlandı).*

---

## 📱 Kullanım Linkleri
Sistem canlıya geçtiğinde:
- **Giriş Portalı (Seçim Ekranı):** `https://mutfak.delinapolitan.com/`
- **Mutfak Fırın Ekranı (Dokunmasız):** `https://mutfak.delinapolitan.com/mutfak`
- **Servis Banko Ekranı (Hazır Butonlu):** `https://mutfak.delinapolitan.com/servis`
