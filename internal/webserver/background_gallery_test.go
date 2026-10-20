package webserver

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

type galleryRPCProbe struct{ called bool }

func (p *galleryRPCProbe) BackgroundGalleryStatus() string {
	p.called = true
	return "desktop-cache"
}

func TestBrowserRPCRejectsDesktopGalleryBeforeReflection(t *testing.T) {
	methods := []string{"BackgroundGalleryStatus", "BackgroundGalleryRefresh", "BackgroundGalleryDownload", "BackgroundGalleryCancel", "BackgroundGalleryResolve", "BackgroundGalleryRemove"}
	for _, target := range []string{"app", "app.app"} {
		for _, method := range methods {
			t.Run(target+"/"+method, func(t *testing.T) {
				probe := &galleryRPCProbe{}
				invoker := &methodInvoker{targets: map[string]reflect.Value{target: reflect.ValueOf(probe)}}
				req := invokeRequest{Namespace: "app", Method: method}
				if target == "app.app" {
					req.Receiver = "App"
				}
				_, err := invoker.Invoke(context.Background(), req)
				if err == nil || !strings.Contains(err.Error(), "unavailable in web runtime") {
					t.Fatalf("gallery must be denied before reflection: %v", err)
				}
				if probe.called {
					t.Fatal("browser accessed the server's desktop cache")
				}
			})
		}
	}
}

func TestNativeSharedRPCAllowsDesktopGallery(t *testing.T) {
	probe := &galleryRPCProbe{}
	invoker := &methodInvoker{targets: map[string]reflect.Value{"app.app": reflect.ValueOf(probe)}, allowDesktopMethods: true}
	got, err := invoker.Invoke(context.Background(), invokeRequest{Namespace: "app", Receiver: "App", Method: "BackgroundGalleryStatus"})
	if err != nil || got != "desktop-cache" || !probe.called {
		t.Fatalf("native shared runtime result=%v err=%v called=%v", got, err, probe.called)
	}
}
