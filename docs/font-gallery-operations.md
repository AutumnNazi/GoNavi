# GoNavi 按需字体库：Bero 发布记录

## 当前发布

- 目录版本：2026-10-16.1；发布时间：2026-10-16 18:06:04（Asia/Shanghai）。
- 公网目录：[catalog.json](https://origin-download.syngnat.top:8443/gonavi/fonts/v1/catalog.json)。
- 目录 SHA-256：`4ccf7f6f8871ebcb90898c0043586d6359ae832dacc8d33a982110c178013dad`。
- 11 款字体原始文件合计 2,157,276 字节；每款小于 512 KiB。
- 固定远端目录：`/srv/gonavi-downloads/gonavi/fonts/v1/`；只添加字体命名空间，不触碰背景图库、更新发布和其他端口。
- 安装包和源码仓库不包含字体文件。浏览目录不会下载字体；预览和安装由用户主动触发。

元数据与配置：

- [上游固定版本与资源哈希](../deploy/font-gallery/source-manifest.json)
- [本次发布验证结果](../deploy/font-gallery/publication-2026-10-16.json)
- [字体目录契约](../deploy/font-gallery/catalog.schema.json)
- [字体 Nginx 路由片段](../deploy/font-gallery/bero-locations.conf)
- [完整 Bero 下载源配置](../deploy/download-mirror/bero-origin-download.conf)

## 首批目录

| 字体 | 用途 | 提供版本 | 许可 |
|---|---|---|---|
| JetBrains Mono | 代码 | 直立可变字重原版 | OFL-1.1 |
| Fira Code | 代码 | 直立可变字重原版 | OFL-1.1 |
| Fira Mono | 代码 | Regular 原版 | OFL-1.1 |
| IBM Plex Mono | 代码 | Regular 原版 | OFL-1.1 |
| Roboto Mono | 代码 | 直立可变字重原版 | OFL-1.1 |
| Inconsolata | 代码 | 字宽、字重可变直立原版 | OFL-1.1 |
| Source Code Pro | 代码 | 直立可变字重原版 | OFL-1.1 |
| Ubuntu Mono | 代码 | Regular 原版 | Ubuntu Font Licence 1.0 |
| Cousine | 代码 | Regular 原版 | OFL-1.1 |
| Space Mono | 代码 | Regular 原版 | OFL-1.1 |
| Atkinson Hyperlegible | 界面 | Regular 原版 | OFL-1.1 |

来源固定为 [google/fonts revision 1d0e46c7933245c8180fe83e47917961c913bbdb](https://github.com/google/fonts/tree/1d0e46c7933245c8180fe83e47917961c913bbdb)。文件字节不做子集、重命名字体族、格式转换或裁剪。每项目录保存源文件版权、完整许可、来源链接与版本；另提供内容寻址的许可文本。

预览字段引用与正式下载相同的原始小文件，不声称它是子集。预览请求不写安装记录。所有字体主要面向拉丁文字；中文预览仍可能使用系统 CJK 字体，不代表这些字体具备完整中文覆盖。

Cascadia Code、Iosevka、Hack、更纱黑体未包含在首批。它们在客户端的本地推荐名单中可以继续显示待上架，不伪造下载地址、授权或资源哈希。

## 发布和验证

1. 在仓库外获取固定 revision 的原始 TTF、LICENSE/OFL 与 METADATA；确认许可证允许本次原版分发，保留版权和完整条款。
2. 生成内容寻址的字体、许可与目录。校验文件大小、SHA-256、字体 family 名称；禁止将任意外部目录路径放进上传清单。
3. 运行下面的本地领域验证。该测试默认跳过，正常 CI 不下载真实字体；外部 payload 不进入仓库。

	export GONAVI_FONT_PUBLICATION_DIR=/absolute/path/to/prepared/payload
	go test ./internal/fontgallery -run TestPublicationPayload -count=1 -v

4. 使用已配置、固定 host key 的 Bero SSH 入口。新文件先放在 root 私有 staging，再校验哈希后落位；不使用删除式同步。
5. 备份现有 Nginx 配置，仅插入字体片段；检查原配置 SHA 以拒绝漂移。执行 nginx -t 后 reload。
6. 在公开目录切换前，逐一下载全部字体与许可，检查 200、SHA、长度、font/ttf 或 text/plain、nosniff、CORS、immutable 缓存。
7. 最后原子写入 catalog.json；目录使用 no-cache 重新验证，不缓存旧清单。再次检查目录字节与 HEAD，非法路径/目录索引返回 404，POST 拒绝。

本次完成：22 个不可变文件公网验证；11 款真实字体通过后端预览、下载、重建离线服务、读取及删除测试；11 款公网字体通过浏览器 FontFace.load() 和 loaded 状态检查。

发布前后背景图库目录 SHA 均为 9722bd0928e3b128afe2aa28e89d3f93b60110c4eabc39bd72f1fbfd4a86be88。healthz 为 200，已有 dev 发布资源 HEAD 为 200。health.txt 在发布前就不存在，前后均为 404；未顺手改动该独立问题。

## 回滚

远端备份目录：`/root/gonavi-font-backups/20261016-v1/`。包含原始配置、首发前目录不存在的标记、stage/activation receipt。首次发布没有旧字体目录需要恢复。

先核对当前配置仍为 b1112ae50525b6cd3357d1d704a54eea9383859d33e55e66c2145d6329d501f5，并比较是否有后续发布。确认无并发变更后，可恢复备份配置，nginx -t 成功后 reload，以撤销新字体路由。保留不可变文件和发布记录，不删除整个下载根目录或后台图库。若已有后续字体发布，不能直接覆盖整份配置，应只撤销本次字体片段。

## 客户端边界

服务器上架不等同于桌面进程已加载新接口。旧的 wails dev 使用 -skipbindings/-nogorebuild 时，前端更新后可能没有 FontGallery* 运行时方法；“当前环境无法安全保存字体库”不能靠发布静态目录消除，必须使用包含新方法的后端重新启动。

本次没有重启用户的桌面应用、修改其字体选择或安装操作系统字体。普通 Web 后端依然不能通过这些接口写服务器的字体目录。
