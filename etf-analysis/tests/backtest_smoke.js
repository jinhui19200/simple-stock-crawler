const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const elements = new Map();
let optionalLinks = [];

function element(id) {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      value: id === 'initial-capital' ? '100000' : id === 'capital-parts' ? '5' : '',
      innerHTML: '',
      textContent: '',
      disabled: false,
      dataset: {},
      style: {},
      childNodes: [{ nodeValue: '' }],
      classList: { toggle() {} },
      addEventListener() {},
      querySelectorAll() { return []; }
    });
  }
  return elements.get(id);
}

const context = vm.createContext({
  console,
  Intl,
  Map,
  Set,
  Date,
  Math,
  Number,
  Array,
  String,
  Promise,
  setTimeout,
  clearTimeout,
  document: {
    getElementById: element,
    querySelectorAll(selector) {
      if (selector !== '[data-optional-etf]') return [];
      optionalLinks = [...element('optional-etf-body').innerHTML.matchAll(/data-optional-etf="(\d{6})"/g)].map(match => ({
        dataset: { optionalEtf: match[1] },
        addEventListener(event, callback) { this.click = callback; }
      }));
      return optionalLinks;
    },
    querySelector() { return null; }
  },
  window: { scrollTo() {} },
  fetch: async relativePath => {
    const filePath = path.join(root, String(relativePath).split('?')[0]);
    if (!fs.existsSync(filePath)) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  }
});

vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context, { filename: 'app.js' });

async function run() {
  await new Promise(resolve => setTimeout(resolve, 50));
  const rules = vm.runInContext('({ ...strategy })', context);
  const result5 = await vm.runInContext('calculatePortfolioBacktest(100000, 5, strategy, () => {})', context);
  const result10 = await vm.runInContext('calculatePortfolioBacktest(100000, 10, strategy, () => {})', context);
  const result20 = await vm.runInContext('calculatePortfolioBacktest(100000, 20, strategy, () => {})', context);
  const detailResult = await vm.runInContext("loadBacktestDataset('512760').then(payload => simulateEtfStrategy(payload, strategy))", context);
  const detailHighTarget = await vm.runInContext("loadBacktestDataset('512760').then(payload => simulateEtfStrategy(payload, { ...strategy, annualRate: 200 }))", context);

  const records5 = Object.values(result5.monthly).flat();
  const records10 = Object.values(result10.monthly).flat();
  const firstBuy5 = records5.find(row => /买入|补仓/.test(row[1]));
  const firstBuy10 = records10.find(row => /买入|补仓/.test(row[1]));
  assert(firstBuy5 && firstBuy5[2].includes('¥20,000'), '5份配置的首笔资金应为20,000元');
  assert(firstBuy10 && firstBuy10[2].includes('¥10,000'), '10份配置的首笔资金应为10,000元');
  assert(records5.some(row => row[1] === '待买 1 份'), '操作列表应标记补仓待买');
  assert(records5.some(row => row[1].includes('待买成交')), '操作列表应标记待买补仓成交');
  assert(records5.some(row => row[1] === '待买至今'), '最新月份应显示仍未成交的待买状态');
  assert.notStrictEqual(result5.finalEquity, result10.finalEquity, '资金份数应改变回测结果');
  assert(result5.maxHeldParts <= 5, '5份配置的同时持仓不能超过5份');
  assert(result10.maxHeldParts <= 10, '10份配置的同时持仓不能超过10份');
  assert(result20.maxHeldParts <= 20, '20份配置的同时持仓不能超过20份');
  assert(result5.pendingQueued > 0, '份数用满时应生成补仓待买记录');
  assert(result5.pendingFilled > 0, '释放份数且价格仍低于触发价时应成交待买补仓');
  context.result20ForUi = result20;
  const visibleMax20 = vm.runInContext(`holdingOperations = result20ForUi.monthly;
    backtestEndMonth = result20ForUi.endMonth;
    Math.max(...holdingPeriodsFromOperations().map(item => item.held))`, context);
  assert(visibleMax20 <= 20, '持仓明细显示的份数不能超过20份');
  const operationRecords20 = Object.values(result20.monthly).flat();
  assert(operationRecords20.length > 0 && operationRecords20.every(record => /^\d{6}$/.test(record[6])), '每条持仓操作必须包含可跳转的ETF代码');
  assert(result5.actualOperations.size > 0, '组合回测必须保存可用于详情页的实际操作');
  const actualCode = [...result5.actualOperations.keys()][0];
  context.actualOperationsForUi = result5.actualOperations;
  context.actualCodeForUi = actualCode;
  vm.runInContext(`portfolioDetailOperations = actualOperationsForUi;
    portfolioDetailRules = { ...strategy };
    openEtfDetail(actualCodeForUi, 'portfolio')`, context);
  assert(elements.get('detail-record-rule').textContent.startsWith('组合回测实际操作'), '从持仓列表进入详情应显示组合实际操作');
  const editorHtml = vm.runInContext("strategyEditor('test')", context);
  assert.strictEqual((editorHtml.match(/data-strategy-field="annualRate"/g) || []).length, 1, '年化收益输入框只应在选项一中保留一个');
  assert(Object.keys(result5.monthly).every(month => month >= '2020-01'), '持仓明细不能早于2020-01');
  assert.strictEqual(vm.runInContext("monthsFrom2020('2020-03').join(',')", context), '2020-01,2020-02,2020-03');

  const chartModel = await vm.runInContext(`(async () => {
    const payload = await loadBacktestDataset('512760');
    selected = etfs.find(item => item.code === '512760');
    verifiedOhlc.set('512760', payload.ohlc);
    verifiedValuation.set('512760', payload.valuation || []);
    drawMarketChart();
    return {
      start: new Date(activeChartModel.startMs).toISOString().slice(0, 10),
      candleStart: new Date(activeChartModel.candleStartMs).toISOString().slice(0, 10),
      peStart: new Date(activeChartModel.peStartMs).toISOString().slice(0, 10)
    };
  })()`, context);
  assert(chartModel.start <= chartModel.peStart, '图表共享时间轴必须覆盖PE起始日期');
  assert(chartModel.candleStart >= '2020-01-01', 'K线不得早于2020年');
  assert(chartModel.peStart < chartModel.candleStart, 'PE与K线应共轴但允许不同起点');
  assert.strictEqual(detailResult.return, detailResult.netProfit * 100, '各份资金收益直接相加的公式不正确');
  const percentile512760 = await vm.runInContext("loadBacktestDataset('512760').then(payload => calculatePricePercentile(payload.ohlc))", context);
  const pricePayload = JSON.parse(fs.readFileSync(path.join(root, 'data/etf/512760.json'), 'utf8'));
  const priceHistory = pricePayload.ohlc.filter(row => row.date >= '2020-01-01').map(row => Number(row.close));
  const expectedPercentile = priceHistory.filter(value => value <= priceHistory.at(-1)).length / priceHistory.length * 100;
  assert(Math.abs(percentile512760 - expectedPercentile) < 1e-9, '成交价历史分位计算不正确');
  assert(elements.get('update-message').textContent.includes('最近发布'), '顶部应区分最近发布时间和实际数据日期');
  assert.strictEqual(elements.get('data-status-banner').hidden, false, '数据状态提示应可见');
  vm.runInContext(`etfs[0].stale = true; etfs[0].latestPriceDate = '2026-01-01'; renderTable();`, context);
  assert(elements.get('etf-table-body').innerHTML.includes('数据过旧'), '过旧 ETF 应在列表中标记');

  const optionalSignals = vm.runInContext(`collectOptionalSignals([
    { etf: { code: '512760', name: '芯片ETF' }, latestDate: '2026-10-23', stale: false,
      result: { available: true, trades: [
        { date: '2025-10-23', type: 'buy', reason: '过期信号' },
        { date: '2025-10-24', type: 'buy', reason: '边界买入' },
        { date: '2026-10-22', type: 'buy', isSupplement: true, reason: '价格跌至首次买入价的 70.00%' },
        { date: '2026-10-23', type: 'sell', reason: '卖出不应入选' },
        { date: '2026-10-25', type: 'buy', reason: '未来信号' }
      ] } },
    { etf: { code: '159796', name: '电池ETF' }, latestDate: '2026-10-23', stale: true,
      result: { available: true, trades: [{ date: '2026-10-23', type: 'buy', reason: '行业 PETTM 创动态历史新低' }] } },
    { etf: { code: '000000', name: '不可用ETF' }, result: { available: false, trades: [{ date: '2026-10-24', type: 'buy' }] } }
  ], '2026-10-24')`, context);
  assert.strictEqual(optionalSignals.length, 3, '只应保留最近一年内的可用买入信号');
  assert.strictEqual(optionalSignals.map(row => row.date).join(','), '2026-10-23,2026-10-22,2025-10-24', '信号应从近到远排序，包含一年边界');
  assert.strictEqual(optionalSignals[1].condition, '加仓', '补仓信号必须标为加仓');
  assert(optionalSignals[1].reason.includes('70.00%'), '加仓原因应保留具体触发条件');
  assert.strictEqual(optionalSignals[0].stale, true, '必须保留缓存过旧状态');
  assert.strictEqual(vm.runInContext("recentSignalRange('2024-02-29').start", context), '2023-02-28', '闰年的一年边界应回退至2月28日');
  await vm.runInContext('refreshOptionalEtfs()', context);
  const optionalSummary = elements.get('optional-etf-status').textContent;
  assert(elements.get('optional-etf-rule').textContent.includes('当前策略'), '个人页应说明使用的共用策略');
  assert(elements.get('optional-etf-status').textContent.includes('100/100') || elements.get('optional-etf-status').textContent.includes('缺少官方 PETTM'), '个人页应显示真实数据计算覆盖情况');
  assert(!elements.get('optional-etf-body').innerHTML.includes('正在按当前条件'), '列表计算应完成');
  assert.strictEqual(elements.get('refresh-optional-etfs').disabled, false, '计算后应可刷新');
  if (optionalLinks.length) {
    const firstLink = optionalLinks[0];
    firstLink.click();
    assert.strictEqual(vm.runInContext('selected.code', context), firstLink.dataset.optionalEtf, '点击可选ETF应进入对应详情');
    assert(vm.runInContext('selected.strategyComputed && detailPortfolioCode === null', context), '信号详情应展示同一策略的操作记录');
    assert.strictEqual(elements.get('page-title').textContent, 'ETF 详情', '点击应切换至详情页');
  }
  const optionalCountBeforeScreenRuleChange = optionalLinks.length;
  await vm.runInContext(`(async () => {
    strategy.sellRule = 'thirty'; strategy.optionTwo = 75;
    await refreshOptionalEtfs();
  })()`, context);
  assert.strictEqual(optionalLinks.length, optionalCountBeforeScreenRuleChange, '筛选页卖出条件变化不能改变个人页独立买入信号');
  assert(elements.get('optional-etf-rule').textContent.includes('个人独立买入条件'), '个人页应说明使用独立买入条件');
  vm.runInContext("strategy.sellRule = 'time'; strategy.optionTwo = 30", context);
  const realDashboardMeta = vm.runInContext('dashboardMeta', context);
  vm.runInContext('dashboardMeta = null', context);
  await vm.runInContext('refreshOptionalEtfs()', context);
  assert(elements.get('optional-etf-body').innerHTML.includes('真实数据尚未就绪'), '真实清单不可用时不得使用示例ETF产生信号');
  context.realDashboardMeta = realDashboardMeta;
  vm.runInContext('dashboardMeta = realDashboardMeta', context);

  console.log(JSON.stringify({
    etfCount: vm.runInContext('etfs.length', context),
    optionalEtfs: optionalSummary,
    parts5: { firstPart: 20000, finalEquity: result5.finalEquity, pendingQueued: result5.pendingQueued, pendingFilled: result5.pendingFilled, pendingCanceled: result5.pendingCanceled, pendingOpen: result5.pendingOpen },
    parts10: { firstPart: 10000, finalEquity: result10.finalEquity },
    parts20: { firstPart: 5000, finalEquity: result20.finalEquity, maxHeldParts: result20.maxHeldParts, visibleMaxParts: visibleMax20 },
    firstHoldingMonth: '2020-01',
    chart: chartModel,
    detail512760: {
      return: detailResult.return,
      netProfitParts: detailResult.netProfit,
      cumulativeBuyParts: detailResult.investedCost
    },
    detail512760Annual200: {
      return: detailHighTarget.return,
      netProfitParts: detailHighTarget.netProfit,
      cumulativeBuyParts: detailHighTarget.investedCost
    },
    percentile512760,
    sellRule: rules.sellRule
  }, null, 2));
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
