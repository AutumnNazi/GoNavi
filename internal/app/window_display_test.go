package app

import "testing"

func TestBuildMainWindowDisplayLayoutKeepsUsableDisplays(t *testing.T) {
	layout := buildMainWindowDisplayLayout([]mainWindowDisplayArea{
		{X: 0, Y: 25, Width: 1512, Height: 950, Primary: true, Current: true},
		{X: 1512, Y: 0, Width: 1920, Height: 1080},
	}, false)

	if len(layout.Displays) != 2 {
		t.Fatalf("displays = %#v, want 2 entries", layout.Displays)
	}
	if layout.PositionIsGlobal {
		t.Fatalf("positionIsGlobal = true, want macOS monitor-local coordinates")
	}
	current := layout.Displays[0]
	if !current.Primary || !current.Current || current.X != 0 || current.Y != 25 {
		t.Fatalf("primary display = %#v, want work-area origin 0,25", current)
	}
	if layout.Displays[1].Current {
		t.Fatalf("secondary display marked current: %#v", layout.Displays[1])
	}
}

func TestBuildMainWindowDisplayLayoutDropsDegenerateDisplays(t *testing.T) {
	layout := buildMainWindowDisplayLayout([]mainWindowDisplayArea{
		{X: 0, Y: 0, Width: 0, Height: 1080},
		{X: 0, Y: 0, Width: 1512, Height: -1},
		{X: -1920, Y: 0, Width: 1920, Height: 1080, Current: true},
	}, false)

	if len(layout.Displays) != 1 {
		t.Fatalf("displays = %#v, want only the usable entry", layout.Displays)
	}
	if layout.Displays[0].X != -1920 {
		t.Fatalf("kept display = %#v, want the left-hand secondary display", layout.Displays[0])
	}
}

func TestBuildMainWindowDisplayLayoutReportsGlobalPositionPlatforms(t *testing.T) {
	layout := buildMainWindowDisplayLayout(nil, true)

	if !layout.PositionIsGlobal {
		t.Fatal("positionIsGlobal = false, want true when the platform already reports global positions")
	}
	if len(layout.Displays) != 0 {
		t.Fatalf("displays = %#v, want empty list for unsupported platforms", layout.Displays)
	}
	if layout.Displays == nil {
		t.Fatal("displays = nil, want an empty slice so the frontend receives a JSON array")
	}
}

func TestGetMainWindowDisplayLayoutReturnsSuccess(t *testing.T) {
	result := (&App{}).GetMainWindowDisplayLayout()

	if !result.Success {
		t.Fatalf("success = false: %s", result.Message)
	}
	if _, ok := result.Data.(mainWindowDisplayLayout); !ok {
		t.Fatalf("data = %#v, want mainWindowDisplayLayout", result.Data)
	}
}
