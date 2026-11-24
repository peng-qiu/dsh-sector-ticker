// 本机冒烟测试：用假的 ctx 拉起 Host 半，检查接口与数据结构。
// 用法: node test/smoke.mjs   （需要能访问行情源；会占用一个临时端口）
import { apply } from '../index.js';

const PORT = process.env.DSH_SECTOR_TICKER_PORT || '8791';
process.env.DSH_SECTOR_TICKER_PORT = PORT;

const cleanups = [];
const ctx = {
  effect(factory) {
    try { cleanups.push(factory()); } catch (e) { console.error('effect failed:', e.message); }
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

console.log('starting host half on port ' + PORT + ' ...');
apply(ctx);

// 轮询等待数据就绪（首次运行要拉板块列表，可能十几秒）
let state = null;
const deadline = Date.now() + 40_000;
while (Date.now() < deadline) {
  await sleep(3000);
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/state`, { signal: AbortSignal.timeout(5000) });
    const j = await r.json();
    if ((j.watch?.themes || []).length && (j.watch?.indices || []).length) { state = j; break; }
    state = j;
  } catch { /* 还没起来 */ }
}

check('GET /api/state 返回 200', !!state);

if (state) {
  check('有 session 字段', typeof state.session === 'string', state.session);
  check('watch.indices 是数组', Array.isArray(state.watch?.indices));
  check('watch.themes 是数组', Array.isArray(state.watch?.themes));
  check('大盘数量 = 5', (state.watch?.indices || []).length === 5, String((state.watch?.indices || []).length));
  check('主题数量 = 12', (state.watch?.themes || []).length === 12, String((state.watch?.themes || []).length));
  check('mode 合法', ['plugin', 'popup', 'silent'].includes(state.mode), state.mode);

  const goldOk = state.gold && typeof state.gold.price === 'number' && state.gold.price > 0;
  check('金价有有效数值', goldOk, goldOk ? String(state.gold.price) : '无');

  const sample = (state.watch?.themes || [])[0];
  check('板块项含 label/pct', !!sample && typeof sample.label === 'string' && typeof sample.pct === 'number',
    sample ? `${sample.label} ${sample.pct}%` : '无数据');

  const errOk = state.error === null || typeof state.error === 'string';
  check('error 字段形态正确', errOk, String(state.error));
}

// POST /api/mode 往返
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'silent' }),
    signal: AbortSignal.timeout(5000),
  });
  const j = await r.json();
  check('POST /api/mode 生效', j.mode === 'silent', JSON.stringify(j));
  await fetch(`http://127.0.0.1:${PORT}/api/mode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'plugin' }),
    signal: AbortSignal.timeout(5000),
  });
} catch (e) {
  check('POST /api/mode 生效', false, e.message);
}

for (const off of cleanups) { try { await off?.(); } catch { /* ignore */ } }
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
