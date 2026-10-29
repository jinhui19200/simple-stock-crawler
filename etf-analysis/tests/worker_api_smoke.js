const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const rows = new Map();
const database = {
  prepare(sql) {
    const statement = {
      async all() {
        return { results: [...rows.values()].sort((a, b) => b.buy_date.localeCompare(a.buy_date)) };
      },
      bind(...values) {
        return {
          async run() {
            if (sql.startsWith('INSERT')) {
              const [id, code, buy_date, buy_price, sell_date, sell_price, parts, buy_condition, sell_condition, sell_reason, created_at, updated_at] = values;
              rows.set(id, { id, code, buy_date, buy_price, sell_date, sell_price, parts, buy_condition, sell_condition, sell_reason, created_at, updated_at });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('UPDATE')) {
              const id = values.at(-1);
              if (!rows.has(id)) return { meta: { changes: 0 } };
              const old = rows.get(id);
              const [code, buy_date, buy_price, sell_date, sell_price, parts, buy_condition, sell_condition, sell_reason, updated_at] = values;
              rows.set(id, { ...old, code, buy_date, buy_price, sell_date, sell_price, parts, buy_condition, sell_condition, sell_reason, updated_at });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('DELETE')) {
              const id = values[0];
              const existed = rows.delete(id);
              return { meta: { changes: existed ? 1 : 0 } };
            }
            return { meta: { changes: 0 } };
          }
        };
      }
    };
    return statement;
  }
};

const context = vm.createContext({
  Request, Response, URL, crypto,
  globalThis: {},
  console
});
vm.runInContext(
  fs.readFileSync('worker.js', 'utf8').replace('export default', 'globalThis.worker ='),
  context,
  { filename: 'worker.js' }
);

async function call(path, init = {}) {
  const response = await context.globalThis.worker.fetch(
    new Request(`https://example.test${path}`, init),
    { DB: database, ASSETS: { fetch: async () => new Response('asset') } }
  );
  return { status: response.status, body: await response.json() };
}

(async () => {
  let result = await call('/api/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '512760', buy_date: '2026-10-28', buy_price: 0.853, parts: 1, buy_condition: '估值低' })
  });
  assert.strictEqual(result.status, 201);
  const id = result.body.id;
  result = await call('/api/operations');
  assert.strictEqual(result.body.operations.length, 1);
  result = await call(`/api/operations/${id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: '512760', buy_date: '2026-10-28', buy_price: 0.853, sell_date: '2026-10-29', sell_price: 0.9, parts: 1, buy_condition: '估值低', sell_condition: '目标收益', sell_reason: '达到目标' })
  });
  assert.strictEqual(result.status, 200);
  result = await call(`/api/operations/${id}`, { method: 'DELETE' });
  assert.strictEqual(result.status, 200);
  result = await call('/api/operations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'bad', buy_date: '2026-10-28', buy_price: 1, parts: 1 })
  });
  assert.strictEqual(result.status, 400);
  console.log('Worker operations API smoke: OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
