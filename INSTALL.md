# 安装说明

## 前置条件

- **DeepSeek Harness**（Desktop 桌面版或 Web 版）已安装并能正常打开页面
- 网络能访问 `quote.eastmoney.com` 与 `hq.sinajs.cn`（行情数据源）
- 端口 `8790` 未被占用（Host 半用它给页面提供数据）

不需要额外安装 Node、Python 或任何运行时——插件的 Host 半跑在 DSH 自己的进程里。

## 方式一：从本地目录安装（开发/自用）

1. 把仓库放到任意目录，例如 `D:\plugins\dsh-sector-ticker`
2. 打开 DSH → 左侧 **插件** → **添加插件** → 选择该目录
3. 列表里出现 `dsh-sector-ticker` 且状态为已启用
4. **刷新页面**（`Ctrl+Shift+R`）
5. 输入框下方出现两行行情

## 方式二：命令行安装

```bash
# 从 Git 仓库（把 USER 换成实际用户名）
dsh plugin install git+https://github.com/peng-qiu/dsh-sector-ticker.git

# 或从本地目录
dsh plugin install /path/to/dsh-sector-ticker
```

## 方式三：从 npm 安装（发布后可用）

```bash
dsh plugin install dsh-sector-ticker
```

## 安装后验证

**1. 页面**：输入框下方应出现两行，样式如下

```
3642.32  +0.05% │ 782.31 ( 1m down 0.107% 3648.74 → 3643.12 )        插件▾
CPO      up 3.52%        ( 1m  up 0.003% )                       插件▾
```

**2. 接口**：浏览器打开 <http://127.0.0.1:8790/api/state>，应返回 JSON：

```json
{
  "now": 1795490258020,
  "session": "am",
  "mode": "plugin",
  "watch": { "indices": [ ... ], "themes": [ ... ] },
  "gold": { "price": 3632.11, "dayPct": -0.08, "autd": 780.28 },
  "error": null
}
```

`error` 不为 `null` 时说明行情源有问题，按下面的排错处理。

**3. 数据目录**：首次运行会创建

```
~/.dsh-sector-ticker/
  universe.json   板块列表（7 天缓存，自动拉取）
  ring.json       采样序列（重启后恢复 1 分钟基准）
  config.json     展示方式设置
```

## 配置

行尾下拉框选择展示方式，写入 `config.json`：

| 值 | 行为 |
|---|---|
| `plugin` | 页面内显示（默认） |
| `popup` | 页面内隐藏，异动时弹桌面浮层 |
| `silent` | 都不显示，只留一个极小的下拉 |

改关注名单：编辑 `index.js` 顶部的 `WATCH_THEMES`（主题）与 `WATCH_INDEXES`（大盘），
每项是 `[显示名, [候选板块名...]]`，从左到右匹配第一个存在的板块。

## 卸载

DSH → 插件 → 找到 `dsh-sector-ticker` → 移除。
数据目录 `~/.dsh-sector-ticker/` 可手动删除。

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 页面没有那两行 | 插件未启用，或页面没刷新 | 插件面板确认已启用，`Ctrl+Shift+R` |
| 只显示下拉框，没有数据 | `8790` 接口没起来 | 打开 <http://127.0.0.1:8790/api/state> 看是否报错；重启 DSH |
| `error` 里是 `HTTP ...` | 行情源被限流或网络不通 | 稍等重试；确认能访问 `quote.eastmoney.com` |
| 某个主题永久缺失 | 东方财富改了板块名 | 在 `WATCH_THEMES` 里加一个候选名 |
| 两行都在但全是 `--` | 非交易时段且没有缓存 | 正常现象，开盘后自动恢复 |

## 安全与隐私

- 插件**不含任何 API Key、账号或口令**，也不需要你填任何凭据
- 只向外发起两类请求：东方财富行情接口、新浪行情接口；不向任何其他服务器发送数据
- 所有状态保存在本机 `~/.dsh-sector-ticker/`，不上传
- `8790` 只监听 `127.0.0.1`（回环地址），局域网内其他机器访问不到
- 从别的机器打开 DSH 页面时，因为拿不到本机接口，两行不会显示——这是预期行为
