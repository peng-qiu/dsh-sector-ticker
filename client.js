window.__ModuleLoader__.load({
  id: 'dsh-sector-ticker',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef } = React;

    const SECTOR_API = 'http://127.0.0.1:8790/api/state';
    const SECTOR_MODE = 'http://127.0.0.1:8790/api/mode';
    const POLL_MS = 3000;
    const POLL_GOLD_MS = 5000;
    const ROTATE_MS = 3500;
    const ANOMALY_TTL = 40000;
    const GOLD_MODE_KEY = 'st-gold-row-mode';
    const GOLD_HIST_KEY = 'st-gold-hist';
    const SEC_HIST_KEY = 'st-sec-hist';

    // 沿用金价插件原本的配色
    const UP = '#c0392b';
    const DOWN = '#1e8449';
    const DIM = 'inherit';

    // 全拼（不是缩写）
    const PY = {
      上证指数: 'shangzheng', 深证成指: 'shenzhen', 创业板指: 'chuangyeban',
      科创50: 'kechuang50', 沪深300: 'hushen300',
      CPO: 'cpo', 芯片: 'xinpian', AI: 'ai', 通信: 'tongxin', 军工: 'jungong', 航天: 'hangtian',
      医药: 'yiyao', 银行: 'yinhang', 游戏: 'youxi', 娱乐: 'yule', 新能源: 'xinnengyuan', 白酒: 'baijiu',
    };
    const PY_CLUSTER = {
      半导体: 'bandaoti', 消费电子: 'xiaofeidianzi', 算力AI: 'suanli', 软件信创: 'ruanjian',
      机器人: 'jiqiren', 传媒应用: 'chuanmei', 新能源: 'xinnengyuan', 汽车: 'qiche',
      通信卫星: 'tongxinweixing', 军工: 'jungong', 医药: 'yiyao', 金融: 'jinrong',
      周期: 'zhouqi', 消费: 'xiaofei', 电力公用: 'dianli', 地产基建: 'dichan', 其他: 'qita',
    };
    const WIN = { '10秒': '10s', '1分钟': '1m', '5分钟': '5m', '15分钟': '15m', '日内': 'day' };

    const MODES = [['plugin', '插件'], ['popup', '弹窗'], ['silent', '静默']];
    const fmt = (n, d = 2) => (typeof n === 'number' && isFinite(n) ? n.toFixed(d) : '--');

    const S = {
      block: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        flex: '0 0 auto',
        width: 'max-content',
        gap: 0,
        padding: '0 2px',
        boxSizing: 'border-box',
        fontSize: 10,
        lineHeight: '12px',
        opacity: 0.55,
        color: 'inherit',
        userSelect: 'none',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      },
      line: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', minHeight: 12 },
      info: { display: 'flex', alignItems: 'center', gap: 4 },
      dot: { width: 4, height: 4, borderRadius: 2, background: UP, animation: 'st-blink 1.8s ease-in-out infinite' },
      code: { color: 'inherit', letterSpacing: '.05em' },
      wrap: { color: DIM, opacity: 0.75 },
      sel: {
        fontSize: 9, height: 12, lineHeight: '12px', padding: 0,
        margin: '0 0 0 4px', border: 'none', borderRadius: 3,
        background: 'transparent', color: 'inherit', opacity: 0.6,
        cursor: 'pointer', fontFamily: 'inherit', outline: 'none', flexShrink: 0,
      },
    };

    const CSS = [
      '@keyframes st-blink{0%,100%{opacity:1}50%{opacity:.2}}',
      '@keyframes st-pulse{0%,100%{opacity:1}50%{opacity:.55}}',
    ].join('');

    // 急涨急跌分级：1=大幅 2=剧烈
    const sevOf = (pct, l1, l2) => {
      if (typeof pct !== 'number') return 0;
      const v = Math.abs(pct);
      if (v >= l2) return 2;
      if (v >= l1) return 1;
      return 0;
    };
    const rowStyle = (sev) => {
      if (sev === 2) {
        return Object.assign({}, S.line, {
          background: 'rgba(192,57,43,0.16)',
          border: '1px solid rgba(192,57,43,0.38)',
          borderRadius: 4,
          padding: '0 4px',
          fontWeight: 600,
          boxSizing: 'border-box',
          animation: 'st-pulse 1.1s ease-in-out infinite',
        });
      }
      if (sev === 1) {
        return Object.assign({}, S.line, {
          background: 'rgba(200,140,0,0.12)',
          border: '1px solid transparent',
          borderRadius: 4,
          padding: '0 4px',
          fontWeight: 600,
          boxSizing: 'border-box',
        });
      }
      return S.line;
    };
    const badgeOf = (sev) => (sev === 2 ? '⚠⚠剧烈' : sev === 1 ? '⚠大幅' : '');

    function readGoldMode() {
      try {
        const v = localStorage.getItem(GOLD_MODE_KEY);
        return v === 'popup' || v === 'silent' ? v : 'plugin';
      } catch { return 'plugin'; }
    }

    function Ticker() {
      const [snap, setSnap] = useState(null);
      const goldHist = useRef([]);
      const secHist = useRef(new Map());

      // 历史落 localStorage：刷新页面后瞬时变化不会"消失"
      useEffect(() => {
        try {
          const cut = Date.now() - 90_000;
          const g = JSON.parse(localStorage.getItem(GOLD_HIST_KEY) || '[]');
          if (Array.isArray(g)) goldHist.current = g.filter((s) => s && s.t > cut);
          const s = JSON.parse(localStorage.getItem(SEC_HIST_KEY) || '{}');
          if (s && typeof s === 'object') {
            const m = new Map();
            for (const k of Object.keys(s)) {
              if (Array.isArray(s[k])) m.set(k, s[k].filter((x) => x && x.t > cut));
            }
            secHist.current = m;
          }
        } catch { /* 忽略 */ }
      }, []);

      const persistHist = () => {
        try {
          localStorage.setItem(GOLD_HIST_KEY, JSON.stringify(goldHist.current));
          const obj = {};
          for (const [k, v] of secHist.current) obj[k] = v;
          localStorage.setItem(SEC_HIST_KEY, JSON.stringify(obj));
        } catch { /* 忽略 */ }
      };
      const [goldMode, setGoldMode] = useState(readGoldMode);
      const [i, setI] = useState(0);
      const alive = useRef(true);

      useEffect(() => {
        alive.current = true;
        const loadSector = async () => {
          try {
            const r = await fetch(SECTOR_API, { cache: 'no-store' });
            if (!r.ok) return;
            const j = await r.json();
            if (!alive.current) return;
            // 客户端自己留一份金价历史：Host 未提供 net1m 时用它补算
            const g = j && j.gold;
            if (g && typeof g.price === 'number') {
              const t = j.now || Date.now();
              const h = goldHist.current;
              if (!h.length || t - h[h.length - 1].t > 1000) h.push({ t, p: g.price });
              const cut = t - 90_000;
              while (h.length && h[0].t < cut) h.shift();
            }
            // 板块也要有自己的历史：算 20 秒急涨急跌（Host 只给单点，不给 burst）
            if (j && j.watch) {
              const t = j.now || Date.now();
              const all = [...(j.watch.indices || []), ...(j.watch.themes || [])];
              for (const w of all) {
                if (typeof w.pct !== 'number') continue;
                const key = w.label;
                let a = secHist.current.get(key);
                if (!a) { a = []; secHist.current.set(key, a); }
                if (!a.length || t - a[a.length - 1].t > 1000) a.push({ t, v: w.pct });
                const cut = t - 90_000;
                while (a.length && a[0].t < cut) a.shift();
              }
            }
            setSnap(j);
            persistHist();
          } catch { /* 静默 */ }
        };
        loadSector();
        const t1 = setInterval(loadSector, POLL_MS);
        return () => { alive.current = false; clearInterval(t1); };
      }, []);

      const list = [];
      if (snap && snap.watch) {
        for (const w of snap.watch.indices) {
          if (typeof w.pct === 'number') list.push({ k: 'i' + w.label, label: w.label, code: PY[w.label] || w.label, pct: w.pct, net: w.net });
        }
        for (const w of snap.watch.themes) {
          if (typeof w.pct === 'number') list.push({ k: 't' + w.label, label: w.label, code: PY[w.label] || w.label, pct: w.pct, net: w.net });
        }
      }

      useEffect(() => {
        if (list.length < 2) return undefined;
        const id = setInterval(() => setI((v) => v + 1), ROTATE_MS);
        return () => clearInterval(id);
      }, [list.length]);

      const sectorMode = (snap && snap.mode) || 'plugin';

      const pushSectorMode = async (m) => {
        setSnap((s) => (s ? Object.assign({}, s, { mode: m }) : s));
        try {
          await fetch(SECTOR_MODE, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: m }),
          });
        } catch { /* 忽略 */ }
      };

      const pushGoldMode = (m) => {
        setGoldMode(m);
        try { localStorage.setItem(GOLD_MODE_KEY, m); } catch { /* 忽略 */ }
      };

      const mkSelect = (value, onChange) => h('select', {
        value, onChange: (e) => onChange(e.target.value), style: S.sel,
      }, ...MODES.map(([id, label]) => h('option', { key: id, value: id }, label)));

      const anomaly = snap && snap.anomaly && (snap.now || Date.now()) - snap.anomaly.at < ANOMALY_TTL
        ? snap.anomaly : null;
      const gold = snap && snap.gold;
      const cur = list.length ? list[i % list.length] : null;
      const hasGold = gold && typeof gold.price === 'number';
      const hasSector = !!(cur || anomaly);

      if (!hasGold && !hasSector) return h('div', { key: 'empty' });

      // 第一行：gold info + 插件（静默时只隐藏信息，下拉保留）
      let goldRow = null;
      if (hasGold) {
        const gPct = typeof gold.dayPct === 'number' ? gold.dayPct : null;
        const gColor = gPct === null ? 'inherit' : gPct >= 0 ? UP : DOWN;
        const gNet = typeof gold.net1m === 'number' ? gold.net1m : null;
        const pickShort = (ms, label) => {
          const h = goldHist.current;
          if (!h.length) return null;
          const last = h[h.length - 1];
          let ref = null;
          for (const s of h) if (last.t - s.t >= ms - 3000 && (!ref || s.t > ref.t)) ref = s;
          if (!ref || ref.p <= 0) return null;
          return { win: label, pct: ((last.p - ref.p) / ref.p) * 100, from: ref.p, to: last.p };
        };
        const short = typeof gold.net1m === 'number'
          ? { win: '1m', pct: gold.net1m, from: null, to: null }
          : (pickShort(60_000, '1m') || pickShort(20_000, '20s'));
        const shortDir = short ? (short.pct >= 0 ? 'up' : 'down') : null;
        const shortColor = shortDir === 'down' ? DOWN : UP;
        const gSev = short ? sevOf(short.pct, short.win === '20s' ? 0.20 : 0.35, short.win === '20s' ? 0.36 : 0.63) : 0;
        const muted = { color: 'inherit', opacity: 0.6 };
        const spans = goldMode === 'silent' ? [] : [
          h('span', { key: 'p', style: { fontWeight: 600, color: gColor } }, fmt(gold.price)),
          h('span', { key: 'c', style: { color: gColor } }, gPct === null ? '' : `${gPct >= 0 ? '+' : ''}${gPct.toFixed(2)}%`),
          h('span', { key: 's1', style: S.wrap }, '│'),
          h('span', { key: 'a', style: S.wrap }, fmt(gold.autd)),
          short ? h('span', { key: 'o', style: muted }, '(') : null,
          short ? h('span', { key: 'w', style: muted }, short.win) : null,
          short ? h('span', { key: 'd', style: { color: shortColor } }, shortDir) : null,
          short ? h('span', { key: 'v', style: { color: shortColor } }, Math.abs(short.pct).toFixed(3) + '%') : null,
          short && short.from !== null ? h('span', { key: 'f', style: muted }, fmt(short.from) + '→' + fmt(short.to)) : null,
          short ? h('span', { key: 'o2', style: muted }, ')') : null,
          gSev ? h('span', { key: 'b', style: { color: gSev === 2 ? UP : '#b8860b', fontWeight: 700 } }, badgeOf(gSev)) : null,
        ];
        goldRow = h('div', { key: 'g', style: rowStyle(gSev) },
          h('div', { key: 'i', style: S.info }, spans),
          mkSelect(goldMode, pushGoldMode));
      }

      // 第二行：拼音 up/down xx% ( 窗口 up/down xx% ) + 插件（静默时只隐藏信息，下拉保留）
      let sectorRow = null;
      if (hasSector) {
        const isUp = anomaly ? (typeof anomaly.dir === 'number' ? anomaly.dir >= 0 : true) : (cur ? cur.pct >= 0 : true);
        const word = isUp ? 'up' : 'down';
        const color = isUp ? UP : DOWN;
        const code = anomaly
          ? (PY_CLUSTER[anomaly.cluster] || 'X') + (anomaly.n >= 3 ? anomaly.n : '')
          : (cur ? cur.code : '');
        const magnitude = (anomaly ? anomaly.burst : (cur ? Math.abs(cur.pct) : 0)).toFixed(2) + '%';
        // 1 分钟变化：优先 Host 的 net，没有再回落到客户端历史（刷新/重启后立刻可用）
        const pickSec = (h, ms, label) => {
          if (!h.length) return null;
          const last = h[h.length - 1];
          let ref = null;
          for (const s of h) if (last.t - s.t >= ms - 3000 && (!ref || s.t > ref.t)) ref = s;
          return ref ? { win: label, val: last.v - ref.v } : null;
        };
        const shortA = (() => {
          const h = (cur && secHist.current.get(cur.label)) || [];
          return pickSec(h, 60_000, '1m') || pickSec(h, 20_000, '20s');
        })();
        const subNet = !anomaly && cur
          ? (typeof cur.net === 'number' ? cur.net : (shortA ? shortA.val : null))
          : null;
        const subWin = typeof cur?.net === 'number' ? '1m' : (shortA ? shortA.win : '1m');
        const subWord = subNet === null ? '' : subNet >= 0 ? 'up' : 'down';
        const subColor = subNet === null ? 'inherit' : subNet >= 0 ? UP : DOWN;
        const muted = { color: 'inherit', opacity: 0.6 };
        // A 股自己的急涨急跌：客户端用历史算 20 秒内最大位移与 1 分钟变化
        const sh = (cur && secHist.current.get(cur.label)) || [];
        let burstA = 0;
        if (sh.length) {
          const lastT = sh[sh.length - 1].t;
          for (let a = 0; a < sh.length; a++) {
            if (lastT - sh[a].t > 60_000) continue;
            for (let b = a + 1; b < sh.length; b++) {
              if (sh[b].t - sh[a].t > 20_000) break;
              const mv = Math.abs(sh[b].v - sh[a].v);
              if (mv > burstA) burstA = mv;
            }
          }
        }
        const netA = (() => {
          if (!sh.length) return null;
          const last = sh[sh.length - 1];
          let ref = null;
          for (const s of sh) if (last.t - s.t >= 57_000 && (!ref || s.t > ref.t)) ref = s;
          return ref ? Math.abs(last.v - ref.v) : null;
        })();
        const sMag = Math.max(
          burstA,
          typeof cur?.net === 'number' ? Math.abs(cur.net) : 0,
          netA === null ? 0 : netA,
          anomaly && anomaly.burst ? anomaly.burst : 0,
        );
        const sSev = sevOf(sMag, 0.30, 0.55);
        const spans = sectorMode === 'silent' ? [] : [
          anomaly ? h('span', { key: 'd', style: S.dot }) : null,
          h('span', { key: 'c', style: S.code }, code),
          h('span', { key: 'w', style: { color } }, word),
          h('span', { key: 'm', style: { color, fontWeight: 600 } }, magnitude),
          subNet !== null ? h('span', { key: 'o', style: muted }, '(') : null,
          subNet !== null ? h('span', { key: 't', style: muted }, subWin) : null,
          subNet !== null ? h('span', { key: 'sw', style: { color: subColor } }, subWord) : null,
          subNet !== null ? h('span', { key: 'sv', style: { color: subColor } }, Math.abs(subNet).toFixed(2) + '%') : null,
          subNet !== null ? h('span', { key: 'o2', style: muted }, ')') : null,
          sSev ? h('span', { key: 'b', style: { color: sSev === 2 ? UP : '#b8860b', fontWeight: 700 } }, badgeOf(sSev)) : null,
        ];
        sectorRow = h('div', { key: 's', style: rowStyle(sSev) },
          h('div', { key: 'i', style: S.info }, spans),
          mkSelect(sectorMode, pushSectorMode));
      }

      return h('div', { key: 'block', style: S.block },
        h('style', { key: 'kf' }, CSS),
        goldRow,
        sectorRow);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'sector-ticker',
          order: 2,
        }, Ticker));
      },
    };
  },
});
