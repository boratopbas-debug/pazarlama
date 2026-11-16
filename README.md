# Osmanlı Yatırım · Pazarlama Paneli

Dijital reklam raporlarının (Google Ads, Meta, X, TikTok) Excel olarak yüklendiği ve ekipçe ortak görüntülendiği dashboard.

## Kurulum (Netlify)

1. Netlify → **Add new site → Import an existing project → GitHub** → `pazarlama` reposunu seçin.
2. Build ayarları otomatik gelir (`netlify.toml`): build komutu yok, publish klasörü `public`, fonksiyonlar `netlify/functions`.
3. **Deploy**. Veriler Netlify Blobs'ta tutulur, ek ayar gerekmez.
4. *(Önerilir)* Site settings → Environment variables → `SITE_KEY` = bir şifre. Tanımlanırsa panel açılırken bu anahtar sorulur ve API anahtarsız istekleri reddeder. Ekledikten sonra yeniden deploy edin.

## Kullanım

- **Veri Yükle:** Dosyaları sürükleyin. Format otomatik tanınır. Hesap adı (Google Ads dosyalarında yazmadığı için) dosya adından tahmin edilir, ay rapordan okunur. Kaydetmeden önce kontrol edin. Aynı platform + hesap + ay yeniden yüklenirse eskisinin yerine geçer.
- **Kategori Başına Maliyet dosyası:** Kampanya → Tür → Kırılım (FP / Hisse / Türev-FX-TV / Genel) eşlemesi bu dosyadan gelir. Yeni kampanyalar için dosyayı güncelleyip yeniden yükleyin. Kategori Maliyeti sekmesinden eşleşmeyen kampanyaların listesi Excel olarak indirilebilir.
- **Veri Yönetimi → Elle giriş:** Ay ya da çeyrek bazında lead, açılan hesap (segment bazında) ve ajans gideri.

## Tanınan formatlar

| Kaynak | Tanıma | Not |
|---|---|---|
| Google Ads kampanya raporu | 1. satır "Kampanya raporu", başlıkta Kampanya / Maliyet | Toplam satırları atlanır. Dönüşüm işlemine göre kırılmış rapor desteklenir. Hesap toplamı kampanyalardan büyükse fark ayrı satır olur. |
| Meta | Kampanya Adı + Harcanan Tutar (TRY) | Sonuçlar, sonuç türüne göre ayrılır. |
| X Ads | Time period + Campaign name + Spend | Platform / Age / Gender / Location sayfaları da okunur. |
| TikTok | Ad group name / Campaign name + Clicks (destination) | Dönem yok, yüklerken seçilir. |
| Kategori dosyası | "Kampanya Adı" + "Kırılım" başlıkları | Çeyrek harcamaları, ajans gideri, lead/hesap sayıları da okunur. |

## Hesaplama

- Genel (ve eşleşmemiş) harcama, FP / Hisse / Türev-FX-TV'ye doğrudan harcama paylarına göre dağıtılır.
- Ajans gideri dağıtılmış harcama paylarına göre eklenir (giydirilmiş maliyet).
- Segment atanmamış lead/hesaplar, segmentli lead/hesap paylarına göre dağıtılır.
- Çeyrekte platform raporu yoksa Kategori dosyasındaki çeyrek harcaması kullanılır.

## Dosyalar

- `public/parsers.js`: rapor okuyucular
- `public/calc.js`: birleştirme ve maliyet hesapları
- `public/app.js`: arayüz
- `netlify/functions/api.mjs`: ortak veri API'si (Netlify Blobs)
