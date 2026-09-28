//go:build !bindings

package main

import (
	"os"

	"GoNavi-Wails/shared/i18n"

	"github.com/wailsapp/wails/v2/pkg/menu"
)

// macOS 菜单栏「GoNavi 设置」菜单向前端派发的事件。
//
// 原生菜单只能放文字菜单项（Wails v2 的 MenuItem 没有图标字段），点击后
// 由前端复用标题栏同名按钮的处理函数，保证两处入口行为一致。
const (
	nativeOpenPreferencesEvent = "gonavi:native-open-preferences"
	nativeToggleThemeEvent     = "gonavi:native-toggle-theme"
	nativeOpenAboutEvent       = "gonavi:native-open-about"
	// nativeMenuLanguageEvent 由前端在界面语言变化时发出，携带语言代码。
	// 语言偏好只存在前端持久化里，Go 启动时拿不到，所以菜单先按环境变量
	// 猜一个语言渲染，前端就绪后再按这个事件校正标签。
	nativeMenuLanguageEvent = "gonavi:native-menu-language"
)

// macPreferencesMenu 是菜单栏上并列的三个顶层菜单：GoNavi 设置 / 主题 / 关于。
//
// macOS 菜单栏顶层项必须挂子菜单才能响应点击，所以「主题」「关于」各自只有
// 一个子项，动作放在子项上。
type macPreferencesMenu struct {
	root        *menu.MenuItem
	preferences *menu.MenuItem
	themeRoot   *menu.MenuItem
	theme       *menu.MenuItem
	aboutRoot   *menu.MenuItem
	about       *menu.MenuItem
	localizer   *i18n.Localizer
}

// newMacPreferencesMenu 构建菜单栏里的「GoNavi 设置」「主题」「关于」三个顶层菜单。
//
// 刻意不绑定快捷键：⌘, 已被前端的「快捷键管理」占用，且前端快捷键可由用户
// 自定义；原生加速键会在 WebView 之前截获按键，写死在这里会让用户的自定义失效。
func newMacPreferencesMenu(localizer *i18n.Localizer, emit func(event string)) *macPreferencesMenu {
	emitOnClick := func(event string) menu.Callback {
		return func(_ *menu.CallbackData) {
			if emit != nil {
				emit(event)
			}
		}
	}
	m := &macPreferencesMenu{
		preferences: menu.Text("", nil, emitOnClick(nativeOpenPreferencesEvent)),
		theme:       menu.Text("", nil, emitOnClick(nativeToggleThemeEvent)),
		about:       menu.Text("", nil, emitOnClick(nativeOpenAboutEvent)),
		localizer:   localizer,
	}
	m.root = menu.SubMenu("", menu.NewMenuFromItems(m.preferences))
	m.themeRoot = menu.SubMenu("", menu.NewMenuFromItems(m.theme))
	m.aboutRoot = menu.SubMenu("", menu.NewMenuFromItems(m.about))
	m.relabel()
	return m
}

// topLevelItems 按菜单栏从左到右的顺序返回要追加的顶层菜单。
func (m *macPreferencesMenu) topLevelItems() []*menu.MenuItem {
	if m == nil {
		return nil
	}
	return []*menu.MenuItem{m.root, m.themeRoot, m.aboutRoot}
}

// setLanguage 切换菜单语言；返回 true 表示标签有变化，调用方需刷新原生菜单。
func (m *macPreferencesMenu) setLanguage(value string) bool {
	if m == nil || m.localizer == nil {
		return false
	}
	language, ok := i18n.NormalizeLanguage(value)
	if !ok || language == m.localizer.Language() {
		return false
	}
	m.localizer.SetLanguage(language)
	m.relabel()
	return true
}

func (m *macPreferencesMenu) relabel() {
	t := func(key string) string {
		if m.localizer == nil {
			return key
		}
		return m.localizer.T(key, nil)
	}
	m.root.SetLabel(t("app.sidebar.settings"))
	m.preferences.SetLabel(t("app.settings.group.preferences.title"))
	m.themeRoot.SetLabel(t("app.titlebar.theme"))
	m.theme.SetLabel(t("app.shortcuts.action.toggleTheme.label"))
	m.aboutRoot.SetLabel(t("app.settings.group.about.title"))
	m.about.SetLabel(t("app.native_menu.about"))
}

// resolveStartupMenuLanguage 从 POSIX 语言环境变量猜首帧菜单语言。
//
// 从 Finder 启动的 .app 通常没有这些变量，会落到英文；前端就绪后发出的
// nativeMenuLanguageEvent 会立即校正，所以这里只求「大多数终端启动时不闪」。
func resolveStartupMenuLanguage() i18n.Language {
	candidates := make([]string, 0, 3)
	for _, name := range []string{"LC_ALL", "LC_MESSAGES", "LANG"} {
		if value := os.Getenv(name); value != "" {
			// 形如 zh_CN.UTF-8：去掉编码后缀交给 NormalizeLanguage。
			for i, r := range value {
				if r == '.' || r == '@' {
					value = value[:i]
					break
				}
			}
			candidates = append(candidates, value)
		}
	}
	return i18n.ResolveLanguage("", candidates)
}
