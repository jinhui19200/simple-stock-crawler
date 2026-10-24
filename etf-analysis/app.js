let etfs = [
  { name: '芯片 ETF', code: '512760', industry: '半导体', index: '中证芯片产业指数', size: '274.6 亿', pe: 42.18, percentile: '18.4%', return: 38.62, actions: 12, days: 648, price: 1.286 },
  { name: '医药 ETF', code: '512010', industry: '医药生物', index: '中证医药卫生指数', size: '168.2 亿', pe: 25.64, percentile: '12.6%', return: 31.48, actions: 9, days: 511, price: 0.918 },
  { name: '证券 ETF', code: '512880', industry: '证券', index: '中证全指证券公司指数', size: '412.8 亿', pe: 18.92, percentile: '24.1%', return: 28.11, actions: 8, days: 448, price: 1.052 },
  { name: '新能源 ETF', code: '516160', industry: '新能源', index: '中证新能源指数', size: '45.7 亿', pe: 21.37, percentile: '8.9%', return: 24.75, actions: 11, days: 602, price: 0.671 },
  { name: '军工 ETF', code: '512660', industry: '国防军工', index: '中证军工指数', size: '97.5 亿', pe: 54.21, percentile: '32.0%', return: 21.93, actions: 7, days: 392, price: 1.137 },
  { name: '消费 ETF', code: '159928', industry: '可选消费', index: '中证主要消费指数', size: '39.9 亿', pe: 28.54, percentile: '19.8%', return: 16.84, actions: 5, days: 324, price: 0.746 },
  { name: '银行 ETF', code: '512800', industry: '银行', index: '中证银行指数', size: '54.1 亿', pe: 6.38, percentile: '36.2%', return: 14.26, actions: 6, days: 281, price: 1.182 },
  { name: '软件 ETF', code: '515230', industry: '软件服务', index: '中证软件服务指数', size: '21.6 亿', pe: 66.15, percentile: '15.7%', return: 10.38, actions: 10, days: 550, price: 0.731 },
  { name: '传媒 ETF', code: '512980', industry: '传媒', index: '中证传媒指数', size: '18.3 亿', pe: 30.71, percentile: '23.5%', return: 7.92, actions: 5, days: 210, price: 0.884 },
  { name: '煤炭 ETF', code: '515220', industry: '煤炭开采', index: '中证煤炭指数', size: '17.1 亿', pe: 10.23, percentile: '28.8%', return: -3.41, actions: 3, days: 158, price: 1.463 }
];

const additionalIndustries = ['光伏', '有色金属', '稀土', '黄金', '钢铁', '建材', '房地产', '家电', '汽车', '农业', '畜牧养殖', '食品饮料', '白酒', '旅游酒店', '物流运输', '港口航运', '航空', '环保', '电力', '通信', '云计算', '人工智能', '机器人', '电池', '游戏', '金融科技', '保险', '医疗器械', '创新药', '化工', '机械设备', '石油石化', '消费电子', '光模块', '电子元件', '元器件', '集成电路设计', '计算机设备', '信息安全', '数据中心', '物联网', '工业互联网', '数字经济', '网络安全', '智能驾驶', '新能源汽车', '锂矿', '风电', '核电', '水务', '燃气', '港口', '快递物流', '航空机场', '酒店餐饮', '教育', '体育产业', '文化娱乐', '出版', '广告营销', '装修建材'];
additionalIndustries.forEach((industry, index) => etfs.push({
  name: `${industry} ETF`, code: String(516300 + index), industry, index: `中证${industry}产业指数`, size: `${(12.4 + index * 2.3).toFixed(1)} 亿`, pe: 12 + index * 1.73, percentile: `${(8 + index * 2.1).toFixed(1)}%`, return: 6.8 + ((index * 7.31) % 28), actions: 4 + (index % 9), days: 160 + index * 13, price: .62 + index * .031
}));

let selected = etfs[0];
let chartWindow = null;
let activeChartModel = null;
let selectedHoldingPeriod = '2026-07';
let portfolioDetailOperations = new Map();
let portfolioDetailRules = null;
let detailPortfolioCode = null;
let dashboardMeta = null;
let activePage = 'screener';
let optionalEtfRequest = 0;
let optionalEtfTimer = null;
let optionalEtfResults = new Map();
const strategy = { annualRate: 15, shortReturn: 10, optionTwo: 30, tierOne: 20, tierTwo: 40, sellRule: 'time' };
const verifiedOhlc = new Map();
const verifiedValuation = new Map();
const valuationUnavailableReasons = new Map();
const backtestDatasetCache = new Map();
const pageTitles = { screener: '策略筛选', detail: 'ETF 详情', backtest: '策略回测', profile: '个人中心' };

function money(value) { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value); }
function signed(value) { return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`; }

function displayDateTime(value) {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function renderDataStatus() {
  const message = document.getElementById('update-message');
  const dot = document.getElementById('update-dot');
  const banner = document.getElementById('data-status-banner');
  if (!message || !dot || !banner) return;
  if (!dashboardMeta) {
    message.textContent = '尚未读取云端数据状态';
    dot.className = 'status-dot warning';
    banner.textContent = '当前显示离线示例列表。请通过本地 HTTP 服务打开网页，或等待 GitHub Actions 完成首次发布。';
    banner.className = 'data-status-banner warning';
    banner.hidden = false;
    return;
  }
  const meta = dashboardMeta;
  const expected = meta.expectedTradingDate || '--';
  message.textContent = `最近发布 ${displayDateTime(meta.updatedAt)} · 数据至 ${meta.latestTradingDate || meta.expectedTradingDate || '--'}`;
  const hasIssue = Boolean(meta.isPartial || meta.selectionError || meta.marketCalendarError || meta.freshnessVerified === false);
  dot.className = `status-dot${hasIssue ? ' warning' : ''}`;
  const sessionText = meta.session === 'noon'
    ? '午间更新：日K只更新到上一完整交易日，不包含当天未收盘行情。'
    : meta.session === 'retry'
      ? '收盘补跑：仅重试仍未更新成功的数据。'
      : '收盘更新：使用已确认的日K与官方 PETTM 数据。';
  const details = [
    sessionText,
    `筛选日期 ${meta.selectionDate || '--'}`,
    `预期交易日 ${expected}`,
    `已发布 ${meta.publishedCount ?? 0}/${meta.selectedCount ?? etfs.length} 只`
  ];
  if (meta.staleCount) details.push(`${meta.staleCount} 只数据过旧`);
  if (meta.freshnessVerified === false) details.push('当前为历史缓存，尚未联网确认最新交易日');
  if (meta.selectionError) details.push(`ETF 名单沿用上次结果：${meta.selectionError}`);
  if (meta.marketCalendarError) details.push(`交易日历读取失败：${meta.marketCalendarError}`);
  banner.textContent = details.join(' · ');
  banner.className = `data-status-banner${meta.selectionError ? ' error' : hasIssue ? ' warning' : ''}`;
  banner.hidden = false;
}

function switchPage(page) {
  activePage = page;
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.dataset.pageContent === page));
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.getElementById('page-title').textContent = pageTitles[page];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (page === 'profile') refreshOptionalEtfs();
}

function renderRuleSummaries() {
  const sellText = strategy.sellRule === 'time' ? `持仓月数目标收益（${strategy.annualRate}% ÷ 12 × 持仓月数）` : strategy.sellRule === 'thirty' ? `整体收益超过 ${strategy.optionTwo}% 全部卖出` : `收益超过 ${strategy.tierOne}% 和 ${strategy.tierTwo}% 分两次卖出`;
  const summary = `首次买入：行业 TTM 市盈率低于前一交易日及以前的历史最低值。补仓：成本价跌至 70%、49%、34.3%、24.01% 时各买一份。卖出：${sellText}；买入后 60 个交易日内，仅在短期收益大于 ${strategy.shortReturn}% 时允许卖出。`;
  document.getElementById('screener-rule-summary').textContent = summary;
  document.getElementById('detail-rule-summary').textContent = summary;
}

function sellRuleLabel(rules = strategy) {
  if (rules.sellRule === 'time') return `选项一（年化 ${rules.annualRate}%）`;
  if (rules.sellRule === 'thirty') return `选项二（整体收益 ${rules.optionTwo}%）`;
  return `选项三（${rules.tierOne}% / ${rules.tierTwo}%）`;
}

function markStrategyPending() {
  document.getElementById('screen-run-state').textContent = `待执行：${sellRuleLabel()}`;
  document.getElementById('detail-run-state').textContent = `待执行：${sellRuleLabel()}`;
  optionalEtfRequest += 1;
  clearTimeout(optionalEtfTimer);
  if (activePage === 'profile') optionalEtfTimer = setTimeout(refreshOptionalEtfs, 180);
}

function strategyEditor(context) {
  return `<div class="strategy-fields">
    <div class="strategy-number-grid">
      <label>短期收益<span class="percent-input"><input type="number" min="0" max="100" step="0.5" data-strategy-field="shortReturn" value="${strategy.shortReturn}" />%</span></label>
    </div>
    <div class="buying-note"><b>买入条件</b>行业 TTM 市盈率低于前一交易日及以前的历史最低值时，首次买入一份。<br />成本价依次跌至 70%、49%、34.3%、24.01% 时，各补仓一份。</div>
    <fieldset class="sell-fieldset"><legend>卖出条件</legend>
      <label class="rule-option"><input type="radio" name="sell-rule-${context}" value="time" data-sell-rule ${strategy.sellRule === 'time' ? 'checked' : ''}/><span><b>选项一</b>目标收益 = <input type="number" min="0" max="100" step="0.5" data-strategy-field="annualRate" value="${strategy.annualRate}" />% ÷ 12 × 持仓月数</span></label>
      <label class="rule-option"><input type="radio" name="sell-rule-${context}" value="thirty" data-sell-rule ${strategy.sellRule === 'thirty' ? 'checked' : ''}/><span><b>选项二</b>整体收益超过 <input type="number" min="0" max="100" step="0.5" data-strategy-field="optionTwo" value="${strategy.optionTwo}" />% 时全部卖出</span></label>
      <label class="rule-option"><input type="radio" name="sell-rule-${context}" value="tiered" data-sell-rule ${strategy.sellRule === 'tiered' ? 'checked' : ''}/><span><b>选项三</b>收益超过 <input type="number" min="0" max="100" step="0.5" data-strategy-field="tierOne" value="${strategy.tierOne}" />% 卖出一半，超过 <input type="number" min="0" max="100" step="0.5" data-strategy-field="tierTwo" value="${strategy.tierTwo}" />% 再卖出一半</span></label>
    </fieldset>
  </div>`;
}

function renderStrategyEditors() {
  document.querySelectorAll('[data-strategy-editor]').forEach(editor => { editor.innerHTML = strategyEditor(editor.dataset.strategyEditor); });
  document.querySelectorAll('[data-strategy-field]').forEach(input => input.addEventListener('input', () => {
    strategy[input.dataset.strategyField] = Math.max(0, Number(input.value) || 0);
    syncStrategyEditors(input); renderRuleSummaries(); markStrategyPending();
  }));
  document.querySelectorAll('[data-sell-rule]').forEach(input => input.addEventListener('change', () => {
    if (!input.checked) return;
    strategy.sellRule = input.value; syncStrategyEditors(); renderRuleSummaries(); markStrategyPending();
  }));
}

function syncStrategyEditors(source) {
  document.querySelectorAll('[data-strategy-field]').forEach(input => { if (input !== source) input.value = strategy[input.dataset.strategyField]; });
  document.querySelectorAll('[data-sell-rule]').forEach(input => { input.checked = input.value === strategy.sellRule; });
}

async function loadBacktestDataset(code) {
  if (backtestDatasetCache.has(code)) return backtestDatasetCache.get(code);
  const response = await fetch(`data/etf/${code}.json`);
  if (!response.ok) throw new Error('本地历史数据不存在');
  const payload = await response.json();
  if (!payload.validation?.passed || !Array.isArray(payload.ohlc) || !payload.ohlc.length) throw new Error('日K数据未通过校验');
  backtestDatasetCache.set(code, payload);
  verifiedOhlc.set(code, payload.ohlc);
  verifiedValuation.set(code, Array.isArray(payload.valuation) ? payload.valuation : []);
  valuationUnavailableReasons.set(code, payload.valuation_unavailable_reason || '跟踪指数官方未公开历史PETTM');
  return payload;
}

function recentSignalRange(asOf) {
  const start = new Date(`${asOf}T00:00:00Z`);
  const month = start.getUTCMonth();
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  if (start.getUTCMonth() !== month) start.setUTCDate(0);
  return { start: start.toISOString().slice(0, 10), end: asOf };
}

function collectOptionalSignals(results, asOf) {
  const { start, end } = recentSignalRange(asOf);
  const signals = [];
  results.forEach(({ etf, result, latestDate, stale }) => {
    if (!result.available) return;
    result.trades.forEach((trade, eventIndex) => {
      if (trade.type !== 'buy' || trade.date < start || trade.date > end) return;
      signals.push({ code: etf.code, name: etf.name, date: trade.date,
        condition: trade.isSupplement ? '加仓' : '买入', reason: trade.reason,
        latestDate, stale, eventIndex });
    });
  });
  return signals.sort((a, b) => b.date.localeCompare(a.date) || a.code.localeCompare(b.code) || a.eventIndex - b.eventIndex);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function refreshOptionalEtfs() {
  clearTimeout(optionalEtfTimer);
  const request = ++optionalEtfRequest;
  const button = document.getElementById('refresh-optional-etfs');
  const status = document.getElementById('optional-etf-status');
  const body = document.getElementById('optional-etf-body');
  const rules = { ...strategy };
  const asOf = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const range = recentSignalRange(asOf);
  document.getElementById('optional-etf-rule').textContent = `当前策略：${sellRuleLabel(rules)} · 短期收益 ${rules.shortReturn}% · 时间范围 ${range.start} 至 ${range.end}`;
  optionalEtfResults = new Map();
  if (!dashboardMeta) {
    button.disabled = false;
    status.textContent = '尚未读取真实 ETF 清单，请等待数据加载后刷新。';
    body.innerHTML = '<tr><td colspan="5" class="holding-empty">真实数据尚未就绪</td></tr>';
    return;
  }
  button.disabled = true;
  body.innerHTML = '<tr><td colspan="5" class="holding-empty">正在按当前条件计算历史信号…</td></tr>';
  const results = [];
  let unavailable = 0;
  let failed = 0;
  for (const etf of [...etfs]) {
    if (request !== optionalEtfRequest) return;
    try {
      const payload = await loadBacktestDataset(etf.code);
      if (request !== optionalEtfRequest) return;
      const result = simulateEtfStrategy(payload, rules);
      if (!result.available) unavailable += 1;
      else results.push({ etf, result, latestDate: payload.ohlc.at(-1).date, stale: Boolean(payload.stale || etf.stale) });
    } catch (_) { failed += 1; }
    status.textContent = `正在读取 ${results.length + unavailable + failed}/${etfs.length} 只 ETF`;
    if ((results.length + unavailable + failed) % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (request !== optionalEtfRequest) return;
  optionalEtfResults = new Map(results.map(item => [item.etf.code, { ...item.result, rules }]));
  const signals = collectOptionalSignals(results, asOf);
  body.innerHTML = signals.map(signal => `<tr>
    <td>${escapeHtml(signal.date)}</td>
    <td><button class="holding-etf-link" type="button" data-optional-etf="${escapeHtml(signal.code)}"><span>${escapeHtml(signal.name)}</span><small>${escapeHtml(signal.code)}</small></button></td>
    <td><span class="optional-signal ${signal.condition === '加仓' ? 'supplement' : ''}">${signal.condition}</span></td>
    <td class="optional-reason">${escapeHtml(signal.reason)}</td>
    <td>${escapeHtml(signal.latestDate)}${signal.stale ? '<span class="stale-badge">数据过旧</span>' : ''}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="holding-empty">最近一年内，已读取的数据未出现符合当前条件的买入或加仓记录</td></tr>';
  status.textContent = `共 ${new Set(signals.map(item => item.code)).size} 只 ETF，${signals.length} 次触发 · 已计算 ${results.length}/${etfs.length} 只${unavailable ? ` · ${unavailable} 只缺少官方 PETTM，已跳过` : ''}${failed ? ` · ${failed} 只数据读取失败，请刷新重试` : ''}`;
  document.querySelectorAll('[data-optional-etf]').forEach(link => link.addEventListener('click', () => {
    const code = link.dataset.optionalEtf;
    const result = optionalEtfResults.get(code);
    const etf = etfs.find(item => item.code === code);
    if (!etf || !result) return;
    Object.assign(etf, { return: result.return, actions: result.actions, days: result.days,
      strategyTrades: result.trades, strategyComputed: result.available, appliedRules: result.rules, openHolding: result.openHolding });
    renderTable(document.getElementById('etf-search').value);
    openEtfDetail(code);
  }));
  button.disabled = false;
}

function simulateEtfStrategy(payload, rules) {
  const candles = (payload.ohlc || []).filter(candle => candle.date >= '2020-01-01');
  const valuation = (payload.valuation || []).filter(point => point.date >= '2016-01-01');
  if (!valuation.length) return { available: false, return: null, actions: 0, days: 0, trades: [] };

  const newLowDates = new Set();
  let historicalLow = Infinity;
  valuation.forEach(point => {
    const value = Number(point.pe_ttm);
    if (value > 0 && value < historicalLow) {
      if (historicalLow < Infinity) newLowDates.add(point.date);
      historicalLow = value;
    }
  });

  const startingCash = 5;
  let cash = startingCash;
  let lots = [];
  let initialPrice = 0;
  let supplementStage = 0;
  let tierOneSold = false;
  let holdingDays = 0;
  let totalInvestedCost = 0;
  const trades = [];
  const supplementLevels = [.7, .49, .343, .2401];

  const positionValue = price => lots.reduce((sum, lot) => sum + lot.quantity * price, 0);
  const positionCost = () => lots.reduce((sum, lot) => sum + lot.cost, 0);
  const overallReturn = price => positionCost() ? positionValue(price) / positionCost() - 1 : 0;
  const record = (candle, operation, reason, profit, days, execution = {}) => trades.push({ date: candle.date, operation, reason, return: profit, days, ...execution });
  const buyPart = (candle, price, reason, operation = '买入 1 份', execution = {}) => {
    if (cash < 1) return false;
    lots.push({ quantity: 1 / price, cost: 1, buyIndex: candle.index });
    cash -= 1;
    totalInvestedCost += 1;
    record(candle, operation, reason, null, 0, { type: 'buy', price, parts: 1, ...execution });
    return true;
  };
  const sellFraction = (candle, fraction, reason) => {
    const beforeCost = positionCost();
    const beforeValue = positionValue(candle.close);
    const profit = beforeCost ? beforeValue / beforeCost - 1 : 0;
    const oldestIndex = Math.min(...lots.map(lot => lot.buyIndex));
    let proceeds = 0;
    lots = lots.map(lot => {
      const soldQuantity = lot.quantity * fraction;
      proceeds += soldQuantity * candle.close;
      return { ...lot, quantity: lot.quantity - soldQuantity, cost: lot.cost * (1 - fraction) };
    }).filter(lot => lot.quantity > 1e-9);
    cash += proceeds;
    record(candle, fraction >= .999 ? '全部卖出' : '卖出一半', reason, profit, candle.index - oldestIndex + 1, { type: 'sell', price: candle.close, fraction });
    if (!lots.length) {
      initialPrice = 0;
      supplementStage = 0;
      tierOneSold = false;
    }
  };

  candles.forEach((sourceCandle, index) => {
    const candle = { ...sourceCandle, index };
    if (lots.length) holdingDays += 1;

    if (!lots.length && newLowDates.has(candle.date) && cash >= 1) {
      initialPrice = candle.close;
      buyPart(candle, candle.close, '行业 PETTM 创动态历史新低');
      holdingDays += 1;
      return;
    }

    if (!lots.length) return;

    while (supplementStage < supplementLevels.length && cash >= 1) {
      const triggerPrice = initialPrice * supplementLevels[supplementStage];
      if (candle.low > triggerPrice) break;
      const fillPrice = candle.open <= triggerPrice ? candle.open : triggerPrice;
      if (!buyPart(candle, fillPrice, `价格跌至首次买入价的 ${(supplementLevels[supplementStage] * 100).toFixed(2)}%`, '补仓 1 份', { isSupplement: true, triggerPrice })) break;
      supplementStage += 1;
    }

    const profit = overallReturn(candle.close);
    const oldestIndex = Math.min(...lots.map(lot => lot.buyIndex));
    const elapsedDays = index - oldestIndex + 1;
    if (elapsedDays <= 60 && profit > rules.shortReturn / 100) {
      sellFraction(candle, 1, `60 个交易日内收益超过 ${rules.shortReturn}%`);
      return;
    }
    if (elapsedDays <= 60 && profit <= rules.shortReturn / 100) return;

    if (rules.sellRule === 'time') {
      const heldMonths = Math.max(1, elapsedDays / 21);
      const target = rules.annualRate / 100 / 12 * heldMonths;
      if (profit >= target) sellFraction(candle, 1, `达到持仓月数目标收益 ${(target * 100).toFixed(2)}%`);
    } else if (rules.sellRule === 'thirty') {
      if (profit >= rules.optionTwo / 100) sellFraction(candle, 1, `整体收益超过 ${rules.optionTwo}%`);
    } else if (!tierOneSold && profit >= rules.tierOne / 100) {
      sellFraction(candle, .5, `整体收益超过 ${rules.tierOne}%`);
      tierOneSold = true;
    } else if (tierOneSold && profit >= rules.tierTwo / 100) {
      sellFraction(candle, 1, `整体收益超过 ${rules.tierTwo}%`);
    }
  });

  const latestClose = candles[candles.length - 1].close;
  const endingValue = cash + positionValue(latestClose);
  const netProfit = endingValue - startingCash;
  // 每次买入或补仓固定投入 1 份，因此每份收益率之和等于总盈亏份数乘以 100%。
  const cumulativePartReturn = totalInvestedCost ? netProfit * 100 : 0;
  const oldestOpenIndex = lots.length ? Math.min(...lots.map(lot => lot.buyIndex)) : -1;
  const openHolding = lots.length ? {
    since: candles[oldestOpenIndex].date,
    latestDate: candles[candles.length - 1].date,
    days: candles.length - oldestOpenIndex,
    parts: positionCost(),
    return: overallReturn(latestClose)
  } : null;
  return { available: true, return: cumulativePartReturn, netProfit, investedCost: totalInvestedCost, actions: trades.length, days: holdingDays, trades, openHolding };
}

async function executeScreeningBacktest() {
  const button = document.getElementById('run-screen');
  const state = document.getElementById('screen-run-state');
  button.disabled = true;
  const rules = { ...strategy };
  let completed = 0;
  let available = 0;
  for (const etf of etfs) {
    try {
      const payload = await loadBacktestDataset(etf.code);
      const result = simulateEtfStrategy(payload, rules);
      etf.return = result.return;
      etf.actions = result.actions;
      etf.days = result.days;
      etf.strategyTrades = result.trades;
      etf.strategyComputed = result.available;
      etf.appliedRules = rules;
      etf.openHolding = result.openHolding;
      if (result.available) available += 1;
    } catch (error) {
      etf.return = null;
      etf.actions = 0;
      etf.days = 0;
      etf.strategyTrades = [];
      etf.strategyComputed = false;
      etf.openHolding = null;
      etf.backtestError = error.message;
    }
    completed += 1;
    if (completed % 5 === 0 || completed === etfs.length) {
      state.textContent = `正在回测 ${completed}/${etfs.length}`;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  document.getElementById('eligible-count').textContent = available;
  renderTable(document.getElementById('etf-search').value);
  detailPortfolioCode = null;
  renderDetail();
  state.textContent = `已执行：${sellRuleLabel(rules)}`;
  button.innerHTML = '执行完成 <span>✓</span>';
  button.disabled = false;
  setTimeout(() => { button.innerHTML = '执行条件 <span>→</span>'; }, 1200);
}

async function executeDetailBacktest() {
  const button = document.getElementById('apply-detail-strategy');
  const state = document.getElementById('detail-run-state');
  const rules = { ...strategy };
  detailPortfolioCode = null;
  button.disabled = true;
  state.textContent = '正在计算当前 ETF';
  try {
    const payload = await loadBacktestDataset(selected.code);
    const result = simulateEtfStrategy(payload, rules);
    selected.return = result.return;
    selected.actions = result.actions;
    selected.days = result.days;
    selected.strategyTrades = result.trades;
    selected.strategyComputed = result.available;
    selected.appliedRules = rules;
    selected.openHolding = result.openHolding;
    chartWindow = null;
    renderTable(document.getElementById('etf-search').value);
    renderDetail();
    state.textContent = `已执行：${sellRuleLabel(rules)}`;
    button.innerHTML = '应用完成 <span>✓</span>';
  } catch (error) {
    state.textContent = `执行失败：${error.message}`;
    button.innerHTML = '执行失败';
  } finally {
    button.disabled = false;
    setTimeout(() => { button.innerHTML = '应用条件 <span>→</span>'; }, 1200);
  }
}

function renderTable(query = '') {
  const normalized = query.trim().toLowerCase();
  const visible = [...etfs].sort((a, b) => (Number.isFinite(b.return) ? b.return : -Infinity) - (Number.isFinite(a.return) ? a.return : -Infinity)).filter(e => `${e.name}${e.code}${e.industry}`.toLowerCase().includes(normalized));
  document.getElementById('etf-table-body').innerHTML = visible.map((etf, i) => `
    <tr>
      <td>${String(i + 1).padStart(2, '0')}</td>
      <td><span class="etf-name">${etf.name}${etf.stale ? '<span class="stale-badge">数据过旧</span>' : ''}</span><span class="etf-code">${etf.code}</span>${etf.latestPriceDate ? `<span class="data-date-note">日K至 ${etf.latestPriceDate}</span>` : ''}</td>
      <td><span class="industry-pill">${etf.industry}</span></td>
      <td class="${Number.isFinite(etf.return) ? (etf.return >= 0 ? 'positive' : 'negative') : 'unavailable'}">${Number.isFinite(etf.return) ? signed(etf.return) : '不可回测'}</td>
      <td>${etf.actions || 0} 次</td><td>${etf.days || 0} 个交易日${etf.openHolding ? '<span class="holding-now">持仓至今</span>' : ''}</td>
      <td><button class="table-link" type="button" data-code="${etf.code}">查看 →</button></td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;color:#78869a">没有找到匹配的 ETF</td></tr>';
  document.querySelectorAll('.table-link').forEach(button => button.addEventListener('click', () => {
    openEtfDetail(button.dataset.code);
  }));
}

function openEtfDetail(code, source = 'screen') {
  const target = etfs.find(etf => etf.code === code);
  if (!target) return;
  selected = target;
  detailPortfolioCode = source === 'portfolio' && portfolioDetailOperations.has(code) ? code : null;
  chartWindow = null;
  renderDetail();
  switchPage('detail');
}

function metric(label, value, className = '') { return `<article class="metric-card"><span>${label}</span><strong class="${className}">${value}</strong></article>`; }

function calculatePricePercentile(history) {
  const values = (history || []).filter(candle => candle.date >= '2020-01-01').map(candle => Number(candle.close)).filter(value => value > 0 && Number.isFinite(value));
  if (!values.length) return null;
  const current = values.at(-1);
  return values.filter(value => value <= current).length / values.length * 100;
}

function renderDetailPricePercentile(symbol) {
  if (selected.code !== symbol) return;
  const percentile = calculatePricePercentile(verifiedOhlc.get(symbol));
  const valueEl = document.getElementById('detail-percentile');
  if (percentile === null) {
    valueEl.textContent = '暂无数据';
    valueEl.className = 'unavailable';
    return;
  }
  valueEl.textContent = `${percentile.toFixed(1)}%`;
  valueEl.className = percentile >= 80 ? 'negative' : percentile <= 20 ? 'positive' : '';
}

function renderDetailStrategyReturn(symbol) {
  if (selected.code !== symbol) return;
  const candles = (verifiedOhlc.get(symbol) || []).filter(candle => candle.date >= '2020-01-01' && Number(candle.close) > 0);
  const latest = candles.at(-1);
  const buyParts = (selected.strategyTrades || []).filter(trade => trade.type === 'buy').length;
  const returnEl = document.getElementById('detail-return');
  document.getElementById('detail-latest-price').textContent = latest ? `最新收盘价 ${Number(latest.close).toFixed(3)}` : '最新收盘价 --';
  if (detailPortfolioCode === symbol) {
    const actualBuys = (portfolioDetailOperations.get(symbol) || []).filter(trade => trade.type === 'buy').length;
    returnEl.textContent = '--';
    returnEl.className = 'unavailable';
    document.getElementById('detail-period').textContent = `组合回测实际操作：${actualBuys} 份已成交`;
    return;
  }
  if (!selected.strategyComputed || !Number.isFinite(selected.return) || !buyParts) {
    returnEl.textContent = '--';
    returnEl.className = 'unavailable';
    document.getElementById('detail-period').textContent = selected.strategyComputed ? '当前条件未产生买入' : '应用条件后计算每份资金收益';
    return;
  }
  returnEl.textContent = signed(selected.return);
  returnEl.className = selected.return >= 0 ? 'positive' : 'negative';
  document.getElementById('detail-period').textContent = `${buyParts} 份资金的收益率直接相加`;
}

function renderDetail() {
  document.getElementById('detail-industry').textContent = selected.industry;
  document.getElementById('detail-name').childNodes[0].nodeValue = `${selected.name} `;
  document.getElementById('detail-code').textContent = selected.code;
  const statusSuffix = selected.stale ? ` · 数据过旧（截至 ${selected.latestPriceDate || '--'}）` : selected.latestPriceDate ? ` · 日K截至 ${selected.latestPriceDate}` : '';
  document.getElementById('detail-index').textContent = `追踪指数：${selected.index}${statusSuffix}`;
  renderDetailPricePercentile(selected.code);
  renderDetailStrategyReturn(selected.code);
  const usesPortfolioRecords = detailPortfolioCode === selected.code;
  const detailTrades = usesPortfolioRecords ? (portfolioDetailOperations.get(selected.code) || []) : (selected.strategyTrades || []);
  document.getElementById('trade-count').textContent = `${usesPortfolioRecords ? detailTrades.length : selected.actions} 笔${!usesPortfolioRecords && selected.openHolding ? ' · 持仓中' : ''}`;
  document.getElementById('detail-record-rule').textContent = usesPortfolioRecords ? `组合回测实际操作：${sellRuleLabel(portfolioDetailRules || strategy)}` : selected.appliedRules ? `执行规则：${sellRuleLabel(selected.appliedRules)}` : '按当前策略计算';
  const demoRecords = [
    ['2026-07-14 10:32', '买入：行业估值创动态历史新低，首次买入一份', '+8.34%', '14 天'],
    ['2026-05-22 14:48', '卖出：达到持仓时间目标收益，全部卖出', '+17.26%', '87 天'],
    ['2026-02-24 10:06', '买入：价格跌至成本价 70%，补仓一份', '-12.08%', '39 天'],
    ['2026-01-06 09:47', '买入：行业估值创动态历史新低，首次买入一份', '+4.56%', '103 天']
  ];
  const hasStrategyRecords = usesPortfolioRecords || selected.strategyComputed;
  const strategyRecords = hasStrategyRecords ? detailTrades.map(trade => [
    `${trade.date} 收盘`,
    `${trade.operation}：${trade.reason}`,
    trade.return === null ? '--' : signed(trade.return * 100),
    trade.days ? `${trade.days} 天` : '--'
  ]) : demoRecords;
  if (!usesPortfolioRecords && selected.strategyComputed && selected.openHolding) strategyRecords.push([
    `${selected.openHolding.latestDate} 收盘`,
    `持仓至今：自 ${selected.openHolding.since} 买入后尚未达到卖出条件`,
    signed(selected.openHolding.return * 100),
    `${selected.openHolding.days} 天`
  ]);
  const records = hasStrategyRecords ? strategyRecords.slice().reverse() : demoRecords;
  document.getElementById('trade-records').innerHTML = records.length ? records.map(r => `<div class="trade-row"><span class="trade-date">${r[0]}</span><span class="trade-reason">${r[1]}</span><span class="trade-return ${r[2].startsWith('+') ? 'positive' : r[2].startsWith('-') ? 'negative' : ''}">${r[2]}</span><span class="trade-days">${r[3]}</span></div>`).join('') : '<div class="holding-empty">当前条件下没有产生买卖操作</div>';
  loadVerifiedOhlc(selected.code); drawMarketChart();
}

function points(values, width, height, pad, min, max) { return values.map((v, i) => `${pad + (i * (width - pad * 2) / (values.length - 1))},${height - pad - ((v - min) / (max - min)) * (height - pad * 2)}`).join(' '); }
function linePath(values, width, height, pad, min, max) { return values.map((v,i) => `${i ? 'L' : 'M'} ${pad + i * (width - pad * 2) / (values.length - 1)} ${height - pad - ((v - min) / (max - min)) * (height - pad * 2)}`).join(' '); }
function svgBase(width, height) { return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" xmlns="http://www.w3.org/2000/svg">`; }
function dailyKHistory() {
  return verifiedOhlc.get(selected.code) || [];
}

async function loadVerifiedOhlc(symbol) {
  if (verifiedOhlc.has(symbol)) {
    const freshness = selected.stale ? `；数据过旧（截至 ${selected.latestPriceDate || '--'}）` : '';
    document.getElementById('ohlc-source-state').textContent = `已读取经校验的东方财富日线${freshness}；滚动鼠标滚轮可缩放`;
    renderDetailPricePercentile(symbol);
    renderDetailStrategyReturn(symbol);
    return;
  }
  try {
    const response = await fetch(`data/etf/${symbol}.json`);
    if (!response.ok) throw new Error('本地数据文件不存在');
    const payload = await response.json();
    if (!payload.validation?.passed || !Array.isArray(payload.ohlc) || !payload.ohlc.length) throw new Error('数据未通过校验');
    verifiedOhlc.set(symbol, payload.ohlc);
    verifiedValuation.set(symbol, Array.isArray(payload.valuation) ? payload.valuation : []);
    valuationUnavailableReasons.set(symbol, payload.valuation_unavailable_reason || '跟踪指数官方未公开历史PETTM');
    if (selected.code === symbol) {
      renderDetailPricePercentile(symbol);
      renderDetailStrategyReturn(symbol);
      const valuationText = payload.valuation?.length ? `，已读取 ${payload.valuation.length} 个官方估值点` : `，${valuationUnavailableReasons.get(symbol)}`;
      const freshness = payload.stale ? `；数据过旧（${payload.stale_reason || '等待收盘更新'}）` : '';
      document.getElementById('ohlc-source-state').textContent = `已读取 ${payload.validation.checked_days} 个校验通过的交易日${valuationText}${freshness}；滚动鼠标滚轮可缩放`;
      drawMarketChart();
    }
  } catch (_) {
    if (selected.code === symbol) document.getElementById('ohlc-source-state').textContent = '尚未下载校验数据，图表不会显示模拟行情';
  }
}

function lineForSeries(values, xAt, yAt) {
  let started = false;
  return values.map((value, index) => {
    if (value === null || value === undefined || Number.isNaN(value)) { started = false; return ''; }
    const command = started ? 'L' : 'M'; started = true;
    return `${command} ${xAt(index)} ${yAt(value)}`;
  }).join(' ');
}

function movingAverage(candles, days) {
  return candles.map((_, index) => index < days - 1 ? null : candles.slice(index - days + 1, index + 1).reduce((sum, item) => sum + item.close, 0) / days);
}

function drawMarketChart() {
  const w = 960, h = 440, p = 42, top = 28, bottom = 38;
  const allK = dailyKHistory().filter(candle => candle.date >= '2020-01-01');
  let historicalPeLow = Infinity;
  const allPe = (verifiedValuation.get(selected.code) || [])
    .filter(point => point.date >= '2016-01-01' && Number(point.pe_ttm) > 0)
    .map(point => {
      const value = Number(point.pe_ttm);
      const isNewLow = historicalPeLow < Infinity && value < historicalPeLow;
      historicalPeLow = Math.min(historicalPeLow, value);
      return { ...point, pe_ttm: value, dynamicLow: historicalPeLow, isNewLow };
    });
  if (!allK.length) {
    activeChartModel = null;
    document.getElementById('market-chart').innerHTML = `${svgBase(w,h)}<text x="${w / 2}" y="${h / 2 - 8}" text-anchor="middle" fill="#64748b" font-size="15">等待已校验的东方财富日线数据</text><text x="${w / 2}" y="${h / 2 + 20}" text-anchor="middle" fill="#94a3b8" font-size="11">运行数据更新后，这里将显示真实 OHLC、TTM 市盈率与买卖标签</text></svg>`;
    return;
  }
  const latestDate = [allK.at(-1)?.date, allPe.at(-1)?.date].filter(Boolean).sort().at(-1);
  const naturalStartDate = [allK[0]?.date, allPe[0]?.date].filter(Boolean).sort()[0];
  const latestMs = Date.parse(`${latestDate}T00:00:00Z`);
  const naturalStartMs = Date.parse(`${naturalStartDate}T00:00:00Z`);
  const fullCalendarSpan = Math.max(1, latestMs - naturalStartMs);
  let chartStartMs = naturalStartMs;
  let chartEndMs = latestMs;
  if (chartWindow) {
    const requestedSpan = Math.max(1, Math.min(fullCalendarSpan, chartWindow.endMs - chartWindow.startMs));
    chartStartMs = Math.max(naturalStartMs, Math.min(chartWindow.startMs, latestMs - requestedSpan));
    chartEndMs = chartStartMs + requestedSpan;
  }
  const isVisibleDate = date => {
    const value = Date.parse(`${date}T00:00:00Z`);
    return value >= chartStartMs && value <= chartEndMs;
  };
  const candles = allK.filter(candle => isVisibleDate(candle.date));
  const pePoints = allPe.filter(point => isVisibleDate(point.date));
  const xAtDate = date => p + (Date.parse(`${date}T00:00:00Z`) - chartStartMs) / Math.max(1, chartEndMs - chartStartMs) * (w - p * 2);
  const values = (candles.length ? candles : allK).flatMap(item => [item.high, item.low]);
  const min = Math.min(...values) * .985, max = Math.max(...values) * 1.015;
  const toPriceY = value => h - bottom - ((value - min) / (max - min)) * (h - top - bottom);
  const xAt = index => xAtDate(candles[index].date);
  const candleWidth = Math.max(.8, (w - p * 2) / candles.length * .62);
  const priceGrid = [0, 1, 2, 3].map(index => `<line x1="${p}" y1="${top + index * (h - top - bottom) / 3}" x2="${w-p}" y2="${top + index * (h - top - bottom) / 3}" stroke="#e9eff6"/>`).join('');
  const bars = candles.map((item, index) => { const x = xAt(index), up = item.close >= item.open, openY = toPriceY(item.open), closeY = toPriceY(item.close); return `<line x1="${x}" y1="${toPriceY(item.high)}" x2="${x}" y2="${toPriceY(item.low)}" stroke="${up ? '#e25c5c' : '#169b74'}" stroke-width="1"/><rect x="${x - candleWidth / 2}" y="${Math.min(openY, closeY)}" width="${candleWidth}" height="${Math.max(1.4, Math.abs(openY - closeY))}" fill="${up ? '#e25c5c' : '#169b74'}"/>`; }).join('');
  const candleIndexByDate = new Map(candles.map((item, index) => [item.date, index]));
  const tagOffsets = new Map();
  const backtestTags = (detailPortfolioCode === selected.code ? (portfolioDetailOperations.get(selected.code) || []) : selected.strategyComputed ? (selected.strategyTrades || []) : []).filter(trade => trade.type === 'buy' || trade.type === 'sell');
  const tags = backtestTags.map(trade => {
    const index = candleIndexByDate.get(trade.date);
    if (index === undefined) return '';
    const item = candles[index];
    const sold = trade.operation.includes('卖出');
    const supplemented = trade.operation.includes('补仓');
    const shortSold = sold && trade.reason.includes('60 个交易日内');
    const label = shortSold ? '短卖' : sold ? '卖' : supplemented ? '补' : '买';
    const color = shortSold ? '#805ad5' : sold ? '#dc5b5b' : supplemented ? '#1769e8' : '#169b74';
    const offset = tagOffsets.get(trade.date) || 0;
    tagOffsets.set(trade.date, offset + 1);
    const stagger = [0, -20, 20, -40, 40][offset] || offset * 12;
    const x = Math.max(p + 10, Math.min(w - p - 10, xAt(index) + stagger));
    const y = sold ? toPriceY(item.high) - 8 : toPriceY(item.low) + 23;
    const title = `${trade.date} ${trade.operation}：${trade.reason}`;
    const tagWidth = shortSold ? 30 : 20;
    return `<g><title>${title}</title><rect x="${x-tagWidth/2}" y="${y-15}" width="${tagWidth}" height="15" rx="3" fill="${color}"/><text x="${x}" y="${y-4}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">${label}</text></g>`;
  }).join('');
  const ma20 = movingAverage(candles, 20), ma30 = movingAverage(candles, 30);
  const pe = pePoints.map(point => Number(point.pe_ttm));
  const lowPe = pePoints.map(point => point.dynamicLow);
  const newLowIndices = pePoints.map((point, index) => point.isNewLow ? index : -1).filter(index => index >= 0);
  const validPe = pe;
  const peMin = validPe.length ? Math.min(...validPe, ...lowPe.filter(value => value !== null)) * .95 : 0;
  const peMax = validPe.length ? Math.max(...validPe) * 1.05 : 1;
  const toPeY = value => h - bottom - ((value - peMin) / (peMax - peMin || 1)) * (h - top - bottom);
  const peXAt = index => xAtDate(pePoints[index].date);
  const axisDates = [chartStartMs, chartStartMs + (chartEndMs - chartStartMs) / 2, chartEndMs].map(value => new Date(value).toISOString().slice(0, 10));
  const sharedDates = axisDates.map((date, index) => `<text x="${p + index * (w - p * 2) / 2}" y="${h-8}" text-anchor="middle" fill="#64748b" font-size="10">${date}</text>`).join('');
  const peStartsHere = allPe.length && isVisibleDate(allPe[0].date);
  const kStartsHere = allK.length && isVisibleDate(allK[0].date);
  const seriesStarts = `${peStartsHere ? `<text x="${xAtDate(allPe[0].date)}" y="12" text-anchor="start" fill="#df5353" font-size="9">PE起 ${allPe[0].date}</text>` : ''}${kStartsHere ? `<text x="${xAtDate(allK[0].date)}" y="${h-bottom-5}" text-anchor="start" fill="#64748b" font-size="9">K起 ${allK[0].date}</text>` : ''}`;
  let lastLowLabelX = -Infinity;
  const lowMarkers = newLowIndices.map((index, markerIndex) => {
    const x = peXAt(index), y = toPeY(pe[index]);
    const showLabel = x - lastLowLabelX >= 54 || markerIndex === newLowIndices.length - 1;
    if (showLabel) lastLowLabelX = x;
    return `<g><circle cx="${x}" cy="${y}" r="2.8" fill="#15a394" stroke="#fff" stroke-width="1"/>${showLabel ? `<text x="${x + 4}" y="${y - 5}" fill="#0b8b78" font-size="8">新低</text>` : ''}</g>`;
  }).join('');
  const peLines = validPe.length ? `<path d="${lineForSeries(pe, peXAt, toPeY)}" fill="none" stroke="#df5353" stroke-width="1.8"/><path d="${lineForSeries(lowPe, peXAt, toPeY)}" fill="none" stroke="#15a394" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${w-8}" y="${top+10}" text-anchor="end" fill="#df5353" font-size="10">PE ${peMax.toFixed(1)}</text><text x="${w-8}" y="${h-bottom}" text-anchor="end" fill="#15a394" font-size="10">PE ${peMin.toFixed(1)}</text>` : `<text x="${w / 2}" y="${top + 20}" text-anchor="middle" fill="#94a3b8" font-size="11">${valuationUnavailableReasons.get(selected.code) || '跟踪指数官方未公开历史PETTM'}</text>`;
  const crosshair = `<g id="chart-crosshair" style="display:none" pointer-events="none"><line id="crosshair-line" y1="${top}" y2="${h-bottom}" stroke="#50647f" stroke-width=".8" stroke-dasharray="3 3"/><rect id="crosshair-box" y="${top+8}" width="150" height="55" rx="4" fill="#17243a" fill-opacity=".9"/><text id="crosshair-text" y="${top+24}" fill="#fff" font-size="10"><tspan id="crosshair-date" x="0"></tspan><tspan id="crosshair-price" x="0" dy="15"></tspan><tspan id="crosshair-pe" x="0" dy="15"></tspan></text><rect id="crosshair-date-box" y="${h-bottom+3}" width="76" height="18" rx="3" fill="#17243a"/><text id="crosshair-axis-date" y="${h-8}" text-anchor="middle" fill="#fff" font-size="9"></text></g>`;
  document.getElementById('market-chart').innerHTML = `${svgBase(w,h)}${priceGrid}${bars}<path d="${lineForSeries(ma20, xAt, toPriceY)}" fill="none" stroke="#df8b16" stroke-width="1.5" stroke-dasharray="5 4"/><path d="${lineForSeries(ma30, xAt, toPriceY)}" fill="none" stroke="#805ad5" stroke-width="1.5" stroke-dasharray="3 4"/>${peLines}${lowMarkers}${tags}<text x="8" y="${top + 10}" fill="#64748b" font-size="10">价格</text>${seriesStarts}${sharedDates}${crosshair}</svg>`;
  activeChartModel = {
    w, h, p, top, bottom,
    startMs: chartStartMs,
    endMs: chartEndMs,
    naturalStartMs,
    naturalEndMs: latestMs,
    candles: allK,
    pePoints: allPe,
    candleStartMs: Date.parse(`${allK[0].date}T00:00:00Z`),
    candleEndMs: Date.parse(`${allK.at(-1).date}T00:00:00Z`),
    peStartMs: allPe.length ? Date.parse(`${allPe[0].date}T00:00:00Z`) : null,
    peEndMs: allPe.length ? Date.parse(`${allPe.at(-1).date}T00:00:00Z`) : null
  };
}

function drawReturnChart(capital, curve = []) {
  const w=840,h=245,p=26;
  if (!curve.length) {
    document.getElementById('return-chart').innerHTML = `${svgBase(w,h)}<text x="${w/2}" y="${h/2}" text-anchor="middle" fill="#8794a8" font-size="13">执行回测后显示真实账户净值</text></svg>`;
    return;
  }
  const values = [{ date: '2020-01-01', equity: capital }, ...curve];
  const normalized = values.map(point => point.equity / capital);
  const min=Math.min(...normalized)*.96,max=Math.max(...normalized)*1.04;
  const grid=[0,1,2,3].map(i=>`<line x1="${p}" y1="${p+i*(h-p*2)/3}" x2="${w-p}" y2="${p+i*(h-p*2)/3}" stroke="#e9eff6"/>`).join('');
  document.getElementById('return-chart').innerHTML=`${svgBase(w,h)}${grid}<path d="${linePath(normalized,w,h,p,min,max)}" fill="none" stroke="#1769e8" stroke-width="2.5"/><text x="${p}" y="${h-6}" fill="#8b98aa" font-size="10">${values[0].date}</text><text x="${w-p}" y="${h-6}" text-anchor="end" fill="#8b98aa" font-size="10">${values.at(-1).date}</text><text x="${p}" y="17" fill="#1769e8" font-size="10">¥ ${money(values.at(-1).equity)}</text></svg>`;
}

let holdingOperations = {};
let backtestEndMonth = '2026-07';

function monthsFrom2020(endMonth) {
  const result = [];
  let year = 2020, month = 1;
  const [endYear, endValue] = endMonth.split('-').map(Number);
  while (year < endYear || (year === endYear && month <= endValue)) {
    result.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month === 13) { month = 1; year += 1; }
  }
  return result;
}

function holdingPeriodsFromOperations() {
  let held = 0;
  return monthsFrom2020(backtestEndMonth).map(period => {
    const records = holdingOperations[period] || [];
    const bought = records.reduce((sum, record) => Number(record[5]) > 0 ? sum + Number(record[5]) : sum, 0);
    const sold = records.reduce((sum, record) => Number(record[5]) < 0 ? sum - Number(record[5]) : sum, 0);
    held = Math.max(0, held + bought - sold);
    return { period, bought, sold, held };
  });
}

function renderHoldingOperations(period) {
  selectedHoldingPeriod = period;
  const records = holdingOperations[period] || [];
  document.getElementById('holding-operation-period').textContent = `${period} 买卖记录`;
  document.getElementById('holding-operation-count').textContent = `${records.length} 笔`;
  document.getElementById('holding-operation-list').innerHTML = records.length ? `
    <div class="holding-operation-row holding-operation-head"><span>持仓 ETF</span><span>买卖操作</span><span>买卖原因</span><span>收益</span><span>持仓时间</span></div>
    ${records.map(record => `<div class="holding-operation-row"><span class="holding-etf"><button type="button" class="holding-etf-link" data-operation-etf="${record[6] || ''}"><span>${record[0]}</span><small>${record[6] || ''}</small></button></span><span>${record[1]}</span><span>${record[2]}</span><span class="${record[3].startsWith('+') ? 'positive' : record[3].startsWith('-') ? 'negative' : ''}">${record[3]}</span><span>${record[4]}</span></div>`).join('')}` : '<div class="holding-empty">该月没有买卖操作</div>';
  document.querySelectorAll('[data-operation-etf]').forEach(button => button.addEventListener('click', () => openEtfDetail(button.dataset.operationEtf, 'portfolio')));
  document.querySelectorAll('[data-holding-period]').forEach(cell => cell.classList.toggle('active', cell.dataset.holdingPeriod === period));
}

function renderHoldingSummary() {
  const holdingPeriods = holdingPeriodsFromOperations();
  const tableWidth = 110 + holdingPeriods.length * 92;
  const rows = [
    ['时间', ...holdingPeriods.map(item => item.period)],
    ['购买份数', ...holdingPeriods.map(item => item.bought)],
    ['卖出份数', ...holdingPeriods.map(item => item.sold)],
    ['持仓份数', ...holdingPeriods.map(item => item.held)]
  ];
  document.getElementById('holding-summary').innerHTML = `<table class="holding-table" style="width:${tableWidth}px"><tbody>${rows.map((row, rowIndex) => `<tr>${row.map((value, columnIndex) => columnIndex === 0 ? `<th scope="row">${value}</th>` : `<td data-holding-period="${holdingPeriods[columnIndex - 1].period}" class="${holdingPeriods[columnIndex - 1].period === selectedHoldingPeriod ? 'active' : ''}">${rowIndex === 0 ? value : `${displayParts(Number(value))} 份`}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('[data-holding-period]').forEach(cell => cell.addEventListener('click', () => renderHoldingOperations(cell.dataset.holdingPeriod)));
  renderHoldingOperations(selectedHoldingPeriod);
}

function priceAtOrBefore(series, date) {
  let low = 0, high = series.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (series[middle].date <= date) low = middle + 1;
    else high = middle - 1;
  }
  return high >= 0 ? Number(series[high].close) : null;
}

function displayParts(value) {
  return Number(value.toFixed(2)).toString();
}

async function calculatePortfolioBacktest(capital, capitalParts, rules, progress) {
  const events = [], priceSeries = new Map(), priceByDate = new Map(), names = new Map(), allDates = new Set();
  let loadedDatasets = 0;
  let latestDate = '2020-01-01';
  for (let index = 0; index < etfs.length; index += 1) {
    const etf = etfs[index];
    try {
      const payload = await loadBacktestDataset(etf.code);
      const series = payload.ohlc.filter(row => row.date >= '2020-01-01');
      priceSeries.set(etf.code, series);
      priceByDate.set(etf.code, new Map(series.map(row => [row.date, row])));
      series.forEach(row => allDates.add(row.date));
      names.set(etf.code, etf.name);
      loadedDatasets += 1;
      latestDate = [latestDate, payload.ohlc.at(-1)?.date].filter(Boolean).sort().at(-1);
      const result = simulateEtfStrategy(payload, rules);
      result.trades.forEach((trade, sequence) => events.push({ ...trade, code: etf.code, name: etf.name, sequence }));
    } catch (error) {
      console.warn(`回测跳过 ${etf.code}：${error.message}`);
    }
    if ((index + 1) % 10 === 0 || index + 1 === etfs.length) {
      progress(`读取数据 ${index + 1}/${etfs.length}`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (!loadedDatasets) throw new Error('没有读取到可用的本地历史数据');
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'sell' ? -1 : 1) || a.code.localeCompare(b.code) || a.sequence - b.sequence);
  const eventsByDate = new Map();
  events.forEach(event => {
    if (!eventsByDate.has(event.date)) eventsByDate.set(event.date, []);
    eventsByDate.get(event.date).push(event);
    allDates.add(event.date);
  });
  let cash = capital;
  const holdings = new Map(), curve = [], monthly = {};
  const actualOperations = new Map();
  let pendingBuys = [];
  let pendingQueued = 0, pendingFilled = 0, pendingCanceled = 0;
  let maxHeldParts = 0;
  const openParts = () => [...holdings.values()].reduce((sum, holding) => sum + holding.parts, 0);
  const equityAt = date => cash + [...holdings.entries()].reduce((sum, [code, holding]) => {
    const price = priceAtOrBefore(priceSeries.get(code) || [], date) || holding.averagePrice;
    return sum + holding.quantity * price;
  }, 0);
  const addRecord = (date, row) => {
    const month = date.slice(0, 7);
    if (!monthly[month]) monthly[month] = [];
    monthly[month].push(row);
  };
  const addActualOperation = (code, operation) => {
    if (!actualOperations.has(code)) actualOperations.set(code, []);
    actualOperations.get(code).push(operation);
  };
  const executeBuy = (event, date, price, pending = false) => {
      if (openParts() + 1 > capitalParts + 1e-8) return false;
      const equity = equityAt(date);
      const partAmount = equity / capitalParts;
      if (cash + 1e-8 < partAmount) return false;
      const holding = holdings.get(event.code) || { quantity: 0, cost: 0, parts: 0, since: date, averagePrice: price };
      holding.quantity += partAmount / price;
      holding.cost += partAmount;
      holding.parts += 1;
      holding.averagePrice = holding.cost / holding.quantity;
      cash -= partAmount;
      holdings.set(event.code, holding);
      maxHeldParts = Math.max(maxHeldParts, openParts());
      const operation = pending ? '补仓 1 份（待买成交）' : event.operation;
      const reason = pending ? `${event.reason}；${event.date} 触发待买，本日价格仍低于 ${Number(event.triggerPrice).toFixed(3)}` : event.reason;
      addRecord(date, [event.name, operation, `${reason}；本份资金 ¥${money(partAmount)}`, '--', '--', 1, event.code]);
      addActualOperation(event.code, { date, operation, reason: `${reason}；本份资金 ¥${money(partAmount)}`, return: null, days: 0, type: 'buy', price, parts: 1 });
      return true;
  };
  const cancelPendingFor = (code, date) => {
    const canceled = pendingBuys.filter(item => item.code === code);
    canceled.forEach(item => {
      addRecord(date, [item.name, '取消待买', '本轮持仓已全部卖出，原补仓待买失效', '--', '--', 0, item.code]);
      addActualOperation(item.code, { date, operation: '取消待买', reason: '本轮持仓已全部卖出，原补仓待买失效', return: null, days: 0, type: 'status' });
    });
    pendingCanceled += canceled.length;
    pendingBuys = pendingBuys.filter(item => item.code !== code);
  };
  const executeSell = (event, date) => {
      const holding = holdings.get(event.code);
      if (!holding) return false;
      const actualHoldingDays = (priceSeries.get(event.code) || []).reduce((count, candle) => count + (candle.date >= holding.since && candle.date <= date ? 1 : 0), 0);
      const fraction = Math.min(1, Number(event.fraction) || 1);
      const soldQuantity = holding.quantity * fraction;
      const soldCost = holding.cost * fraction;
      const soldParts = holding.parts * fraction;
      const proceeds = soldQuantity * event.price;
      const profit = soldCost ? proceeds / soldCost - 1 : 0;
      cash += proceeds;
      holding.quantity -= soldQuantity;
      holding.cost -= soldCost;
      holding.parts -= soldParts;
      if (holding.quantity <= 1e-8) {
        holdings.delete(event.code);
        cancelPendingFor(event.code, date);
      }
      else holdings.set(event.code, holding);
      addRecord(date, [event.name, `卖出 ${displayParts(soldParts)} 份`, event.reason, signed(profit * 100), `${actualHoldingDays} 天`, -soldParts, event.code]);
      addActualOperation(event.code, { date, operation: `卖出 ${displayParts(soldParts)} 份`, reason: event.reason, return: profit, days: actualHoldingDays, type: 'sell', price: event.price, fraction });
      return true;
  };
  const queuePendingBuy = event => {
    if (!event.isSupplement || pendingBuys.some(item => item.code === event.code && item.sequence === event.sequence)) return;
    pendingBuys.push(event);
    pendingQueued += 1;
    addRecord(event.date, [event.name, '待买 1 份', `${event.reason}；资金份数已用完，等待可用份数`, '--', '待买', 0, event.code]);
    addActualOperation(event.code, { date: event.date, operation: '待买 1 份', reason: `${event.reason}；资金份数已用完，等待可用份数`, return: null, days: 0, type: 'pending' });
  };
  const fillPendingBuys = date => {
    const remaining = [];
    pendingBuys.forEach(event => {
      const candle = priceByDate.get(event.code)?.get(date);
      const remainsBelowTrigger = candle && Number(candle.low) <= Number(event.triggerPrice);
      if (!remainsBelowTrigger || openParts() + 1 > capitalParts + 1e-8) {
        remaining.push(event);
        return;
      }
      const fillPrice = Number(candle.open) <= Number(event.triggerPrice) ? Number(candle.open) : Number(event.triggerPrice);
      if (executeBuy(event, date, fillPrice, true)) pendingFilled += 1;
      else remaining.push(event);
    });
    pendingBuys = remaining;
  };

  [...allDates].filter(date => date >= '2020-01-01').sort().forEach(date => {
    const dayEvents = eventsByDate.get(date) || [];
    dayEvents.filter(event => event.type === 'sell').forEach(event => executeSell(event, date));
    fillPendingBuys(date);
    dayEvents.filter(event => event.type === 'buy').forEach(event => {
      if (!event.price) return;
      if (openParts() + 1 > capitalParts + 1e-8) {
        queuePendingBuy(event);
        return;
      }
      executeBuy(event, date, Number(event.price));
    });
    curve.push({ date, equity: equityAt(date) });
  });

  const finalEquity = equityAt(latestDate);
  const endMonth = latestDate.slice(0, 7);
  holdings.forEach((holding, code) => {
    const latestPrice = priceAtOrBefore(priceSeries.get(code) || [], latestDate) || holding.averagePrice;
    const profit = holding.cost ? holding.quantity * latestPrice / holding.cost - 1 : 0;
    addRecord(latestDate, [names.get(code) || code, '持仓至今', `自 ${holding.since} 持有 ${displayParts(holding.parts)} 份`, signed(profit * 100), '至今', 0, code]);
    addActualOperation(code, { date: latestDate, operation: '持仓至今', reason: `自 ${holding.since} 持有 ${displayParts(holding.parts)} 份`, return: profit, days: 0, type: 'status' });
  });
  pendingBuys.forEach(event => {
    addRecord(latestDate, [event.name, '待买至今', `自 ${event.date} 等待补仓 1 份；触发价 ${Number(event.triggerPrice).toFixed(3)}`, '--', '待买中', 0, event.code]);
    addActualOperation(event.code, { date: latestDate, operation: '待买至今', reason: `自 ${event.date} 等待补仓 1 份；触发价 ${Number(event.triggerPrice).toFixed(3)}`, return: null, days: 0, type: 'status' });
  });
  const years = Math.max(1 / 12, (Date.parse(latestDate) - Date.parse('2020-01-01')) / 31557600000);
  let peak = capital, maxDrawdown = 0;
  curve.forEach(point => { peak = Math.max(peak, point.equity); maxDrawdown = Math.min(maxDrawdown, point.equity / peak - 1); });
  return { finalEquity, return: (finalEquity / capital - 1) * 100, annualized: (Math.pow(finalEquity / capital, 1 / years) - 1) * 100, maxDrawdown: maxDrawdown * 100, curve, monthly, endMonth, maxHeldParts, pendingQueued, pendingFilled, pendingCanceled, pendingOpen: pendingBuys.length, actualOperations };
}

async function runBacktest() {
  const capital = Math.max(10000, Number(document.getElementById('initial-capital').value) || 100000);
  const capitalParts = Math.max(1, Math.min(100, Math.round(Number(document.getElementById('capital-parts').value) || 5)));
  document.getElementById('capital-parts').value = capitalParts;
  const button = document.getElementById('run-backtest');
  button.disabled = true;
  button.textContent = '正在回测';
  try {
    const result = await calculatePortfolioBacktest(capital, capitalParts, { ...strategy }, message => { button.textContent = message; });
    holdingOperations = result.monthly;
    portfolioDetailOperations = result.actualOperations;
    portfolioDetailRules = { ...strategy };
    backtestEndMonth = result.endMonth;
    if (!monthsFrom2020(backtestEndMonth).includes(selectedHoldingPeriod)) selectedHoldingPeriod = backtestEndMonth;
    document.getElementById('backtest-stats').innerHTML = [metric('期末资产', `¥ ${money(result.finalEquity)}`), metric('策略收益', signed(result.return), result.return >= 0 ? 'positive' : 'negative'), metric('年化收益', signed(result.annualized), result.annualized >= 0 ? 'positive' : 'negative'), metric('最大回撤', signed(result.maxDrawdown), 'negative')].join('');
    renderHoldingSummary();
    renderRuleSummaries(); drawReturnChart(capital, result.curve);
    button.innerHTML = '回测完成 <span>✓</span>';
  } catch (error) {
    button.textContent = `回测失败：${error.message}`;
  } finally {
    button.disabled = false;
    setTimeout(() => { button.innerHTML = '执行回测 <span>→</span>'; }, 1400);
  }
}

document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => switchPage(el.dataset.page)));
document.getElementById('etf-search').addEventListener('input', e => renderTable(e.target.value));
document.getElementById('run-screen').addEventListener('click', executeScreeningBacktest);
document.getElementById('apply-detail-strategy').addEventListener('click', executeDetailBacktest);
document.getElementById('run-backtest').addEventListener('click', runBacktest);
document.getElementById('refresh-optional-etfs').addEventListener('click', refreshOptionalEtfs);
document.getElementById('market-chart').addEventListener('wheel', event => {
  event.preventDefault();
  if (!activeChartModel) return;
  const factor = event.deltaY > 0 ? 1.2 : .82;
  const { w, p, startMs, endMs, naturalStartMs, naturalEndMs } = activeChartModel;
  const rect = event.currentTarget.getBoundingClientRect();
  const pointerX = Math.max(p, Math.min(w - p, (event.clientX - rect.left) / rect.width * w));
  const anchorRatio = (pointerX - p) / (w - p * 2);
  const anchorMs = startMs + anchorRatio * (endMs - startMs);
  const fullSpan = naturalEndMs - naturalStartMs;
  const minimumSpan = Math.min(fullSpan, 90 * 86400000);
  const nextSpan = Math.max(minimumSpan, Math.min(fullSpan, (endMs - startMs) * factor));
  let nextStart = anchorMs - anchorRatio * nextSpan;
  let nextEnd = nextStart + nextSpan;
  if (nextStart < naturalStartMs) { nextStart = naturalStartMs; nextEnd = nextStart + nextSpan; }
  if (nextEnd > naturalEndMs) { nextEnd = naturalEndMs; nextStart = nextEnd - nextSpan; }
  chartWindow = nextSpan >= fullSpan - 1 ? null : { startMs: nextStart, endMs: nextEnd };
  drawMarketChart();
}, { passive: false });

function nearestChartPoint(points, targetMs, preferPrevious = false) {
  if (!points.length) return null;
  let low = 0, high = points.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const value = Date.parse(`${points[middle].date}T00:00:00Z`);
    if (value <= targetMs) low = middle + 1;
    else high = middle - 1;
  }
  if (preferPrevious) return high >= 0 ? points[high] : null;
  if (high < 0) return points[0];
  if (low >= points.length) return points.at(-1);
  const before = Date.parse(`${points[high].date}T00:00:00Z`);
  const after = Date.parse(`${points[low].date}T00:00:00Z`);
  return targetMs - before <= after - targetMs ? points[high] : points[low];
}

document.getElementById('market-chart').addEventListener('mousemove', event => {
  if (!activeChartModel) return;
  const svg = document.querySelector('#market-chart svg');
  const group = document.getElementById('chart-crosshair');
  if (!svg || !group) return;
  const rect = svg.getBoundingClientRect();
  const { w, p, top, startMs, endMs, candles, pePoints, candleStartMs, candleEndMs, peStartMs, peEndMs } = activeChartModel;
  const svgX = Math.max(p, Math.min(w - p, (event.clientX - rect.left) / rect.width * w));
  const targetMs = startMs + (svgX - p) / (w - p * 2) * (endMs - startMs);
  const candle = targetMs >= candleStartMs && targetMs <= candleEndMs ? nearestChartPoint(candles, targetMs, true) : null;
  const pePoint = peStartMs !== null && targetMs >= peStartMs && targetMs <= peEndMs ? nearestChartPoint(pePoints, targetMs, true) : null;
  const date = new Date(targetMs).toISOString().slice(0, 10);
  const boxX = svgX > w - 210 ? svgX - 158 : svgX + 8;
  group.style.display = '';
  document.getElementById('crosshair-line').setAttribute('x1', svgX); document.getElementById('crosshair-line').setAttribute('x2', svgX);
  document.getElementById('crosshair-box').setAttribute('x', boxX);
  document.getElementById('crosshair-date').setAttribute('x', boxX + 9); document.getElementById('crosshair-date').textContent = date;
  document.getElementById('crosshair-price').setAttribute('x', boxX + 9); document.getElementById('crosshair-price').textContent = `ETF收盘 ${candle ? Number(candle.close).toFixed(3) : '--'}`;
  document.getElementById('crosshair-pe').setAttribute('x', boxX + 9); document.getElementById('crosshair-pe').textContent = `PETTM ${pePoint ? Number(pePoint.pe_ttm).toFixed(2) : '--'}`;
  document.getElementById('crosshair-date-box').setAttribute('x', svgX - 38);
  document.getElementById('crosshair-axis-date').setAttribute('x', svgX); document.getElementById('crosshair-axis-date').textContent = date;
});

document.getElementById('market-chart').addEventListener('mouseleave', () => {
  const group = document.getElementById('chart-crosshair');
  if (group) group.style.display = 'none';
});

document.getElementById('eligible-count').textContent = etfs.length;
renderStrategyEditors(); renderRuleSummaries(); renderTable(); renderDetail();
document.getElementById('backtest-stats').innerHTML = [metric('期末资产', '--'), metric('策略收益', '--'), metric('年化收益', '--'), metric('最大回撤', '--')].join('');
renderHoldingSummary();
drawReturnChart(Number(document.getElementById('initial-capital').value) || 100000, []);

async function loadLocalUniverse() {
  try {
    const response = await fetch('data/dashboard_universe.json');
    if (!response.ok) throw new Error('本地ETF清单不存在');
    const payload = await response.json();
    if (!Array.isArray(payload.etfs) || !payload.etfs.length) throw new Error('本地ETF清单为空');
    etfs = payload.etfs;
    dashboardMeta = { ...(payload.meta || {}), updatedAt: payload.updatedAt || payload.meta?.updatedAt || '' };
    selected = etfs.find(item => item.code === '512760') || etfs[0];
    document.getElementById('eligible-count').textContent = etfs.length;
    renderTable(); renderDetail(); renderDataStatus();
    if (activePage === 'profile') refreshOptionalEtfs();
  } catch (error) {
    console.warn('未加载本地真实ETF清单，继续显示离线示例列表。', error);
    renderDataStatus();
  }
}

loadLocalUniverse();
