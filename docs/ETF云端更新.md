# ETF 网站：独立接入与云端更新

本次沿用 `jinhui19200/simple-stock-crawler`，不替换原股票项目。

## 目录和发布目标

- 原股票项目：根目录及 `public/`，原有 GitHub Pages 工作流不变。
- ETF 项目：`etf-analysis/`，网站、测试、采集器和清洗缓存独立存放。
- ETF 日更：`.github/workflows/etf-site-daily.yml`。
- ETF 测试：`.github/workflows/etf-site-ci.yml`。
- Cloudflare Worker：`lin-etf-analysis`。
- 站点：`https://lin-etf-analysis.lin2194740187.workers.dev/`。

## 一次性配置

仓库 Actions Secrets：

- `CLOUDFLARE_API_TOKEN`：仅允许目标账号 Workers 部署的 API Token。
- `CLOUDFLARE_ACCOUNT_ID`：目标 Cloudflare 账号 ID。

密钥只能配置为 Secrets，不写入源码、缓存和日志。不要将本地 OAuth 访问令牌充当长期 CI 密钥。

## 每日行为（北京时间）

- 工作日 11:40：截至上一完整交易日，不纳入当日未收盘日 K。
- 工作日 15:10：更新收盘日 K 和官方 PETTM，并按条件重新筛选。
- 工作日 15:45：只重试缺失、失败或日期不足的项目。
- 可在 Actions 手动运行 `ETF site daily update and deploy`，选择 `manual`。

GitHub 定时执行可能延迟。Mac 不是主调度器，云端成功配置后不依赖 Mac 开机。

## 数据约束

- 已有历史本地保存，增量请求从最后日期下一自然日开始。
- 每个 ETF 的请求串行进行，完成后等待 5 秒，重试退避 3/6/12 秒。
- 前复权日 K 只接受真实、有效 OHLC；指数 PETTM 只采用官方数据。
- 原始响应作为 14 天构建附件保存；清洗缓存提交至仓库。
- 缺少官方估值时明确标注，不插值、不推算、不伪造。
- 过旧缓存继续保留；网页显示数据截至日期和异常状态。

## 验收

首次运行完成后，必须同时检查 Actions 日志、清洗缓存提交及线上 `data/dashboard_universe.json`。
没有执行成功前，不宣称云端自动更新已生效。
