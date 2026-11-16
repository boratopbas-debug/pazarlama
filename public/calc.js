/* Osmanlı Yatırım Pazarlama Paneli — hesaplama katmanı
 * Yüklenen raporları birleştirir, kategori eşlemesini uygular ve
 * lead / açılan hesap başına maliyeti (çıplak ve giydirilmiş) hesaplar.
 */
(function (root) {
  'use strict';
  const P = typeof module !== 'undefined' && module.exports ? require('./parsers.js') : root.Parsers;

  const SEGS = ['FP', 'Hisse', 'Türev-FX-TV'];
  const SEG_ALL = ['FP', 'Hisse', 'Türev-FX-TV', 'Genel', 'Eşleşmemiş'];
  const TYPE_LABELS = {
    'video': 'Video', 'search': 'Arama', 'pmax': 'Maks. Performans', 'dgen': 'Talep Yaratma',
    'eğitim': 'Eğitim', 'app install': 'Uygulama yükleme', 'display': 'Görüntülü', 'diğer': 'Diğer',
  };

  const STATUS_TR = { active: 'Aktif', inactive: 'Pasif', completed: 'Tamamlandı', paused: 'Duraklatıldı', 'not delivering': 'Yayında değil', deleted: 'Silindi', archived: 'Arşivlendi' };

  // Google kampanya türü / ad içeriğinden kampanya türü tahmini (eşlemede yoksa)
  function inferType(r) {
    const ch = P.fold(r.channelType || '');
    if (/^arama|search/.test(ch)) return 'search';
    if (/^video/.test(ch)) return 'video';
    if (/maks|performance/.test(ch)) return 'pmax';
    if (/talep|demand/.test(ch)) return 'dgen';
    if (/uygulama|app/.test(ch)) return 'app install';
    if (/goruntulu|display/.test(ch)) return 'display';
    const n = P.normName(r.campaign);
    if (/egitim|leadform/.test(n)) return 'eğitim';
    if (/appinstall|install/.test(n)) return 'app install';
    if (/pmax/.test(n)) return 'pmax';
    if (/videoview|video|reel|youtube|postboost|thruplay/.test(n)) return 'video';
    if (/search/.test(n)) return 'search';
    if (/dgen|demandgen|traffic|conv|completeregistration/.test(n)) return 'dgen';
    return 'diğer';
  }

  function isQuarter(p) { return /-Q\d$/.test(p); }
  function monthsIn(period) { return isQuarter(period) ? P.monthsOfQuarter(period) : [period]; }
  function periodLabel(p) { return isQuarter(p) ? P.quarterLabel(p) : P.monthLabel(p); }
  function prevPeriod(p) {
    if (isQuarter(p)) {
      let [y, q] = p.split('-Q').map(Number);
      q -= 1; if (q === 0) { q = 4; y -= 1; }
      return `${y}-Q${q}`;
    }
    let [y, m] = p.split('-').map(Number);
    m -= 1; if (m === 0) { m = 12; y -= 1; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }

  // Tüm raporları tek satır listesine çevir + eşleme + çift kayıt temizliği
  function buildRows(state) {
    const mapping = (state.category && state.category.mapping) || {};
    const out = [];
    const seen = new Map(); // platform|month|kampanya → satır (aynı kampanya iki dosyada aynı rakamla gelirse tek say)
    let dupCount = 0;
    for (const d of state.datasets || []) {
      for (const r of d.rows) {
        const key = P.normName(r.campaign);
        const sig = `${d.platform}|${d.month}|${key}`;
        if (r.spend > 0 && seen.has(sig)) {
          const prev = seen.get(sig);
          if (prev.datasetId !== d.id && Math.abs(prev.spend - r.spend) < 0.01 && prev.impressions === r.impressions) { dupCount++; continue; }
        }
        const m = mapping[key];
        const row = Object.assign({}, r, {
          status: STATUS_TR[String(r.status || '').toLowerCase()] || r.status,
          platform: d.platform, account: d.account || '—', month: d.month, datasetId: d.id,
          segment: m ? m.segment : 'Eşleşmemiş', type: m && m.type ? m.type : inferType(r),
          typeInferred: !(m && m.type), mapped: !!m,
        });
        if (r.spend > 0) seen.set(sig, row);
        out.push(row);
      }
    }
    return { rows: out, dupCount };
  }

  function availablePeriods(state) {
    const months = new Set((state.datasets || []).map((d) => d.month).filter(Boolean));
    const quarters = new Set([...months].map(P.quarterOf));
    if (state.category && state.category.quarters) Object.keys(state.category.quarters).forEach((q) => quarters.add(q));
    Object.keys(state.inputs || {}).forEach((k) => (isQuarter(k) ? quarters.add(k) : null));
    return { months: [...months].sort().reverse(), quarters: [...quarters].sort().reverse() };
  }

  // Bir döneme ait satırlar. Çeyrekte hiç platform raporu yoksa Kategori dosyasındaki çeyrek harcaması kullanılır.
  function rowsFor(all, state, period) {
    const months = new Set(monthsIn(period));
    const rows = all.rows.filter((r) => months.has(r.month));
    if (rows.length || !isQuarter(period)) return { rows, source: 'reports', monthsWithData: [...new Set(rows.map((r) => r.month))].sort() };
    const cq = state.category && state.category.quarters && state.category.quarters[period];
    if (!cq) return { rows: [], source: 'none', monthsWithData: [] };
    const mapping = state.category.mapping || {};
    const legacy = cq.campaigns.map((c) => {
      const m = mapping[P.normName(c.name)];
      return {
        campaign: c.name, platform: 'Kategori dosyası', account: '—', month: period, spend: c.cost,
        impressions: 0, clicks: 0, conversions: 0, installs: 0, results: 0, videoViews: 0, interactions: 0,
        segment: c.segment || (m && m.segment) || 'Genel', type: c.type || (m && m.type) || 'diğer', mapped: true, status: '',
      };
    });
    return { rows: legacy, source: 'category', monthsWithData: [] };
  }

  function sum(rows, f) { let s = 0; for (const r of rows) s += (typeof f === 'function' ? f(r) : r[f]) || 0; return s; }
  function groupSum(rows, keyFn, valKey) {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      m.set(k, (m.get(k) || 0) + (r[valKey] || 0));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }

  function kpis(rows) {
    const spend = sum(rows, 'spend'), impressions = sum(rows, 'impressions'), clicks = sum(rows, 'clicks');
    return {
      spend, impressions, clicks,
      ctr: impressions ? clicks / impressions : null,
      cpc: clicks ? spend / clicks : null,
      cpm: impressions ? (spend / impressions) * 1000 : null,
      installs: sum(rows, 'installs'),
      leads: sum(rows, (r) => r.leads || 0),
      conversions: sum(rows, (r) => (r.platform === 'Google Ads' ? r.conversions : 0)),
      videoViews: sum(rows, 'videoViews') + sum(rows, (r) => (r.platform === 'Meta' && /thruplay/i.test(r.resultType) ? r.results : 0)),
      campaigns: rows.filter((r) => r.spend > 0).length,
    };
  }

  // Lead / hesap girdileri: elle giriş > (çeyrekse) ayların toplamı > Kategori dosyası
  function inputsFor(state, period) {
    const inp = state.inputs || {};
    const blank = () => ({ leads: {}, accounts: {}, agency: null, source: null });
    if (inp[period]) return Object.assign(blank(), inp[period], { source: 'Elle giriş' });
    if (isQuarter(period)) {
      const ms = P.monthsOfQuarter(period).filter((m) => inp[m]);
      if (ms.length) {
        const o = blank();
        o.source = `Elle giriş (${ms.length}/3 ay)`;
        for (const m of ms) {
          for (const t of ['leads', 'accounts']) for (const s in inp[m][t] || {}) o[t][s] = (o[t][s] || 0) + (+inp[m][t][s] || 0);
          if (inp[m].agency != null && inp[m].agency !== '') o.agency = (o.agency || 0) + +inp[m].agency;
        }
        return o;
      }
      const cq = state.category && state.category.quarters && state.category.quarters[period];
      if (cq && (Object.keys(cq.leads || {}).length || Object.keys(cq.accounts || {}).length || cq.agency != null)) {
        return { leads: cq.leads || {}, accounts: cq.accounts || {}, agency: cq.agency, source: 'Kategori dosyası' };
      }
    }
    return blank();
  }

  // Kategori dosyasındaki mantık:
  //  1) Genel (ve eşleşmemiş) harcama FP/Hisse/Türev'e doğrudan harcama paylarına göre dağıtılır
  //  2) Ajans gideri, dağıtılmış harcama paylarına göre eklenir → giydirilmiş maliyet
  //  3) Segment atanmamış lead/hesaplar, segmentli lead/hesap paylarına göre dağıtılır
  function categoryCost(rows, inputs) {
    const spend = {};
    for (const s of SEG_ALL) spend[s] = 0;
    for (const r of rows) spend[SEG_ALL.includes(r.segment) ? r.segment : 'Eşleşmemiş'] += r.spend || 0;
    const direct = SEGS.reduce((a, s) => a + spend[s], 0);
    const shared = spend['Genel'] + spend['Eşleşmemiş'];
    const total = direct + shared;
    const agency = +inputs.agency || 0;
    const alloc = {}, dressed = {};
    for (const s of SEGS) {
      alloc[s] = spend[s] + (direct ? shared * spend[s] / direct : 0);
      dressed[s] = alloc[s] + (total ? agency * alloc[s] / total : 0);
    }
    function distribute(counts) {
      const c = {};
      for (const s of SEGS) c[s] = +counts[s] || 0;
      const un = +counts['Atanmamış'] || 0;
      const assigned = SEGS.reduce((a, s) => a + c[s], 0);
      const res = {};
      for (const s of SEGS) res[s] = c[s] + (assigned ? un * c[s] / assigned : 0);
      return { raw: c, unassigned: un, total: assigned + un, alloc: res };
    }
    const leads = distribute(inputs.leads || {});
    const accounts = distribute(inputs.accounts || {});
    const per = (num, den) => (den > 0 ? num / den : null);
    const segs = SEGS.map((s) => ({
      segment: s, direct: spend[s], alloc: alloc[s], dressed: dressed[s],
      leads: leads.raw[s], leadsAlloc: leads.alloc[s], accounts: accounts.raw[s], accountsAlloc: accounts.alloc[s],
      cpl: per(alloc[s], leads.alloc[s]), cplDressed: per(dressed[s], leads.alloc[s]),
      cpa: per(alloc[s], accounts.alloc[s]), cpaDressed: per(dressed[s], accounts.alloc[s]),
    }));
    return {
      spend, direct, shared, total, agency, dressedTotal: total + agency, segs, leads, accounts,
      totals: {
        cpl: per(total, leads.total), cplDressed: per(total + agency, leads.total),
        cpa: per(total, accounts.total), cpaDressed: per(total + agency, accounts.total),
      },
    };
  }

  const api = { buildRows, availablePeriods, rowsFor, kpis, categoryCost, inputsFor, groupSum, sum, inferType, isQuarter, monthsIn, periodLabel, prevPeriod, SEGS, SEG_ALL, TYPE_LABELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== 'undefined' ? window : globalThis);
