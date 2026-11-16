// Osmanlı Yatırım Pazarlama Paneli — ortak veri API'si (Netlify Functions + Netlify Blobs)
//
// Veriler "pazarlama" Blobs deposunda tutulur:
//   ds/<id>     → tek bir yüklenen reklam raporu (platform + hesap + ay)
//   category    → Kategori Başına Maliyet dosyasından okunan eşleme ve çeyrek verisi
//   inputs      → elle girilen lead / açılan hesap / ajans gideri
//
// Netlify ortam değişkeni SITE_KEY tanımlanırsa tüm istekler "x-site-key" başlığı ister.

import { getStore } from '@netlify/blobs';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const store = () => getStore({ name: 'pazarlama', consistency: 'strong' });

const safeId = (s) => String(s || '').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 200);

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = req.method.toUpperCase();

  const key = process.env.SITE_KEY;
  if (path === 'auth') {
    return json({ required: !!key, ok: !key || req.headers.get('x-site-key') === key });
  }
  if (key && req.headers.get('x-site-key') !== key) return json({ error: 'Erişim anahtarı gerekli' }, 401);

  const s = store();
  try {
    // ---- tüm veriyi getir ----
    if (path === 'data' && method === 'GET') {
      const { blobs } = await s.list({ prefix: 'ds/' });
      const datasets = (await Promise.all(blobs.map((b) => s.get(b.key, { type: 'json' })))).filter(Boolean);
      const [category, inputs] = await Promise.all([s.get('category', { type: 'json' }), s.get('inputs', { type: 'json' })]);
      return json({ datasets, category: category || null, inputs: inputs || {} });
    }

    // ---- reklam raporları ----
    if (path === 'datasets' && method === 'POST') {
      const body = await req.json();
      const list = Array.isArray(body.datasets) ? body.datasets : [];
      if (!list.length) return json({ error: 'Kaydedilecek rapor yok' }, 400);
      for (const d of list) {
        if (!d.id || !d.platform || !d.month || !Array.isArray(d.rows)) return json({ error: 'Eksik alan: id, platform, month, rows' }, 400);
        d.uploadedAt = new Date().toISOString();
        await s.setJSON('ds/' + safeId(d.id), d);
      }
      return json({ ok: true, saved: list.length });
    }
    if (path.startsWith('datasets/') && method === 'DELETE') {
      await s.delete('ds/' + safeId(decodeURIComponent(path.slice('datasets/'.length))));
      return json({ ok: true });
    }

    // ---- kategori dosyası ----
    if (path === 'category' && method === 'PUT') {
      const body = await req.json();
      if (!body || typeof body.mapping !== 'object') return json({ error: 'Eşleme bulunamadı' }, 400);
      body.uploadedAt = new Date().toISOString();
      await s.setJSON('category', body);
      return json({ ok: true });
    }
    if (path === 'category' && method === 'DELETE') {
      await s.delete('category');
      return json({ ok: true });
    }

    // ---- elle girilen veriler ----
    if (path === 'inputs' && method === 'PUT') {
      const body = await req.json();
      if (!body || !body.period) return json({ error: 'Dönem gerekli' }, 400);
      const cur = (await s.get('inputs', { type: 'json' })) || {};
      if (body.values == null) delete cur[body.period];
      else cur[body.period] = { ...body.values, updatedAt: new Date().toISOString() };
      await s.setJSON('inputs', cur);
      return json({ ok: true, inputs: cur });
    }

    return json({ error: 'Bulunamadı' }, 404);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};

export const config = { path: '/api/*' };
