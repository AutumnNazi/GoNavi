package app

import (
	"context"
	"net/http"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/fontgallery"
	"GoNavi-Wails/internal/uievents"

	"github.com/google/uuid"
)

const fontGalleryProgressEvent = "font-gallery:progress"

func (a *App) fontGalleryFailure(code string) connection.QueryResult {
	return connection.QueryResult{Success: false, Message: a.appText("app.theme.font_family.gallery.error."+code, nil), Data: map[string]any{"code": code, "canceled": code == "canceled"}}
}

func (a *App) fontGalleryResult(value any, err error) connection.QueryResult {
	if err != nil {
		return a.fontGalleryFailure(fontgallery.ErrorCode(err))
	}
	return connection.QueryResult{Success: true, Data: value}
}

func (a *App) fontGalleryAvailable() bool {
	return a != nil && !a.webRuntime
}

func (a *App) FontGalleryStatus() connection.QueryResult {
	if !a.fontGalleryAvailable() {
		return a.fontGalleryFailure("unsupported_environment")
	}
	release, err := a.beginFontGalleryOperation()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	defer release()
	service, err := a.fontGalleryService()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	state, err := service.Status()
	return a.fontGalleryResult(state, err)
}

func (a *App) FontGalleryRefresh() connection.QueryResult {
	return a.fontGalleryRefreshContext(a.galleryContext())
}

func (a *App) fontGalleryRefreshContext(parent context.Context) connection.QueryResult {
	if !a.fontGalleryAvailable() {
		return a.fontGalleryFailure("unsupported_environment")
	}
	release, err := a.beginFontGalleryOperation()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	defer release()
	service, err := a.fontGalleryService()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	ctx, finish, err := a.beginFontGalleryRequest(parent, uuid.NewString())
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	defer finish()
	state, err := service.Refresh(ctx)
	return a.fontGalleryResult(state, err)
}

func (a *App) FontGalleryDownload(id, version, requestID string) connection.QueryResult {
	return a.fontGalleryDownloadContext(a.galleryContext(), id, version, requestID)
}

func (a *App) fontGalleryDownloadContext(parent context.Context, id, version, requestID string) connection.QueryResult {
	if !a.fontGalleryAvailable() {
		return a.fontGalleryFailure("unsupported_environment")
	}
	if !galleryRequestIDValid(requestID) {
		return a.fontGalleryFailure("invalid_id")
	}
	release, err := a.beginFontGalleryOperation()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	defer release()
	service, err := a.fontGalleryService()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	ctx, finish, err := a.beginFontGalleryRequest(parent, requestID)
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	defer finish()
	installed, err := service.Download(ctx, id, version, func(progress fontgallery.Progress) {
		progress.RequestID = requestID
		uievents.Emit(a.ctx, fontGalleryProgressEvent, progress)
	})
	return a.fontGalleryResult(installed, err)
}

func (a *App) FontGalleryPreview(id, version, requestID string) connection.QueryResult {
	return a.fontGalleryPreviewContext(a.galleryContext(), id, version, requestID)
}

func (a *App) fontGalleryPreviewContext(parent context.Context, id, version, requestID string) connection.QueryResult {
	if !a.fontGalleryAvailable() {
		return a.fontGalleryFailure("unsupported_environment")
	}
	if !galleryRequestIDValid(requestID) {
		return a.fontGalleryFailure("invalid_id")
	}
	release, err := a.beginFontGalleryOperation()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	defer release()
	service, err := a.fontGalleryService()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	ctx, finish, err := a.beginFontGalleryRequest(parent, requestID)
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	defer finish()
	preview, err := service.Preview(ctx, id, version, func(progress fontgallery.Progress) {
		progress.RequestID = requestID
		uievents.Emit(a.ctx, fontGalleryProgressEvent, progress)
	})
	return a.fontGalleryResult(preview, err)
}

func (a *App) FontGalleryCancel(requestID string) connection.QueryResult {
	if !a.fontGalleryAvailable() {
		return a.fontGalleryFailure("unsupported_environment")
	}
	if !galleryRequestIDValid(requestID) {
		return a.fontGalleryFailure("invalid_id")
	}
	canceled := a.cancelFontGalleryRequest(requestID)
	return connection.QueryResult{Success: true, Data: map[string]any{"canceled": canceled}}
}

func (a *App) FontGalleryResolve(id, version string) connection.QueryResult {
	if !a.fontGalleryAvailable() {
		return a.fontGalleryFailure("unsupported_environment")
	}
	release, err := a.beginFontGalleryOperation()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	defer release()
	service, err := a.fontGalleryService()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	installed, err := service.Resolve(id, version)
	return a.fontGalleryResult(installed, err)
}

func (a *App) FontGalleryRemove(id, version string) connection.QueryResult {
	if !a.fontGalleryAvailable() {
		return a.fontGalleryFailure("unsupported_environment")
	}
	release, err := a.beginFontGalleryOperation()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	defer release()
	service, err := a.fontGalleryService()
	if err != nil {
		return a.fontGalleryResult(nil, err)
	}
	err = service.Remove(id, version)
	return a.fontGalleryResult(map[string]any{"removed": err == nil}, err)
}

func FontGalleryAssetHandler(a *App) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.fontGalleryAvailable() || !strings.HasPrefix(r.URL.Path, fontgallery.AssetURLPrefix) {
			http.NotFound(w, r)
			return
		}
		release, err := a.beginFontGalleryOperation()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer release()
		service, err := a.fontGalleryService()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		service.ServeHTTP(w, r)
	})
}

func withFontGalleryContextHandlers(a *App, handlers map[string]any) map[string]any {
	handlers["FontGalleryRefresh"] = a.fontGalleryRefreshContext
	handlers["FontGalleryDownload"] = a.fontGalleryDownloadContext
	handlers["FontGalleryPreview"] = a.fontGalleryPreviewContext
	return handlers
}
