package app

import (
	"context"
	"errors"
	"os"

	"GoNavi-Wails/internal/appdata"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/sessionassets"
)

// 会话资产服务的宿主管理：懒打开、启动恢复与退出停止。
// 服务持有材料库锁（单写入者）；打开失败时向绑定层返回可解释状态，
// 不显示“正在保护”（V-05/V-13）。

// ensureSessionAssetsService 返回已打开的服务；必要时按已配置位置打开。
// 第二个 GoNavi 实例占用材料库时返回 ErrLibraryLocked。
func (a *App) ensureSessionAssetsService() (*sessionassets.Service, error) {
	a.sessionAssetsMu.Lock()
	defer a.sessionAssetsMu.Unlock()
	if a.sessionAssets != nil {
		return a.sessionAssets, nil
	}
	materialsRoot, err := appdata.ResolveSessionAssetsDirectory(appdata.MustResolveActiveRoot())
	if err != nil {
		return nil, err
	}
	service, err := sessionassets.Open(materialsRoot)
	if err != nil {
		return nil, err
	}
	service.StartWorker(a.sessionAssetsContext())
	a.sessionAssets = service
	return service, nil
}

// sessionAssetsContext 返回 worker 使用的生命周期上下文。
func (a *App) sessionAssetsContext() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

// sessionAssetsCatalog 在服务可用时返回其目录索引。
func (a *App) sessionAssetsCatalog() (*sessionassets.Catalog, *sessionassets.Service, error) {
	service, err := a.ensureSessionAssetsService()
	if err != nil {
		return nil, nil, err
	}
	return service.Catalog(), service, nil
}

// initializeSessionAssets 在启动时恢复已存在材料库的服务与保存队列。
// 没有材料库（从未启用）时不创建文件；库被其他实例占用时仅记录警告，
// 由状态查询呈现占用原因。
func (a *App) initializeSessionAssets() {
	materialsRoot, err := appdata.ResolveSessionAssetsDirectory(appdata.MustResolveActiveRoot())
	if err != nil {
		logger.Warnf("解析会话资产材料库位置失败：%v", err)
		return
	}
	catalogPath := materialsRoot + string(os.PathSeparator) + "catalog.sqlite"
	if _, err := os.Stat(catalogPath); err != nil {
		// 从未启用过：不创建材料库。
		return
	}
	if _, err := a.ensureSessionAssetsService(); err != nil {
		if errors.Is(err, sessionassets.ErrLibraryLocked) {
			logger.Warnf("会话资产材料库被其他 GoNavi 实例占用，本次运行不提供保全：path=%s", materialsRoot)
			return
		}
		logger.Error(err, "恢复会话资产服务失败")
	}
}

// shutdownSessionAssets 在应用退出时停止保存并释放材料库锁。
func (a *App) shutdownSessionAssets() {
	a.sessionAssetsMu.Lock()
	service := a.sessionAssets
	a.sessionAssets = nil
	a.sessionAssetsMu.Unlock()
	if service == nil {
		return
	}
	if err := service.Close(); err != nil {
		logger.Error(err, "关闭会话资产服务失败")
	}
}
