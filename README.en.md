# dsh-sector-ticker

[中文](./README.md) | **English**

Two live ticker rows under the DeepSeek Harness composer: **gold** and **your A-share sectors**.
Each row shows the day change, the last minute's change, and turns bold, colored and badged with
`⚠大幅` / `⚠⚠剧烈` when the price moves sharply.

```
3642.32  +0.05% │ 782.31 ( 1m down 0.107% 3648.74 → 3643.12 )        插件▾
CPO      up 3.52%        ( 1m  up 0.003% )                       插件▾
```

## Features

- **Two independent rows** — gold and sectors, each with its own `插件 / 弹窗 / 静默` dropdown
- **Day change** — measured from the previous close, the primary number
- **1-minute change** — window, direction and size in parentheses; gold also shows `from → to`
- **Sharp-move alerts** — row turns bold and tinted, flashing when the move is extreme
- **12 A-share themes** — CPO, chips, AI, telecom, defence, aerospace, pharma, banks, gaming,
  media, new energy, baijiu — plus five broad indices
- **Pinyin codes** — `cpo` / `xinpian` / `chuangyeban` instead of Chinese characters

## Data and lifetime

The plugin's **Host half** runs inside the DSH process and fetches data itself:

| Source | Used for | Interval |
|---|---|---|
| Eastmoney `push2` | sector quotes | 2 s |
| Sina `hq.sinajs.cn` | XAU/USD and Au(T+D) | 3 s |

- No external process, scheduled task or pid file
- The sample ring is persisted every 10 s to `~/.dsh-sector-ticker/ring.json`, so a DSH restart
  keeps the 1-minute baseline
- The sector universe is fetched on first start and cached for 7 days
  (`~/.dsh-sector-ticker/universe.json`)

All resources are registered through `ctx.effect`, so they are released when the plugin unloads.

## Install

```bash
dsh plugin install git+https://github.com/peng-qiu/dsh-sector-ticker.git
```

Or: DSH → Plugins → Add plugin → pick this directory.

Refresh the page (`Ctrl+Shift+R`) and the two rows appear under the composer.

See [INSTALL.md](./INSTALL.md) for verification steps, configuration and troubleshooting.

## Use as a plugin index

This repository ships a **format 1** index document (`index.json`, validated with
`@deepseek-ai/dsh-plugin-market-index`):

1. Plugins → Experimental → enable **custom plugin indexes**
2. Plugins → Discover → Manage index sources → add
   `https://raw.githubusercontent.com/peng-qiu/dsh-sector-ticker/main/index.json`
3. Search `dsh-sector-ticker` and install

## Security

- No API key, account or credential is bundled or required
- Only two outbound hosts: Eastmoney and Sina public quote endpoints
- All state stays in `~/.dsh-sector-ticker/`
- The local HTTP interface listens on `127.0.0.1:8790` only

## Licence

MIT
