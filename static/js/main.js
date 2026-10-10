// Static menu + swappable center content + right panel widgets.
const PAGE_ORDER = ['o-nas', 'jednotka', 'akce', 'napsali', 'kontakty', 'informace', 'sponzori'];
const TITLES = {
  'o-nas': 'O nás',
  'jednotka': 'Jednotka',
  'akce': 'Akce sboru',
  'napsali': 'Napsali o nás',
  'kontakty': 'Kontakty',
  'informace': 'Informace pro občany',
  'sponzori': 'Sponzoři',
};

function currentPageFromURL() {
  const hash = (window.location.hash || '').replace(/^#\/?/, '').split('?')[0];
  if (PAGE_ORDER.includes(hash)) return hash;
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  if (PAGE_ORDER.includes(path)) return path;
  const initial = document.body.dataset.activePage;
  if (PAGE_ORDER.includes(initial)) return initial;
  return 'o-nas';
}

function showPage(slug, push = true) {
  if (!PAGE_ORDER.includes(slug)) slug = 'o-nas';
  const tpl = document.getElementById('tpl-' + slug);
  const mount = document.getElementById('page-content');
  if (tpl && mount) {
    mount.innerHTML = '';
    mount.appendChild(tpl.content.cloneNode(true));
  }
  document.querySelectorAll('#main-menu .is-nav').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.page === slug);
  });
  document.title = `SDH Litvínovice – ${TITLES[slug]}`;
  if (push) history.replaceState(null, '', '#/' + slug);
}

/* ---------------- Calendar (Litvínovice events) ---------------- */
let calCursor = new Date();
let calEvents = [];
calCursor.setDate(1);

async function initCalendar() {
  const el = document.getElementById('calendar-widget');
  if (!el) return;
  try {
    const res = await fetch('/api/events');
    const json = await res.json();
    calEvents = (json.events || []).map((e) => ({ ...e, d: e.date }));
  } catch {
    calEvents = [];
  }
  renderCalendar();
}

function renderCalendar() {
  const el = document.getElementById('calendar-widget');
  if (!el) return;
  const y = calCursor.getFullYear();
  const m = calCursor.getMonth();
  const monthName = calCursor.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' });
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7; // Mon=0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const byDay = {};
  calEvents.forEach((e) => {
    const [ey, em, ed] = e.date.split('-').map(Number);
    if (ey === y && em - 1 === m) {
      (byDay[ed] = byDay[ed] || []).push(e);
    }
  });
  const today = new Date();
  const isThisMonth = today.getFullYear() === y && today.getMonth() === m;

  let cells = '';
  ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].forEach((d) => { cells += `<span class="cal-dow">${d}</span>`; });
  for (let i = 0; i < firstDow; i++) cells += '<span class="cal-day cal-empty"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const has = !!byDay[d];
    const isToday = isThisMonth && today.getDate() === d;
    cells += `<button type="button" class="cal-day${has ? ' has-event' : ''}${isToday ? ' is-today' : ''}" data-day="${d}" ${has ? '' : 'disabled'}>${d}${has ? '<i></i>' : ''}</button>`;
  }

  // Upcoming events (next 3, incl. today)
  const todayStr = toISODate(today);
  const upcoming = calEvents.filter((e) => e.date >= todayStr).slice(0, 3);

  el.innerHTML = `
    <div class="cal-head">
      <button type="button" class="cal-nav" data-nav="-1" aria-label="Předchozí měsíc">‹</button>
      <strong class="cal-month">${monthName}</strong>
      <button type="button" class="cal-nav" data-nav="1" aria-label="Další měsíc">›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-upcoming">
      ${upcoming.length ? upcoming.map((e) => `
        <div class="cal-event"><span class="cal-date">${formatCZDate(e.date)}</span><span>${escapeHtml(e.title)}${e.place ? ` <small>· ${escapeHtml(e.place)}</small>` : ''}</span></div>
      `).join('') : '<p class="muted">Zatím žádné nadcházející akce.</p>'}
    </div>`;

  el.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    calCursor.setMonth(calCursor.getMonth() + Number(b.dataset.nav));
    renderCalendar();
  }));
  el.querySelectorAll('.cal-day[data-day]').forEach((b) => b.addEventListener('click', () => {
    const d = Number(b.dataset.day);
    const key = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const list = calEvents.filter((e) => e.date === key);
    if (list.length) alert(list.map((e) => `${e.date} – ${e.title}${e.place ? ' (' + e.place + ')' : ''}`).join('\n'));
  }));
}

function toISODate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatCZDate(iso) {
  const [yy, mm, dd] = iso.split('-');
  return `${Number(dd)}. ${Number(mm)}. ${yy}`;
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- Weather forecast (Litvínovice) ---------------- */
async function fetchWeather() {
  const el = document.getElementById('weather-widget');
  if (!el) return;
  try {
    const res = await fetch('/api/weather');
    const json = await res.json();
    if (json.status !== 'ok') throw new Error(json.message || 'Weather error');
    const cur = json.current || {};
    const daily = json.daily || {};
    const times = daily.time || [];
    const rows = times.slice(0, 4).map((t, i) => {
      const dt = new Date(t + 'T12:00:00');
      const label = i === 0 ? 'Dnes' : dt.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
      return { label, code: daily.weather_code?.[i], max: daily.temperature_2m_max?.[i], min: daily.temperature_2m_min?.[i], rain: daily.precipitation_probability_max?.[i] };
    });
    el.innerHTML = `
      <div class="wx-now"><span class="wx-temp">${Math.round(cur.temperature_2m ?? 0)}°C</span>
      <span class="wx-desc">${mapWeatherCode(cur.weather_code)} · pocitově ${Math.round(cur.apparent_temperature ?? cur.temperature_2m ?? 0)}°C</span>
      <span class="wx-wind">Vítr ${Math.round(cur.wind_speed_10m ?? 0)} km/h</span></div>
      <div class="wx-days">${rows.map((r) => `
        <div class="wx-day"><strong>${r.label}</strong><span class="wx-ico">${wxIcon(r.code)}</span>
        <span>${Math.round(r.max ?? 0)}° / ${Math.round(r.min ?? 0)}°</span>
        <small>${r.rain ?? 0}% srážky</small></div>`).join('')}</div>
      <p class="src">Zdroj: Open-Meteo · Litvínovice</p>`;
  } catch (err) {
    el.innerHTML = '<p class="muted">Nelze načíst počasí.</p>';
  }
}

function mapWeatherCode(code) {
  const map = { 0: 'Jasno', 1: 'Převážně jasno', 2: 'Polojasno', 3: 'Oblačno', 45: 'Mlha', 48: 'Mrznoucí mlha', 51: 'Mrholení', 53: 'Mrholení', 55: 'Mrholení', 56: 'Mrznoucí mrholení', 57: 'Mrznoucí mrholení', 61: 'Déšť', 63: 'Déšť', 65: 'Silný déšť', 66: 'Mrznoucí déšť', 67: 'Mrznoucí déšť', 71: 'Sníh', 73: 'Sníh', 75: 'Silný sníh', 77: 'Sněhové krupky', 80: 'Přeháňky', 81: 'Přeháňky', 82: 'Silné přeháňky', 95: 'Bouřky', 96: 'Bouřky s kroupami', 99: 'Bouřky s kroupami' };
  return map[code] ?? '—';
}
function wxIcon(code) {
  if (code === 0) return '☀️';
  if ([1, 2].includes(code)) return '⛅';
  if (code === 3) return '☁️';
  if ([45, 48].includes(code)) return '🌫️';
  if ([51, 53, 55, 56, 57].includes(code)) return '🌦️';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if ([71, 73, 75, 77].includes(code)) return '❄️';
  if (code >= 95) return '⛈️';
  return '☁️';
}

/* ---------------- Hydro (Vltava + Malše) ---------------- */
async function fetchHydro() {
  const el = document.getElementById('hydro-widget');
  if (!el) return;
  try {
    const res = await fetch('/api/hydro');
    const json = await res.json();
    if (json.status !== 'ok' || !json.stations?.length) throw new Error('no data');
    const tendIcon = { rising: '↗ stoupá', falling: '↘ klesá', stable: '→ setrvalý' };
    el.innerHTML = json.stations.map((s) => `
      <div class="hydro">
        <div class="hydro-head"><strong>${escapeHtml(s.river)} – ${escapeHtml(s.name)}</strong>
        <span class="spa spa-${s.spa}">${s.spa === 0 ? 'Normální stav' : s.spa + '. SPA'}</span></div>
        <div class="hydro-vals"><span><b>${s.level_cm ?? '–'}</b> cm</span><span><b>${s.flow_m3s ?? '–'}</b> m³/s</span></div>
        <small class="muted">${tendIcon[s.tendency] || ''}${s.time ? ' · ' + fmtHydroTime(s.time) : ''}</small>
      </div>`).join('') + `<p class="src">Zdroj: <a href="${json.detail_url}" target="_blank" rel="noopener">ČHMÚ – hydro.chmi.cz</a></p>`;
  } catch {
    el.innerHTML = '<p class="muted">Nelze načíst vodní stavy.</p><p class="src"><a href="https://hydro.chmi.cz/hpps/" target="_blank" rel="noopener">Aktuální stavy na hydro.chmi.cz →</a></p>';
  }
}
function fmtHydroTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#main-menu .is-nav').forEach((btn) => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  window.addEventListener('hashchange', () => showPage(currentPageFromURL(), false));
  showPage(currentPageFromURL(), false);
  initCalendar();
  fetchWeather();
  fetchHydro();
});
