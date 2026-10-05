package app

import (
	"context"

	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/sessionassets"
	"GoNavi-Wails/internal/sessionassets/adapters/codex"
)

// 来源核对与观察的宿主接线：启用与启动后对每个启用的来源执行
// 只读发现、归档补保存，并启动运行期间目录观察。

// resumeSessionAssetSources 对全部启用集成的启用来源做一次补核对并启动
// 观察。单来源失败只记录，不阻断其他来源（V-12：能补的补）。
func (a *App) resumeSessionAssetSources(service *sessionassets.Service) {
	catalog := service.Catalog()
	integrations, err := catalog.ListIntegrations(context.Background())
	if err != nil {
		logger.Error(err, "会话资产：读取集成列表失败")
		return
	}
	for _, integration := range integrations {
		if !integration.Enabled {
			continue
		}
		sources, err := catalog.ListSources(context.Background(), integration.ID)
		if err != nil {
			logger.Error(err, "会话资产：读取来源列表失败")
			continue
		}
		for _, source := range sources {
			if !source.Enabled {
				continue
			}
			a.syncAndObserveSource(service, source)
		}
	}
}

// syncAndObserveSource 对单个来源补核对（发现+归档补保存）并启动观察。
func (a *App) syncAndObserveSource(service *sessionassets.Service, source sessionassets.Source) {
	ctx := context.Background()
	sessions, broken, err := (codex.Discoverer{}).DiscoverSourceSessions(ctx, source.RootPath)
	scanOK := err == nil
	if err != nil {
		// 目录不可达：保留最后观测与副本，状态由引用维度呈现（AC-11）。
		logger.Errorf("会话资产：来源扫描不可达 source=%s err=%v", source.ID, err)
	}
	report, syncErr := service.SyncSource(ctx, source, sessions, scanOK)
	if syncErr != nil {
		logger.Error(syncErr, "会话资产：来源核对失败")
	} else if report.Discovered > 0 || report.Backfilled > 0 || len(report.MarkedGone) > 0 || len(broken) > 0 {
		logger.Infof("会话资产：来源核对完成 source=%s discovered=%d backfilled=%d gone=%d broken=%d",
			source.ID, report.Discovered, report.Backfilled, len(report.MarkedGone), len(broken))
	}
	if err := service.StartSourceObservation(source, codex.Discoverer{}, nil); err != nil {
		// 观察启动失败必须可见，不得显示为正在保护（V-05）。
		logger.Errorf("会话资产：来源观察启动失败 source=%s err=%v", source.ID, err)
	}
}
