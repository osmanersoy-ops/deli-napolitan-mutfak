import http.server
import socketserver
import urllib.request
import json
import time
import os
import threading
from datetime import datetime

PORT = int(os.environ.get("PORT", 3001))
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(BASE_DIR, "public")

ADISYO_BASE_URL = os.environ.get("ADISYO_BASE_URL", "https://ext.adisyo.com/api/External/v2")
ADISYO_API_KEY = os.environ.get("ADISYO_API_KEY", "25b80b3556ca3a15353dd2fd312062fad27adcf5a1de51b75bdadea1fa8214ab")
ADISYO_API_SECRET = os.environ.get("ADISYO_API_SECRET", "65e70574-2b17-42a1-b093-4128ad9aff44")
ADISYO_API_CONSUMER = os.environ.get("ADISYO_API_CONSUMER", "Deli Napolitan")

PIZZA_KEYWORDS = ["pizza", "pizzalar", "napolitan", "calzone", "pizzetta"]

# Memory store for active orders and ready products
raw_active_orders = {}  # { orderId: rawOrderDict }
ready_product_ids = set()  # set of str(productId)
order_lock = threading.Lock()
last_sync_time = None
last_sync_status = "Başlatılıyor..."

def normalize_turkish(text):
    if not text:
        return ""
    return text.replace("İ", "i").replace("I", "ı").replace("Ğ", "ğ").replace("Ü", "ü").replace("Ş", "ş").replace("Ö", "ö").lower()

def is_pizza_product(p):
    cat = normalize_turkish(p.get("categoryName") or "")
    name = normalize_turkish(p.get("productName") or "")
    return any(k in cat or k in name for k in PIZZA_KEYWORDS)

def format_order(order):
    if not order or not isinstance(order.get("products"), list):
        return None

    status_str = normalize_turkish(order.get("status") or "")
    status_id = order.get("statusId", 0)

    # 3 = Hazırlandı, 5 = Tamamlandı/Kapandı, İptal = İptal
    is_finished = (
        status_id in (3, 5) or
        "hazır" in status_str or
        "kapan" in status_str or
        "iptal" in status_str
    )
    if is_finished:
        return None

    all_products = []
    pizza_products = []

    for p in order.get("products", []):
        pid = str(p.get("id"))
        pname = p.get("productName") or "Ürün"
        cat_name = p.get("categoryName") or "Genel"
        qty = int(float(p.get("quantity", 1)))
        is_pizza = is_pizza_product(p)
        is_ready = pid in ready_product_ids

        notes = []
        if p.get("productNote") and str(p.get("productNote")).strip():
            notes.append(str(p.get("productNote")).strip())
        if isinstance(p.get("excludedItems"), list) and p.get("excludedItems"):
            notes.append(", ".join(p.get("excludedItems")) + " ÇIKAR")
        if isinstance(p.get("features"), list) and p.get("features"):
            feat_names = [f.get("name") if isinstance(f, dict) else str(f) for f in p.get("features")]
            feat_names = [f for f in feat_names if f]
            if feat_names:
                notes.append(", ".join(feat_names))

        prod_item = {
            "id": pid,
            "name": pname,
            "category": cat_name,
            "isPizza": is_pizza,
            "qty": qty,
            "note": " • ".join(notes) if notes else None,
            "isReady": is_ready
        }
        all_products.append(prod_item)
        if is_pizza:
            pizza_products.append(prod_item)

    # Adisyonda hiç ürün yoksa gösterme
    if not all_products:
        return None

    total_pizzas = len(pizza_products)
    ready_pizzas = sum(1 for p in pizza_products if p["isReady"])
    all_pizzas_ready = total_pizzas > 0 and ready_pizzas == total_pizzas

    total_products = len(all_products)
    ready_products = sum(1 for p in all_products if p["isReady"])
    all_products_ready = total_products > 0 and ready_products == total_products

    table_name = order.get("tableName") or "Masa"
    order_type_raw = normalize_turkish(order.get("orderType") or "")
    order_type = "SALON"

    if "paket" in order_type_raw:
        order_type = "PAKET"
        ext_app = order.get("externalAppName")
        table_name = f"{ext_app} #{order.get('orderNumber')}" if ext_app else f"Paket #{order.get('orderNumber')}"
    elif "gel" in order_type_raw:
        order_type = "GEL-AL"
        table_name = f"Gel-Al #{order.get('orderNumber')}"

    insert_date = order.get("insertDate") or datetime.now().isoformat()
    try:
        dt = datetime.fromisoformat(insert_date.split(".")[0])
        elapsed = max(0, int(time.time() - dt.timestamp()))
    except:
        elapsed = 0

    return {
        "id": order.get("id"),
        "orderNumber": order.get("orderNumber"),
        "orderType": order_type,
        "tableName": table_name,
        "waiterName": order.get("waiterName") or "",
        "insertDate": insert_date,
        "secondsElapsed": elapsed,
        "products": all_products,
        "pizzas": pizza_products,
        "pizzaCount": total_pizzas,
        "readyPizzaCount": ready_pizzas,
        "allPizzasReady": all_pizzas_ready,
        "productCount": total_products,
        "readyProductCount": ready_products,
        "allProductsReady": all_products_ready
    }

def mark_order_prepared_in_adisyo(order_id):
    if not order_id:
        return False, "Eksik orderId"
    try:
        oid_int = int(order_id)
    except:
        return False, "Geçersiz orderId"

    # Mock test siparişiyse uzaktaki Adisyo'ya istek atma
    if oid_int > 1000000000000:
        print(f"[Test Siparişi] #{order_id} simüle edildi, Adisyo'da Hazırlandı kabul edildi.")
        return True, {"mock": True}

    url = f"{ADISYO_BASE_URL}/Prepared"
    headers = {
        "x-api-key": ADISYO_API_KEY,
        "x-api-secret": ADISYO_API_SECRET,
        "x-api-consumer": ADISYO_API_CONSUMER,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Deli-Napolitan-KDS)"
    }
    payload = json.dumps({"orderId": oid_int}).encode("utf-8")
    req = urllib.request.Request(url, headers=headers, method="POST", data=payload)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"[Adisyo Prepared Başarılı] Sipariş #{order_id} Adisyo POS'a bildirildi ve 'Hazırlandı' yapıldı!")
            return True, data
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8") if hasattr(e, 'read') else str(e)
        print(f"[Adisyo Prepared Bildirimi] Sipariş #{order_id}: {e.code} - {err_body}")
        return False, err_body
    except Exception as e:
        print(f"[Adisyo Prepared Hata] {e}")
        return False, str(e)

def poll_adisyo():
    global last_sync_time, last_sync_status
    url = f"{ADISYO_BASE_URL}/RecentOrders?orderType=TakeAway,Table,Retail&onlyRestaurantCourier=false"
    headers = {
        "x-api-key": ADISYO_API_KEY,
        "x-api-secret": ADISYO_API_SECRET,
        "x-api-consumer": ADISYO_API_CONSUMER,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Deli-Napolitan-KDS)"
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=12) as response:
            data = json.loads(response.read().decode("utf-8"))
            orders = data.get("data") or []
            current_active_ids = set()

            with order_lock:
                for o in orders:
                    oid = o.get("id")
                    status_str = normalize_turkish(o.get("status") or "")
                    status_id = o.get("statusId", 0)
                    is_finished = (
                        status_id in (3, 5) or
                        "hazır" in status_str or
                        "kapan" in status_str or
                        "iptal" in status_str
                    )
                    if not is_finished:
                        current_active_ids.add(oid)
                        raw_active_orders[oid] = o

                # Drop orders that are no longer active in Adisyo
                for oid in list(raw_active_orders.keys()):
                    if oid not in current_active_ids:
                        del raw_active_orders[oid]

            last_sync_time = datetime.now().strftime("%H:%M:%S")
            last_sync_status = f"Bağlı ({len(raw_active_orders)} aktif adisyon)"
    except Exception as e:
        err_msg = str(e)
        if hasattr(e, 'read'):
            try:
                err_body = e.read().decode('utf-8')
                if "601" in err_body:
                    err_msg = "Adisyo kota beklemesi (30s)"
            except:
                pass
        if not last_sync_time:
            last_sync_status = f"Adisyo bekleniyor: {err_msg}"
        print(f"[Adisyo Polling] {err_msg}")

def background_sync_worker():
    while True:
        poll_adisyo()
        time.sleep(30)

# Start background sync thread
sync_thread = threading.Thread(target=background_sync_worker, daemon=True)
sync_thread.start()

class KDSHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def do_GET(self):
        # Clean URL Routing
        if self.path == "/" or self.path == "/index.html":
            self.path = "/index.html"
            return super().do_GET()
        elif self.path == "/mutfak":
            self.path = "/mutfak.html"
            return super().do_GET()
        elif self.path == "/servis":
            self.path = "/servis.html"
            return super().do_GET()

        # API: Tüm siparişleri al
        if self.path.startswith("/api/orders"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()

            with order_lock:
                formatted_list = []
                for o in raw_active_orders.values():
                    f = format_order(o)
                    if f:
                        formatted_list.append(f)

                # FIFO Sıralaması: En eski sipariş en başta
                formatted_list.sort(key=lambda x: x.get("insertDate", ""))

            payload = {
                "orders": formatted_list,
                "count": len(formatted_list),
                "lastSyncTime": last_sync_time,
                "status": last_sync_status,
                "serverTime": datetime.now().strftime("%H:%M:%S")
            }
            self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            return

        elif self.path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            status_data = {
                "activeOrders": len(raw_active_orders),
                "lastSync": last_sync_time,
                "status": last_sync_status
            }
            self.wfile.write(json.dumps(status_data).encode("utf-8"))
            return

        # Serve static files from public
        return super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"
        
        try:
            req_data = json.loads(body.decode("utf-8"))
        except:
            req_data = {}

        # Ürünü Hazır / Hazır Değil olarak işaretle (Servis tarafından tetiklenir)
        if self.path == "/api/products/toggle-ready":
            pid = str(req_data.get("productId", ""))
            with order_lock:
                if pid in ready_product_ids:
                    ready_product_ids.remove(pid)
                    is_ready = False
                else:
                    ready_product_ids.add(pid)
                    is_ready = True

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "productId": pid, "isReady": is_ready}).encode("utf-8"))
            return

        # Adisyondaki tüm ürünleri hazır yap ve Adisyo POS'a "Hazırlandı" bildir
        elif self.path == "/api/orders/mark-all-ready":
            order_id = req_data.get("orderId")
            with order_lock:
                target_order = None
                for oid, o in raw_active_orders.items():
                    if str(oid) == str(order_id):
                        target_order = o
                        break
                if target_order:
                    for p in target_order.get("products", []):
                        ready_product_ids.add(str(p.get("id")))

            # Arka planda Adisyo POS API'sine bildir
            threading.Thread(target=mark_order_prepared_in_adisyo, args=(order_id,), daemon=True).start()

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "orderId": order_id, "adisyoNotified": True}).encode("utf-8"))
            return

        # Doğrudan Adisyo'ya "Hazırlandı" komutu gönder
        elif self.path == "/api/orders/notify-adisyo":
            order_id = req_data.get("orderId")
            success, msg = mark_order_prepared_in_adisyo(order_id)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": success, "orderId": order_id, "detail": msg}).encode("utf-8"))
            return

        # Test amaçlı manuel sipariş simülasyonu
        elif self.path == "/api/test/new-order":
            mock_id = int(time.time() * 1000)
            mock_order = {
                "id": mock_id,
                "orderNumber": 140 + (mock_id % 30),
                "orderType": "Masa Siparişi" if (mock_id % 2 == 0) else "Paket Sipariş",
                "tableName": f"Masa {(mock_id % 12) + 1}",
                "waiterName": "Deli Garson",
                "insertDate": datetime.now().isoformat(),
                "statusId": 1,
                "status": "Sipariş Alındı",
                "products": [
                    {
                        "id": mock_id + 1,
                        "productName": "Acı Reçel Dana Brisket",
                        "categoryName": "PİZZALAR",
                        "quantity": 1,
                        "productNote": "Acısı bol olsun",
                        "excludedItems": [],
                        "features": []
                    },
                    {
                        "id": mock_id + 2,
                        "productName": "Margherita",
                        "categoryName": "PİZZALAR",
                        "quantity": 1,
                        "productNote": None,
                        "excludedItems": [],
                        "features": []
                    },
                    {
                        "id": mock_id + 3,
                        "productName": "Burrata Roka Salata",
                        "categoryName": "SALATALAR",
                        "quantity": 1,
                        "productNote": "Sos ayrı gelsin",
                        "excludedItems": [],
                        "features": []
                    },
                    {
                        "id": mock_id + 4,
                        "productName": "Coca Cola Zero",
                        "categoryName": "İÇECEKLER",
                        "quantity": 2,
                        "productNote": "Buzlu ve limonlu",
                        "excludedItems": [],
                        "features": []
                    }
                ]
            }
            with order_lock:
                raw_active_orders[mock_id] = mock_order

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "order": mock_order}).encode("utf-8"))
            return

        elif self.path == "/api/test/drop-order":
            removed = None
            with order_lock:
                if raw_active_orders:
                    first_id = next(iter(raw_active_orders))
                    removed = raw_active_orders.pop(first_id)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "removed": removed}).encode("utf-8"))
            return

        elif self.path == "/api/sync-now":
            poll_adisyo()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "orders": len(raw_active_orders)}).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

if __name__ == "__main__":
    with ThreadedHTTPServer(("0.0.0.0", PORT), KDSHandler) as httpd:
        print(f"=======================================================")
        print(f"🍕 Deli Napolitan Mutfak & Servis Sunucusu Hazır!")
        print(f"📡 Port: {PORT}")
        print(f"🌐 Yerel Portalı (Localhost): http://localhost:{PORT}")
        print(f"📱 Tablet / Ağ Portalı: http://192.168.1.106:{PORT}")
        print(f"👨‍🍳 Mutfak Ekranı: http://192.168.1.106:{PORT}/mutfak")
        print(f"🛎️ Servis Ekranı: http://192.168.1.106:{PORT}/servis")
        print(f"=======================================================")
        httpd.serve_forever()
