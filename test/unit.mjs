// 离线单元测试：用假的行情响应验证 Host 半的完整链路，不依赖网络。
// 用法: node test/unit.mjs
const realFetch = globalThis.fetch;
const PORT = process.env.DSH_SECTOR_TICKER_PORT || '8794';
process.env.DSH_SECTOR_TICKER_PORT = PORT;

// 用临时数据目录，避免读到真实缓存
const { mkdtempSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
process.env.DSH_SECTOR_TICKER_DATA = mkdtempSync(join(tmpdir(), 'dsh-st-test-'));

const THEMES = [
  'CPO概念', '芯片概念', '人工智能', '通信设备', '国防军工',
  '卫星导航', '医药生物', '银行', '游戏概念', '传媒', '新能源', '白酒Ⅱ',
];

function resp(obj, isText = false) {
  return {
    ok: true,
    status: 200,
    json: async () => obj,
    text: async () => (isText ? obj : JSON.stringify(obj)),
  };
}

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(u, opts);

  if (u.includes('/api/qt/clist/get')) {
    const p = new URL(u).searchParams;
    const pn = Number(p.get('pn') || '1');
    const isConcept = u.includes('t:3');
    if (pn > 3) return resp({ data: { diff: [] } });
    const rows = [];
    for (let i = 0; i < 100; i++) {
      if (pn === 1 && i < 10 && isConcept) {
        rows.push({ f12: 'BKC' + String(i).padStart(3, '0'), f14: THEMES[i] });
      } else if (pn === 1 && i < 2 && !isConcept) {
        rows.push({ f12: 'BKH' + String(i).padStart(3, '0'), f14: THEMES[10 + i] });
      } else {
        rows.push({ f12: (isConcept ? 'BKC' : 'BKH') + pn + '_' + i, f14: (isConcept ? '概念' : '行业') + pn + '-' + i });
      }
    }
    return resp({ data: { diff: rows } });
  }

  if (u.includes('/api/qt/ulist.np/get')) {
    const secids = (new URL(u).searchParams.get('secids') || '').split(',').filter(Boolean);
    return resp({
      data: {
        diff: secids.map((s) => ({
          f12: s.split('.')[1],
          f2: 1000 + Math.round(Math.random() * 10),
          f3: 2.5,
        })),
      },
    });
  }

  if (u.includes('hq.sinajs.cn')) {
    return resp('var hf_XAU="2000.50,1990.00,0,0,0,0,10:00,1995";\nvar gds_AUTD="780.10,0,0,0,0,0,10:00";', true);
  }

  return resp({});
};

const { apply } = await import('../index.js');

const cleanups = [];
const ctx = { effect(factory) { try { cleanups.push(factory()); } catch { /* ignore */ } } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

console.log('offline test on port ' + PORT);
apply(ctx);

let state = null;
const deadline = Date.now() + 20_000;
while (Date.now() < deadline) {
  await sleep(1500);
  try {
    const r = await realFetch(`http://127.0.0.1:${PORT}/api/state`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    state = j;
    if ((j.watch?.themes || []).length === 12) break;
  } catch { /* not up yet */ }
}

check('GET /api/state 可用', !!state);
check('大盘 = 5', (state?.watch?.indices || []).length === 5, String((state?.watch?.indices || []).length));
check('主题 = 12', (state?.watch?.themes || []).length === 12, String((state?.watch?.themes || []).length));
check('每个主题都有涨跌幅', (state?.watch?.themes || []).every((t) => typeof t.pct === 'number'));
check('金价解析正确', state?.gold?.price === 2000.5, String(state?.gold?.price));
check('金价日内涨幅', Math.abs((state?.gold?.dayPct ?? 0) - 0.5276) < 0.01, String(state?.gold?.dayPct));
check('金价国内价', state?.gold?.autd === 780.1, String(state?.gold?.autd));
check('error 为空', state?.error === null, String(state?.error));

// 模式读写
const r1 = await realFetch(`http://127.0.0.1:${PORT}/api/mode`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'silent' }),
});
const j1 = await r1.json();
check('POST /api/mode 写入 silent', j1.mode === 'silent', JSON.stringify(j1));
const r2 = await realFetch(`http://127.0.0.1:${PORT}/api/mode`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'bogus' }),
});
const j2 = await r2.json();
check('非法 mode 被忽略', j2.mode === 'silent', JSON.stringify(j2));
await realFetch(`http://127.0.0.1:${PORT}/api/mode`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ mode: 'plugin' }),
});

for (const off of cleanups) { try { await off?.(); } catch { /* ignore */ } }
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
