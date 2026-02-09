// =============================
// Supabase config (REEMPLAZAR)
// =============================
const SUPABASE_URL = "https://lcheqgajbwjktrddaqon.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_ZLw1lObmfqAcDPFXNC8xng_i52IlEQ2";

// supabase-js UMD expone "supabase"
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// -----------------------------
// Utils
// -----------------------------
const nf = new Intl.NumberFormat('es-ES');
const METRICS = ['views', 'likes', 'comments', 'reposts', 'conversions'];
const METRIC_LABEL = {
  views: 'Views',
  likes: 'Likes',
  comments: 'Comments',
  reposts: 'Reposts',
  conversions: 'Conversions'
};
const PLATFORMS = ['Instagram', 'LinkedIn', 'YouTube', 'TikTok', 'Oktopost'];

const SCORE_WEIGHTS = {
  views: 0.40,
  likes: 0.20,
  comments: 0.15,
  reposts: 0.15,
  conversions: 0.10
};

function clampNonNeg(n) {
  n = Number(n);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function formatDateISO(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return new Intl.DateTimeFormat('es-ES', { year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeUrl(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s);
  if (!hasScheme) s = 'https://' + s.replace(/^\/\//, '');
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (e) {}
  return '';
}

function truncateLabel(s, max = 22) {
  s = String(s ?? '');
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

// -----------------------------
// Aggregation helpers (1 platform por video)
// -----------------------------
function aggregateVideoForPlatform(video, platformFilter = 'all') {
  if (platformFilter !== 'all' && video.platform !== platformFilter) {
    return { views:0, likes:0, comments:0, reposts:0, conversions:0 };
  }
  return {
    views: Number(video.views) || 0,
    likes: Number(video.likes) || 0,
    comments: Number(video.comments) || 0,
    reposts: Number(video.reposts) || 0,
    conversions: video.has_utm ? (Number(video.conversions) || 0) : 0
  };
}

function maximaAgg(videos, platformFilter = 'all') {
  const max = { views: 0, likes: 0, comments: 0, reposts: 0, conversions: 0 };
  for (const v of videos) {
    const a = aggregateVideoForPlatform(v, platformFilter);
    for (const m of METRICS) max[m] = Math.max(max[m], Number(a[m]) || 0);
  }
  return max;
}

function norm(value, max) {
  if (!max || max <= 0) return 0;
  return (value || 0) / max;
}

function computeScoreAgg(agg, max) {
  let score = 0;
  for (const m of METRICS) score += norm(agg[m] || 0, max[m]) * SCORE_WEIGHTS[m];
  return score;
}

// -----------------------------
// State + Elements
// -----------------------------
const state = {
  videos: [],
  metric: 'views',
  rankSort: 'score',
  platformFilter: 'all',
  editingId: null,

  dateFrom: '',
  dateTo: ''
};

const el = {
  pages: {
    dashboard: document.getElementById('dashboard'),
    form: document.getElementById('form'),
  },
  navButtons: Array.from(document.querySelectorAll('nav button')),
  totals: {
    videos: document.getElementById('totalVideos'),
    views: document.getElementById('totalViews'),
    likes: document.getElementById('totalLikes'),
    comments: document.getElementById('totalComments'),
    reposts: document.getElementById('totalReposts'),
    conversions: document.getElementById('totalConversions')
  },
  metricSelect: document.getElementById('metricSelect'),
  platformFilter: document.getElementById('platformFilter'),
  rankPlatformFilter: document.getElementById('rankPlatformFilter'),
  metricByVideoTitle: document.getElementById('metricByVideoTitle'),
  metricOverTimeTitle: document.getElementById('metricOverTimeTitle'),
  rankSort: document.getElementById('rankSort'),
  rankingList: document.getElementById('rankingList'),
  table: document.getElementById('videoTable'),

  dateFrom: document.getElementById('dateFrom'),
  dateTo: document.getElementById('dateTo'),
  clearDatesBtn: document.getElementById('clearDatesBtn'),

  // Form
  form: document.getElementById('videoForm'),
  videoId: document.getElementById('videoId'),
  title: document.getElementById('title'),
  channel: document.getElementById('channel'),
  date: document.getElementById('date'),

  platform: document.getElementById('platform'),
  platformUrl: document.getElementById('platformUrl'),
  views: document.getElementById('views'),
  likes: document.getElementById('likes'),
  comments: document.getElementById('comments'),
  reposts: document.getElementById('reposts'),

  hasUtm: document.getElementById('hasUtm'),
  conversionsRow: document.getElementById('conversionsRow'),
  conversions: document.getElementById('conversions'),

  saveBtn: document.getElementById('saveBtn'),
  cancelEditBtn: document.getElementById('cancelEditBtn'),

  cloudStatus: document.getElementById('cloudStatus')
};

let chartMetric = null;
let chartTime = null;

// -----------------------------
// Cloud (Supabase) CRUD
// -----------------------------
async function cloudLoadAll() {
  setCloudStatus('Cargando…');

  const { data, error } = await sb
    .from('videos')
    .select('*')
    .order('date', { ascending: false });

  if (error) {
    console.error(error);
    setCloudStatus(`Error al cargar: ${error.message || 'revisa consola'}`);
    return false;
  }

  // ✅ ESTE ERA EL BUG: faltaba guardar los datos en state.videos
  state.videos = Array.isArray(data) ? data : [];
  setCloudStatus('OK (cloud sync)');
  return true;
}

async function cloudUpsert(video) {
  setCloudStatus('Guardando…');

  const { error } = await sb
    .from('videos')
    .upsert(video, { onConflict: 'id' });

  if (error) {
    console.error(error);
    setCloudStatus(`Error al guardar: ${error.message || ''}`);
    return false;
  }

  setCloudStatus('OK (cloud sync)');
  return true;
}

async function cloudDelete(id) {
  setCloudStatus('Borrando…');
  const { error } = await sb.from('videos').delete().eq('id', id);
  if (error) {
    console.error(error);
    setCloudStatus(`Error al borrar: ${error.message || ''}`);
    return false;
  }
  setCloudStatus('OK (cloud sync)');
  return true;
}

function setCloudStatus(msg) {
  if (el.cloudStatus) el.cloudStatus.textContent = `Cloud: ${msg}`;
}

// -----------------------------
// Navigation
// -----------------------------
function showPage(pageId) {
  Object.values(el.pages).forEach(p => p.classList.remove('active'));
  el.pages[pageId].classList.add('active');

  el.navButtons.forEach(b => b.classList.remove('active'));
  el.navButtons.find(b => b.dataset.page === pageId)?.classList.add('active');
}

// -----------------------------
// Date filtering
// -----------------------------
function withinDateRange(videoIso) {
  if (!videoIso) return false;
  const from = state.dateFrom || '';
  const to = state.dateTo || '';
  if (!from && !to) return true;
  if (from && videoIso < from) return false;
  if (to && videoIso > to) return false;
  return true;
}

function getFilteredVideos() {
  return state.videos.filter(v => withinDateRange(v.date));
}

function setDateFilters(from, to) {
  state.dateFrom = from || '';
  state.dateTo = to || '';
  if (el.dateFrom) el.dateFrom.value = state.dateFrom;
  if (el.dateTo) el.dateTo.value = state.dateTo;
  render();
}

// -----------------------------
// Platform filters
// -----------------------------
function populatePlatformFilters() {
  const options = [
    { value: 'all', label: 'All platforms' },
    ...PLATFORMS.map(p => ({ value: p, label: p }))
  ];
  const html = options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
  el.platformFilter.innerHTML = html;
  el.rankPlatformFilter.innerHTML = html;
  el.platformFilter.value = state.platformFilter;
  el.rankPlatformFilter.value = state.platformFilter;
}

function setPlatformFilter(value) {
  state.platformFilter = value || 'all';
  if (el.platformFilter.value !== state.platformFilter) el.platformFilter.value = state.platformFilter;
  if (el.rankPlatformFilter.value !== state.platformFilter) el.rankPlatformFilter.value = state.platformFilter;
  render();
}

// -----------------------------
// Form logic
// -----------------------------
function toggleUtmUI() {
  const enabled = el.hasUtm.checked;
  el.conversionsRow.style.display = enabled ? 'block' : 'none';
  if (!enabled) el.conversions.value = '0';
}

function resetForm() {
  state.editingId = null;
  el.form.reset();
  el.videoId.value = '';
  el.conversionsRow.style.display = 'none';
  el.saveBtn.textContent = 'Save';
  el.cancelEditBtn.style.display = 'none';

  el.views.value = '0';
  el.likes.value = '0';
  el.comments.value = '0';
  el.reposts.value = '0';
  el.conversions.value = '0';
}

function startEdit(id) {
  const v = state.videos.find(x => x.id === id);
  if (!v) return;

  state.editingId = id;

  el.videoId.value = v.id;
  el.title.value = v.title || '';
  el.channel.value = v.channel || '';
  el.date.value = v.date || '';

  el.platform.value = v.platform || 'Instagram';
  el.platformUrl.value = v.platform_url || '';

  el.views.value = String(v.views ?? 0);
  el.likes.value = String(v.likes ?? 0);
  el.comments.value = String(v.comments ?? 0);
  el.reposts.value = String(v.reposts ?? 0);

  el.hasUtm.checked = !!v.has_utm;
  el.conversions.value = String(v.conversions ?? 0);
  toggleUtmUI();

  el.saveBtn.textContent = 'Update';
  el.cancelEditBtn.style.display = 'inline-block';
  showPage('form');
}

async function deleteVideo(id) {
  const v = state.videos.find(x => x.id === id);
  if (!v) return;

  const ok = confirm(`¿Borrar el video "${v.title}"?`);
  if (!ok) return;

  const success = await cloudDelete(id);
  if (!success) return;

  const loaded = await cloudLoadAll();
  if (!loaded) return;

  if (state.editingId === id) resetForm();
  render();
}

async function upsertFromForm(e) {
  e.preventDefault();

  // UX: feedback visible y quedarse en Add/Edit
  el.saveBtn.disabled = true;
  const originalBtnText = el.saveBtn.textContent;
  el.saveBtn.textContent = 'Saving…';
  setCloudStatus('Guardando…');

  const payload = {
    id: el.videoId.value || undefined,
    title: (el.title.value || '').trim(),
    channel: (el.channel.value || '').trim(),
    date: el.date.value,

    platform: el.platform.value,
    platform_url: normalizeUrl(el.platformUrl.value),

    views: clampNonNeg(el.views.value),
    likes: clampNonNeg(el.likes.value),
    comments: clampNonNeg(el.comments.value),
    reposts: clampNonNeg(el.reposts.value),

    has_utm: !!el.hasUtm.checked,
    conversions: el.hasUtm.checked ? clampNonNeg(el.conversions.value) : 0
  };

  if (!payload.title) {
    alert('El título es obligatorio.');
    return finish();
  }
  if (!payload.date) {
    alert('La fecha es obligatoria.');
    return finish();
  }

  const success = await cloudUpsert(payload);
  if (!success) return finish();

  const loaded = await cloudLoadAll();
  if (!loaded) return finish();

  // Si el filtro de fechas oculta el video nuevo, limpiamos filtros
  if (getFilteredVideos().length === 0) {
    setDateFilters('', '');
    setCloudStatus('✅ Guardado correctamente (se limpiaron filtros de fecha)');
  } else {
    setCloudStatus('✅ Guardado correctamente');
  }

  // Mantener en el formulario, pero limpiar para cargar otro
  resetForm();

  // Actualizar dashboard aunque no navegues
  render();

  finish();

  function finish() {
    el.saveBtn.disabled = false;
    el.saveBtn.textContent = originalBtnText || 'Save';
  }
}

// -----------------------------
// Rendering
// -----------------------------
function renderTotals() {
  const videos = getFilteredVideos();
  el.totals.videos.textContent = nf.format(videos.length);

  const totals = videos.reduce((acc, v) => {
    const a = aggregateVideoForPlatform(v, 'all');
    acc.views += a.views;
    acc.likes += a.likes;
    acc.comments += a.comments;
    acc.reposts += a.reposts;
    acc.conversions += a.conversions;
    return acc;
  }, { views:0, likes:0, comments:0, reposts:0, conversions:0 });

  el.totals.views.textContent = nf.format(totals.views);
  el.totals.likes.textContent = nf.format(totals.likes);
  el.totals.comments.textContent = nf.format(totals.comments);
  el.totals.reposts.textContent = nf.format(totals.reposts);
  el.totals.conversions.textContent = nf.format(totals.conversions);
}

function renderTable() {
  const videos = getFilteredVideos();

  if (videos.length === 0) {
    el.table.innerHTML = `<tr><td class="empty" colspan="11">No hay videos en el rango seleccionado. Prueba “Clear (All dates)”.</td></tr>`;
    return;
  }

  el.table.innerHTML = videos
    .slice()
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map(v => {
      const a = aggregateVideoForPlatform(v, 'all');

      const platformPill = v.platform_url
        ? `<a class="platform-pill clickable" href="${escapeHtml(v.platform_url)}" target="_blank" rel="noopener">${escapeHtml(v.platform || '—')}</a>`
        : `<span class="platform-pill">${escapeHtml(v.platform || '—')}</span>`;

      return `
        <tr>
          <td class="wrap"><strong>${escapeHtml(v.title)}</strong></td>
          <td class="wrap">${escapeHtml(v.channel || '—')}</td>
          <td>${formatDateISO(v.date)}</td>
          <td class="wrap">${platformPill}</td>
          <td>${nf.format(a.views)}</td>
          <td>${nf.format(a.likes)}</td>
          <td>${nf.format(a.comments)}</td>
          <td>${nf.format(a.reposts)}</td>
          <td>${v.has_utm ? 'UTM' : '—'}</td>
          <td>${nf.format(a.conversions)}</td>
          <td>
            <div class="actions">
              <button class="btn" type="button" data-edit="${v.id}">Edit</button>
              <button class="btn btn-danger" type="button" data-del="${v.id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');
}

function renderRanking() {
  const videos = getFilteredVideos();
  if (videos.length === 0) {
    el.rankingList.innerHTML = `<div class="empty">No hay datos en el rango de fechas seleccionado.</div>`;
    return;
  }

  const max = maximaAgg(videos, state.platformFilter);

  const scored = videos.map(v => {
    const agg = aggregateVideoForPlatform(v, state.platformFilter);
    const score = computeScoreAgg(agg, max);
    return { v, agg, score };
  });

  let ordered;
  if (state.rankSort === 'score') ordered = scored.slice().sort((a, b) => b.score - a.score);
  else {
    const k = state.rankSort;
    ordered = scored.slice().sort((a, b) => (b.agg[k] || 0) - (a.agg[k] || 0));
  }

  const bestScore = ordered[0]?.score || 1;

  el.rankingList.innerHTML = ordered.slice(0, 5).map((r, i) => {
    const v = r.v;
    const agg = r.agg;

    const parts = METRICS.map(m => ({ m, normalized: norm(agg[m] || 0, max[m]), raw: agg[m] || 0 }));
    const scorePct = bestScore ? (r.score / bestScore) * 100 : 0;

    return `
      <div class="rank-item">
        <div class="rank-num">${i + 1}</div>
        <div>
          <div class="rank-title">
            <strong>${escapeHtml(v.title)}</strong>
            <span class="rank-sub">${escapeHtml(v.channel || '—')} · ${formatDateISO(v.date)} · ${state.platformFilter === 'all' ? 'All platforms' : escapeHtml(state.platformFilter)}</span>
          </div>
          <div class="rank-bar"><div style="width:${scorePct.toFixed(1)}%"></div></div>
          <div class="rank-breakdown">
            ${parts.map(p => `
              <div class="chip" title="Normalizado: ${(p.normalized*100).toFixed(0)}% · Peso: ${(SCORE_WEIGHTS[p.m]*100).toFixed(0)}%">
                <div class="label">${METRIC_LABEL[p.m]}</div>
                <div class="value">${nf.format(p.raw)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-weight:900;">${(r.score * 100).toFixed(1)}</div>
          <div class="muted" style="font-size:11px; font-weight:800;">score</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderCharts() {
  const videos = getFilteredVideos();
  const metric = state.metric;
  const label = METRIC_LABEL[metric] || 'Metric';
  const pfLabel = state.platformFilter === 'all' ? 'All platforms' : state.platformFilter;

  el.metricByVideoTitle.textContent = `${label} by Video · ${pfLabel}`;
  el.metricOverTimeTitle.textContent = `${label} over Time · ${pfLabel}`;

  const videoLabelsFull = videos.map(v => v.title || '—');
  const videoLabels = videoLabelsFull.map(t => truncateLabel(t, 24));
  const videoData = videos.map(v => (aggregateVideoForPlatform(v, state.platformFilter)[metric] || 0));

  if (chartMetric) chartMetric.destroy();
  chartMetric = new Chart(document.getElementById('metricChart'), {
    type: 'bar',
    data: {
      labels: videoLabels.length ? videoLabels : ['—'],
      datasets: [{ data: videoLabels.length ? videoData : [0], backgroundColor: '#ff355e', borderRadius: 8 }]
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items?.[0]?.dataIndex ?? 0;
              return videoLabelsFull[idx] || '—';
            },
            label: (ctx) => `${label}: ${nf.format(ctx.parsed.x)}`
          }
        }
      },
      scales: { y: { ticks: { autoSkip: false } }, x: { ticks: { precision: 0 } } }
    }
  });

  const byDate = new Map();
  for (const v of videos) {
    const d = v.date || '—';
    const a = aggregateVideoForPlatform(v, state.platformFilter);
    byDate.set(d, (byDate.get(d) || 0) + (Number(a[metric]) || 0));
  }

  const dates = Array.from(byDate.keys()).filter(d => d !== '—').sort((a, b) => a.localeCompare(b));
  const timeLabels = dates.length ? dates.map(formatDateISO) : ['—'];
  const timeData = dates.length ? dates.map(d => byDate.get(d) || 0) : [0];

  if (chartTime) chartTime.destroy();
  chartTime = new Chart(document.getElementById('metricTimeChart'), {
    type: 'line',
    data: {
      labels: timeLabels,
      datasets: [{
        data: timeData,
        borderColor: '#ff355e',
        backgroundColor: 'rgba(255,53,94,0.2)',
        fill: true,
        tension: 0.3,
        pointRadius: 3
      }]
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });
}

function render() {
  renderTotals();
  renderRanking();
  renderTable();
  renderCharts();
}

// -----------------------------
// Init
// -----------------------------
async function init() {
  el.navButtons.forEach(btn => btn.addEventListener('click', () => showPage(btn.dataset.page)));

  el.metricSelect.addEventListener('change', () => { state.metric = el.metricSelect.value; render(); });
  el.platformFilter.addEventListener('change', () => setPlatformFilter(el.platformFilter.value));
  el.rankPlatformFilter.addEventListener('change', () => setPlatformFilter(el.rankPlatformFilter.value));
  el.rankSort.addEventListener('change', () => { state.rankSort = el.rankSort.value; renderRanking(); });

  el.hasUtm.addEventListener('change', toggleUtmUI);

  el.form.addEventListener('submit', upsertFromForm);

  el.cancelEditBtn.addEventListener('click', () => { resetForm(); showPage('dashboard'); });

  el.table.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit]');
    if (editBtn) startEdit(editBtn.dataset.edit);

    const delBtn = e.target.closest('[data-del]');
    if (delBtn) deleteVideo(delBtn.dataset.del);
  });

  el.dateFrom.addEventListener('change', () => setDateFilters(el.dateFrom.value, el.dateTo.value));
  el.dateTo.addEventListener('change', () => setDateFilters(el.dateFrom.value, el.dateTo.value));
  el.clearDatesBtn.addEventListener('click', () => setDateFilters('', ''));

  state.metric = el.metricSelect.value;
  state.rankSort = el.rankSort.value;
  populatePlatformFilters();
  setPlatformFilter('all');

  resetForm();

  await cloudLoadAll();
  render();
}

init();
