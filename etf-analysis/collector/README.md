# ETF Data Collector

独立采集器，不依赖旧项目和浏览器页面。

## 每日入口

```bash
python3 daily_pipeline.py --session close
python3 publish_to_dashboard.py
```

会话类型：

- `daily`：每日 23:00 触发；只有出现新的完整交易日才更新。
- `noon`：增量更新到上一完整交易日。
- `close`：更新当天收盘数据并重新筛选 ETF。
- `retry`：只重试日 K 或 PETTM 未达到预期交易日的项目。
- `manual`：按收盘口径立即重新筛选和更新。

`run_cloud_update.sh` 供 GitHub Actions 使用；`run_daily_update.sh` 保留为 macOS 本地备用入口。

## 请求保护与备用入口

- ETF 日 K 默认每批处理 15 只，批次之间等待 20 秒；每只 ETF 之间仍等待 5 秒。
- 批次大小和批次间隔可通过 `ETF_BATCH_SIZE`、`ETF_BATCH_PAUSE` 或命令行
  `--batch-size`、`--batch-pause` 调整，建议保持在 10–20 只/批。
- 日 K 请求顺序为东方财富主接口、东方财富备用接口，二者都失败后才使用
  `AkShare东方财富` 解析。两条入口均属于东方财富数据服务，不改变主数据源要求。
- 云端单次 HTTP 连接超时默认 5 秒、单次请求最长 20 秒，避免某个被阻断的接口
  长时间占住整个批次；仍保留 3/6/12 秒退避重试。
- `output/update_report.json` 按每只 ETF 即时写入批次、完成数和失败原因；任务中断后
  重新运行不会重下已经完整缓存的日期，只会继续请求缓存缺少的日期。
- GitHub Actions 每完成一批即提交增量缓存到仓库，避免任务中断丢失已完成的批次。
- 已有缓存一律从最后日期的下一自然日请求；只有没有缓存的新 ETF/指数才请求初始历史。
  收到超出请求区间的记录会被过滤，旧历史记录不会因每日更新被覆盖。
- 任何手动补跑在北京时间 15:00 前只接收上一完整交易日及以前的数据。

GitHub Actions 每天北京时间 23:00 触发一次（UTC `15:00`）。`daily` 会先确认是否出现新的完整交易日；没有新交易日时只记录“无新的完整交易日”，不重复下载、不发布 Cloudflare。

## 筛选规则

- 市值不低于 10 亿元。
- 仅限 A 股场内股票型 ETF。
- 排除宽基、债券、货币、商品、QDII、REIT、FOF 和混合基金。
- 相同跟踪指数只保留规模最大的一只 ETF。
- 只选择能够读取官方历史 PETTM 的跟踪指数。
- 按市值降序选择，最多 100 只；不足 100 只时保留实际合格数量。

已验证清单写入 `etf_mapping.json`，候选资料缓存在 `candidate_catalog.json`。候选目录不会把不可用的 PETTM 当作 0，也不会用其他指数替代。

## 缓存与报告

- 日 K：`output/etf_price/{code}.json`
- PETTM：`output/index_pe/{indexCode}.json`
- 原始响应：`output/raw/`，GitHub Actions 中作为短期附件保存
- 更新报告：`output/update_report.json`
- 运行上下文：`output/run_context.json`
- 新鲜度报告：`output/freshness_report.json`

已有有效缓存不会被清空。失败项保留上一份有效数据，并在网页标记为过旧。
