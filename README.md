# dsh-sector-ticker

在 DeepSeek Harness 的输入框下方加两行行情：**金价** 和 **A 股自选板块**。
每行显示当日涨跌、最近 1 分钟变化，急涨急跌时加粗、变色并打上 `⚠大幅` / `⚠⚠剧烈` 标记。

```
3642.32  +0.05% │ 782.31 ( 1m down 0.107% 3648.74 → 3643.12 )        插件▾
CPO      up 3.52%        ( 1m  up 0.003% )                       插件▾
```

## 功能

- **两行独立**：金价一行、行情一行，各自带「插件 / 弹窗 / 静默」下拉
- **当日涨跌**（从昨收算起，主指标）
- **1 分钟变化**：括号内显示窗口、方向、幅度；金价额外显示 `从→到`
- **急涨急跌**：达到阈值时整行加粗、加底色、剧烈时呼吸闪烁
- **A 股自选**：CPO、芯片、AI、通信、军工、航天、医药、银行、游戏、娱乐、新能源、白酒 + 5 个大盘
- **代号显示**：用拼音全拼（`cpo` / `xinpian` / `chuangyeban`），不出现汉字

## 数据与常驻

插件的 **Host 半**（`index.js`）随 DSH 进程运行，自己抓数据：

| 来源 | 用途 | 频率 |
|---|---|---|
| 东方财富 `push2` | 板块快照（涨跌幅） | 2 秒 |
| 新浪 `hq.sinajs.cn` | 黄金 XAU/USD、Au(T+D) | 3 秒 |

- 不用任何外部进程、计划任务或 pid 文件
- 采样序列每 10 秒落盘到 `~/.dsh-sector-ticker/ring.json`，DSH 重启后立刻恢复 90 秒历史
- 板块列表首次启动时自动拉取并缓存 7 天（`~/.dsh-sector-ticker/universe.json`）

资源用 `ctx.effect` 注册，插件卸载或 DSH 退出时自动回收。

## 安装

```bash
# 从 Git 仓库
dsh plugin install git+https://github.com/USER/dsh-sector-ticker.git

# 从本地目录
dsh plugin install /path/to/dsh-sector-ticker
```

也可以直接：DSH → 插件 → 添加插件 → 选择本目录。

安装后刷新页面（`Ctrl+Shift+R`），输入框下方出现两行。

**完整的安装、验证、配置、排错见 [INSTALL.md](./INSTALL.md)。**

> **安全**：插件不含任何 API Key 或账号信息；只访问东方财富与新浪的公开行情接口；
> 数据全部留在本机 `~/.dsh-sector-ticker/`；接口只监听 `127.0.0.1:8790`。

## 配置

展示方式下拉写入 `~/.dsh-sector-ticker/config.json`：

```json
{ "display": "plugin" }
```

- `plugin`：页面内显示
- `popup`：隐藏页面内容，异动时弹桌面浮层
- `silent`：都不显示，只留一个极小的下拉

想改关注名单，编辑 `index.js` 顶部的 `WATCH_THEMES` / `WATCH_INDEXES`。

## 已知限制

- 只支持在**运行 DSH 的这台机器**上显示：数据由 Host 半在本机抓取，接口监听 `127.0.0.1:8790`，从别的机器打开页面拿不到数据
- 板块名称匹配依赖东方财富的板块命名，改名会导致对应主题消失（会在 `universe.json` 里回退匹配）
- 交易时段外的数据是上一交易日的收盘值

## License

MIT
