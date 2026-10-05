// Package sessionassets 管理智能体会话资产的发现、保全与交接。
//
// 本包是独立领域：它不复用 GoNavi 内置 AI 助手的 runharness 账本，也不进入
// db.Database 数据源契约。每种智能体工具在一个 GoNavi 数据根内只有一个
// Integration，可配置多个本地历史来源（Source）；每个会话对应一个 Asset，
// 归档等触发事件产生 CaptureJob，把原始材料提交为自包含的代次（generation）。
//
// 持久化分两层：catalog.sqlite 保存配置、索引与任务（投影，可重建）；
// 材料库目录保存提交清单（current.json + manifest.json + 原始文件，事实依据）。
// 两者冲突时以提交清单为准，启动核对负责修复投影。
package sessionassets
