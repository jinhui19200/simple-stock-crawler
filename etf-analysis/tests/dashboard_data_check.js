// Validate the currently published universe without assuming fixed ETF membership.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const universe = read('data/dashboard_universe.json');
assert(Array.isArray(universe.etfs) && universe.etfs.length > 0 && universe.etfs.length <= 100, '有效名单应包含1至100只ETF');
assert.strictEqual(new Set(universe.etfs.map(row => row.code)).size, universe.etfs.length, 'ETF代码不能重复');
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {
    value: id === 'initial-capital' ? '100000' : id === 'capital-parts' ? '20' : '',
    innerHTML: '', textContent: '', dataset: {}, style: {}, childNodes: [{ nodeValue: '' }],
    classList: { toggle() {} }, addEventListener() {}, querySelectorAll() { return []; }
  });
  return elements.get(id);
};
const context = vm.createContext({
  console, Intl, Map, Set, Date, Math, Number, Array, String, Promise, setTimeout, clearTimeout,
  document: { getElementById: element, querySelectorAll() { return []; }, querySelector() { return null; } },
  window: { scrollTo() {} },
  fetch: async relative => {
    try { return { ok: true, json: async () => read(String(relative).split('?')[0]) }; }
    catch (_) { return { ok: false }; }
  }
});
vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), context);

async function main() {
  await new Promise(resolve => setTimeout(resolve, 0));
  let published = 0;
  let withValuation = 0;
  for (const etf of universe.etfs) {
    if (etf.dataAvailable === false) {
      assert(etf.stale && etf.staleReason, `${etf.code}: 不可用数据必须标明原因`);
      continue;
    }
    const payload = read(`data/etf/${etf.code}.json`);
    assert(payload.validation?.passed && payload.ohlc.length, `${etf.code}: 日K必须经过校验`);
    let previous = '';
    for (const row of payload.ohlc) {
      assert(/^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.date > previous, `${etf.code}: 日期必须递增且不重复`);
      assert([row.open, row.close, row.high, row.low].every(value => Number.isFinite(value) && value > 0), `${etf.code}: OHLC必须为正数`);
      assert(row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close), `${etf.code}: OHLC关系错误`);
      previous = row.date;
    }
    assert.strictEqual(previous, etf.latestPriceDate, `${etf.code}: 列表和图表最新日期应一致`);
    previous = '';
    for (const point of payload.valuation || []) {
      assert(point.date >= '2016-01-01' && point.date > previous && Number.isFinite(point.pe_ttm) && point.pe_ttm > 0, `${etf.code}: PETTM日期或数值无效`);
      previous = point.date;
    }
    context.checkedPayload = payload;
    const result = vm.runInContext('simulateEtfStrategy(checkedPayload, strategy)', context);
    if (payload.valuation?.length) {
      withValuation += 1;
      assert(result.available && Number.isFinite(result.return), `${etf.code}: 策略结果必须有效`);
      const dates = new Set(payload.ohlc.filter(row => row.date >= '2020-01-01').map(row => row.date));
      assert(result.trades.every(trade => dates.has(trade.date) && trade.price > 0), `${etf.code}: 操作应来自真实交易日`);
    } else assert(!result.available && result.trades.length === 0, `${etf.code}: 无官方估值时不得产生交易`);
    published += 1;
  }
  assert(published > 0, '至少应有一只有效ETF可发布');
  await vm.runInContext('refreshOptionalEtfs()', context);
  assert.strictEqual(element('refresh-optional-etfs').disabled, false, '个人页信号计算必须完成');
  const portfolio = await vm.runInContext('calculatePortfolioBacktest(100000, 20, strategy, () => {})', context);
  assert(Number.isFinite(portfolio.finalEquity) && portfolio.finalEquity >= 0, '账户净值应有效');
  assert(portfolio.maxHeldParts <= 20, '持仓份数不能超过初始20份');
  console.log(JSON.stringify({ listed: universe.etfs.length, published, withValuation, optionalEtfs: element('optional-etf-status').textContent }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
