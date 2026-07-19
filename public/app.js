const DEFAULT_REFRESH_MS = 5000;
const DETAIL_REFRESH_MS = 5000;

const appEl = document.getElementById('app');
const state = {
  stocks: [],
  stockDetail: null,
  search: '',
  refreshMs: DEFAULT_REFRESH_MS,
  nextRefreshAt: Date.now() + DEFAULT_REFRESH_MS,
  loading: true,
  isRefreshing: false,
  error: '',
  routeCode: getRouteCode()
};

function getRouteCode() {
  return new URL(location.href).searchParams.get('stock');
}

function isFileMode() {
  return location.protocol === 'file:';
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatMoney(value) {
  if (value == null || Number.isNaN(Number(value))) return '--';
  const numeric = Number(value);
  if (Math.abs(numeric) >= 1e8) return `${(numeric / 1e8).toFixed(2)}亿`;
  if (Math.abs(numeric) >= 1e4) return `${(numeric / 1e4).toFixed(2)}万`;
  return numeric.toFixed(2);
}

function formatPrice(value) {
  if (value == null || Number.isNaN(Number(value))) return '--';
  return `¥${Number(value).toFixed(2)}`;
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '--';
  return `${Number(value).toFixed(2)}%`;
}

function formatPe(value) {
  if (value == null || Number.isNaN(Number(value))) return '--';
  return Number(value).toFixed(2);
}

function formatTime(value) {
  if (!value) return '--';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

function formatAxisDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatRangeValue(key, value) {
  if (key === 'grossMargin') return formatPercent(value);
  if (key === 'pe') return formatPe(value);
  if (key === 'price') return formatPrice(value);
  return formatMoney(value);
}

function buildDerivedSeries(points, transform) {
  return (points || [])
    .map((point) => {
      const value = transform(Number(point?.value));
      if (!point?.date || value == null || Number.isNaN(value)) return null;
      return { date: point.date, value };
    })
    .filter(Boolean);
}

function normalizePoints(points, width, height, padding) {
  const valid = points.filter((point) => point && point.value != null && !Number.isNaN(Number(point.value)));
  if (!valid.length) return [];
  const values = valid.map((point) => Number(point.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  return valid.map((point, index) => {
    const ratio = valid.length === 1 ? 0.5 : index / (valid.length - 1);
    return {
      ...point,
      value: Number(point.value),
      x: padding + plotWidth * ratio,
      y: padding + plotHeight - ((Number(point.value) - min) / range) * plotHeight
    };
  });
}

function pointsToPath(points) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function pointsToArea(points, height, padding) {
  if (!points.length) return '';
  const baseline = height - padding;
  const first = points[0];
  const last = points[points.length - 1];
  const middle = points.slice(1).map((point) => `L ${point.x} ${point.y}`).join(' ');
  return `M ${first.x} ${baseline} L ${first.x} ${first.y} ${middle} L ${last.x} ${baseline} Z`;
}

function renderChart(points, key, axisLabel) {
  const width = 320;
  const height = 150;
  const padding = 18;
  const normalized = normalizePoints(points, width, height, padding);
  if (!normalized.length) {
    return '<div class="empty-chart">暂无历史数据</div>';
  }
  const values = normalized.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const tickIndexes = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => Math.round((normalized.length - 1) * fraction))
    .filter((index, position, array) => array.indexOf(index) === position);

  return `
    <svg class="metric-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(key)} 历史走势图">
      <defs>
        <linearGradient id="gradient-${key}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#2f6fed" stop-opacity="0.28"></stop>
          <stop offset="100%" stop-color="#2f6fed" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <path class="metric-chart__area" d="${pointsToArea(normalized, height, padding)}" fill="url(#gradient-${key})"></path>
      <path class="metric-chart__line" d="${pointsToPath(normalized)}" fill="none"></path>
      ${tickIndexes
        .map((index) => `<circle class="metric-chart__dot" cx="${normalized[index].x}" cy="${normalized[index].y}" r="3.5"></circle>`)
        .join('')}
      <line class="metric-chart__baseline" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
    </svg>
    <div class="metric-chart__axis">
      ${tickIndexes.map((index) => `<span>${formatAxisDate(normalized[index].date)}</span>`).join('')}
    </div>
    <div class="metric-chart__range">${axisLabel} · 区间：${formatRangeValue(key, min)} - ${formatRangeValue(key, max)}</div>
  `;
}

function filteredStocks() {
  const query = state.search.trim().toLowerCase();
  const sorted = [...state.stocks].sort((left, right) => String(left.code).localeCompare(String(right.code), 'zh-CN'));
  if (!query) return sorted;
  return sorted.filter((stock) => `${stock.code} ${stock.name}`.toLowerCase().includes(query));
}

function renderHome() {
  const rows = filteredStocks();
  return `
    <section class="card list-card">
      <div class="list-top">
        <div class="card-head">
          <div>
            <p class="eyebrow">平安银行 · 在线行情</p>
            <h2>股票列表</h2>
            <p class="subtle">仅展示平安银行，在线数据每 5 秒自动刷新。输入 000001 后按回车可直达详情页。</p>
          </div>
          <div class="status">
            <span class="badge">在线接口</span>
            <span class="badge ghost" id="timerBadge">下次刷新：${secondsLeft()}s</span>
          </div>
        </div>
        <label class="search-field">
          <span>搜索</span>
          <input id="searchInput" type="search" value="${escapeHtml(state.search)}" placeholder="输入 000001 后按回车跳转" />
        </label>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>代码</th>
              <th>成交价</th>
              <th>市值</th>
              <th>毛利率</th>
              <th>市盈率</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody id="tableBody">${renderRows(rows)}</tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRows(rows) {
  if (!rows.length) {
    return '<tr><td colspan="7">暂无匹配结果</td></tr>';
  }
  return rows
    .map(
      (stock) => `
        <tr class="stock-row" data-code="${stock.code}" tabindex="0">
          <td>${escapeHtml(stock.name)}</td>
          <td>${escapeHtml(stock.code)}</td>
          <td>${formatPrice(stock.latestPrice)}</td>
          <td>${formatMoney(stock.marketValue)}</td>
          <td>${formatPercent(stock.grossMargin)}</td>
          <td>${formatPe(stock.pe)}</td>
          <td>${formatTime(stock.updatedAt)}</td>
        </tr>
      `
    )
    .join('');
}

function renderMetricCard(title, currentValue, note, points, key, axisLabel) {
  return `
    <article class="card metric-card">
      <div class="metric-card__head">
        <div>
          <p class="metric-label">${title}</p>
          <h2>${currentValue}</h2>
        </div>
        <span class="metric-pill">现在数据</span>
      </div>
      <p class="subtle">${note}</p>
      ${renderChart(points, key, axisLabel)}
    </article>
  `;
}

function renderDetail() {
  const stock = state.stockDetail;
  if (!stock) return '';
  const shareCountEstimate = Number(stock.shareCountEstimate);
  const marketValueHistory =
    stock.marketValueHistory && stock.marketValueHistory.length
      ? stock.marketValueHistory
      : buildDerivedSeries(stock.priceHistory, (price) => {
          if (!Number.isFinite(price) || !Number.isFinite(shareCountEstimate)) return null;
          return price * shareCountEstimate;
        });
  const peHistory =
    stock.peHistory && stock.peHistory.length
      ? stock.peHistory
      : buildDerivedSeries(stock.priceHistory, (price) => {
          if (!Number.isFinite(price) || !Number.isFinite(Number(stock.latestPrice)) || !Number.isFinite(Number(stock.pe)) || Number(stock.latestPrice) <= 0) {
            return null;
          }
          return (price / Number(stock.latestPrice)) * Number(stock.pe);
        });
  return `
    <section class="detail-hero">
      <button class="back-link" id="backButton" type="button">← 返回列表</button>
      <div class="detail-title">
        <p class="eyebrow">平安银行 · 在线详情</p>
        <h1>${escapeHtml(stock.name)}</h1>
        <p class="subtle">${escapeHtml(stock.code)} · 更新时间 ${formatTime(stock.updatedAt)}</p>
      </div>
    </section>

    <section class="detail-grid">
      ${renderMetricCard('成交价', formatPrice(stock.latestPrice), '近五年复权日线收盘价走势', stock.priceHistory || [], 'price', '横轴：交易日期')}
      ${renderMetricCard('市值', formatMoney(stock.marketValue), '按近五年收盘价和当前总股本推算', marketValueHistory, 'marketValue', '横轴：交易日期')}
      ${renderMetricCard('毛利率', formatPercent(stock.grossMargin), '按财报披露更新，不会每 5 秒变化', stock.grossMarginHistory || [], 'grossMargin', '横轴：财报日期')}
      ${renderMetricCard('市盈率', formatPe(stock.pe), '按近五年收盘价与当前动态市盈率估算', peHistory, 'pe', '横轴：交易日期')}
    </section>
  `;
}

function renderLoading(message) {
  return `
    <section class="card notice-card">
      <h2>加载中</h2>
      <p class="subtle">${message}</p>
    </section>
  `;
}

function renderError(message) {
  return `
    <section class="card notice-card">
      <h2>暂时无法读取在线数据</h2>
      <p class="subtle">${escapeHtml(message)}</p>
    </section>
  `;
}

function renderFileModeNotice() {
  return `
    <section class="card notice-card">
      <h2>请通过本地服务打开</h2>
      <p class="subtle">当前是 <code>file://</code> 方式，在线接口无法正常读取。请运行 <code>python3 server.py</code>，本机打开 <code>http://127.0.0.1:8000</code>；其他设备请打开终端里显示的局域网地址，例如 <code>http://192.168.1.10:8000</code>。</p>
    </section>
  `;
}

function renderApp() {
  document.title = state.routeCode ? `股票详情 - ${state.routeCode}` : '股票列表';
  if (isFileMode()) {
    appEl.innerHTML = renderFileModeNotice();
    return;
  }
  if (state.error) {
    appEl.innerHTML = renderError(state.error);
    return;
  }
  if (state.loading) {
    appEl.innerHTML = renderLoading(state.routeCode ? '正在读取个股详情...' : '正在读取全 A 股列表...');
    return;
  }
  appEl.innerHTML = state.routeCode ? renderDetail() : renderHome();
  bindViewEvents();
}

function bindViewEvents() {
  if (state.routeCode) {
    const backButton = document.getElementById('backButton');
    if (backButton) {
      backButton.addEventListener('click', () => {
        history.pushState({}, '', location.pathname);
        state.routeCode = null;
        state.stockDetail = null;
        state.error = '';
        state.loading = true;
        refreshCurrentView();
      });
    }
    return;
  }

  const searchInput = document.getElementById('searchInput');
  const tableBody = document.getElementById('tableBody');
  if (searchInput) {
    searchInput.addEventListener('input', (event) => {
      state.search = event.target.value;
      if (tableBody) {
        tableBody.innerHTML = renderRows(filteredStocks());
      }
    });
    searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const query = state.search.trim();
      if (!query) return;
      const exact = state.stocks.find((stock) => stock.code === query);
      const firstMatched = filteredStocks()[0];
      const target = exact || firstMatched;
      if (target) {
        event.preventDefault();
        openDetail(target.code);
      }
    });
  }
  if (tableBody) {
    tableBody.addEventListener('click', (event) => {
      const row = event.target.closest('.stock-row');
      if (row) openDetail(row.dataset.code);
    });
    tableBody.addEventListener('keydown', (event) => {
      const row = event.target.closest('.stock-row');
      if (!row) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetail(row.dataset.code);
      }
    });
  }
}

function openDetail(code) {
  history.pushState({}, '', `${location.pathname}?stock=${encodeURIComponent(code)}`);
  state.routeCode = code;
  state.stockDetail = null;
  state.error = '';
  state.loading = true;
  refreshCurrentView();
}

function secondsLeft() {
  return Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload?.detail) detail = payload.detail;
    } catch {}
    throw new Error(detail);
  }
  return response.json();
}

async function refreshMarket() {
  const payload = await fetchJson('/api/market');
  state.stocks = payload.stocks || [];
  state.refreshMs = (payload.refreshIntervalSeconds || 5) * 1000;
  state.nextRefreshAt = Date.now() + state.refreshMs;
}

async function refreshStockDetail(code) {
  const payload = await fetchJson(`/api/stock?code=${encodeURIComponent(code)}`);
  state.stockDetail = payload;
  state.refreshMs = (payload.refreshIntervalSeconds || DETAIL_REFRESH_MS / 1000) * 1000;
  state.nextRefreshAt = Date.now() + state.refreshMs;
}

async function refreshCurrentView() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  try {
    state.error = '';
    if (state.routeCode) {
      await refreshStockDetail(state.routeCode);
    } else {
      await refreshMarket();
    }
    state.loading = false;
    renderApp();
  } catch (error) {
    state.loading = false;
    state.error = error instanceof Error ? error.message : '未知错误';
    renderApp();
  } finally {
    state.isRefreshing = false;
  }
}

window.addEventListener('popstate', () => {
  state.routeCode = getRouteCode();
  state.loading = true;
  state.error = '';
  refreshCurrentView();
});

setInterval(() => {
  const timerBadge = document.getElementById('timerBadge');
  if (timerBadge) {
    timerBadge.textContent = `下次刷新：${secondsLeft()}s`;
  }
}, 1000);

setInterval(() => {
  if (isFileMode()) return;
  if (Date.now() < state.nextRefreshAt) return;
  refreshCurrentView();
}, 1000);

renderApp();
if (!isFileMode()) {
  refreshCurrentView();
}
