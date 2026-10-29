const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'access-control-allow-headers': 'content-type',
};
const writeBuckets = new Map();

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: JSON_HEADERS,
});

const now = () => new Date().toISOString();

function withHeaders(response) {
  const headers = new Headers(response.headers);
  Object.entries(JSON_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, { status: response.status, headers });
}

function validateOperation(input) {
  const code = String(input.code || '').trim();
  const buyDate = String(input.buy_date || '').trim();
  const buyPrice = Number(input.buy_price);
  const parts = Number(input.parts ?? 1);
  const sellDate = input.sell_date ? String(input.sell_date).trim() : null;
  const sellPrice = input.sell_price === '' || input.sell_price == null ? null : Number(input.sell_price);
  if (!/^\d{6}$/.test(code)) throw new Error('代码必须是6位数字');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(buyDate)) throw new Error('买入日期格式无效');
  if (!Number.isFinite(buyPrice) || buyPrice <= 0) throw new Error('买入价格无效');
  if (!Number.isFinite(parts) || parts <= 0 || parts > 100000) throw new Error('份数无效');
  if (sellDate && !/^\d{4}-\d{2}-\d{2}$/.test(sellDate)) throw new Error('卖出日期格式无效');
  if (sellPrice !== null && (!Number.isFinite(sellPrice) || sellPrice <= 0)) throw new Error('卖出价格无效');
  return {
    code, buy_date: buyDate, buy_price: buyPrice, sell_date: sellDate,
    sell_price: sellPrice, parts,
    buy_condition: String(input.buy_condition || '').slice(0, 120),
    sell_condition: String(input.sell_condition || '').slice(0, 120),
    sell_reason: String(input.sell_reason || '').slice(0, 240),
  };
}

async function readBody(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 16 * 1024) throw new Error('请求内容过大');
  return validateOperation(await request.json());
}

async function listOperations(env) {
  const result = await env.DB.prepare(
    `SELECT id, code, buy_date, buy_price, sell_date, sell_price, parts,
            buy_condition, sell_condition, sell_reason, created_at, updated_at
       FROM operations
      ORDER BY buy_date DESC, updated_at DESC, id DESC`,
  ).all();
  return json({ operations: result.results || [] });
}

async function writeOperation(request, env, id = null) {
  const values = await readBody(request);
  const timestamp = now();
  if (id === null) {
    const newId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO operations
       (id, code, buy_date, buy_price, sell_date, sell_price, parts,
        buy_condition, sell_condition, sell_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      newId, values.code, values.buy_date, values.buy_price, values.sell_date,
      values.sell_price, values.parts, values.buy_condition, values.sell_condition,
      values.sell_reason, timestamp, timestamp,
    ).run();
    return json({ id: newId, ...values, created_at: timestamp, updated_at: timestamp }, 201);
  }
  const result = await env.DB.prepare(
    `UPDATE operations
        SET code=?, buy_date=?, buy_price=?, sell_date=?, sell_price=?, parts=?,
            buy_condition=?, sell_condition=?, sell_reason=?, updated_at=?
      WHERE id=?`,
  ).bind(
    values.code, values.buy_date, values.buy_price, values.sell_date, values.sell_price,
    values.parts, values.buy_condition, values.sell_condition, values.sell_reason,
    timestamp, id,
  ).run();
  if (!result.meta?.changes) return json({ error: '记录不存在' }, 404);
  return json({ id, ...values, updated_at: timestamp });
}

async function deleteOperation(request, env, id) {
  const result = await env.DB.prepare('DELETE FROM operations WHERE id=?').bind(id).run();
  return result.meta?.changes ? json({ deleted: id }) : json({ error: '记录不存在' }, 404);
}

async function operationsApi(request, env) {
  if (!env.DB) return json({ error: '公开记录数据库尚未配置' }, 503);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: JSON_HEADERS });
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/api\/operations(?:\/([^/]+))?$/);
  if (!match) return json({ error: '接口不存在' }, 404);
  try {
    if (['POST', 'PUT', 'DELETE'].includes(request.method)) {
      const key = request.headers.get('cf-connecting-ip') || 'anonymous';
      const minute = Math.floor(Date.now() / 60000);
      const bucket = writeBuckets.get(key);
      if (!bucket || bucket.minute !== minute) writeBuckets.set(key, { minute, count: 1 });
      else if (bucket.count >= 30) return json({ error: '写入过于频繁，请稍后再试' }, 429);
      else bucket.count += 1;
    }
    if (request.method === 'GET') return await listOperations(env);
    if (request.method === 'POST' && !match[1]) return await writeOperation(request, env);
    if (request.method === 'PUT' && match[1]) return await writeOperation(request, env, match[1]);
    if (request.method === 'DELETE' && match[1]) return await deleteOperation(request, env, match[1]);
    return json({ error: '不支持的操作' }, 405);
  } catch (error) {
    return json({ error: error.message || '请求失败' }, 400);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/operations')) {
      return operationsApi(request, env);
    }
    return withHeaders(await env.ASSETS.fetch(request));
  },
};
