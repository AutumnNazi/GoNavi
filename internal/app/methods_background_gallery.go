package app

import (
	"context"
	"net/http"
	"strings"

	"GoNavi-Wails/internal/backgroundgallery"
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/uievents"

	"github.com/google/uuid"
)

const backgroundGalleryProgressEvent = "background-gallery:progress"

func (a *App) backgroundGalleryFailure(code string) connection.QueryResult {
	return connection.QueryResult{Success: false, Message: a.appText("app.theme.background.gallery.error."+code, nil), Data: map[string]any{"code": code, "canceled": code == "canceled"}}
}

func (a *App) galleryResult(value any, err error) connection.QueryResult {
	if err != nil {
		return a.backgroundGalleryFailure(backgroundgallery.ErrorCode(err))
	}
	return connection.QueryResult{Success: true, Data: value}
}

func (a *App) galleryContext() context.Context {
	if a != nil && a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

func (a *App) galleryAvailable() bool {
	return a != nil && !a.webRuntime
}

// BackgroundGalleryStatus reads installed metadata without network requests.
func (a *App) BackgroundGalleryStatus() connection.QueryResult {
	if !a.galleryAvailable() {
		return a.backgroundGalleryFailure("unsupported_environment")
	}
	release, err := a.beginBackgroundGalleryOperation()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	defer release()
	service, err := a.backgroundGalleryService()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	state, err := service.Status()
	return a.galleryResult(state, err)
}

// BackgroundGalleryRefresh explicitly refreshes the remote catalog.
func (a *App) BackgroundGalleryRefresh() connection.QueryResult {
	return a.backgroundGalleryRefreshContext(a.galleryContext())
}

func (a *App) backgroundGalleryRefreshContext(parent context.Context) connection.QueryResult {
	if !a.galleryAvailable() {
		return a.backgroundGalleryFailure("unsupported_environment")
	}
	release, err := a.beginBackgroundGalleryOperation()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	defer release()
	service, err := a.backgroundGalleryService()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	ctx, finish, err := a.beginBackgroundGalleryRequest(parent, uuid.NewString())
	if err != nil {
		return a.galleryResult(nil, err)
	}
	defer finish()
	state, err := service.Refresh(ctx)
	return a.galleryResult(state, err)
}

// BackgroundGalleryDownload installs one explicitly selected approved image.
func (a *App) BackgroundGalleryDownload(id, version, requestID string) connection.QueryResult {
	return a.backgroundGalleryDownloadContext(a.galleryContext(), id, version, requestID)
}

func (a *App) backgroundGalleryDownloadContext(parent context.Context, id, version, requestID string) connection.QueryResult {
	if !a.galleryAvailable() {
		return a.backgroundGalleryFailure("unsupported_environment")
	}
	if !galleryRequestIDValid(requestID) {
		return a.backgroundGalleryFailure("invalid_id")
	}
	release, err := a.beginBackgroundGalleryOperation()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	defer release()
	service, err := a.backgroundGalleryService()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	ctx, finish, err := a.beginBackgroundGalleryRequest(parent, requestID)
	if err != nil {
		return a.galleryResult(nil, err)
	}
	defer finish()
	installed, err := service.Download(ctx, id, version, func(progress backgroundgallery.Progress) {
		progress.RequestID = requestID
		uievents.Emit(a.ctx, backgroundGalleryProgressEvent, progress)
	})
	return a.galleryResult(installed, err)
}

// BackgroundGalleryCancel cancels a task, including a request racing with registration.
func (a *App) BackgroundGalleryCancel(requestID string) connection.QueryResult {
	if !a.galleryAvailable() {
		return a.backgroundGalleryFailure("unsupported_environment")
	}
	if !galleryRequestIDValid(requestID) {
		return a.backgroundGalleryFailure("invalid_id")
	}
	canceled := a.cancelBackgroundGalleryRequest(requestID)
	return connection.QueryResult{Success: true, Data: map[string]any{"canceled": canceled}}
}

// BackgroundGalleryResolve resolves only verified, already installed content.
func (a *App) BackgroundGalleryResolve(id, version string) connection.QueryResult {
	if !a.galleryAvailable() {
		return a.backgroundGalleryFailure("unsupported_environment")
	}
	release, err := a.beginBackgroundGalleryOperation()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	defer release()
	service, err := a.backgroundGalleryService()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	installed, err := service.Resolve(id, version)
	return a.galleryResult(installed, err)
}

// BackgroundGalleryRemove removes only an explicitly chosen local installation.
func (a *App) BackgroundGalleryRemove(id, version string) connection.QueryResult {
	if !a.galleryAvailable() {
		return a.backgroundGalleryFailure("unsupported_environment")
	}
	release, err := a.beginBackgroundGalleryOperation()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	defer release()
	service, err := a.backgroundGalleryService()
	if err != nil {
		return a.galleryResult(nil, err)
	}
	err = service.Remove(id, version)
	return a.galleryResult(map[string]any{"removed": err == nil}, err)
}

// BackgroundGalleryAssetHandler exposes installed rasters, never arbitrary files.
// Mount only in Wails and authenticated native SharedRuntime, not browser servers.
func BackgroundGalleryAssetHandler(a *App) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !a.galleryAvailable() || !strings.HasPrefix(r.URL.Path, backgroundgallery.AssetURLPrefix) {
			http.NotFound(w, r)
			return
		}
		release, err := a.beginBackgroundGalleryOperation()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer release()
		service, err := a.backgroundGalleryService()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		service.ServeHTTP(w, r)
	})
}

func withBackgroundGalleryContextHandlers(a *App, handlers map[string]any) map[string]any {
	handlers["BackgroundGalleryRefresh"] = a.backgroundGalleryRefreshContext
	handlers["BackgroundGalleryDownload"] = a.backgroundGalleryDownloadContext
	return handlers
}
