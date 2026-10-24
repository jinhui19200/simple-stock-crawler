# ETF Data Collector

独立采集器，不依赖旧项目和浏览器页面。

## 每日入口

```bash
python3 daily_pipeline.py --session close
python3 publish_to_dashboard.py
```

会话类型：

- `noon`：增量更新到上一完整交易日。
- `close`：更新当天收盘数据并重新筛选 ETF。
- `retry`：只重试日 K 或 PETTM 未达到预期交易日的项目。
- `manual`：按收盘口径立即重新筛选和更新。

`run_cloud_update.sh` 供 GitHub Actions 使用；`run_daily_update.sh` 保留为 macOS 本地备用入口。

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
