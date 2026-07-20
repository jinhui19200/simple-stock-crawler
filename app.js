const DEFAULT_REFRESH_MS = 60 * 1000;
const SNAPSHOT_URLS = ['./pingan-bank.json', './data/pingan-bank.json'];
const TARGET_STOCK_CODE = '000001';
const MARKET_TIMEZONE = 'Asia/Shanghai';
const INDUSTRY_INDEX_CODE = '399986';
const INDUSTRY_INDEX_MARKET = 'sz';
const INDUSTRY_HISTORY_LIMIT = 1300;
const SIDEBAR_ITEMS = [
  { page: 'list', label: '股票列表' },
  { page: 'detail', label: '股票详情' },
  { page: 'analysis', label: '分析' }
];

const appEl = document.getElementById('app');
const state = {
  stocks: [],
  stockDetail: null,
  snapshot: null,
  industryPeHistory: null,
  industryPeHistoryFetchedAt: 0,
  showDiscountThreshold: true,
  search: '',
  refreshMs: DEFAULT_REFRESH_MS,
  nextRefreshAt: null,
  loading: true,
  isRefreshing: false,
  error: '',
  route: getRoute()
};

function getRoute() {
  const params = new URL(location.href).searchParams;
  const page = params.get('page');
  const stock = params.get('stock');
  if (page === 'detail') return { page: 'detail', code: stock || TARGET_STOCK_CODE };
  if (page === 'analysis') return { page: 'analysis', code: stock || TARGET_STOCK_CODE };
  if (stock) return { page: 'detail', code: stock };
  return { page: 'list', code: null };
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
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

function formatSignedNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '--';
  const numeric = Number(value);
  const prefix = numeric > 0 ? '+' : numeric < 0 ? '-' : '';
  return `${prefix}${Math.abs(numeric).toFixed(2)}`;
}

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function lastGrossMarginDate(snapshot) {
  const points = snapshot?.grossMarginHistory || [];
  return points.length ? points[points.length - 1].date : null;
}

function estimatePe(latestPrice, snapshot) {
  const basePrice = normalizeNumber(snapshot?.latestPrice);
  const basePe = normalizeNumber(snapshot?.pe);
  if (!basePrice || !basePe) return basePe;
  return (Number(latestPrice) / basePrice) * basePe;
}

function estimateMarketValue(latestPrice, snapshot) {
  const shareCountEstimate = normalizeNumber(snapshot?.shareCountEstimate);
  if (!shareCountEstimate) return normalizeNumber(snapshot?.marketValue);
  return Number(latestPrice) * shareCountEstimate;
}

function normalizePoints(points, width, height, padding, comparePoints = [], thresholdPoints = []) {
  const valid = points.filter((point) => point && point.value != null && !Number.isNaN(Number(point.value)));
  if (!valid.length) return { points: [], min: null, max: null };
  const compareMap = new Map(
    (comparePoints || [])
      .filter((point) => point?.date && point.value != null && !Number.isNaN(Number(point.value)))
      .map((point) => [point.date, Number(point.value)])
  );
  const thresholdMap = new Map(
    (thresholdPoints || [])
      .filter((point) => point?.date && point.value != null && !Number.isNaN(Number(point.value)))
      .map((point) => [point.date, Number(point.value)])
  );
  const values = valid.flatMap((point) => {
    const merged = [Number(point.value)];
    const compareValue = compareMap.get(point.date);
    if (compareValue != null) merged.push(compareValue);
    const thresholdValue = thresholdMap.get(point.date);
    if (thresholdValue != null) merged.push(thresholdValue);
    return merged;
  });
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const normalized = valid.map((point, index) => {
    const ratio = valid.length === 1 ? 0.5 : index / (valid.length - 1);
    const compareValue = compareMap.get(point.date);
    const thresholdValue = thresholdMap.get(point.date);
    const compareY =
      compareValue == null ? null : padding + plotHeight - ((compareValue - min) / range) * plotHeight;
    const thresholdY =
      thresholdValue == null ? null : padding + plotHeight - ((thresholdValue - min) / range) * plotHeight;
    return {
      ...point,
      value: Number(point.value),
      compareValue,
      thresholdValue,
      x: padding + plotWidth * ratio,
      y: padding + plotHeight - ((Number(point.value) - min) / range) * plotHeight,
      compareY,
      thresholdY
    };
  });
  return { points: normalized, min, max };
}

function pointsToPath(points, yKey = 'y') {
  return points
    .filter((point) => point[yKey] != null)
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point[yKey]}`)
    .join(' ');
}

function pointsToConditionalPaths(points, predicate, yKey = 'y') {
  const paths = [];
  let current = [];

  points.forEach((point) => {
    if (predicate(point)) {
      current.push(point);
      return;
    }
    if (current.length > 1) {
      paths.push(pointsToPath(current, yKey));
    }
    current = [];
  });

  if (current.length > 1) {
    paths.push(pointsToPath(current, yKey));
  }

  return paths;
}

function pointsToArea(points, height, padding) {
  if (!points.length) return '';
  const baseline = height - padding;
  const first = points[0];
  const last = points[points.length - 1];
  const middle = points.slice(1).map((point) => `L ${point.x} ${point.y}`).join(' ');
  return `M ${first.x} ${baseline} L ${first.x} ${first.y} ${middle} L ${last.x} ${baseline} Z`;
}

function buildDefaultTooltipHtml(point, label, key) {
  return `
    <div class="chart-tooltip__stack">
      <div class="chart-tooltip__title">${escapeHtml(label)}</div>
      <div class="chart-tooltip__row">${escapeHtml(formatAxisDate(point.date))}</div>
      <div class="chart-tooltip__row">${escapeHtml(formatRangeValue(key, point.value))}</div>
    </div>
  `;
}

function buildPeCompareTooltipHtml(point, compareLabel) {
  if (point.compareValue == null) {
    return `
      <div class="chart-tooltip__stack">
        <div class="chart-tooltip__row">平安银行市盈率：${escapeHtml(formatPe(point.value))}</div>
        <div class="chart-tooltip__row">${escapeHtml(compareLabel)}：--</div>
        <div class="chart-tooltip__row">差值：--</div>
      </div>
    `;
  }
  return `
    <div class="chart-tooltip__stack">
      <div class="chart-tooltip__row">平安银行市盈率：${escapeHtml(formatPe(point.value))}</div>
      <div class="chart-tooltip__row">${escapeHtml(compareLabel)}：${escapeHtml(formatPe(point.compareValue))}</div>
      <div class="chart-tooltip__row">差值：${escapeHtml(formatSignedNumber(point.value - point.compareValue))}</div>
    </div>
  `;
}

function renderChart(points, key, axisLabel, options = {}) {
  const width = options.width || 320;
  const height = options.height || 150;
  const padding = 18;
  const comparePoints = options.comparePoints || [];
  const thresholdPoints = options.thresholdPoints || [];
  const compareLabel = options.compareLabel || '行业市盈率';
  const normalizedResult = normalizePoints(points, width, height, padding, comparePoints, thresholdPoints);
  const normalized = normalizedResult.points;
  if (!normalized.length) {
    return '<div class="empty-chart">暂无历史数据</div>';
  }
  const min = normalizedResult.min;
  const max = normalizedResult.max;
  const tickIndexes = [0, 0.25, 0.5, 0.75, 1]
    .map((fraction) => Math.round((normalized.length - 1) * fraction))
    .filter((index, position, array) => array.indexOf(index) === position);
  const interactive = Boolean(options.interactive);
  const label = options.label || key;
  const hasCompare = normalized.some((point) => point.compareY != null);
  const hasThreshold = normalized.some((point) => point.thresholdY != null);
  const highlightBelowThreshold = Boolean(options.highlightBelowThreshold);
  const alertPaths =
    hasThreshold && highlightBelowThreshold
      ? pointsToConditionalPaths(normalized, (point) => point.thresholdValue != null && point.value < point.thresholdValue)
      : [];
  const tooltip = interactive
    ? '<div class="chart-tooltip" aria-hidden="true"></div>'
    : '';

  return `
    <div class="chart-shell${interactive ? ' is-interactive' : ''}" data-chart-shell="${interactive ? key : ''}">
      ${tooltip}
      <svg class="metric-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)} 历史走势图">
        <defs>
          <linearGradient id="gradient-${key}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#2f6fed" stop-opacity="0.28"></stop>
            <stop offset="100%" stop-color="#2f6fed" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <path class="metric-chart__area" d="${pointsToArea(normalized, height, padding)}" fill="url(#gradient-${key})"></path>
        <path class="metric-chart__line" d="${pointsToPath(normalized)}" fill="none"></path>
        ${alertPaths.map((path) => `<path class="metric-chart__line metric-chart__line--alert" d="${path}" fill="none"></path>`).join('')}
        ${hasCompare ? `<path class="metric-chart__line metric-chart__line--compare" d="${pointsToPath(normalized, 'compareY')}" fill="none"></path>` : ''}
        ${tickIndexes
          .map((index) => `<circle class="metric-chart__dot" cx="${normalized[index].x}" cy="${normalized[index].y}" r="3.5"></circle>`)
          .join('')}
        ${
          interactive
            ? normalized
                .map(
                  (point) => `
                    <circle
                      class="metric-chart__hit"
                      data-tooltip-html="${encodeURIComponent(
                        options.tooltipMode === 'pe-compare'
                          ? buildPeCompareTooltipHtml(point, compareLabel)
                          : buildDefaultTooltipHtml(point, label, key)
                      )}"
                      cx="${point.x}"
                      cy="${point.y}"
                      r="${Math.max(6, Math.min(12, 500 / normalized.length))}"
                      tabindex="0"
                    ></circle>
                    ${
                      point.compareY != null
                        ? `
                          <circle
                            class="metric-chart__hit metric-chart__hit--compare"
                            data-tooltip-html="${encodeURIComponent(
                              options.tooltipMode === 'pe-compare'
                                ? buildPeCompareTooltipHtml(point, compareLabel)
                                : buildDefaultTooltipHtml(point, label, key)
                            )}"
                            cx="${point.x}"
                            cy="${point.compareY}"
                            r="${Math.max(6, Math.min(12, 500 / normalized.length))}"
                            tabindex="0"
                          ></circle>
                        `
                        : ''
                    }
                  `
                )
                .join('')
            : ''
        }
        <line class="metric-chart__baseline" x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}"></line>
      </svg>
    </div>
    ${
      hasCompare
        ? `
          <div class="metric-chart__legend">
            <span class="metric-chart__legend-item"><i class="metric-chart__legend-line"></i>个股市盈率</span>
            <span class="metric-chart__legend-item"><i class="metric-chart__legend-line metric-chart__legend-line--compare"></i>${escapeHtml(compareLabel)}</span>
            ${alertPaths.length ? '<span class="metric-chart__legend-item"><i class="metric-chart__legend-line metric-chart__legend-line--alert"></i>低于行业平均20%</span>' : ''}
          </div>
        `
        : ''
    }
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
  return sorted.filter((stock) => `${stock.code} ${stock.name} ${stock.industry || ''}`.toLowerCase().includes(query));
}

function getSidebarTarget(page) {
  if (page === 'list') return null;
  return state.route.code || state.stockDetail?.code || state.stocks[0]?.code || TARGET_STOCK_CODE;
}

function renderSidebar() {
  return `
    <aside class="sidebar">
      <nav class="sidebar__nav" aria-label="页面导航">
        ${SIDEBAR_ITEMS.map((item) => {
          const targetCode = getSidebarTarget(item.page);
          const isActive = state.route.page === item.page;
          return `
            <button
              class="sidebar__link${isActive ? ' is-active' : ''}"
              type="button"
              data-nav-page="${item.page}"
              data-nav-code="${targetCode || ''}"
            >
              ${item.label}
            </button>
          `;
        }).join('')}
      </nav>
    </aside>
  `;
}

function renderStatusPill(stock) {
  if (!stock) return '';
  return `
    <div class="status">
      <span class="badge">${escapeHtml(stock.source || '数据源未标注')}</span>
      <span class="badge ghost" id="timerBadge">${escapeHtml(getRefreshText(stock))}</span>
    </div>
  `;
}

function getRefreshText(stock) {
  if (!stock) return '等待数据';
  if (!stock.shouldAutoRefresh || !state.nextRefreshAt) {
    return stock.refreshLabel || '当前暂停刷新';
  }
  return `下次刷新：${secondsLeft()}s`;
}

function renderHome() {
  const rows = filteredStocks();
  const stock = state.stocks[0];
  return `
    <section class="page">
      <header class="page__header">
        <div>
          <p class="eyebrow">平安银行 · A股银行板块</p>
          <h2>股票列表</h2>
          <p class="subtle">交易时段按 1 分钟刷新；午间停牌暂停轮询；收市后自动展示最新收盘数据。</p>
        </div>
        ${renderStatusPill(stock)}
      </header>

      <section class="card list-card">
        <div class="list-top">
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
                <th>行业</th>
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
    </section>
  `;
}

function renderRows(rows) {
  if (!rows.length) {
    return '<tr><td colspan="8">暂无匹配结果</td></tr>';
  }
  return rows
    .map(
      (stock) => `
        <tr class="stock-row" data-code="${stock.code}" tabindex="0">
          <td>${escapeHtml(stock.name)}</td>
          <td>${escapeHtml(stock.industry || '--')}</td>
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

function renderMetricCard(title, currentValue, note, points, key, axisLabel, options = {}) {
  return `
    <article class="card metric-card${options.className ? ` ${options.className}` : ''}">
      <div class="metric-card__head">
        <div>
          <p class="metric-label">${title}</p>
          <h2>${currentValue}</h2>
        </div>
        <span class="metric-pill">${escapeHtml(options.pill || '现在数据')}</span>
      </div>
      <p class="subtle">${note}</p>
      ${renderChart(points, key, axisLabel, options.chartOptions)}
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

function resolveDetailSeries(stock) {
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

  return { marketValueHistory, peHistory };
}

function resolveIndustryPeHistory(stock) {
  return (stock.industryPeHistory || [])
    .filter((point) => point?.date && point.value != null && !Number.isNaN(Number(point.value)))
    .map((point) => ({ date: point.date, value: Number(point.value) }));
}

function buildIndustryDiscountThreshold(points, discountRate = 0.2) {
  return (points || [])
    .filter((point) => point?.date && point.value != null && !Number.isNaN(Number(point.value)))
    .map((point) => ({
      date: point.date,
      value: Number(point.value) * (1 - discountRate)
    }));
}

function renderDetail() {
  const stock = state.stockDetail;
  if (!stock) return '';
  const { marketValueHistory, peHistory } = resolveDetailSeries(stock);
  const pill = stock.dataPill || '现在数据';

  return `
    <section class="page">
      <header class="page__header">
        <div>
          <p class="eyebrow">单股详情</p>
          <h2>股票详情</h2>
          <p class="subtle">${escapeHtml(stock.name)} ${escapeHtml(stock.code)} · 更新时间 ${formatTime(stock.updatedAt)}</p>
        </div>
        ${renderStatusPill(stock)}
      </header>

      <section class="detail-hero">
        <button class="back-link" id="backButton" type="button">← 返回列表</button>
        <div class="detail-title">
          <p class="eyebrow">平安银行 · 在线详情</p>
          <h1>${escapeHtml(stock.name)}</h1>
          <p class="subtle">${escapeHtml(stock.code)} · ${escapeHtml(stock.refreshLabel)}</p>
        </div>
      </section>

      <section class="detail-grid">
        ${renderMetricCard('成交价', formatPrice(stock.latestPrice), '交易时段按 1 分钟自动刷新；休市时展示最近收盘价。', stock.priceHistory || [], 'price', '横轴：交易日期', { pill })}
        ${renderMetricCard('市值', formatMoney(stock.marketValue), '按最新成交价与当前总股本估算；历史图按收盘价回推。', marketValueHistory, 'marketValue', '横轴：交易日期', { pill })}
        ${renderMetricCard('毛利率', formatPercent(stock.grossMargin), '毛利率使用内置财报历史数据；仅随财报更新。', stock.grossMarginHistory || [], 'grossMargin', '横轴：财报日期', { pill: '财报数据' })}
        ${renderMetricCard('市盈率', formatPe(stock.pe), '按最新成交价与首版基线市盈率换算；历史图按收盘价回推。', peHistory, 'pe', '横轴：交易日期', { pill })}
      </section>
    </section>
  `;
}

function renderAnalysis() {
  const stock = state.stockDetail;
  if (!stock) return '';
  const { peHistory } = resolveDetailSeries(stock);
  const industryPeHistory = resolveIndustryPeHistory(stock);
  const hasIndustryPeHistory = industryPeHistory.length > 0;
  const industryLabel = `${stock.industry || '银行'}行业市盈率`;
  const discountThresholdHistory = state.showDiscountThreshold ? buildIndustryDiscountThreshold(industryPeHistory, 0.2) : [];
  return `
    <section class="page">
      <header class="page__header">
        <div>
          <p class="eyebrow">估值观察</p>
          <h2>分析</h2>
          <p class="subtle">${escapeHtml(stock.name)} · 市盈率与成交价共用近五年交易日横轴。${hasIndustryPeHistory ? '悬浮时显示行业市盈率和估值差值。' : '行业历史估值线将在接入真实行业数据后显示。'}</p>
        </div>
        ${renderStatusPill(stock)}
      </header>

      <section class="analysis-stack">
        <label class="analysis-toggle">
          <input id="discountThresholdToggle" type="checkbox" ${state.showDiscountThreshold ? 'checked' : ''} />
          <span>标出低于行业平均 20% 的平安银行线段</span>
        </label>
        ${renderMetricCard(
          '市盈率',
          formatPe(stock.pe),
          hasIndustryPeHistory
            ? `蓝线为${escapeHtml(stock.name)}，橙线为${escapeHtml(industryLabel)}；打开开关后，蓝线中低于行业平均 20% 的部分会标成红色。`
            : '当前版本仅显示个股市盈率，行业历史估值线待接入真实数据源。',
          peHistory,
          'pe',
          '横轴：交易日期',
          {
            pill: stock.dataPill || '现在数据',
            className: 'metric-card--wide metric-card--compact',
            chartOptions: {
              interactive: true,
              label: '市盈率',
              width: 760,
              height: 124,
              comparePoints: industryPeHistory,
              thresholdPoints: discountThresholdHistory,
              compareLabel: industryLabel,
              tooltipMode: 'pe-compare',
              highlightBelowThreshold: state.showDiscountThreshold
            }
          }
        )}
        ${renderMetricCard(
          '成交价',
          formatPrice(stock.latestPrice),
          '与上方共用近五年交易日横轴，方便直接对照估值和价格变化。',
          stock.priceHistory || [],
          'price',
          '横轴：交易日期',
          {
            pill: stock.dataPill || '现在数据',
            className: 'metric-card--wide metric-card--compact',
            chartOptions: {
              interactive: true,
              label: '成交价',
              width: 760,
              height: 124
            }
          }
        )}
      </section>
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

function renderShell(content) {
  return `
    <div class="app-layout">
      ${renderSidebar()}
      <main class="content">${content}</main>
    </div>
  `;
}

function renderRouteView() {
  if (state.route.page === 'list') return renderHome();
  if (state.route.page === 'analysis') return renderAnalysis();
  return renderDetail();
}

function renderApp() {
  document.title =
    state.route.page === 'analysis'
      ? `分析 - ${state.route.code || TARGET_STOCK_CODE}`
      : state.route.page === 'detail'
        ? `股票详情 - ${state.route.code || TARGET_STOCK_CODE}`
        : '股票列表';

  if (isFileMode()) {
    appEl.innerHTML = renderFileModeNotice();
    return;
  }
  if (state.error) {
    appEl.innerHTML = renderShell(renderError(state.error));
    return;
  }
  if (state.loading) {
    const message =
      state.route.page === 'analysis'
        ? '正在读取分析数据...'
        : state.route.page === 'detail'
          ? '正在读取个股详情...'
          : '正在读取股票列表...';
    appEl.innerHTML = renderShell(renderLoading(message));
    return;
  }
  appEl.innerHTML = renderShell(renderRouteView());
  bindViewEvents();
}

function bindViewEvents() {
  bindSidebarEvents();
  if (state.route.page === 'detail') {
    bindDetailEvents();
    return;
  }
  if (state.route.page === 'analysis') {
    bindAnalysisEvents();
    return;
  }
  bindHomeEvents();
}

function bindSidebarEvents() {
  appEl.querySelectorAll('[data-nav-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const page = button.dataset.navPage;
      const code = button.dataset.navCode || null;
      navigateTo(page, code, true);
    });
  });
}

function bindDetailEvents() {
  const backButton = document.getElementById('backButton');
  if (backButton) {
    backButton.addEventListener('click', () => {
      navigateTo('list', null, true);
    });
  }
}

function bindAnalysisEvents() {
  const toggle = document.getElementById('discountThresholdToggle');
  if (toggle) {
    toggle.addEventListener('change', (event) => {
      state.showDiscountThreshold = event.target.checked;
      renderApp();
    });
  }

  appEl.querySelectorAll('.chart-shell.is-interactive').forEach((shell) => {
    const tooltip = shell.querySelector('.chart-tooltip');
    if (!tooltip) return;

    const showTooltip = (point) => {
      const shellRect = shell.getBoundingClientRect();
      const pointRect = point.getBoundingClientRect();
      tooltip.innerHTML = point.dataset.tooltipHtml ? decodeURIComponent(point.dataset.tooltipHtml) : '';
      tooltip.style.left = `${pointRect.left - shellRect.left}px`;
      tooltip.style.top = `${pointRect.top - shellRect.top - 12}px`;
      tooltip.classList.add('is-visible');
    };

    const hideTooltip = () => {
      tooltip.classList.remove('is-visible');
    };

    shell.addEventListener('pointermove', (event) => {
      const point = event.target.closest('.metric-chart__hit');
      if (!point) {
        hideTooltip();
        return;
      }
      showTooltip(point);
    });

    shell.addEventListener('pointerleave', hideTooltip);
    shell.addEventListener('focusin', (event) => {
      const point = event.target.closest('.metric-chart__hit');
      if (point) showTooltip(point);
    });
    shell.addEventListener('focusout', hideTooltip);
  });
}

function bindHomeEvents() {
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
        navigateTo('detail', target.code, true);
      }
    });
  }
  if (tableBody) {
    tableBody.addEventListener('click', (event) => {
      const row = event.target.closest('.stock-row');
      if (row) navigateTo('detail', row.dataset.code, true);
    });
    tableBody.addEventListener('keydown', (event) => {
      const row = event.target.closest('.stock-row');
      if (!row) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        navigateTo('detail', row.dataset.code, true);
      }
    });
  }
}

function navigateTo(page, code = null, push = false) {
  const params = new URLSearchParams();
  if (page === 'detail' || page === 'analysis') {
    params.set('page', page);
    params.set('stock', code || TARGET_STOCK_CODE);
  }
  const target = params.toString() ? `${location.pathname}?${params.toString()}` : location.pathname;
  if (push) {
    history.pushState({}, '', target);
  }
  state.route = { page, code: page === 'list' ? null : code || TARGET_STOCK_CODE };
  state.error = '';
  state.loading = true;
  if (page === 'list') {
    state.stockDetail = null;
  }
  refreshCurrentView();
}

function secondsLeft() {
  if (!state.nextRefreshAt) return 0;
  return Math.max(0, Math.ceil((state.nextRefreshAt - Date.now()) / 1000));
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchServerStock(code) {
  return fetchJson(`./api/stock?code=${encodeURIComponent(code)}`);
}

async function ensureSnapshot() {
  if (state.snapshot) return state.snapshot;
  let lastError = null;
  for (const url of SNAPSHOT_URLS) {
    try {
      state.snapshot = await fetchJson(url);
      return state.snapshot;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('静态详情数据读取失败');
}

async function fetchIndustryPeHistory() {
  const now = Date.now();
  if (state.industryPeHistory && now - state.industryPeHistoryFetchedAt < 12 * 60 * 60 * 1000) {
    return state.industryPeHistory;
  }

  const marketCode = `${INDUSTRY_INDEX_MARKET}${INDUSTRY_INDEX_CODE}`;
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${marketCode},day,,,${INDUSTRY_HISTORY_LIMIT},qfq&_=${now}`;
  const payload = await fetchJson(url);
  const dataset = payload?.data?.[marketCode];
  const rows = dataset?.day || dataset?.qfqday || [];
  const currentPe = normalizeNumber(dataset?.qt?.[marketCode]?.[39]);
  const latestClose = normalizeNumber(dataset?.qt?.[marketCode]?.[3]);
  if (!rows.length || currentPe == null || latestClose == null || latestClose <= 0) {
    throw new Error('未读取到银行行业估值历史');
  }

  const history = rows
    .map((row) => {
      const date = row?.[0];
      const close = normalizeNumber(row?.[2]);
      if (!date || close == null) return null;
      return {
        date,
        value: Number(((close / latestClose) * currentPe).toFixed(4))
      };
    })
    .filter(Boolean);

  state.industryPeHistory = history;
  state.industryPeHistoryFetchedAt = now;
  return history;
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
    pe: normalizeNumber(fields[39]),
    updatedAt: new Date().toISOString()
  };
}

function getShanghaiClock(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: MARKET_TIMEZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    weekday: parts.weekday,
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

function getMarketPhase(date = new Date()) {
  const clock = getShanghaiClock(date);
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(clock.weekday);
  if (!isWeekday) {
    return { phase: 'closed', label: '非交易日，展示最新收盘数据', autoRefresh: false };
  }
  const totalMinutes = clock.hour * 60 + clock.minute;
  if ((totalMinutes >= 570 && totalMinutes < 690) || (totalMinutes >= 780 && totalMinutes < 900)) {
    return { phase: 'live', label: '交易时段内，每 1 分钟刷新', autoRefresh: true };
  }
  if (totalMinutes >= 690 && totalMinutes < 780) {
    return { phase: 'break', label: '午间休市，暂停自动刷新', autoRefresh: false };
  }
  return { phase: 'closed', label: '非交易时段，展示最新收盘数据', autoRefresh: false };
}

function toCloseTimestamp(dateText) {
  if (!dateText) return new Date().toISOString();
  return `${dateText}T15:00:00+08:00`;
}

function getLatestClose(snapshot) {
  const latestPoint = snapshot?.priceHistory?.length ? snapshot.priceHistory[snapshot.priceHistory.length - 1] : null;
  return {
    latestPrice: normalizeNumber(latestPoint?.value) ?? normalizeNumber(snapshot?.latestPrice),
    updatedAt: toCloseTimestamp(latestPoint?.date || formatAxisDate(snapshot?.updatedAt || new Date().toISOString()))
  };
}

function buildStock(snapshot, quote, marketPhase, options = {}) {
  const latestPrice =
    normalizeNumber(quote?.latestPrice) ??
    normalizeNumber(options.latestPrice) ??
    normalizeNumber(snapshot.latestPrice);
  const pe =
    normalizeNumber(quote?.pe) ??
    normalizeNumber(options.pe) ??
    estimatePe(latestPrice, snapshot);
  const updatedAt = options.updatedAt || quote?.updatedAt || snapshot.updatedAt || new Date().toISOString();
  const shouldAutoRefresh = marketPhase.autoRefresh && latestPrice != null;
  const pill = marketPhase.phase === 'live' ? '实时数据' : marketPhase.phase === 'break' ? '暂停刷新' : '最新收盘';
  return {
    code: snapshot.code,
    name: quote?.name || snapshot.name,
    industry: snapshot.industry || '银行',
    latestPrice,
    marketValue: estimateMarketValue(latestPrice, snapshot),
    grossMargin: normalizeNumber(snapshot.grossMargin),
    grossMarginUpdatedAt: snapshot.grossMarginUpdatedAt || lastGrossMarginDate(snapshot),
    pe,
    shareCountEstimate: normalizeNumber(snapshot.shareCountEstimate),
    updatedAt,
    source: options.source || snapshot.source || '内置数据',
    refreshLabel: options.refreshLabel || marketPhase.label,
    shouldAutoRefresh,
    dataPill: pill,
    priceHistory: snapshot.priceHistory || [],
    grossMarginHistory: snapshot.grossMarginHistory || [],
    industryPeHistory: snapshot.industryPeHistory || []
  };
}

async function buildSnapshotBackedStock() {
  try {
    const payload = await fetchServerStock(TARGET_STOCK_CODE);
    if (Array.isArray(payload.industryPeHistory) && payload.industryPeHistory.length) {
      const marketPhase = getMarketPhase();
      return buildStock(payload, null, marketPhase, {
        latestPrice: normalizeNumber(payload.latestPrice),
        pe: normalizeNumber(payload.pe),
        updatedAt: payload.updatedAt,
        source: payload.source,
        refreshLabel: marketPhase.label,
      });
    }
  } catch {}

  const snapshot = await ensureSnapshot();
  let industryPeHistory = snapshot.industryPeHistory || [];
  try {
    industryPeHistory = await fetchIndustryPeHistory();
  } catch {}
  const marketPhase = getMarketPhase();
  if (marketPhase.phase === 'live') {
    try {
      const quote = await fetchTencentQuote(snapshot.code || TARGET_STOCK_CODE);
      return buildStock({ ...snapshot, industryPeHistory }, quote, marketPhase, {
        source: '数据源：东方财富财报 + 腾讯个股行情PE + 腾讯银行指数PE代理'
      });
    } catch {
      const latestClose = getLatestClose(snapshot);
      return buildStock({ ...snapshot, industryPeHistory }, null, { phase: 'closed', label: '实时行情暂不可用，展示最近收盘数据', autoRefresh: false }, {
        latestPrice: latestClose.latestPrice,
        updatedAt: latestClose.updatedAt,
        source: '数据源：东方财富财报快照 + 内置收盘历史 + 内置个股PE基线',
        refreshLabel: '实时行情暂不可用，当前展示最近收盘数据'
      });
    }
  }

  try {
    const quote = await fetchTencentQuote(snapshot.code || TARGET_STOCK_CODE);
    const latestClose = getLatestClose(snapshot);
    return buildStock({ ...snapshot, industryPeHistory }, quote, marketPhase, {
      updatedAt: marketPhase.phase === 'closed' ? latestClose.updatedAt : quote.updatedAt,
      source:
        marketPhase.phase === 'break'
          ? '数据源：东方财富财报 + 腾讯个股行情PE + 腾讯银行指数PE代理'
          : '数据源：东方财富财报 + 腾讯个股收盘PE + 腾讯银行指数PE代理'
    });
  } catch {
    const latestClose = getLatestClose(snapshot);
    return buildStock({ ...snapshot, industryPeHistory }, null, marketPhase, {
      latestPrice: latestClose.latestPrice,
      updatedAt: latestClose.updatedAt,
      source: '数据源：东方财富财报快照 + 内置收盘历史 + 内置个股PE基线'
    });
  }
}

function updateRefreshSchedule(stock) {
  if (stock?.shouldAutoRefresh) {
    state.refreshMs = DEFAULT_REFRESH_MS;
    state.nextRefreshAt = Date.now() + state.refreshMs;
    return;
  }
  state.refreshMs = 0;
  state.nextRefreshAt = null;
}

async function refreshMarket() {
  const stock = await buildSnapshotBackedStock();
  state.stocks = [stock];
  updateRefreshSchedule(stock);
}

async function refreshStockDetail(code) {
  const stock = await buildSnapshotBackedStock();
  if (stock.code !== code) {
    throw new Error('暂未找到该股票');
  }
  state.stockDetail = stock;
  state.stocks = [stock];
  updateRefreshSchedule(stock);
}

async function refreshCurrentView() {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  try {
    state.error = '';
    if (state.route.page === 'list') {
      await refreshMarket();
    } else {
      await refreshStockDetail(state.route.code || TARGET_STOCK_CODE);
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
  state.route = getRoute();
  state.loading = true;
  state.error = '';
  refreshCurrentView();
});

setInterval(() => {
  const timerBadge = document.getElementById('timerBadge');
  const currentStock = state.route.page === 'list' ? state.stocks[0] : state.stockDetail;
  if (timerBadge && currentStock) {
    timerBadge.textContent = getRefreshText(currentStock);
  }
}, 1000);

setInterval(() => {
  if (isFileMode()) return;
  if (!state.nextRefreshAt) return;
  if (Date.now() < state.nextRefreshAt) return;
  refreshCurrentView();
}, 1000);

renderApp();
if (!isFileMode()) {
  refreshCurrentView();
}
