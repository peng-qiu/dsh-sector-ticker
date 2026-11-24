/**
 * Host half of the sector ticker bundle.
 *
 * 生命周期全部交给 DSH 的 ctx 管理（ctx.effect 注册、卸载时自动清理），
 * 不再有独立的守护进程、计划任务或 pid 文件：
 *   - ctx.effect 里起 HTTP 服务（127.0.0.1:8790），卸载即 close
 *   - ctx.effect 里起轮询定时器（板块 2s / 金价 3s），卸载即 clearInterval
 *
 * 数据：东方财富板块快照 + 新浪金价，全部在本进程内计算，不依赖外部引擎。
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// 数据目录放在用户主目录下，跟安装位置无关
const DATA_DIR = join(homedir(), '.dsh-sector-ticker');
try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* ignore */ }
const UNIVERSE = join(DATA_DIR, 'universe.json');
const CONFIG = join(DATA_DIR, 'config.json');
const RING_FILE = join(DATA_DIR, 'ring.json');
const PORT = 8790;
const KEEP_MS = 90_000;
const UNIVERSE_TTL = 7 * 24 * 3600_000;

const HOSTS = ['push2.eastmoney.com', '1.push2.eastmoney.com', '7.push2.eastmoney.com', '82.push2.eastmoney.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) dsh-sector-ticker/2.0';

const WATCH_THEMES = [
  ['CPO', ['CPO概念', '光模块', '光通信模块']],
  ['芯片', ['芯片概念', '半导体', '半导体概念']],
  ['AI', ['人工智能', 'AIGC概念', '算力概念']],
  ['通信', ['通信设备', '通信网络设备及器件', '通信服务']],
  ['军工', ['国防军工', '军工电子Ⅱ', '航空装备Ⅱ']],
  ['航天', ['卫星导航', '航天装备Ⅱ', '卫星互联网']],
  ['医药', ['医药生物', '化学制药', '生物制品']],
  ['银行', ['银行', '银行Ⅱ', '国有大型银行Ⅲ']],
  ['游戏', ['游戏概念', '游戏Ⅱ']],
  ['娱乐', ['传媒', '影视概念', '文化传媒']],
  ['新能源', ['新能源', '电池', '光伏设备']],
  ['白酒', ['白酒Ⅱ', '白酒', '酿酒行业']],
];
const WATCH_INDEXES = ['上证指数', '深证成指', '创业板指', '科创50', '沪深300'];

const ring = new Map();
let targets = [];
let hostIdx = 0;
let lastError = null;
let gold = null;
const goldRing = [];

const beijingNow = () => new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 60_000);

function session() {
  const x = beijingNow();
  const wd = x.getDay();
  if (wd === 0 || wd === 6) return 'closed';
  const m = x.getHours() * 60 + x.getMinutes();
  if (m >= 555 && m < 570) return 'auction';
  if (m >= 570 && m < 690) return 'am';
  if (m >= 690 && m < 780) return 'lunch';
  if (m >= 780 && m < 900) return 'pm';
  return 'closed';
}

function readJson(path, fallback) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback; } catch { return fallback; }
}

// 把采样序列落到磁盘：DSH 重启后立刻就有 1 分钟基准，不用再等 55 秒
function loadRing() {
  const j = readJson(RING_FILE, null);
  if (!j) return;
  const cut = Date.now() - KEEP_MS;
  if (j.sector && typeof j.sector === 'object') {
    for (const [k, v] of Object.entries(j.sector)) {
      if (!Array.isArray(v)) continue;
      const arr = v.filter((s) => s && s.t > cut && isFinite(s.p));
      if (arr.length) ring.set(k, arr);
    }
  }
  if (Array.isArray(j.gold)) {
    for (const s of j.gold) if (s && s.t > cut && isFinite(s.p)) goldRing.push(s);
  }
}

function saveRing() {
  try {
    const sector = {};
    for (const [k, v] of ring) sector[k] = v;
    writeFileSync(RING_FILE, JSON.stringify({ sector, gold: goldRing }), 'utf8');
  } catch { /* 忽略 */ }
}

async function fetchSectors() {
  const all = [];
  for (const t of ['t:2', 't:3']) {
    for (let pn = 1; pn <= 8; pn++) {
      const j = await api(`/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+${t}+f:!50&fields=f12,f14`);
      const rows = j?.data?.diff;
      if (!rows || !rows.length) break;
      for (const r of rows) {
        if (r?.f12) all.push({ code: '90.' + r.f12, name: String(r.f14 || r.f12) });
      }
      if (rows.length < 100) break;
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  return all;
}

async function resolveTargets() {
  let u = readJson(UNIVERSE, null);
  const fresh = u && Array.isArray(u.list) && u.list.length && Date.now() - (u.at || 0) < UNIVERSE_TTL;
  if (!fresh) {
    const list = await fetchSectors();
    if (list.length) {
      u = { at: Date.now(), list };
      try { writeFileSync(UNIVERSE, JSON.stringify(u), 'utf8'); } catch { /* ignore */ }
    }
  }
  if (!u || !Array.isArray(u.list)) { lastError = '板块列表不可用'; return; }

  const byName = new Map(u.list.map((s) => [s.name, s]));
  const out = [];
  for (const label of WATCH_INDEXES) {
    const s = byName.get(label);
    if (s) out.push({ label, code: s.code, bucket: 'indices' });
  }
  for (const [label, cands] of WATCH_THEMES) {
    let hit = null;
    for (const c of cands) { if (byName.has(c)) { hit = byName.get(c); break; } }
    if (hit) out.push({ label, code: hit.code, bucket: 'themes' });
  }
  targets = out;
  if (targets.length) lastError = null;
}

async function api(path) {
  for (let k = 0; k < HOSTS.length; k++) {
    const h = HOSTS[(hostIdx + k) % HOSTS.length];
    try {
      const r = await fetch(`https://${h}${path}`, {
        headers: { 'User-Agent': UA, Referer: 'https://quote.eastmoney.com/' },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      hostIdx = (hostIdx + k) % HOSTS.length;
      return j;
    } catch (e) { lastError = e.message; }
  }
  return null;
}

async function pollSector() {
  if (!targets.length) return;
  const codes = targets.map((t) => t.code);
  const t = Date.now();
  for (let i = 0; i < codes.length; i += 60) {
    const chunk = codes.slice(i, i + 60);
    const j = await api(`/api/qt/ulist.np/get?secids=${chunk.join(',')}&fields=f2,f3,f12&fltt=2&invt=2`);
    let diff = j?.data?.diff;
    if (diff && !Array.isArray(diff)) diff = Object.values(diff);
    for (const d of diff ?? []) {
      if (!d?.f12) continue;
      const code = chunk.find((c) => c.split('.')[1] === String(d.f12));
      if (!code) continue;
      const p = Number(d.f2);
      if (!isFinite(p) || p <= 0) continue;
      let arr = ring.get(code);
      if (!arr) { arr = []; ring.set(code, arr); }
      arr.push({ t, p, pct: isFinite(Number(d.f3)) ? Number(d.f3) : null });
      const cut = t - KEEP_MS;
      while (arr.length && arr[0].t < cut) arr.shift();
    }
  }
}

async function pollGold() {
  try {
    const r = await fetch('https://hq.sinajs.cn/list=hf_XAU,gds_AUTD', {
      headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(6000),
    });
    const txt = await r.text();
    const pick = (sym) => {
      const m = txt.match(new RegExp(sym + '="([^"]*)"'));
      return m ? m[1].split(',') : null;
    };
    const xau = pick('hf_XAU');
    const autd = pick('gds_AUTD');
    if (xau && isFinite(Number(xau[0]))) {
      const price = Number(xau[0]);
      const prev = Number(xau[1]);
      const now = Date.now();

      goldRing.push({ t: now, p: price });
      const cut = now - KEEP_MS;
      while (goldRing.length && goldRing[0].t < cut) goldRing.shift();

      // 1 分钟变化
      let ref = null;
      for (const s of goldRing) if (now - s.t >= 55_000 && (!ref || s.t > ref.t)) ref = s;
      const net1m = ref ? ((price - ref.p) / ref.p) * 100 : null;

      // 20 秒内最大位移
      let burst = 0, dir = 0;
      for (let i = 0; i < goldRing.length; i++) {
        for (let j = i + 1; j < goldRing.length; j++) {
          if (goldRing[j].t - goldRing[i].t > 20_000) break;
          const mv = (Math.abs(goldRing[j].p - goldRing[i].p) / goldRing[i].p) * 100;
          if (mv > burst) { burst = mv; dir = goldRing[j].p >= goldRing[i].p ? 1 : -1; }
        }
      }

      gold = {
        price,
        prevClose: isFinite(prev) ? prev : null,
        dayPct: isFinite(prev) && prev > 0 ? ((price - prev) / prev) * 100 : null,
        autd: autd && isFinite(Number(autd[0])) ? Number(autd[0]) : (gold ? gold.autd : null),
        net1m: net1m === null ? null : +net1m.toFixed(3),
        burst: +burst.toFixed(3),
        dir,
        at: now,
      };
    }
  } catch { /* 保持上次值 */ }
}

function metricsFor(code) {
  const arr = ring.get(code);
  if (!arr || arr.length < 2) return null;
  const last = arr[arr.length - 1];
  const now = last.t;
  let ref = null;
  for (const s of arr) if (now - s.t >= 55_000 && (!ref || s.t > ref.t)) ref = s;
  const net = ref ? ((last.p - ref.p) / ref.p) * 100 : null;
  let burst = 0, dir = 0;
  for (let i = 0; i < arr.length; i++) {
    if (now - arr[i].t > 60_000) continue;
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[j].t - arr[i].t > 20_000) break;
      const mv = (Math.abs(arr[j].p - arr[i].p) / arr[i].p) * 100;
      if (mv > burst) { burst = mv; dir = arr[j].p >= arr[i].p ? 1 : -1; }
    }
  }
  return {
    pct: isFinite(last.pct) ? +last.pct.toFixed(2) : null,
    net: net === null ? null : +net.toFixed(2),
    burst: +burst.toFixed(2),
    dir,
  };
}

function snapshot() {
  const out = { indices: [], themes: [] };
  let top = null;
  for (const t of targets) {
    const m = metricsFor(t.code);
    if (!m) continue;
    out[t.bucket].push({ label: t.label, pct: m.pct, net: m.net });
    if (m.burst >= 0.3 && (!top || m.burst > top.burst)) {
      top = { cluster: t.label, n: 1, burst: m.burst, dir: m.dir, at: Date.now() };
    }
  }
  return { watch: out, anomaly: top };
}

const displayMode = () => {
  const c = readJson(CONFIG, {});
  return ['plugin', 'popup', 'silent'].includes(c.display) ? c.display : 'plugin';
};

function setDisplayMode(mode) {
  const c = readJson(CONFIG, {});
  writeFileSync(CONFIG, JSON.stringify({ ...c, display: mode }, null, 2), 'utf8');
}

function handler(req, res) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (url.pathname === '/api/state') {
    const snap = snapshot();
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      now: Date.now(),
      session: session(),
      mode: displayMode(),
      watch: snap.watch,
      anomaly: snap.anomaly,
      gold,
      error: lastError,
    }));
    return;
  }
  if (url.pathname === '/api/mode' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        const mode = JSON.parse(raw || '{}').mode;
        if (['plugin', 'popup', 'silent'].includes(mode)) setDisplayMode(mode);
      } catch { /* ignore */ }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mode: displayMode() }));
    });
    return;
  }
  res.writeHead(404, cors); res.end('not found');
}

export function apply(ctx) {
  resolveTargets().catch(() => {});
  loadRing();

  // 统一用 ctx.effect 注册：插件卸载 / DSH 退出时由框架回收
  const fx = (factory, label) => {
    try { ctx.effect(factory, label); } catch { factory(); }
  };

  fx(() => {
    const server = createServer(handler);
    server.on('error', (e) => { lastError = 'HTTP ' + e.message; });
    server.listen(PORT, '127.0.0.1');
    return () => server.close();
  }, 'sector-ticker: http');

  fx(() => {
    const t = setInterval(() => { pollSector().catch(() => {}); }, 2000);
    return () => clearInterval(t);
  }, 'sector-ticker: sector poll');

  fx(() => {
    const t = setInterval(() => { pollGold().catch(() => {}); }, 3000);
    return () => clearInterval(t);
  }, 'sector-ticker: gold poll');

  fx(() => {
    const t = setInterval(() => { resolveTargets().catch(() => {}); }, 600_000);
    return () => clearInterval(t);
  }, 'sector-ticker: universe reload');

  fx(() => {
    const t = setInterval(saveRing, 10_000);
    return () => { clearInterval(t); saveRing(); };
  }, 'sector-ticker: ring persist');

  pollSector().catch(() => {});
  pollGold().catch(() => {});
}
