# 🍕 Deli Napolitan | Mutfak (KDS) & Servis Ekranı

Adisyo POS sistemiyle tam entegre, mutfak fırın personeli ve servis bankosu için gerçek zamanlı operasyon ve sipariş takip sistemi.

---

## 🌟 Özellikler

### 1. 👨‍🍳 Mutfak Ekranı (`/mutfak`)
- **Yalnızca Pizza Filtresi:** İçecek, salata, meze veya tatlılar mutfak ekranına düşmez; fırın ustasının önüne yalnızca fırına girecek pizzalar akar.
- **Pasif & Dokunmasız Kullanım:** Fırın personelinin ekrana dokunmasına gerek yoktur. Siparişler otomatik olarak FIFO (en eski sipariş en başta) mantığıyla dizilir.
- **Canlı Sayaç & Renk Kodları:**
  - `0 - 8 dk`: Normal (Yeşil)
  - `8 - 15 dk`: Dikkat (Sarı)
  - `15+ dk`: Kritik / Gecikme (Kırmızı ve yanıp sönen uyarı)
- **Akıllı Otomatik Düşme:** Servis ekranından pizzalar "Hazır" olarak işaretlendiğinde mutfak ekranında üzeri çizilir. Bir adisyondaki tüm pizzalar hazırlandığında kart **"TÜM PİZZALAR HAZIRLANDI"** uyarısıyla 1.2 saniye içinde mutfak ekranından otomatik kaybolur!
- **Yeni Sipariş Sesli Uyarısı:** Yeni bir pizza siparişi geldiğinde mutfağı uyaran zarif bildirim zili çalar.

### 2. 🛎️ Servis / Banko Ekranı (`/servis`)
- **Tam Adisyon Görünümü:** Servis personeli adisyondaki **tüm ürünleri** (Pizzalar, İçecekler, Salatalar, Tatlılar) kategori etiketleriyle birlikte görür.
- **Tek Tek "Hazır" Butonu:** Hazırlanan veya masaya çıkan ürünün yanındaki **"Hazır"** butonuna basıldığında ürünün üzeri çizilir ve aynı anda mutfak ekranındaki pizzanın da üzeri çizilir.
- **Tümü Hazır & Adisyo POS Bildirimi:** Adisyondaki tüm ürünler bittiğinde veya **"Tümü Hazır"** butonuna basıldığında, sistem Adisyo API'sine (`POST /api/External/v2/Prepared`) komut göndererek Adisyo POS üzerinde sipariş durumunu anında **"Hazırlandı"** yapar!
- **Tamamlananlar Arşivi:** Servisten düşen adisyonlar sağ üstteki **"Tamamlananlar"** butonuna tıklanarak geçmiş listesinde incelenebilir veya istenirse geri çağrılabilir.

---

## 🚀 Vercel & Canlı Yayın Kurulumu (`mutfak.delinapolitan.com`)

### 1. Adım: GitHub Reposu
Repo GitHub üzerinde `osmanersoy-ops/deli-napolitan-mutfak` altında tutulur.

### 2. Adım: Vercel Dağıtımı
1. [vercel.com](https://vercel.com) paneline gidin.
2. **"Add New... -> Project"** seçeneğini seçin.
3. `deli-napolitan-mutfak` reposunu seçin ve **Deploy** butonuna basın.

### 3. Adım: Özel Alan Adı (Custom Domain)
1. Vercel proje panelinde **Settings -> Domains** sekmesine gidin.
2. `mutfak.delinapolitan.com` yazıp **Add** butonuna tıklayın.
3. DNS yönetiminizde (Google Cloud DNS / Google Domains / Squarespace):
   - **Tip:** `CNAME`
   - **Ad:** `mutfak`
   - **Hedef / Değer:** `cname.vercel-dns.com`

---

## ⚙️ Ortam Değişkenleri (Environment Variables)

Vercel **Project Settings -> Environment Variables** alanında:

| Değişken | Açıklama |
| :--- | :--- |
| `ADISYO_API_KEY` | Adisyo Entegrasyon API Anahtarı |
| `ADISYO_API_SECRET` | Adisyo Entegrasyon Gizli Anahtarı |
| `ADISYO_API_CONSUMER` | `Deli Napolitan` |
| `ADISYO_BASE_URL` | `https://ext.adisyo.com/api/External/v2` |

---

## 📡 Adisyo Webhook Entegrasyonu (Sıfır Gecikme)
Adisyo Yönetim Paneli -> Entegrasyonlar -> **Webhooks** bölümüne şu adresi girin:
`https://mutfak.delinapolitan.com/api/adisyo/webhook`
*(Sistem Adisyo'nun doğrulama el sıkışmasını otomatik karşılar).*

---

## 💻 Yerel (Local) Çalıştırma
İnternet veya Vercel haricinde yerel ağda çalıştırmak için:
```bash
python3 kds_server.py
```
- Portal: `http://localhost:3001`
- Mutfak: `http://localhost:3001/mutfak`
- Servis: `http://localhost:3001/servis`
