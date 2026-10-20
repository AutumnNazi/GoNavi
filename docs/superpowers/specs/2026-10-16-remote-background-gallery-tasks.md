# 远程背景图库实施计划与契约

设计：2026-10-16-remote-background-gallery-design.md；用户已确认实施及非商业用途。首批鲸鱼娘 A/B 后，已批准三张 Pixiv 原版（GLM、文心轮椅版、MiniMax）；其余未核实项和 GLM 镜像继续排除。禁止自动 commit/push。

## 共享 JSON 契约（不可各自另造）

BaseURL: https://origin-download.syngnat.top:8443/gonavi/backgrounds/v1/

Catalog: { schemaVersion: 1, version: string, entries: Entry[] }
Entry: { id: string, version: string, names: Record<string,string>, fit: "contain"|"cover", image: Asset, thumbnail: Asset, attribution: string, sourceUrl: string, rightsStatus: "approved", license: License }
Asset: { path: "assets/<sha256>.<webp|png|jpg>", sha256: string, sizeBytes: number, width: number, height: number, mimeType: "image/webp"|"image/png"|"image/jpeg" }
License: { id: string, name: string, url: string, notice: string, text: string, nonCommercial: boolean }
Installed: { entry: Entry, url: string }
State: { catalog: Catalog|null, installed: Installed[], stale: boolean, warningCode?: string }
Progress: { requestId: string, downloaded: number, total: number, phase: string }

桌面本地资源 URL: /__gonavi/background-gallery/assets/<sha256>.<ext>。存储目录为活动 GoNavi 数据根目录下 background-gallery/v1。原图最大 16MiB，缩略图最大 256KiB，最多 64 个目录条目、目录最大 2MiB、图像最大 24MP。ID/版本/URL/文本长度等需有界校验。

App 方法（全部返回 connection.QueryResult）：
- BackgroundGalleryStatus() -> State，仅查本地，不联网。
- BackgroundGalleryRefresh() -> State，显式刷新，错误时可回退合法缓存并 stale=true。
- BackgroundGalleryDownload(id, version, requestId string) -> Installed，下载及持久化完成后返回。
- BackgroundGalleryCancel(requestId string) -> canceled=true。
- BackgroundGalleryResolve(id, version string) -> Installed；version 空时解析该 ID 已安装版本，兼容旧设置。
- BackgroundGalleryRemove(id, version string) -> removed=true；仅删除该已安装条目。

事件：background-gallery:progress，采用上面的 Progress。App 方法在普通 Web RPC 服务端 deny；原生分离窗口允许调用父宿主。客户端浏览器 adapter 不调用这些方法，使用 IDB Blob 缓存。

## 模块边界

浏览器缓存与校验集中在 backgroundGallery 的 types、validation、webStorage 和 webAdapter 模块；桌面 adapter、状态选择、UI 与渲染独立。完整许可正文上限 64KiB、NOTICE 上限 16KiB，不截断许可文本。

## 写入范围与顺序

1. 领域实现：只写 internal/backgroundgallery/**。提供 Options/Service API 与表驱动测试；不改 app/main/frontend/deploy/i18n。
2. 前端：只写 frontend/src 中背景相关 store/utils/components/types/tests；不改 frontend/wailsjs、shared/i18n、后台或部署文件，不自行删除/下载美术资源。
3. 发布工具：只写 deploy/background-gallery/**、tools/publish-background-gallery.py、tools/test_publish_background_gallery.py、docs/background-gallery-operations.md、deploy/download-mirror/bero-origin-download.conf。不执行 SSH/上传，不写图片到仓库。
4. 集成层：App 生命周期/薄绑定/上下文注册、main/SharedRuntime 路由/Web拒绝、六语言目录、自动生成绑定、外部素材恢复包、审查与部署。生成器独占执行，先保护当前已有生成物差异。
5. 发布前最后检查全部 diff 与测试；部署前验证源站并备份配置；不改既有服务端口、证书、release/driver/brand 路径。

## 集成注意事项

- 桌面资源须通过 Wails 前置 Middleware 拦截，避免 Vite SPA 回退返回 HTML；SharedRuntime 继续使用已鉴权的直接资源路由。
- 缩略图复用有界、静态格式、尺寸及 SHA-256 校验；浏览器资源 URL 不写入持久化选择。
- 取消、数据目录迁移、跨进程锁等待和元数据提交失败均须保持清理/回滚语义。

## 领域 API 约定

package backgroundgallery，Service 可由 NewService(Options{Root, BaseURL, Client}) 创建；BaseURL 默认上述固定值，Client 为 HTTP client 或工厂（由实现给 Lead 最终签名）。
- Status() (State,error)
- Refresh(ctx context.Context) (State,error)
- Download(ctx context.Context,id,version string,onProgress func(Progress)) (Installed,error)
- Resolve(id,version string) (Installed,error)
- Remove(id,version string) error
- ServeHTTP(w http.ResponseWriter,r *http.Request)
- ErrorCode(err error) string，稳定机器码，例如 invalid_catalog, invalid_id, unavailable, download_failed, integrity, canceled, storage_failed。

底层 Service 不拥有 UI requestId；Progress.requestId 由 App wrapper 补充。取消由 App 持有 context.CancelFunc。Service 必须支持并发/原子写，不在网络 I/O 期间持有全局锁。BaseURL 的测试覆盖用注入 HTTPS 测试服务，不在单测访问真实 Bero。

## 验证与发布

- 先写各边界失败测试，再实现；委派提交结果前自行测试自己的范围。
- 全量背景 Vitest，Go domain/app/web 相关测试，race，六语言 i18n 和前端构建。
- 真机 Wails 开始只读本地；手动点击下载测试进度/取消/成功；离线重启保持背景；损坏/失败保留旧选择。
- 浏览器 IDB、CORS/crypto 缺失、配额失败、跨窗口与迟到请求覆盖的反向测试。
- Bero 先测试配置，再仅上传五张审核通过图片的原图/缩略图/对应许可与目录；公众 HTTPS 校验 hash/大小/MIME/CORS。
- 图片外部备份后从当前源码树删除两张静态 WebP；检查构建无二进制/内联残留。不重写历史。
- 若某项验证或部署受阻，明确未完成部分，不把候选素材暂缓包装成已上线。
