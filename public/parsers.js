/* Osmanlı Yatırım Pazarlama Paneli — rapor okuyucular
 * Tarayıcıda window.Parsers, Node'da module.exports olarak çalışır.
 * Her okuyucu SheetJS çalışma kitabını (XLSX.read çıktısı) alır.
 */
(function (root) {
  'use strict';

  // ---------- yardımcılar ----------
  const TR_MAP = { 'ı': 'i', 'İ': 'i', 'ş': 's', 'Ş': 's', 'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u', 'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c' };
  function fold(s) {
    return String(s == null ? '' : s).replace(/[ıİşŞğĞüÜöÖçÇ]/g, (c) => TR_MAP[c]).toLowerCase();
  }
  // Kampanya adı eşleme anahtarı: Türkçe karakter, boşluk, noktalama farklarını yok sayar
  function normName(s) {
    return fold(s).normalize('NFKD').replace(/[^a-z0-9]/g, '');
  }
  function txt(v) { return v == null ? '' : String(v).trim(); }

  // "1.234,56" / "1234.56" / "%3,2" / "--" → sayı ya da null
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s || /^[-–—]+$/.test(s) || s === '-' ) return null;
    if (/^[<>]/.test(s)) return null; // "< %10" gibi aralık değerleri
    let pct = false;
    if (s.includes('%')) { pct = true; s = s.replace(/%/g, ''); }
    s = s.replace(/[\s₺TRY]/g, '');
    const hasDot = s.includes('.'), hasComma = s.includes(',');
    if (hasDot && hasComma) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
    } else if (hasComma) {
      s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    if (!isFinite(n)) return null;
    return pct ? n / 100 : n;
  }

  const TR_MONTHS = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
  const TR_MONTH_LABELS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
  const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function iso(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }

  // Excel tarih seri numarası / Date / metin → 'YYYY-MM-DD'
  function toISODate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return iso(+m[3], +m[2], +m[1]);
    return null;
  }

  // "1 Ekim 2026 - 31 Ekim 2026" / "2026-10-01 - 2026-10-31" / "Oct 1, 2026 - Oct 31, 2026"
  function parseRange(s) {
    s = txt(s);
    if (!s) return null;
    let m = s.match(/(\d{4}-\d{1,2}-\d{1,2}).*?(\d{4}-\d{1,2}-\d{1,2})/);
    if (m) return { start: toISODate(m[1]), end: toISODate(m[2]) };
    m = s.match(/(\d{1,2}[./]\d{1,2}[./]\d{4}).*?(\d{1,2}[./]\d{1,2}[./]\d{4})/);
    if (m) return { start: toISODate(m[1]), end: toISODate(m[2]) };
    const f = fold(s);
    const re = /(\d{1,2})\s+([a-z]+)\s+(\d{4})/g;
    const found = [];
    let x;
    while ((x = re.exec(f))) {
      const mi = TR_MONTHS.findIndex((mm) => x[2].startsWith(mm.slice(0, 3)));
      if (mi >= 0) found.push(iso(+x[3], mi + 1, +x[1]));
    }
    if (found.length >= 2) return { start: found[0], end: found[found.length - 1] };
    // "1 Ekim - 31 Ekim 2026"
    const re2 = /(\d{1,2})\s+([a-z]+)/g;
    const yr = (f.match(/(\d{4})/) || [])[1];
    const f2 = [];
    while ((x = re2.exec(f))) {
      const mi = TR_MONTHS.findIndex((mm) => x[2].startsWith(mm.slice(0, 3)));
      const me = EN_MONTHS.findIndex((mm) => x[2].startsWith(mm));
      const k = mi >= 0 ? mi : me;
      if (k >= 0 && yr) f2.push(iso(+yr, k + 1, +x[1]));
    }
    if (f2.length >= 2) return { start: f2[0], end: f2[f2.length - 1] };
    return null;
  }

  // Bir dönemin raporlanacağı ay: dönemin başladığı ay (aylık raporlar için)
  function monthOf(range) {
    if (!range || !range.start) return null;
    return range.start.slice(0, 7);
  }
  function monthLabel(m) {
    if (!m) return '—';
    const [y, mm] = m.split('-');
    return `${TR_MONTH_LABELS[+mm - 1]} ${y}`;
  }
  function quarterOf(m) {
    const [y, mm] = m.split('-');
    return `${y}-Q${Math.floor((+mm - 1) / 3) + 1}`;
  }
  function quarterLabel(q) {
    const [y, qq] = q.split('-Q');
    const names = ['Ocak–Mart', 'Nisan–Haziran', 'Temmuz–Eylül', 'Ekim–Aralık'];
    return `${y} Ç${qq} (${names[+qq - 1]})`;
  }
  function monthsOfQuarter(q) {
    const [y, qq] = q.split('-Q');
    const s = (+qq - 1) * 3 + 1;
    return [s, s + 1, s + 2].map((m) => `${y}-${pad(m)}`);
  }

  // Dosya adından hesap/marka tahmini
  const ACCOUNTS = ['Osmanlı Menkul', 'Osmanlı FX', 'Osmanlı Mobil', 'Yatırım Direkt', 'Borsa Direkt Web', 'Borsa Direkt Mobil', 'Borsa Direkt'];
  function guessAccount(fileName) {
    const f = normName(fileName.replace(/\.[a-z]+$/i, ''));
    // yüklemede bozulan Türkçe karakterler (osmanl__fx → osmanlfx) de yakalanır
    if (/borsa?direkt/.test(f)) return /mobil|app/.test(f) ? 'Borsa Direkt Mobil' : (/web/.test(f) ? 'Borsa Direkt Web' : 'Borsa Direkt');
    if (/yat[i]?r[i]?m?direkt|yatrmdirekt|yatirimdirekt/.test(f)) return 'Yatırım Direkt';
    if (/osmanl[i]?fx|(^|[^a-z])fx/.test(f) || f.endsWith('fx')) return 'Osmanlı FX';
    if (/osmanl[i]?mobil/.test(f)) return 'Osmanlı Mobil';
    if (/osmanl[i]?menkul/.test(f)) return 'Osmanlı Menkul';
    return '';
  }

  // ---------- sayfa okuma ----------
  function sheetRows(XLSX, ws) {
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
  }
  function findCol(header, ...names) {
    const h = header.map((x) => fold(txt(x)));
    for (const n of names) {
      const i = h.indexOf(fold(n));
      if (i >= 0) return i;
    }
    return -1;
  }
  function rowObj(header, row) {
    const o = {};
    header.forEach((h, i) => { if (h != null && h !== '') o[txt(h)] = row[i]; });
    return o;
  }

  // Ortak satır şablonu
  function blankRow() {
    return {
      campaign: '', status: '', channelType: '', spend: 0, impressions: 0, clicks: 0, reach: null,
      conversions: 0, installs: 0, results: 0, resultType: '', videoViews: 0, interactions: 0,
      budget: null, budgetType: '', extra: {},
    };
  }

  // ===== Google Ads "Kampanya raporu" =====
  function isGoogle(rows) {
    return rows.length > 3 && /kampanya raporu/i.test(txt(rows[0] && rows[0][0])) ||
      rows.slice(0, 6).some((r) => r && findCol(r, 'Kampanya') >= 0 && (findCol(r, 'Maliyet') >= 0) && findCol(r, 'Göstr.', 'Gösterimler') >= 0);
  }

  function parseGoogle(rows, fileName) {
    const hIdx = rows.findIndex((r) => r && findCol(r, 'Kampanya') >= 0 && findCol(r, 'Maliyet') >= 0);
    const header = rows[hIdx];
    let range = null;
    for (let i = 0; i < hIdx; i++) { range = range || parseRange(rows[i] && rows[i][0]); }
    const C = {
      conv: findCol(header, 'Dönüşüm işlemi', 'Dönüşüm eylemi'),
      state: findCol(header, 'Kampanya durumu'),
      name: findCol(header, 'Kampanya'),
      budget: findCol(header, 'Bütçe'),
      btype: findCol(header, 'Bütçe türü'),
      status: findCol(header, 'Durum'),
      type: findCol(header, 'Kampanya türü'),
      bid: findCol(header, 'Teklif stratejisi türü'),
      opt: findCol(header, 'Optimizasyon puanı'),
      impr: findCol(header, 'Göstr.', 'Gösterimler'),
      clicks: findCol(header, 'Tıklamalar'),
      cost: findCol(header, 'Maliyet'),
      conversions: findCol(header, 'Dönüşümler'),
      installs: findCol(header, 'Yükleme sayısı', 'Yüklemeler'),
      views: findCol(header, 'TrueView görüntülemeleri', 'Görüntülemeler'),
      inter: findCol(header, 'Etkileşim', 'Etkileşimler'),
      uniq: findCol(header, 'Benzersiz kullanıcılar'),
      q25: findCol(header, "Videonun %25'i oynatıldı"),
      q50: findCol(header, "Videonun %50'si oynatıldı"),
      q75: findCol(header, "Videonun %75'i oynatıldı"),
      q100: findCol(header, "Videonun %100'ü oynatıldı"),
    };
    const segmented = C.conv >= 0;
    const byName = new Map();
    let acctTotal = null;
    const warnings = [];

    for (let i = hIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r) continue;
      const state = txt(r[C.state]);
      const name = txt(r[C.name]);
      if (/^toplam/i.test(state) || /^toplam/i.test(txt(r[0]))) {
        // Hesap toplamı (segmentli dosyada dönüşüm işlemi boş olan satır)
        if (/toplam:\s*hesap/i.test(state) && (!segmented || !txt(r[C.conv]) || txt(r[C.conv]) === '--')) {
          acctTotal = {
            spend: num(r[C.cost]) || 0, impressions: num(r[C.impr]) || 0, clicks: num(r[C.clicks]) || 0,
            videoViews: C.views >= 0 ? num(r[C.views]) || 0 : 0, interactions: C.inter >= 0 ? num(r[C.inter]) || 0 : 0,
          };
        }
        continue;
      }
      if (!name || name === '--') continue;
      let o = byName.get(name);
      if (!o) {
        o = blankRow();
        o.campaign = name;
        o.status = txt(r[C.status]) || state;
        o.state = state;
        o.channelType = C.type >= 0 ? txt(r[C.type]) : '';
        o.budget = C.budget >= 0 ? num(r[C.budget]) : null;
        o.budgetType = C.btype >= 0 ? txt(r[C.btype]) : '';
        o.bidStrategy = C.bid >= 0 ? txt(r[C.bid]) : '';
        o.optScore = C.opt >= 0 ? num(r[C.opt]) : null;
        o.convActions = {};
        byName.set(name, o);
      }
      o.spend += num(r[C.cost]) || 0;
      o.impressions += num(r[C.impr]) || 0;
      o.clicks += num(r[C.clicks]) || 0;
      if (C.conversions >= 0) o.conversions += num(r[C.conversions]) || 0;
      if (C.installs >= 0) o.installs += num(r[C.installs]) || 0;
      if (C.views >= 0) o.videoViews += num(r[C.views]) || 0;
      if (C.inter >= 0) o.interactions += num(r[C.inter]) || 0;
      if (C.uniq >= 0 && num(r[C.uniq]) != null) o.reach = (o.reach || 0) + num(r[C.uniq]);
      if (segmented) {
        const act = txt(r[C.conv]);
        const val = (C.installs >= 0 ? num(r[C.installs]) : 0) || (C.conversions >= 0 ? num(r[C.conversions]) : 0) || 0;
        if (act && act !== '--' && val) o.convActions[act] = (o.convActions[act] || 0) + val;
      }
      if (C.q25 >= 0 && num(r[C.q25]) != null) {
        o.extra.video = { q25: num(r[C.q25]), q50: num(r[C.q50]), q75: num(r[C.q75]), q100: num(r[C.q100]) };
      }
    }
    const out = [...byName.values()];
    // Kampanyalara dağıtılmamış hesap toplamı (ör. dönüşüm işlemine göre kırılmış raporlar)
    if (acctTotal) {
      const sum = out.reduce((s, r) => s + r.spend, 0);
      const diff = acctTotal.spend - sum;
      if (diff > 1) {
        const withActivity = out.filter((r) => r.installs || r.conversions || r.spend);
        const tgt = withActivity.length === 1 ? withActivity[0] : (out.length === 1 ? out[0] : null);
        const d = {
          spend: diff,
          impressions: Math.max(0, acctTotal.impressions - out.reduce((s, r) => s + r.impressions, 0)),
          clicks: Math.max(0, acctTotal.clicks - out.reduce((s, r) => s + r.clicks, 0)),
          videoViews: Math.max(0, acctTotal.videoViews - out.reduce((s, r) => s + r.videoViews, 0)),
          interactions: Math.max(0, acctTotal.interactions - out.reduce((s, r) => s + r.interactions, 0)),
        };
        if (tgt) {
          for (const k in d) tgt[k] += d[k];
          warnings.push(`Maliyet kampanya satırlarında değil, hesap toplamında (${fmtTL(diff)}). Tek aktif kampanya olduğu için "${tgt.campaign}" kampanyasına yazıldı.`);
        } else {
          const r = blankRow();
          r.campaign = '(Hesap toplamı farkı — raporda listelenmeyen kampanyalar)';
          Object.assign(r, d);
          out.push(r);
          warnings.push(`${fmtTL(diff)} hesap toplamında var ama kampanya satırlarında yok (silinmiş kampanyalar vb.); ayrı satır olarak eklendi.`);
        }
      }
    }
    if (!range) warnings.push('Rapor dönemi dosyada bulunamadı — ay seçin.');
    return { platform: 'Google Ads', range, rows: out, breakdowns: null, warnings, level: 'Kampanya' };
  }

  // ===== Meta (Facebook/Instagram) =====
  const META_RESULT_LABELS = [
    [/mobile_app_install|app_install/, 'Uygulama yükleme'],
    [/landing_page_view/, 'Açılış sayfası görüntüleme'],
    [/leadgen|lead/, 'Lead'],
    [/thruplay|video_view/, 'ThruPlay (video)'],
    [/post_interaction|post_engagement/, 'Gönderi etkileşimi'],
    [/link_click/, 'Bağlantı tıklaması'],
    [/complete_registration|completeregistration/, 'Kayıt tamamlama'],
    [/purchase/, 'Satın alma'],
    [/reach/, 'Erişim'],
  ];
  function metaResultLabel(s) {
    const f = fold(s);
    if (!f) return '';
    for (const [re, l] of META_RESULT_LABELS) if (re.test(f)) return l;
    return s.replace(/^actions:/, '');
  }
  function isMeta(rows) {
    const h = rows[0] || [];
    return findCol(h, 'Kampanya Adı', 'Campaign name') >= 0 && (findCol(h, 'Harcanan Tutar (TRY)', 'Amount spent (TRY)') >= 0 || h.some((x) => /^harcanan tutar|^amount spent/i.test(txt(x))));
  }
  function parseMeta(rows) {
    const h = rows[0];
    const spendIdx = h.findIndex((x) => /^harcanan tutar|^amount spent/i.test(txt(x)));
    const C = {
      start: findCol(h, 'Rapor Başlangıcı', 'Reporting starts'),
      end: findCol(h, 'Rapor Sonu', 'Reporting ends'),
      name: findCol(h, 'Kampanya Adı', 'Campaign name'),
      status: findCol(h, 'Kampanya yayını', 'Campaign delivery'),
      results: findCol(h, 'Sonuçlar', 'Results'),
      rtype: findCol(h, 'Sonuç Göstergesi', 'Result indicator'),
      budget: findCol(h, 'Reklam Seti Bütçesi', 'Ad set budget'),
      btype: findCol(h, 'Reklam Seti Bütçe Türü', 'Ad set budget type'),
      impr: findCol(h, 'Gösterim', 'Impressions'),
      reach: findCol(h, 'Erişim', 'Reach'),
      freq: findCol(h, 'Sıklık', 'Frequency'),
      clicks: findCol(h, 'Tekil Bağlantı Tıklamaları', 'Bağlantı Tıklamaları', 'Link clicks', 'Unique link clicks'),
      end2: findCol(h, 'Bitiş', 'Ends'),
    };
    let range = null;
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = txt(r[C.name]);
      if (!name) continue;
      if (!range && C.start >= 0) range = { start: toISODate(r[C.start]), end: toISODate(r[C.end]) };
      const o = blankRow();
      o.campaign = name;
      o.status = txt(r[C.status]);
      o.spend = num(r[spendIdx]) || 0;
      o.impressions = num(r[C.impr]) || 0;
      o.reach = C.reach >= 0 ? num(r[C.reach]) : null;
      o.clicks = C.clicks >= 0 ? num(r[C.clicks]) || 0 : 0;
      o.results = C.results >= 0 ? num(r[C.results]) || 0 : 0;
      o.resultType = C.rtype >= 0 ? metaResultLabel(txt(r[C.rtype])) : '';
      o.budget = typeof num(r[C.budget]) === 'number' ? num(r[C.budget]) : null;
      o.budgetType = txt(r[C.btype]);
      if (/install/i.test(fold(r[C.rtype]))) o.installs = o.results;
      if (/lead/i.test(fold(r[C.rtype]))) o.leads = o.results;
      out.push(o);
    }
    const warnings = [];
    if (C.clicks < 0) warnings.push('Bu Meta raporunda bağlantı tıklaması sütunu yok; tıklama 0 sayıldı.');
    return { platform: 'Meta', range, rows: out, breakdowns: null, warnings, level: 'Kampanya' };
  }

  // ===== X (Twitter) Ads =====
  function isX(wb, XLSX) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    const h = (sheetRows(XLSX, ws)[0]) || [];
    return findCol(h, 'Time period') >= 0 && findCol(h, 'Campaign name') >= 0 && findCol(h, 'Spend') >= 0;
  }
  function parseX(wb, XLSX) {
    const rows = sheetRows(XLSX, wb.Sheets[wb.SheetNames[0]]);
    const h = rows[0];
    const C = {
      period: findCol(h, 'Time period'), name: findCol(h, 'Campaign name'), status: findCol(h, 'Delivery status'),
      obj: findCol(h, 'Objective'), impr: findCol(h, 'Impressions'), spend: findCol(h, 'Spend'), reach: findCol(h, 'Reach'),
      clicks: findCol(h, 'Link clicks'), freq: findCol(h, 'Average frequency'), id: findCol(h, 'Campaign ID'),
    };
    let range = null;
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = txt(r[C.name]);
      if (!name) continue;
      range = range || parseRange(r[C.period]);
      const o = blankRow();
      o.campaign = name;
      o.status = txt(r[C.status]);
      o.channelType = txt(r[C.obj]);
      o.spend = num(r[C.spend]) || 0;
      o.impressions = num(r[C.impr]) || 0;
      o.reach = num(r[C.reach]);
      o.clicks = num(r[C.clicks]) || 0;
      o.results = o.clicks;
      o.resultType = 'Bağlantı tıklaması';
      out.push(o);
    }
    // Kırılım sayfaları: Platform, Age, Gender, Location
    const breakdowns = {};
    const DIM = { Platform: 'Cihaz', Age: 'Yaş', Gender: 'Cinsiyet', Location: 'Lokasyon' };
    for (const sn of wb.SheetNames.slice(1)) {
      const rr = sheetRows(XLSX, wb.Sheets[sn]);
      if (!rr.length) continue;
      const hh = rr[0];
      const dimKey = Object.keys(DIM).find((k) => findCol(hh, k) >= 0);
      if (!dimKey) continue;
      const di = findCol(hh, dimKey), si = findCol(hh, 'Spend'), ii = findCol(hh, 'Impressions'), ci = findCol(hh, 'Link clicks');
      const agg = {};
      for (let i = 1; i < rr.length; i++) {
        let k = txt(rr[i][di]);
        if (!k) continue;
        k = translateDim(k);
        agg[k] = agg[k] || { spend: 0, impressions: 0, clicks: 0 };
        agg[k].spend += num(rr[i][si]) || 0;
        agg[k].impressions += num(rr[i][ii]) || 0;
        agg[k].clicks += num(rr[i][ci]) || 0;
      }
      breakdowns[DIM[dimKey]] = agg;
    }
    return { platform: 'X', range, rows: out, breakdowns, warnings: [], level: 'Kampanya' };
  }
  function translateDim(k) {
    const m = { Male: 'Erkek', Female: 'Kadın', Unknown: 'Bilinmiyor', AGE_UNDER_13: '13 altı', TR: 'Türkiye' };
    return m[k] || k.replace(/\s*-\s*/g, '–');
  }

  // ===== TikTok Ads =====
  function isTikTok(rows) {
    const h = rows[0] || [];
    return (findCol(h, 'Ad group name') >= 0 || findCol(h, 'Campaign name') >= 0) && findCol(h, 'Clicks (destination)') >= 0;
  }
  function parseTikTok(rows) {
    const h = rows[0];
    const lvlIdx = findCol(h, 'Ad group name') >= 0 ? findCol(h, 'Ad group name') : findCol(h, 'Campaign name');
    const C = {
      name: lvlIdx, status: findCol(h, 'Primary status'), budget: findCol(h, 'Ad Group Budget', 'Budget'),
      spend: findCol(h, 'Spend', 'Cost'), impr: findCol(h, 'Impressions'), clicks: findCol(h, 'Clicks (destination)'),
      conv: findCol(h, 'Conversions'), results: findCol(h, 'Results'), sched: findCol(h, 'Schedule'),
      reach: findCol(h, 'Reach'),
    };
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const name = txt(r[C.name]);
      if (!name || /^total of/i.test(name)) continue;
      const o = blankRow();
      o.campaign = name;
      o.status = txt(r[C.status]);
      o.budget = num(r[C.budget]);
      o.spend = num(r[C.spend]) || 0;
      o.impressions = num(r[C.impr]) || 0;
      o.clicks = num(r[C.clicks]) || 0;
      o.conversions = num(r[C.conv]) || 0;
      o.results = num(r[C.results]) || 0;
      o.reach = C.reach >= 0 ? num(r[C.reach]) : null;
      o.resultType = /videoview|video/i.test(name) ? 'Video izlenme' : 'Sonuç';
      out.push(o);
    }
    return {
      platform: 'TikTok', range: null, rows: out, breakdowns: null,
      warnings: ['TikTok raporunda dönem bilgisi yok — ayı seçmeniz gerekiyor.'],
      level: lvlIdx === findCol(h, 'Ad group name') ? 'Reklam grubu' : 'Kampanya',
    };
  }

  // ===== Kategori Başına Maliyet dosyası =====
  const SEGMENTS = ['FP', 'Hisse', 'Türev-FX-TV'];
  function canonSegment(s) {
    const f = normName(s);
    if (!f) return '';
    if (f === 'fp' || f.startsWith('finansalplan')) return 'FP';
    if (f.startsWith('hisse')) return 'Hisse';
    if (f.startsWith('turev') || f.includes('fx')) return 'Türev-FX-TV';
    if (f.startsWith('genel')) return 'Genel';
    if (f.includes('atanmamis')) return 'Atanmamış';
    return txt(s);
  }
  const QUARTER_PATTERNS = [
    [/^ocak.*mart/, 1], [/^nisan.*haziran/, 2], [/^temmuz.*eylul/, 3], [/^ekim.*aralik/, 4],
  ];
  function quarterFromLabel(s) {
    const f = fold(txt(s)).replace(/\s+/g, '');
    for (const [re, q] of QUARTER_PATTERNS) if (re.test(f)) return q;
    const m = f.match(/^(?:q|ç|c)(\d)$/);
    return m ? +m[1] : null;
  }
  function isCategory(wb, XLSX) {
    return wb.SheetNames.some((sn) => {
      const rr = sheetRows(XLSX, wb.Sheets[sn]).slice(0, 6);
      return rr.some((r) => r && r.some((c) => /^kampanya ad/i.test(txt(c))) && r.some((c) => /k[ıi]r[ıi]l[ıi]m/i.test(fold(txt(c)))));
    });
  }
  function parseCategory(wb, XLSX, fileName) {
    const mapping = {}; // normName → {name, type, segment}
    const quarters = {}; // 'Qn' → {campaigns:[{name,cost,type,segment}], agency, leads:{}, accounts:{}}
    const yearMatch = (fileName.match(/(20\d{2})/) || [])[1];
    const year = yearMatch ? +yearMatch : new Date().getFullYear();
    const qget = (q) => (quarters[q] = quarters[q] || { campaigns: [], agency: null, leads: {}, accounts: {} });

    for (const sn of wb.SheetNames) {
      const rr = sheetRows(XLSX, wb.Sheets[sn]);
      // Kampanya blokları: "Kampanya Adı" başlıklı her sütun bloğu
      for (let r = 0; r < Math.min(rr.length, 8); r++) {
        const row = rr[r] || [];
        row.forEach((cell, c) => {
          if (!/^kampanya ad/i.test(txt(cell))) return;
          const cols = { cost: -1, type: -1, seg: -1 };
          for (let k = c + 1; k < c + 5; k++) {
            const t = fold(txt(row[k]));
            if (/maa?liyet|harcama|maliyet/.test(t)) cols.cost = k;
            else if (/kampanya tur/.test(t)) cols.type = k;
            else if (/kirilim|kategori/.test(t)) cols.seg = k;
          }
          // blok başlığı (çeyrek) bu satırın üstünde, solunda
          let q = null;
          for (let rr2 = r - 1; rr2 >= 0 && q == null; rr2--) {
            for (let k = c - 1; k <= c + 1 && q == null; k++) q = quarterFromLabel((rr[rr2] || [])[k]);
          }
          for (let i = r + 1; i < rr.length; i++) {
            const x = rr[i] || [];
            const name = txt(x[c]);
            if (!name) continue;
            const f = fold(name);
            if (/kategori toplam|toplam harcama|^genel kategorinin|^giydirilmis|^kategori$/.test(f)) {
              if (f.startsWith('genel kategorinin') || f.startsWith('giydirilmis')) break;
              continue;
            }
            if (/ajans gider/.test(f)) {
              if (q) qget(q).agency = num(x[c + 1]);
              continue;
            }
            if (/eklenecek giydirilmis/.test(f)) continue;
            const type = cols.type >= 0 ? txt(x[cols.type]) : '';
            const seg = cols.seg >= 0 ? canonSegment(x[cols.seg]) : '';
            if (!type && !seg && cols.cost < 0) continue;
            if (type || seg) {
              const key = normName(name);
              mapping[key] = { name, type: type.toLowerCase(), segment: seg || 'Genel' };
            }
            if (q && cols.cost >= 0) {
              const cost = num(x[cols.cost]);
              if (cost != null) qget(q).campaigns.push({ name, cost, type: type.toLowerCase(), segment: seg || 'Genel' });
            }
          }
        });
      }
      // Kırılımlar: "Gelen Lead Sayısı" / "Açılan Hesap Sayısı" satırları
      for (let r = 0; r < rr.length; r++) {
        const row = rr[r] || [];
        row.forEach((cell, c) => {
          if (fold(txt(cell)) !== 'kategori') return;
          // sütun → segment
          const segCols = {};
          for (let k = c + 1; k < c + 8; k++) {
            const s = canonSegment(row[k]);
            if (s === 'FP' || s === 'Hisse' || s === 'Türev-FX-TV' || s === 'Atanmamış') segCols[s] = k;
          }
          if (!Object.keys(segCols).length) return;
          let q = null;
          for (let rr2 = r - 1; rr2 >= 0 && q == null; rr2--) {
            for (let k = c - 1; k <= c + 1 && q == null; k++) q = quarterFromLabel((rr[rr2] || [])[k]);
          }
          if (!q) return;
          const next = rr[r + 1] || [];
          const label = fold(txt(next[c]));
          const target = /lead/.test(label) ? 'leads' : (/hesap/.test(label) ? 'accounts' : null);
          if (!target) return;
          for (const s in segCols) qget(q)[target][s] = num(next[segCols[s]]) || 0;
        });
      }
    }
    const qs = {};
    for (const q in quarters) qs[`${year}-Q${q}`] = quarters[q];
    return { kind: 'category', mapping, quarters: qs, year, warnings: [] };
  }

  function fmtTL(n) {
    return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(n) + ' TL';
  }

  // ===== giriş noktası =====
  function parseWorkbook(XLSX, wb, fileName) {
    try {
      if (isCategory(wb, XLSX)) return parseCategory(wb, XLSX, fileName);
      if (isX(wb, XLSX)) return finish(parseX(wb, XLSX), fileName);
      const rows = sheetRows(XLSX, wb.Sheets[wb.SheetNames[0]]);
      if (isMeta(rows)) return finish(parseMeta(rows), fileName);
      if (isTikTok(rows)) return finish(parseTikTok(rows), fileName);
      if (isGoogle(rows)) return finish(parseGoogle(rows, fileName), fileName);
      return { kind: 'unknown', fileName, warnings: ['Format tanınamadı. Desteklenen: Google Ads kampanya raporu, Meta, X Ads, TikTok Ads, Kategori Başına Maliyet dosyası.'] };
    } catch (e) {
      return { kind: 'unknown', fileName, warnings: ['Okuma hatası: ' + e.message] };
    }
  }
  function finish(res, fileName) {
    res.kind = 'ads';
    res.fileName = fileName;
    res.account = guessAccount(fileName);
    res.month = monthOf(res.range);
    if (res.range && res.range.start && res.range.end && res.range.start.slice(0, 7) !== res.range.end.slice(0, 7)) {
      res.warnings.push(`Rapor birden fazla ayı kapsıyor (${res.range.start} – ${res.range.end}); başlangıç ayına yazılacak.`);
    }
    res.totals = res.rows.reduce((t, r) => { t.spend += r.spend; t.impressions += r.impressions; t.clicks += r.clicks; return t; }, { spend: 0, impressions: 0, clicks: 0 });
    return res;
  }

  const api = {
    parseWorkbook, normName, num, parseRange, monthLabel, quarterOf, quarterLabel, monthsOfQuarter,
    guessAccount, canonSegment, SEGMENTS, ACCOUNTS, TR_MONTH_LABELS, fold,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Parsers = api;
})(typeof window !== 'undefined' ? window : globalThis);
