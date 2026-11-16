/* Osmanlı Yatırım Pazarlama Paneli — arayüz */
(function () {
  'use strict';
  const P = window.Parsers, C = window.Calc;

  // ---------- renkler (kategorik sıra sabit; renk varlığı izler, sırayı değil) ----------
  const PLATFORM_COLORS = { 'Google Ads': '#2a78d6', 'Meta': '#eb6834', 'X': '#1baf7a', 'TikTok': '#eda100', 'Kategori dosyası': '#9a988f' };
  const SEGMENT_COLORS = { 'FP': '#e87ba4', 'Hisse': '#008300', 'Türev-FX-TV': '#6250d6', 'Genel': '#8f8d86', 'Eşleşmemiş': '#c9c7c0' };
  const SINGLE = '#2a78d6';
  const pc = (p) => PLATFORM_COLORS[p] || '#7c7b76';
  const sc = (s) => SEGMENT_COLORS[s] || '#7c7b76';

  // ---------- durum ----------
  let DATA = { datasets: [], category: null, inputs: {} };
  let ALL = { rows: [], dupCount: 0 };
  const UI = { tab: 'overview', gran: 'month', period: '', platform: '', account: '', segment: '' };
  let PENDING = []; // yükleme ekranında bekleyen dosyalar
  const charts = {};

  // ---------- biçimlendirme ----------
  const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fInt = (n) => (n == null || !isFinite(n) ? '—' : nf0.format(n));
  const fTL = (n, d = 0) => (n == null || !isFinite(n) ? '—' : (d ? nf2 : nf0).format(n) + ' ₺');
  const fPct = (n, d = 2) => (n == null || !isFinite(n) ? '—' : '%' + (d === 1 ? nf1 : nf2).format(n * 100));
  const fCompactTL = (n) => {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e6) return nf2.format(n / 1e6) + ' Mn ₺';
    if (a >= 1e3) return nf1.format(n / 1e3) + ' B ₺';
    return nf0.format(n) + ' ₺';
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (err ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3200);
  }

  // ---------- API ----------
  const keyStore = { get: () => { try { return localStorage.getItem('pz-key') || ''; } catch (e) { return ''; } }, set: (v) => { try { localStorage.setItem('pz-key', v); } catch (e) { /* yok */ } } };
  async function api(path, opts = {}) {
    const res = await fetch('/api/' + path, {
      method: opts.method || 'GET',
      headers: { 'content-type': 'application/json', 'x-site-key': keyStore.get() },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* boş */ }
    if (!res.ok) throw new Error((data && data.error) || `Sunucu hatası (${res.status})`);
    return data;
  }
  async function ensureAuth() {
    try {
      const a = await api('auth');
      if (a.required && !a.ok) {
        await new Promise((resolve) => {
          const m = $('#keymodal');
          m.hidden = false;
          $('#keyform').onsubmit = async (e) => {
            e.preventDefault();
            keyStore.set($('#keyinput').value.trim());
            const b = await api('auth');
            if (b.ok) { m.hidden = true; resolve(); } else toast('Anahtar hatalı', true);
          };
        });
      }
    } catch (e) { /* auth uç noktası yoksa devam */ }
  }
  async function loadData() {
    DATA = await api('data');
    DATA.datasets = (DATA.datasets || []).sort((a, b) => (a.month + a.platform + a.account).localeCompare(b.month + b.platform + b.account));
    ALL = C.buildRows(DATA);
  }

  // ---------- filtreler ----------
  function periodsForGran() {
    const av = C.availablePeriods(DATA);
    if (UI.gran === 'month') {
      const ms = new Set(av.months);
      Object.keys(DATA.inputs || {}).forEach((k) => { if (!C.isQuarter(k)) ms.add(k); });
      return [...ms].sort().reverse();
    }
    return av.quarters;
  }
  function renderFilters() {
    $$('.seg button').forEach((b) => b.classList.toggle('active', b.dataset.gran === UI.gran));
    const periods = periodsForGran();
    if (!periods.includes(UI.period)) UI.period = periods[0] || '';
    $('#f-period').innerHTML = periods.length
      ? periods.map((p) => `<option value="${p}" ${p === UI.period ? 'selected' : ''}>${esc(C.periodLabel(p))}</option>`).join('')
      : '<option value="">Veri yok</option>';
    const platforms = [...new Set(ALL.rows.map((r) => r.platform))].sort();
    const accounts = [...new Set(ALL.rows.map((r) => r.account))].sort((a, b) => a.localeCompare(b, 'tr'));
    $('#f-platform').innerHTML = '<option value="">Tümü</option>' + platforms.map((p) => `<option ${p === UI.platform ? 'selected' : ''}>${esc(p)}</option>`).join('');
    $('#f-account').innerHTML = '<option value="">Tümü</option>' + accounts.map((p) => `<option ${p === UI.account ? 'selected' : ''}>${esc(p)}</option>`).join('');
    $('#f-segment').innerHTML = '<option value="">Tümü</option>' + C.SEG_ALL.map((p) => `<option ${p === UI.segment ? 'selected' : ''}>${esc(p)}</option>`).join('');
    const hideDims = UI.tab === 'category';
    ['#f-platform', '#f-account', '#f-segment'].forEach((s) => ($(s).parentElement.style.display = hideDims ? 'none' : ''));
    $('#filters').classList.toggle('hidden', UI.tab === 'upload' || UI.tab === 'manage');
    const last = DATA.datasets.reduce((m, d) => (d.uploadedAt > m ? d.uploadedAt : m), '');
    $('#f-note').textContent = last ? 'Son yükleme: ' + new Date(last).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }
  function applyDims(rows) {
    return rows.filter((r) => (!UI.platform || r.platform === UI.platform) && (!UI.account || r.account === UI.account) && (!UI.segment || r.segment === UI.segment));
  }
  function periodRows(period) {
    if (!period) return { rows: [], source: 'none', monthsWithData: [] };
    const r = C.rowsFor(ALL, DATA, period);
    return Object.assign({}, r, { rows: applyDims(r.rows) });
  }

  // ---------- grafikler ----------
  Chart.defaults.font.family = getComputedStyle(document.documentElement).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = '#52514e';
  Chart.defaults.borderColor = '#ecebe6';
  Chart.defaults.plugins.tooltip.backgroundColor = '#0f2a4a';
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.animation.duration = 250;

  // Yatay çubukların ucuna seçici değer etiketi
  const endLabels = {
    id: 'endLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts || !opts.enabled) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = '12px ' + Chart.defaults.font.family;
      ctx.fillStyle = '#52514e';
      ctx.textBaseline = 'middle';
      const meta = chart.getDatasetMeta(chart.data.datasets.length - 1);
      meta.data.forEach((bar, i) => {
        let total = 0;
        chart.data.datasets.forEach((ds) => (total += +ds.data[i] || 0));
        ctx.fillText(opts.format(total, i), bar.x + 6, bar.y);
      });
      ctx.restore();
    },
  };
  Chart.register(endLabels);

  function mkChart(id, cfg) {
    if (charts[id]) charts[id].destroy();
    const el = document.getElementById(id);
    if (!el) return;
    charts[id] = new Chart(el, cfg);
  }
  function hbar(id, labels, values, colors, opts = {}) {
    const h = Math.max(120, labels.length * 30 + 30);
    document.getElementById(id).parentElement.style.height = h + 'px';
    const total = values.reduce((a, b) => a + b, 0);
    mkChart(id, {
      type: 'bar',
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, borderSkipped: 'start', barThickness: 16 }] },
      options: {
        indexAxis: 'y', maintainAspectRatio: false, layout: { padding: { right: 92 } },
        scales: {
          x: { grid: { color: '#ecebe6' }, border: { display: false }, ticks: { callback: (v) => fCompactTL(v), maxTicksLimit: 5 } },
          y: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, callback: function (v) { const l = this.getLabelForValue(v); return l.length > 34 ? l.slice(0, 33) + '…' : l; } } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${fTL(c.parsed.x)}  ·  ${fPct(total ? c.parsed.x / total : 0, 1)}` } },
          endLabels: { enabled: true, format: (v) => fCompactTL(v) },
        },
        ...opts,
      },
    });
  }

  // ---------- görünümler ----------
  function render() {
    renderFilters();
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === UI.tab));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + UI.tab));
    ({ overview: renderOverview, campaigns: renderCampaigns, category: renderCategory, upload: renderUpload, manage: renderManage })[UI.tab]();
  }

  function emptyState(el) {
    el.innerHTML = `<div class="empty card"><h2>Henüz veri yok</h2><p>Google Ads, Meta, X, TikTok raporlarını ve Kategori Başına Maliyet dosyasını yükleyerek başlayın.</p>
      <button class="btn primary" data-go="upload">Veri Yükle</button></div>`;
  }

  function deltaHtml(cur, prev, better) {
    if (prev == null || cur == null || !isFinite(prev) || !isFinite(cur) || prev === 0) return '<div class="delta">&nbsp;</div>';
    const d = (cur - prev) / Math.abs(prev);
    const dir = d > 0.0005 ? 'up' : d < -0.0005 ? 'down' : '';
    const good = better === 'up' ? dir === 'up' : better === 'down' ? dir === 'down' : null;
    const cls = good == null ? '' : good ? 'up' : 'down';
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
    return `<div class="delta ${cls}">${arrow} ${fPct(Math.abs(d), 1)} <span class="muted">önceki döneme göre</span></div>`;
  }

  function renderOverview() {
    const el = $('#view-overview');
    if (!DATA.datasets.length && !DATA.category) return emptyState(el);
    if (!UI.period) { el.innerHTML = '<div class="empty card"><h2>Bu görünümde dönem yok</h2><p>Ay/Çeyrek seçimini değiştirin.</p></div>'; return; }
    const cur = periodRows(UI.period);
    const prev = periodRows(C.prevPeriod(UI.period));
    const k = C.kpis(cur.rows);
    const kp = prev.rows.length && prev.source === cur.source ? C.kpis(prev.rows) : {};
    const legacy = cur.source === 'category';
    const unm = cur.rows.filter((r) => r.segment === 'Eşleşmemiş' && r.spend > 0);
    const unmSpend = C.sum(unm, 'spend');

    let notices = '';
    if (legacy) notices += `<div class="notice info">Bu çeyrek için yüklenmiş platform raporu yok. Kategori Başına Maliyet dosyasındaki kampanya harcamaları gösteriliyor; gösterim, tıklama ve dönüşüm verisi bu kaynakta yok.</div>`;
    else if (C.isQuarter(UI.period) && cur.monthsWithData.length < 3) notices += `<div class="notice info">Bu çeyrekte ${cur.monthsWithData.length}/3 ayın raporu yüklü (${cur.monthsWithData.map(P.monthLabel).join(', ')}).</div>`;
    if (unmSpend > 0 && !UI.segment) notices += `<div class="notice">${fTL(unmSpend)} harcama (${unm.length} kampanya), Kategori dosyasındaki eşlemede bulunamadı ve <b>Eşleşmemiş</b> olarak gösteriliyor. <a href="#" data-go="category">Listeyi gör ve indir →</a></div>`;
    if (!cur.rows.length) { el.innerHTML = notices + '<div class="empty card"><h2>Bu dönem ve filtrede veri yok</h2></div>'; return; }

    const tiles = [
      ['Toplam harcama', fTL(k.spend), deltaHtml(k.spend, kp.spend, null)],
      ...(legacy ? [] : [
        ['Gösterim', fInt(k.impressions), deltaHtml(k.impressions, kp.impressions, 'up')],
        ['Tıklama', fInt(k.clicks), deltaHtml(k.clicks, kp.clicks, 'up')],
        ['Tıklama oranı (TO)', fPct(k.ctr), deltaHtml(k.ctr, kp.ctr, 'up')],
        ['Ort. TBM', fTL(k.cpc, 2), deltaHtml(k.cpc, kp.cpc, 'down')],
        ['BGBM (1.000 gösterim)', fTL(k.cpm, 2), deltaHtml(k.cpm, kp.cpm, 'down')],
        ['Uygulama yükleme', fInt(k.installs), deltaHtml(k.installs, kp.installs, 'up')],
        ['Meta lead formu', fInt(k.leads), deltaHtml(k.leads, kp.leads, 'up')],
      ]),
      ['Harcaması olan kampanya', fInt(k.campaigns), '<div class="delta">&nbsp;</div>'],
    ];

    const byPlat = C.groupSum(cur.rows, (r) => r.platform, 'spend').filter((x) => x[1] > 0);
    const bySeg = C.SEG_ALL.map((s) => [s, C.sum(cur.rows.filter((r) => r.segment === s), 'spend')]).filter((x) => x[1] > 0);
    const byAcc = C.groupSum(cur.rows, (r) => r.account, 'spend').filter((x) => x[1] > 0);
    const byType = C.groupSum(cur.rows, (r) => C.TYPE_LABELS[r.type] || r.type, 'spend').filter((x) => x[1] > 0);

    // platform performans tablosu
    const platRows = byPlat.map(([p]) => {
      const rs = cur.rows.filter((r) => r.platform === p);
      const kk = C.kpis(rs);
      return `<tr><td><span class="dot" style="background:${pc(p)}"></span>${esc(p)}</td><td class="num">${fTL(kk.spend)}</td><td class="num">${fPct(k.spend ? kk.spend / k.spend : 0, 1)}</td>
        <td class="num">${fInt(kk.impressions)}</td><td class="num">${fInt(kk.clicks)}</td><td class="num">${fPct(kk.ctr)}</td><td class="num">${fTL(kk.cpc, 2)}</td><td class="num">${fTL(kk.cpm, 2)}</td></tr>`;
    }).join('');

    // en çok harcayan kampanyalar
    const top = cur.rows.filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 12);
    const topRows = top.map((r) => `<tr><td class="name">${esc(r.campaign)}</td><td><span class="dot" style="background:${pc(r.platform)}"></span>${esc(r.platform)}</td><td>${esc(r.account)}</td>
      <td>${segPill(r.segment)}</td><td class="num">${fTL(r.spend)}</td><td class="num">${fInt(r.clicks)}</td><td class="num">${r.clicks ? fTL(r.spend / r.clicks, 2) : '—'}</td></tr>`).join('');

    // Meta sonuç türleri
    const metaRows = cur.rows.filter((r) => r.platform === 'Meta' && r.results > 0);
    const metaAgg = {};
    for (const r of metaRows) {
      const t = r.resultType || 'Diğer';
      metaAgg[t] = metaAgg[t] || { results: 0, spend: 0, n: 0 };
      metaAgg[t].results += r.results; metaAgg[t].spend += r.spend; metaAgg[t].n++;
    }
    const metaHtml = Object.entries(metaAgg).sort((a, b) => b[1].spend - a[1].spend)
      .map(([t, v]) => `<tr><td>${esc(t)}</td><td class="num">${v.n}</td><td class="num">${fInt(v.results)}</td><td class="num">${fTL(v.spend)}</td><td class="num">${fTL(v.spend / v.results, 2)}</td></tr>`).join('');

    // Google dönüşümleri kampanya türüne göre
    const g = cur.rows.filter((r) => r.platform === 'Google Ads' && (r.conversions > 0 || r.installs > 0));
    const gAgg = {};
    for (const r of g) {
      const t = C.TYPE_LABELS[r.type] || r.type;
      gAgg[t] = gAgg[t] || { conv: 0, inst: 0, spend: 0 };
      gAgg[t].conv += r.conversions; gAgg[t].inst += r.installs; gAgg[t].spend += r.spend;
    }
    const gHtml = Object.entries(gAgg).sort((a, b) => b[1].spend - a[1].spend)
      .map(([t, v]) => `<tr><td>${esc(t)}</td><td class="num">${fInt(v.conv)}</td><td class="num">${fInt(v.inst)}</td><td class="num">${fTL(v.spend)}</td><td class="num">${v.conv ? fTL(v.spend / v.conv, 2) : '—'}</td></tr>`).join('');

    // X kırılımları
    const months = new Set(C.monthsIn(UI.period));
    const xs = DATA.datasets.filter((d) => d.platform === 'X' && months.has(d.month) && d.breakdowns && (!UI.account || d.account === UI.account) && (!UI.platform || UI.platform === 'X'));
    const xb = {};
    for (const d of xs) for (const dim in d.breakdowns) for (const v in d.breakdowns[dim]) {
      xb[dim] = xb[dim] || {};
      xb[dim][v] = xb[dim][v] || { spend: 0, clicks: 0, impressions: 0 };
      const s = d.breakdowns[dim][v];
      xb[dim][v].spend += s.spend; xb[dim][v].clicks += s.clicks; xb[dim][v].impressions += s.impressions;
    }
    const xDims = ['Yaş', 'Cinsiyet', 'Cihaz'].filter((d) => xb[d]);

    el.innerHTML = `${notices}
      <div class="grid kpis">${tiles.map(([l, v, d]) => `<div class="card kpi"><div class="label">${l}</div><div class="value">${v}</div>${d}</div>`).join('')}</div>
      <div class="grid two">
        <div class="card"><h3>Platform bazında harcama</h3><p class="sub">${esc(C.periodLabel(UI.period))}</p><div class="chart-box"><canvas id="c-plat"></canvas></div></div>
        <div class="card"><h3>Kırılım bazında harcama</h3><p class="sub">Kategori dosyasındaki eşlemeye göre. Genel, kategorilere henüz dağıtılmamış hali.</p><div class="chart-box"><canvas id="c-seg"></canvas></div></div>
      </div>
      <div class="grid two">
        <div class="card"><h3>Hesap bazında harcama</h3><p class="sub">Raporun yüklendiği reklam hesabı</p><div class="chart-box"><canvas id="c-acc"></canvas></div></div>
        <div class="card"><h3>Kampanya türü bazında harcama</h3><p class="sub">Eşlemedeki tür; eşlemede yoksa platformdaki kampanya türü</p><div class="chart-box"><canvas id="c-type"></canvas></div></div>
      </div>
      <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Aylık harcama trendi</h3><p class="sub">Yüklenen tüm aylar, platform bazında (filtreler uygulanır)</p></div></div>
        <div class="legend" id="trend-legend"></div><div class="chart-box" style="height:260px"><canvas id="c-trend"></canvas></div><p class="small muted" id="trend-note"></p></div>
      ${legacy ? '' : `<div class="card" style="margin-bottom:16px"><h3>Platform performansı</h3><p class="sub">Tıklama: Google'da tüm tıklamalar, Meta ve X'te bağlantı tıklaması, TikTok'ta hedef tıklaması</p>
        <div class="table-wrap" style="max-height:none"><table class="data"><thead><tr><th>Platform</th><th class="num">Harcama</th><th class="num">Pay</th><th class="num">Gösterim</th><th class="num">Tıklama</th><th class="num">TO</th><th class="num">Ort. TBM</th><th class="num">BGBM</th></tr></thead><tbody>${platRows}</tbody></table></div></div>`}
      <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>En çok harcayan kampanyalar</h3><p class="sub">İlk 12 · tamamı Kampanyalar sekmesinde</p></div><button class="btn small" data-go="campaigns">Tümünü gör</button></div>
        <div class="table-wrap" style="max-height:none"><table class="data"><thead><tr><th>Kampanya</th><th>Platform</th><th>Hesap</th><th>Kırılım</th><th class="num">Harcama</th><th class="num">Tıklama</th><th class="num">TBM</th></tr></thead><tbody>${topRows}</tbody></table></div></div>
      ${legacy ? '' : `<div class="grid two">
        <div class="card"><h3>Google Ads dönüşümleri</h3><p class="sub">Kampanya türüne göre. Dönüşümler, her kampanyanın kendi hedefine göre sayılır.</p>
          ${gHtml ? `<table class="data"><thead><tr><th>Tür</th><th class="num">Dönüşüm</th><th class="num">Yükleme</th><th class="num">Harcama</th><th class="num">Dönüşüm başı</th></tr></thead><tbody>${gHtml}</tbody></table>` : '<p class="muted">Bu dönemde dönüşüm yok.</p>'}</div>
        <div class="card"><h3>Meta sonuçları</h3><p class="sub">Sonuç türleri farklı olduğu için türe göre ayrı gösterilir</p>
          ${metaHtml ? `<table class="data"><thead><tr><th>Sonuç türü</th><th class="num">Kampanya</th><th class="num">Sonuç</th><th class="num">Harcama</th><th class="num">Sonuç başı</th></tr></thead><tbody>${metaHtml}</tbody></table>` : '<p class="muted">Bu dönemde Meta sonucu yok.</p>'}</div>
      </div>`}
      ${xDims.length ? `<h2 class="section">X Ads kitle kırılımları</h2><div class="grid three">${xDims.map((d) => `<div class="card"><h3>${d} bazında harcama</h3><p class="sub">X Ads · ${xs.length} hesap</p><div class="chart-box"><canvas id="c-x-${d}"></canvas></div></div>`).join('')}</div>` : ''}
    `;

    hbar('c-plat', byPlat.map((x) => x[0]), byPlat.map((x) => x[1]), byPlat.map((x) => pc(x[0])));
    hbar('c-seg', bySeg.map((x) => x[0]), bySeg.map((x) => x[1]), bySeg.map((x) => sc(x[0])));
    hbar('c-acc', byAcc.map((x) => x[0]), byAcc.map((x) => x[1]), SINGLE);
    hbar('c-type', byType.map((x) => x[0]), byType.map((x) => x[1]), SINGLE);
    for (const d of xDims) {
      const order = Object.entries(xb[d]).filter((x) => x[1].spend > 0).sort((a, b) => (d === 'Yaş' ? a[0].localeCompare(b[0]) : b[1].spend - a[1].spend));
      hbar('c-x-' + d, order.map((x) => x[0]), order.map((x) => x[1].spend), SINGLE, {});
      charts['c-x-' + d].options.plugins.tooltip.callbacks.afterLabel = (c) => {
        const v = order[c.dataIndex][1];
        return ` ${fInt(v.clicks)} tıklama · TBM ${v.clicks ? fTL(v.spend / v.clicks, 2) : '—'}`;
      };
    }
    renderTrend();
  }

  function renderTrend() {
    const rows = applyDims(ALL.rows);
    const months = [...new Set(rows.map((r) => r.month))].sort();
    const plats = Object.keys(PLATFORM_COLORS).filter((p) => rows.some((r) => r.platform === p));
    const note = $('#trend-note');
    $('#trend-legend').innerHTML = plats.map((p) => `<span><span class="dot" style="background:${pc(p)}"></span>${esc(p)}</span>`).join('');
    note.textContent = months.length < 2 ? 'Şu an yalnızca bir ayın raporu var. Yeni aylar yüklendikçe trend burada oluşacak.' : '';
    mkChart('c-trend', {
      type: 'bar',
      data: {
        labels: months.map(P.monthLabel),
        datasets: plats.map((p) => ({
          label: p, backgroundColor: pc(p), borderColor: '#fcfcfb', borderWidth: { top: 2 }, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 46,
          data: months.map((m) => C.sum(rows.filter((r) => r.month === m && r.platform === p), 'spend')),
        })),
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false } },
          y: { stacked: true, border: { display: false }, ticks: { callback: (v) => fCompactTL(v), maxTicksLimit: 5 } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fTL(c.parsed.y)}`, footer: (items) => 'Toplam: ' + fTL(items.reduce((a, i) => a + i.parsed.y, 0)) } },
        },
      },
    });
  }

  function segPill(s) {
    return `<span class="pill ${s === 'Eşleşmemiş' ? 'warn' : ''}"><span class="dot" style="background:${sc(s)}"></span>${esc(s)}</span>`;
  }

  // ---------- Kampanyalar ----------
  const CAMP_COLS = [
    ['campaign', 'Kampanya', 's'], ['platform', 'Platform', 's'], ['account', 'Hesap', 's'], ['month', 'Ay', 's'], ['typeLabel', 'Tür', 's'],
    ['segment', 'Kırılım', 's'], ['status', 'Durum', 's'], ['spend', 'Harcama', 'tl'], ['impressions', 'Gösterim', 'i'], ['clicks', 'Tıklama', 'i'],
    ['ctr', 'TO', 'p'], ['cpc', 'TBM', 'tl2'], ['conversions', 'Dönüşüm', 'i'], ['installs', 'Yükleme', 'i'], ['results', 'Sonuç', 'i'],
    ['resultType', 'Sonuç türü', 's'], ['cpr', 'Sonuç başı', 'tl2'],
  ];
  const campState = { sort: 'spend', dir: -1, q: '', hideZero: true };
  function campRows() {
    const cur = periodRows(UI.period);
    return cur.rows.map((r) => Object.assign({}, r, {
      typeLabel: (C.TYPE_LABELS[r.type] || r.type) + (r.typeInferred ? '*' : ''),
      ctr: r.impressions ? r.clicks / r.impressions : null,
      cpc: r.clicks ? r.spend / r.clicks : null,
      cpr: r.results ? r.spend / r.results : (r.conversions ? r.spend / r.conversions : null),
      month: C.isQuarter(r.month) ? C.periodLabel(r.month) : P.monthLabel(r.month),
    }));
  }
  function renderCampaigns() {
    const el = $('#view-campaigns');
    if (!DATA.datasets.length && !DATA.category) return emptyState(el);
    el.innerHTML = `<div class="toolbar">
        <input type="search" id="camp-q" placeholder="Kampanya ara…" value="${esc(campState.q)}">
        <label class="small"><input type="checkbox" id="camp-zero" ${campState.hideZero ? 'checked' : ''}> Harcaması olmayanları gizle</label>
        <span class="muted small" id="camp-count"></span>
        <span style="flex:1"></span>
        <button class="btn" id="camp-export">Excel'e aktar</button>
      </div>
      <div class="table-wrap"><table class="data" id="camp-table"></table></div>
      <p class="small muted">* Tür, Kategori dosyasındaki eşlemede bulunamadığı için platformdaki kampanya türünden ya da kampanya adından tahmin edildi.</p>`;
    $('#camp-q').oninput = (e) => { campState.q = e.target.value; drawCampTable(); };
    $('#camp-zero').onchange = (e) => { campState.hideZero = e.target.checked; drawCampTable(); };
    $('#camp-export').onclick = () => {
      const rows = filteredCamp();
      const aoa = [CAMP_COLS.map((c) => c[1])].concat(rows.map((r) => CAMP_COLS.map((c) => (r[c[0]] == null ? '' : r[c[0]]))));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Kampanyalar');
      XLSX.writeFile(wb, `kampanyalar_${UI.period}.xlsx`);
    };
    drawCampTable();
  }
  function filteredCamp() {
    const q = P.fold(campState.q);
    let rows = campRows().filter((r) => (!campState.hideZero || r.spend > 0 || r.impressions > 0) && (!q || P.fold(r.campaign).includes(q)));
    const k = campState.sort, d = campState.dir;
    rows.sort((a, b) => {
      const x = a[k], y = b[k];
      if (typeof x === 'number' || typeof y === 'number') return ((x == null ? -Infinity : x) - (y == null ? -Infinity : y)) * d;
      return String(x || '').localeCompare(String(y || ''), 'tr') * d;
    });
    return rows;
  }
  function cell(v, t) {
    if (t === 'tl') return fTL(v);
    if (t === 'tl2') return fTL(v, 2);
    if (t === 'i') return v ? fInt(v) : (v === 0 ? '0' : '—');
    if (t === 'p') return fPct(v);
    return esc(v);
  }
  function drawCampTable() {
    const rows = filteredCamp();
    const t = $('#camp-table');
    const tot = C.kpis(rows);
    t.innerHTML = `<thead><tr>${CAMP_COLS.map(([k, l, ty]) => `<th class="sortable ${ty !== 's' ? 'num' : ''}" data-k="${k}">${l}${campState.sort === k ? (campState.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${CAMP_COLS.map(([k, , ty]) => {
        if (k === 'campaign') return `<td class="name">${esc(r.campaign)}</td>`;
        if (k === 'platform') return `<td><span class="dot" style="background:${pc(r.platform)}"></span>${esc(r.platform)}</td>`;
        if (k === 'segment') return `<td>${segPill(r.segment)}</td>`;
        return `<td class="${ty !== 's' ? 'num' : ''}">${cell(r[k], ty)}</td>`;
      }).join('')}</tr>`).join('')}</tbody>
      <tfoot><tr><td>Toplam (${rows.length})</td><td></td><td></td><td></td><td></td><td></td><td></td><td class="num">${fTL(tot.spend)}</td><td class="num">${fInt(tot.impressions)}</td><td class="num">${fInt(tot.clicks)}</td><td class="num">${fPct(tot.ctr)}</td><td class="num">${fTL(tot.cpc, 2)}</td><td></td><td class="num">${fInt(tot.installs)}</td><td></td><td></td><td></td></tr></tfoot>`;
    $('#camp-count').textContent = `${rows.length} satır · ${C.periodLabel(UI.period)}`;
    $$('th.sortable', t).forEach((th) => (th.onclick = () => {
      const k = th.dataset.k;
      if (campState.sort === k) campState.dir *= -1; else { campState.sort = k; campState.dir = CAMP_COLS.find((c) => c[0] === k)[2] === 's' ? 1 : -1; }
      drawCampTable();
    }));
  }

  // ---------- Kategori maliyeti ----------
  function renderCategory() {
    const el = $('#view-category');
    if (!DATA.datasets.length && !DATA.category) return emptyState(el);
    if (!UI.period) { el.innerHTML = '<div class="empty card"><h2>Dönem seçin</h2></div>'; return; }
    const cur = C.rowsFor(ALL, DATA, UI.period);
    const inp = C.inputsFor(DATA, UI.period);
    const cc = C.categoryCost(cur.rows, inp);
    const unm = cur.rows.filter((r) => r.segment === 'Eşleşmemiş' && r.spend > 0).sort((a, b) => b.spend - a.spend);
    const hasLeads = cc.leads.total > 0, hasAcc = cc.accounts.total > 0;
    const srcSpend = cur.source === 'category' ? 'Kategori Başına Maliyet dosyası' : cur.source === 'reports' ? `Platform raporları (${cur.monthsWithData.map(P.monthLabel).join(', ')})` : '—';

    const segRow = (s, f) => `<td><span class="dot" style="background:${sc(s.segment)}"></span>${s.segment}</td>${f(s)}`;
    const spendTable = `<table class="data"><thead><tr><th>Kategori</th><th class="num">Doğrudan harcama</th><th class="num">Genel'den aldığı pay</th><th class="num">Reklam harcaması (dağıtılmış)</th><th class="num">Ajans gideri payı</th><th class="num">Giydirilmiş maliyet</th><th class="num">Pay</th></tr></thead>
      <tbody>${cc.segs.map((s) => `<tr>${segRow(s, (x) => `<td class="num">${fTL(x.direct)}</td><td class="num">${fTL(x.alloc - x.direct)}</td><td class="num">${fTL(x.alloc)}</td><td class="num">${fTL(x.dressed - x.alloc)}</td><td class="num">${fTL(x.dressed)}</td><td class="num">${fPct(cc.total ? x.alloc / cc.total : 0, 1)}</td>`)}</tr>`).join('')}</tbody>
      <tfoot><tr><td>Toplam</td><td class="num">${fTL(cc.direct)}</td><td class="num">${fTL(cc.shared)}</td><td class="num">${fTL(cc.total)}</td><td class="num">${fTL(cc.agency)}</td><td class="num">${fTL(cc.dressedTotal)}</td><td class="num">%100</td></tr></tfoot></table>
      <p class="small muted">Dağıtılan ortak harcama: Genel ${fTL(cc.spend['Genel'])}${cc.spend['Eşleşmemiş'] ? ` + Eşleşmemiş ${fTL(cc.spend['Eşleşmemiş'])}` : ''}. Kategorilere doğrudan harcama paylarına göre dağıtılır. Ajans gideri, dağıtılmış harcama paylarına göre eklenir.</p>`;

    const costTable = (title, d, unitLabel, k1, k2, totals) => `<div class="card"><h3>${title}</h3><p class="sub">Segment atanmamış ${unitLabel.toLowerCase()}, segmentli ${unitLabel.toLowerCase()} paylarına göre dağıtılır</p>
      <div class="table-wrap" style="max-height:none"><table class="data"><thead><tr><th>Kategori</th><th class="num">Gelen ${unitLabel.toLowerCase()}</th><th class="num">Atanmamıştan pay</th><th class="num">Toplam</th><th class="num">Maliyet (reklam)</th><th class="num">Maliyet (giydirilmiş)</th></tr></thead>
      <tbody>${cc.segs.map((s) => `<tr>${segRow(s, (x) => `<td class="num">${fInt(d.raw[x.segment])}</td><td class="num">${fInt(d.alloc[x.segment] - d.raw[x.segment])}</td><td class="num">${fInt(d.alloc[x.segment])}</td><td class="num"><b>${fTL(x[k1])}</b></td><td class="num"><b>${fTL(x[k2])}</b></td>`)}</tr>`).join('')}</tbody>
      <tfoot><tr><td>Toplam</td><td class="num">${fInt(d.total - d.unassigned)}</td><td class="num">${fInt(d.unassigned)}</td><td class="num">${fInt(d.total)}</td><td class="num">${fTL(totals[0])}</td><td class="num">${fTL(totals[1])}</td></tr></tfoot></table></div></div>`;

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Kategori başına maliyet · ${esc(C.periodLabel(UI.period))}</h3>
        <p class="sub">Harcama kaynağı: ${esc(srcSpend)} · Lead/hesap/ajans girdisi: ${esc(inp.source || 'girilmemiş')}</p></div>
        <button class="btn small" data-go="manage" data-input-period="${UI.period}">Lead / hesap / ajans gideri gir</button></div>
        ${!hasLeads && !hasAcc ? `<div class="notice">Bu dönem için lead ve açılan hesap sayısı girilmemiş. Maliyet hesapları için <a href="#" data-go="manage" data-input-period="${UI.period}">Veri Yönetimi → Elle giriş</a> bölümünden ekleyin.</div>` : ''}
        ${inp.agency == null ? '<p class="small muted">Ajans gideri girilmemiş; giydirilmiş maliyet reklam harcamasına eşit görünür.</p>' : ''}
        <div class="table-wrap" style="max-height:none">${spendTable}</div></div>
      <div class="grid two">
        ${costTable('Lead başına maliyet', cc.leads, 'Lead', 'cpl', 'cplDressed', [cc.totals.cpl, cc.totals.cplDressed])}
        ${costTable('Açılan hesap başına maliyet', cc.accounts, 'Hesap', 'cpa', 'cpaDressed', [cc.totals.cpa, cc.totals.cpaDressed])}
      </div>
      ${unm.length ? `<div class="card"><div class="card-head"><div><h3>Eşlemede bulunmayan kampanyalar (${unm.length})</h3>
        <p class="sub">Toplam ${fTL(C.sum(unm, 'spend'))}. Bu tutar şu an Genel gibi tüm kategorilere dağıtılıyor. Listeyi indirip Kategori dosyasına ekleyin, sonra dosyayı yeniden yükleyin.</p></div>
        <button class="btn primary small" id="unm-export">Listeyi Excel olarak indir</button></div>
        <div class="table-wrap"><table class="data"><thead><tr><th>Kampanya</th><th>Platform</th><th>Hesap</th><th>Tür (tahmin)</th><th class="num">Harcama</th></tr></thead>
        <tbody>${unm.map((r) => `<tr><td class="name">${esc(r.campaign)}</td><td>${esc(r.platform)}</td><td>${esc(r.account)}</td><td>${esc(r.type)}</td><td class="num">${fTL(r.spend)}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <p class="small muted" style="margin-top:14px">Not: Genel harcama, kategorilerin doğrudan harcama paylarına göre tam oranla dağıtılır. Excel'deki yuvarlanmış katsayılar (ör. 14/62) kullanılmadığı için kategori rakamları Excel'den ±%1 civarında farklı olabilir. Toplam lead/hesap başına maliyet birebir aynıdır.</p>`;

    const ex = $('#unm-export');
    if (ex) ex.onclick = () => {
      const aoa = [['Kampanya Adı', 'Kampanya Türü', 'Kırılım', 'Platform', 'Hesap', 'Harcama']].concat(unm.map((r) => [r.campaign, r.type, '', r.platform, r.account, Math.round(r.spend * 100) / 100]));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 60 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Eşleşmemiş');
      XLSX.writeFile(wb, `eslesmemis_kampanyalar_${UI.period}.xlsx`);
    };
  }

  // ---------- Veri yükleme ----------
  function renderUpload() {
    const el = $('#view-upload');
    el.innerHTML = `
      <div class="dropzone" id="drop"><strong>Rapor dosyalarını buraya sürükleyin</strong>ya da tıklayıp seçin · birden fazla dosya seçebilirsiniz (.xlsx, .xls, .csv)
        <input type="file" id="file" multiple accept=".xlsx,.xls,.csv" hidden></div>
      <div id="review"></div>
      <h2 class="section">Tanınan formatlar</h2>
      <div class="grid three">
        <div class="card"><h3>Google Ads · Kampanya raporu</h3><p class="sub">İlk satırda "Kampanya raporu", ikinci satırda dönem yazar. Sütun seti farklı olabilir; "Toplam" satırları otomatik atlanır. Dönüşüm işlemine göre kırılmış raporlar da okunur.</p></div>
        <div class="card"><h3>Meta Ads Manager</h3><p class="sub">Kampanya düzeyinde dışa aktarım: Rapor Başlangıcı/Sonu, Kampanya Adı, Harcanan Tutar (TRY), Sonuçlar, Sonuç Göstergesi.</p></div>
        <div class="card"><h3>X Ads</h3><p class="sub">"results" sayfası (Time period, Campaign name, Spend…) ve varsa Platform, Age, Gender, Location kırılım sayfaları.</p></div>
        <div class="card"><h3>TikTok Ads</h3><p class="sub">Reklam grubu ya da kampanya düzeyinde dışa aktarım. Dosyada dönem olmadığı için ayı yüklerken seçersiniz.</p></div>
        <div class="card"><h3>Kategori Başına Maliyet</h3><p class="sub">Kampanya → Kampanya Türü → Kırılım eşlemesi (AllTime / Kampanyalar sayfaları), çeyrek harcamaları, ajans gideri, lead ve açılan hesap sayıları. Her yüklemede eşleme yenilenir.</p></div>
      </div>
      <p class="small muted">Hesap adı Google Ads dosyalarının içinde yazmadığı için dosya adından tahmin edilir (ör. "osmanlimenkul", "borsa_direkt_web"). Kaydetmeden önce kontrol edin. Aynı platform + hesap + ay için yeniden yükleme yapılırsa eski rapor yenisiyle değiştirilir.</p>`;
    const drop = $('#drop'), file = $('#file');
    drop.onclick = () => file.click();
    file.onchange = () => handleFiles(file.files);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles(e.dataTransfer.files); };
    drawReview();
  }

  async function handleFiles(files) {
    for (const f of files) {
      try {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array', cellDates: false });
        const res = P.parseWorkbook(XLSX, wb, f.name);
        res.fileName = f.name;
        PENDING.push(res);
      } catch (e) {
        PENDING.push({ kind: 'unknown', fileName: f.name, warnings: ['Dosya açılamadı: ' + e.message] });
      }
    }
    // Dönemi olmayan raporlar (TikTok) için toplu yüklemedeki en yaygın ay
    const months = PENDING.filter((p) => p.kind === 'ads' && p.month).map((p) => p.month);
    const common = months.sort((a, b) => months.filter((x) => x === b).length - months.filter((x) => x === a).length)[0];
    const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
    PENDING.forEach((p) => { if (p.kind === 'ads' && !p.month) p.month = common || lastMonth; });
    drawReview();
  }

  const dsId = (p) => `${p.platform}|${p.account}|${p.month}`;

  function drawReview() {
    const el = $('#review');
    if (!el) return;
    if (!PENDING.length) { el.innerHTML = ''; return; }
    const existing = new Set(DATA.datasets.map((d) => d.id));
    const accounts = [...new Set([...P.ACCOUNTS, ...DATA.datasets.map((d) => d.account)])].filter(Boolean);
    const ids = PENDING.filter((p) => p.kind === 'ads').map(dsId);
    el.innerHTML = `<h2 class="section">Yüklenecek dosyalar (${PENDING.length})</h2>
      <datalist id="acc-list">${accounts.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
      <div class="table-wrap review" style="max-height:none"><table class="data"><thead><tr><th>Dosya</th><th>Tür</th><th>Hesap</th><th>Ay / Yıl</th><th class="num">Satır</th><th class="num">Harcama</th><th>Durum</th><th></th></tr></thead>
      <tbody>${PENDING.map((p, i) => {
        const warn = p.warnings && p.warnings.length ? `<ul class="warnlist">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
        if (p.kind === 'category') {
          const qs = Object.keys(p.quarters).sort();
          return `<tr><td class="name">${esc(p.fileName)}${warn}</td><td><span class="pill ok">Kategori dosyası</span></td><td class="muted">—</td>
            <td><input type="number" min="2020" max="2100" value="${p.year}" data-i="${i}" data-f="year" style="width:90px"></td>
            <td class="num">${Object.keys(p.mapping).length} eşleme</td><td class="small" colspan="2">Çeyrekler: ${qs.map((q) => q.replace(/^\d+-/, '')).join(', ') || '—'}<br><span class="muted">Mevcut eşleme bununla değiştirilir</span></td>
            <td><button class="btn small danger" data-rm="${i}">Kaldır</button></td></tr>`;
        }
        if (p.kind !== 'ads') return `<tr><td class="name">${esc(p.fileName)}${warn}</td><td><span class="pill warn">Tanınmadı</span></td><td colspan="5"></td><td><button class="btn small danger" data-rm="${i}">Kaldır</button></td></tr>`;
        const id = dsId(p);
        const dupInBatch = ids.filter((x) => x === id).length > 1;
        const status = dupInBatch ? '<span class="pill warn">Bu listede tekrar</span>' : existing.has(id) ? '<span class="pill warn">Üzerine yazılacak</span>' : '<span class="pill ok">Yeni</span>';
        return `<tr><td class="name">${esc(p.fileName)}${warn}</td><td><span class="dot" style="background:${pc(p.platform)}"></span>${esc(p.platform)}<div class="small muted">${esc(p.level || '')}</div></td>
          <td><input list="acc-list" value="${esc(p.account)}" data-i="${i}" data-f="account" placeholder="Hesap adı" style="width:170px"></td>
          <td><input type="month" value="${esc(p.month || '')}" data-i="${i}" data-f="month"></td>
          <td class="num">${p.rows.length}</td><td class="num">${fTL(p.totals.spend)}</td><td>${status}</td>
          <td><button class="btn small danger" data-rm="${i}">Kaldır</button></td></tr>`;
      }).join('')}</tbody></table></div>
      <div class="toolbar" style="margin-top:12px"><button class="btn primary" id="save-all">Tümünü kaydet</button><button class="btn" id="clear-all">Listeyi temizle</button><span class="small muted" id="save-msg"></span></div>`;
    $$('#review input').forEach((inp) => (inp.onchange = () => {
      const p = PENDING[+inp.dataset.i];
      const f = inp.dataset.f;
      if (f === 'year') {
        const y = +inp.value;
        const nq = {};
        for (const q in p.quarters) nq[q.replace(/^\d+/, y)] = p.quarters[q];
        p.quarters = nq; p.year = y;
      } else p[f] = inp.value.trim();
      drawReview();
    }));
    $$('#review [data-rm]').forEach((b) => (b.onclick = () => { PENDING.splice(+b.dataset.rm, 1); drawReview(); }));
    $('#clear-all').onclick = () => { PENDING = []; drawReview(); };
    $('#save-all').onclick = saveAll;
  }

  async function saveAll() {
    const ads = PENDING.filter((p) => p.kind === 'ads');
    const cats = PENDING.filter((p) => p.kind === 'category');
    const bad = ads.filter((p) => !p.account || !/^\d{4}-\d{2}$/.test(p.month || ''));
    if (bad.length) return toast('Hesap adı ve ay her rapor için dolu olmalı', true);
    const ids = ads.map(dsId);
    if (new Set(ids).size !== ids.length) return toast('Aynı platform + hesap + ay iki kez var. Birini kaldırın ya da hesabı düzeltin.', true);
    const btn = $('#save-all');
    btn.disabled = true; $('#save-msg').textContent = 'Kaydediliyor…';
    try {
      // Raporları küçük gruplar halinde gönder (istek boyutu sınırı için)
      for (let i = 0; i < ads.length; i += 4) {
        const chunk = ads.slice(i, i + 4).map((p) => ({
          id: dsId(p), platform: p.platform, account: p.account, month: p.month, range: p.range, fileName: p.fileName,
          level: p.level, rows: p.rows, breakdowns: p.breakdowns || null, warnings: p.warnings || [],
        }));
        await api('datasets', { method: 'POST', body: { datasets: chunk } });
      }
      if (cats.length) {
        const c = cats[cats.length - 1];
        await api('category', { method: 'PUT', body: { fileName: c.fileName, mapping: c.mapping, quarters: c.quarters, year: c.year } });
      }
      PENDING = [];
      await loadData();
      toast(`${ads.length} rapor${cats.length ? ' ve kategori dosyası' : ''} kaydedildi`);
      const newest = ads.map((a) => a.month).sort().pop();
      if (newest) { UI.gran = 'month'; UI.period = newest; }
      UI.tab = 'overview';
      render();
    } catch (e) {
      toast('Kaydedilemedi: ' + e.message, true);
      btn.disabled = false; $('#save-msg').textContent = '';
    }
  }

  // ---------- Veri yönetimi ----------
  const inputState = { gran: 'quarter', period: '' };
  function renderManage() {
    const el = $('#view-manage');
    if (!inputState.period) inputState.period = UI.period || '';
    const byMonth = {};
    DATA.datasets.forEach((d) => (byMonth[d.month] = byMonth[d.month] || []).push(d));
    const cat = DATA.category;
    const savedInputs = Object.keys(DATA.inputs || {}).sort().reverse();

    el.innerHTML = `
      <div class="card" style="margin-bottom:16px"><h3>Elle giriş · lead, açılan hesap, ajans gideri</h3>
        <p class="sub">Kategori başına maliyet hesabında kullanılır. Ay ya da çeyrek bazında girilebilir. Çeyrek görünümünde önce çeyreğe girilen değer, yoksa ayların toplamı, o da yoksa Kategori dosyasındaki değer kullanılır.</p>
        <div class="toolbar">
          <div class="seg" id="inp-gran"><button data-g="month" class="${inputState.gran === 'month' ? 'active' : ''}">Ay</button><button data-g="quarter" class="${inputState.gran === 'quarter' ? 'active' : ''}">Çeyrek</button></div>
          ${inputState.gran === 'month' ? `<input type="month" id="inp-period" value="${C.isQuarter(inputState.period) ? '' : esc(inputState.period)}">`
            : `<select id="inp-year">${yearOptions()}</select><select id="inp-q">${[1, 2, 3, 4].map((q) => `<option value="${q}" ${inputState.period.endsWith('Q' + q) ? 'selected' : ''}>Ç${q}</option>`).join('')}</select>`}
          <span class="small muted" id="inp-src"></span>
        </div>
        <div class="form-grid" id="inp-form"></div>
        <div class="toolbar" style="margin-top:12px"><button class="btn primary" id="inp-save">Kaydet</button><button class="btn danger" id="inp-del">Bu dönemin girişini sil</button></div>
        ${savedInputs.length ? `<p class="small muted">Kayıtlı girişler: ${savedInputs.map((k) => `<a href="#" data-edit="${k}">${esc(C.periodLabel(k))}</a>`).join(' · ')}</p>` : ''}
      </div>

      <div class="card" style="margin-bottom:16px"><div class="card-head"><div><h3>Kategori Başına Maliyet dosyası</h3>
        <p class="sub">${cat ? `${esc(cat.fileName || '')} · ${Object.keys(cat.mapping || {}).length} kampanya eşlemesi · çeyrekler: ${Object.keys(cat.quarters || {}).sort().map((q) => esc(C.periodLabel(q))).join(', ') || '—'} · yüklenme: ${cat.uploadedAt ? new Date(cat.uploadedAt).toLocaleString('tr-TR') : '—'}` : 'Yüklenmemiş. Kampanyalar FP/Hisse/Türev-FX-TV/Genel kırılımına bu dosyayla eşlenir.'}</p></div>
        ${cat ? '<button class="btn small danger" id="cat-del">Sil</button>' : '<button class="btn small" data-go="upload">Yükle</button>'}</div></div>

      <div class="card"><h3>Yüklenen raporlar (${DATA.datasets.length})</h3><p class="sub">Her satır bir platform + hesap + ay. Aynısı yeniden yüklenirse değiştirilir.</p>
        ${DATA.datasets.length ? `<div class="table-wrap" style="max-height:none"><table class="data"><thead><tr><th>Ay</th><th>Platform</th><th>Hesap</th><th>Dosya</th><th class="num">Satır</th><th class="num">Harcama</th><th>Yüklenme</th><th></th></tr></thead><tbody>
        ${Object.keys(byMonth).sort().reverse().map((m) => byMonth[m].map((d) => `<tr><td>${esc(P.monthLabel(d.month))}</td><td><span class="dot" style="background:${pc(d.platform)}"></span>${esc(d.platform)}</td><td>${esc(d.account)}</td>
          <td class="name small">${esc(d.fileName || '')}</td><td class="num">${d.rows.length}</td><td class="num">${fTL(C.sum(d.rows, 'spend'))}</td>
          <td class="small muted">${d.uploadedAt ? new Date(d.uploadedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td>
          <td><button class="btn small danger" data-del="${esc(d.id)}">Sil</button></td></tr>`).join('')).join('')}
        </tbody></table></div>` : '<p class="muted">Henüz rapor yok.</p>'}</div>`;

    $$('#inp-gran button').forEach((b) => (b.onclick = () => { inputState.gran = b.dataset.g; inputState.period = ''; renderManage(); }));
    const setP = () => {
      if (inputState.gran === 'month') inputState.period = $('#inp-period').value;
      else inputState.period = `${$('#inp-year').value}-Q${$('#inp-q').value}`;
      drawInputForm();
    };
    if (inputState.gran === 'month') $('#inp-period').onchange = setP; else { $('#inp-year').onchange = setP; $('#inp-q').onchange = setP; }
    if (inputState.gran === 'quarter' && !C.isQuarter(inputState.period)) setP();
    else if (inputState.gran === 'month' && C.isQuarter(inputState.period)) { inputState.period = ''; drawInputForm(); }
    else drawInputForm();
    $('#inp-save').onclick = saveInputs;
    $('#inp-del').onclick = async () => {
      if (!inputState.period || !DATA.inputs[inputState.period]) return toast('Bu dönem için kayıtlı giriş yok', true);
      await api('inputs', { method: 'PUT', body: { period: inputState.period, values: null } });
      await loadData(); toast('Silindi'); renderManage();
    };
    $$('[data-edit]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); const k = a.dataset.edit; inputState.gran = C.isQuarter(k) ? 'quarter' : 'month'; inputState.period = k; renderManage(); }));
    $$('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Bu rapor silinsin mi?')) return;
      try { await api('datasets/' + encodeURIComponent(b.dataset.del), { method: 'DELETE' }); await loadData(); toast('Rapor silindi'); render(); } catch (e) { toast(e.message, true); }
    }));
    const cd = $('#cat-del');
    if (cd) cd.onclick = async () => {
      if (!confirm('Kategori dosyası ve eşleme silinsin mi?')) return;
      await api('category', { method: 'DELETE' }); await loadData(); toast('Kategori dosyası silindi'); render();
    };
  }
  function yearOptions() {
    const y = new Date().getFullYear();
    const cur = C.isQuarter(inputState.period) ? +inputState.period.slice(0, 4) : y;
    const ys = [];
    for (let i = y + 1; i >= y - 4; i--) ys.push(i);
    return ys.map((v) => `<option ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
  }
  const INPUT_SEGS = [['FP', 'FP'], ['Hisse', 'Hisse'], ['Türev-FX-TV', 'Türev-FX-TV'], ['Atanmamış', 'Segment atanmamış']];
  function drawInputForm() {
    const f = $('#inp-form');
    const p = inputState.period;
    if (!p) { f.innerHTML = '<p class="muted">Dönem seçin.</p>'; $('#inp-src').textContent = ''; return; }
    const v = (DATA.inputs || {})[p];
    const fallback = v ? null : C.inputsFor(DATA, p);
    const src = v ? 'Kayıtlı elle giriş' : fallback && fallback.source ? `Kayıt yok · öneri: ${fallback.source}` : 'Kayıt yok';
    $('#inp-src').textContent = `${C.periodLabel(p)} · ${src}`;
    const base = v || fallback || { leads: {}, accounts: {}, agency: null };
    const val = (t, s) => (base[t] && base[t][s] != null ? base[t][s] : '');
    f.innerHTML = `<div></div>${INPUT_SEGS.map(([, l]) => `<div class="h">${l}</div>`).join('')}
      <div class="h">Gelen lead</div>${INPUT_SEGS.map(([s]) => `<input type="number" min="0" step="1" data-t="leads" data-s="${s}" value="${val('leads', s)}">`).join('')}
      <div class="h">Açılan hesap</div>${INPUT_SEGS.map(([s]) => `<input type="number" min="0" step="1" data-t="accounts" data-s="${s}" value="${val('accounts', s)}">`).join('')}
      <div class="h">Ajans gideri (TL)</div><input type="number" min="0" step="0.01" id="inp-agency" value="${base.agency != null ? base.agency : ''}"><div class="small muted" style="grid-column: span 3">Dijital pazarlama ajans giderleri, dönemin toplamı</div>`;
  }
  async function saveInputs() {
    const p = inputState.period;
    if (!p) return toast('Dönem seçin', true);
    const values = { leads: {}, accounts: {}, agency: null };
    $$('#inp-form input[data-t]').forEach((i) => { if (i.value !== '') values[i.dataset.t][i.dataset.s] = +i.value; });
    const a = $('#inp-agency').value;
    values.agency = a === '' ? null : +a;
    try {
      await api('inputs', { method: 'PUT', body: { period: p, values } });
      await loadData();
      toast(`${C.periodLabel(p)} kaydedildi`);
      renderManage();
    } catch (e) { toast(e.message, true); }
  }

  // ---------- olaylar ----------
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) {
      e.preventDefault();
      if (go.dataset.inputPeriod) { inputState.period = go.dataset.inputPeriod; inputState.gran = C.isQuarter(go.dataset.inputPeriod) ? 'quarter' : 'month'; }
      UI.tab = go.dataset.go; render(); window.scrollTo(0, 0);
    }
  });
  $$('.tab').forEach((t) => (t.onclick = () => { UI.tab = t.dataset.tab; render(); }));
  $$('.filters .seg button').forEach((b) => (b.onclick = () => {
    if (UI.gran === b.dataset.gran) return;
    // dönemi koru: ay → içinde bulunduğu çeyrek, çeyrek → içindeki en son veri ayı
    const prev = UI.period;
    UI.gran = b.dataset.gran;
    if (UI.gran === 'quarter' && prev && !C.isQuarter(prev)) UI.period = P.quarterOf(prev);
    else if (UI.gran === 'month' && C.isQuarter(prev)) UI.period = periodsForGran().find((m) => P.quarterOf(m) === prev) || '';
    render();
  }));
  $('#f-period').onchange = (e) => { UI.period = e.target.value; render(); };
  $('#f-platform').onchange = (e) => { UI.platform = e.target.value; render(); };
  $('#f-account').onchange = (e) => { UI.account = e.target.value; render(); };
  $('#f-segment').onchange = (e) => { UI.segment = e.target.value; render(); };

  // ---------- başlat ----------
  (async function init() {
    await ensureAuth();
    try { await loadData(); } catch (e) { toast('Veri alınamadı: ' + e.message, true); }
    if (!DATA.datasets.length && !DATA.category) UI.tab = 'upload';
    render();
  })();
})();
