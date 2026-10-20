package app

// 将外观资源服务状态聚合在独立类型，避免继续扩充 App 结构。
type appearanceGalleryState struct {
	backgroundGallery backgroundGalleryState
	fontGallery       fontGalleryState
}
