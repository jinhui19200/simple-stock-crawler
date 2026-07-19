const DEFAULT_REFRESH_MS = 5000;
const SNAPSHOT_URL = './pingan-bank.json';
const TARGET_STOCK_CODE = '000001';

const appEl = document.getElementById('app');
const state = {
  stocks: [],
  stockDetail: null,
  snapshot: null,
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

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function lastGrossMarginDate(snapshot) {
  const points = snapshot?.grossMarginHistory || [];
  return points.length ? points[points.length - 1].date : null;
}

function estimatePe(livePrice, snapshot) {
  const latestPrice = normalizeNumber(snapshot?.latestPrice);
  const latestPe = normalizeNumber(snapshot?.pe);
  if (!latestPrice || !latestPe) return latestPe;
  return (Number(livePrice) / latestPrice) * latestPe;
}

function estimateMarketValue(livePrice, snapshot) {
  const shareCountEstimate = normalizeNumber(snapshot?.shareCountEstimate);
  if (!shareCountEstimate) return normalizeNumber(snapshot?.marketValue);
  return Number(livePrice) * shareCountEstimate;
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
            <p class="subtle">成交价每 5 秒刷新；市值和市盈率按最新成交价动态推算；毛利率展示首版内置财报历史。</p>
          </div>
          <div class="status">
            <span class="badge">纯静态模式</span>
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

function buildDerivedSeries(points, transform) {
  return (points || [])
    .map((point) => {
      const value = transform(Number(point?.value));
      if (!point?.date || value == null || Number.isNaN(value)) return null;
      return { date: point.date, value };
    })
    .filter(Boolean);
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
      ${renderMetricCard('成交价', formatPrice(stock.latestPrice), '实时成交价每 5 秒自动刷新；历史图为近五年收盘价。', stock.priceHistory || [], 'price', '横轴：交易日期')}
      ${renderMetricCard('市值', formatMoney(stock.marketValue), '按最新成交价与当前总股本估算；历史图按收盘价回推。', marketValueHistory, 'marketValue', '横轴：交易日期')}
      ${renderMetricCard('毛利率', formatPercent(stock.grossMargin), '首版使用内置财报历史数据；不会每 5 秒波动。', stock.grossMarginHistory || [], 'grossMargin', '横轴：财报日期')}
      ${renderMetricCard('市盈率', formatPe(stock.pe), '按最新成交价与首版基线市盈率换算；历史图按收盘价回推。', peHistory, 'pe', '横轴：交易日期')}
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
      <h2>请通过网页链接或本地服务打开</h2>
      <p class="subtle">当前是 <code>file://</code> 方式，浏览器通常不会稳定读取同目录静态 JSON。请通过已部署链接访问，或继续使用 <code>http://127.0.0.1:8000</code> 预览。</p>
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
    appEl.innerHTML = renderLoading(state.routeCode ? '正在读取个股详情...' : '正在读取股票列表...');
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
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function ensureSnapshot() {
  if (state.snapshot) return state.snapshot;
  state.snapshot = await fetchJson(SNAPSHOT_URL);
  return state.snapshot;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.remove();
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error('实时行情脚本加载失败'));
    };
    document.head.appendChild(script);
  });
}

async function fetchTencentQuote(code) {
  const marketPrefix = String(code).startsWith('6') ? 'sh' : 'sz';
  const variableName = `v_${marketPrefix}${code}`;
  try {
    delete window[variableName];
  } catch {}

  const separator = `refresh=${Date.now()}`;
  const scriptUrl = `https://qt.gtimg.cn/q=${marketPrefix}${code}&${separator}`;
  await loadScript(scriptUrl);

  const rawQuote = window[variableName];
  if (typeof rawQuote !== 'string' || !rawQuote) {
    throw new Error('行情接口返回格式异常');
  }

  const fields = rawQuote.split('~');
  const latestPrice = normalizeNumber(fields[3]);
  if (latestPrice == null) {
    throw new Error('未读取到最新成交价');
  }

  return {
    code,
    name: fields[1] || '平安银行',
    latestPrice,
    updatedAt: new Date().toISOString()
  };
}

function buildLiveStock(snapshot, quote) {
  const latestPrice = normalizeNumber(quote?.latestPrice) ?? normalizeNumber(snapshot.latestPrice);
  const fallbackUpdatedAt = new Date().toISOString();
  return {
    code: snapshot.code,
    name: quote?.name || snapshot.name,
    latestPrice,
    marketValue: estimateMarketValue(latestPrice, snapshot),
    grossMargin: normalizeNumber(snapshot.grossMargin),
    grossMarginUpdatedAt: snapshot.grossMarginUpdatedAt || lastGrossMarginDate(snapshot),
    pe: estimatePe(latestPrice, snapshot),
    shareCountEstimate: normalizeNumber(snapshot.shareCountEstimate),
    updatedAt: quote?.updatedAt || fallbackUpdatedAt,
    source: '腾讯实时行情 + 首版内置历史数据',
    refreshIntervalSeconds: DEFAULT_REFRESH_MS / 1000,
    priceHistory: snapshot.priceHistory || [],
    grossMarginHistory: snapshot.grossMarginHistory || []
  };
}

async function buildSnapshotBackedStock() {
  const snapshot = await ensureSnapshot();
  try {
    const quote = await fetchTencentQuote(snapshot.code || TARGET_STOCK_CODE);
    return buildLiveStock(snapshot, quote);
  } catch (error) {
    const fallbackStock = buildLiveStock(snapshot, null);
    fallbackStock.updatedAt = new Date().toISOString();
    return fallbackStock;
  }
}

async function refreshMarket() {
  const stock = await buildSnapshotBackedStock();
  state.stocks = [stock];
  state.refreshMs = DEFAULT_REFRESH_MS;
  state.nextRefreshAt = Date.now() + state.refreshMs;
}

async function refreshStockDetail(code) {
  const stock = await buildSnapshotBackedStock();
  if (stock.code !== code) {
    throw new Error('暂未找到该股票');
  }
  state.stockDetail = stock;
  state.refreshMs = DEFAULT_REFRESH_MS;
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
