# 映迹 ETF 分析

蓝白色四页面 ETF 分析网站，包含筛选、详情、组合回测和个人页。

个人页的“可选 ETF”按共用策略列出最近一年触发过的买入、加仓记录，按日期从近到远排序，可点击 ETF 查看对应策略的详情。时间范围按当前北京时间计算，同一 ETF 多次触发分别保留；缺少经校验行情或官方 PETTM 的数据会跳过并提示。历史信号不代表当前仍可买入，也不代表组合资金允许实际成交。

线上地址：

https://lin-etf-analysis.lin2194740187.workers.dev/

## 数据与自动更新

数据采集不依赖 `简易爬虫` 项目，也不读取浏览器页面：

- ETF 行情：东方财富前复权日 K。
- 日 K 更新按每批 15 只 ETF 分批执行，批次之间等待 20 秒；主接口失败时切换到备用东方财富接口，再失败才使用 AkShare 东方财富解析。
- 行业估值：跟踪指数编制机构公开的日度 PETTM。
- ETF 日 K 从 2020-01-01 开始展示。
- PETTM 从 2016-01-01 开始请求，使用官方实际最早日期。
- 只接受通过日期顺序、重复日期和 OHLC 关系校验的数据。
- 官方数据不足时跳过对应 ETF，不插值、不推算、不伪造。

Cloudflare 由 GitHub Actions 自动部署。每天北京时间 23:00 触发一次；任务会先判断是否有新的完整交易日：

- 有新的完整交易日：增量更新并发布到 Cloudflare。
- 没有新的完整交易日：只记录无更新状态，不重复下载或重新部署。

GitHub 的定时任务可能延迟数分钟。运行失败会通过 GitHub Actions 的失败通知发送邮件；网站同时显示更新时间、预期交易日、部分发布和数据过旧标记。

## GitHub 一次性设置

1. 在 GitHub 创建公开仓库 `lin-etf-analysis`，然后在“终端”推送本项目：

```bash
cd "/Users/hui/Documents/这些网页"
git add -A
git commit -m "Add cloud ETF data automation"
git branch -M main
git remote add origin https://github.com/你的GitHub用户名/lin-etf-analysis.git
git push -u origin main
```

2. 在仓库 `Settings > Secrets and variables > Actions` 添加：
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`，当前账号为 `18538c907356e9f69066604cc9c20767`
3. 在 GitHub 通知设置中启用 Actions 失败邮件。
4. 打开仓库的 `Actions > ETF daily update and deploy > Run workflow`，先手动运行一次 `manual`，完成历史补齐。没有新的完整交易日时不会重复下载或重新部署。

Cloudflare 令牌至少需要该账号的 Workers Scripts 编辑权限。密钥只保存在 GitHub Secrets，不进入公开仓库。

## 本地运行

仅发布当前缓存和网页：双击项目中的 `发布网页到Cloudflare.command`。脚本会先生成页面并校验数据，登录过期时打开 Cloudflare 官方授权，再部署到原网址。它不会下载历史数据，也不会启用云端定时任务。

本机网页：

```bash
python3 -m http.server 8000
```

打开 `http://localhost:8000/`。

本地手动更新并发布：

```bash
./update_etf_now.command
```

本地命令可设置 Clash 代理：

```bash
export ETF_HTTP_PROXY=http://127.0.0.1:7897
```

本地定时任务仅作为备用；线上自动更新以 GitHub Actions 为准。

## 测试

```bash
python3 -m unittest discover -s tests -p "test_*.py"
node tests/backtest_smoke.js
python3 -m py_compile collector/update.py collector/universe_service.py collector/daily_pipeline.py collector/publish_to_dashboard.py
```
