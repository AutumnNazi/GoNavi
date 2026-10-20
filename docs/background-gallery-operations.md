# Background gallery: preparation, rights gate and Bero operations

## 2026-10-16.3 展示名称修订（当前目录）

当前目录 SHA-256：`9722bd0928e3b128afe2aa28e89d3f93b60110c4eabc39bd72f1fbfd4a86be88`。仅将名称校正为“GLM 娘（原版立绘）”“文心娘（轮椅版）”“MiniMax 娘”及对应六语言，不把 MiniMax 误称女仆。五张图片、缩略图、许可和鲸鱼娘旧记录与下面扩展版本相同；新增三图的派生条目版本随名称变化。已核验公网目录字节，并在桌面刷新后选择新版本 GLM 原版成功。备份为 `/root/gonavi-gallery-backups/20261016-pixiv-v3-labels`。

## 2026-10-16.2 三张 Pixiv 原版扩展（已部署）

- 新增 GLM 娘原版立绘（第7张/p6）、文心娘轮椅版（第12张/p11）、MiniMax 娘（第16张/p15），原版来源为 https://www.pixiv.net/artworks/148186519 。原 JPEG 字节不变；只为预览制作等比、无损编码 WebP 缩略图。
- 许可逐条区分：鲸鱼娘仍为 CC BY-NC-SA 4.0；新增三图使用自定义作者取用声明，保留 ZipZipPipe 署名、原始 URL、相册页码和原文“作为保存用，方便所有人取用，需要标注作者，不可商用。”不赋予这三图 CC 或 ShareAlike 标签。
- 目录 SHA-256：`4c7ec93ab2ea115d7fda6163f7f8bd5867748d8051744b29cb6beb6b40f86a65`；配置 SHA-256：`eb4e15578bfdd1ea09ea1e4db47e7ca1ee71aec39573b5ed56d9fa7c90b10d8e`。五条目录、15个不可变资源均完成公网字节、MIME、CORS及缓存头核验；既有健康检查和安装包 HEAD 正常。
- 备份：`/root/gonavi-gallery-backups/20261016-pixiv-v2`，包含更新前目录和配置。新增资源先发布，目录最后原子切换；鲸鱼娘两条记录及版本与此前完全一致。
- 文心原版为 11,254,649 字节，因保留原版，上限统一调整为16MiB；24MP、256KiB缩略图及并发限制不变。旧10MiB试验构建须重新构建/启动，不能仅刷新界面；旧缓存保留回退机制。未在此操作中发布新的应用安装包。

## 2026-10-16 首次部署记录（历史）

- 维护者确认仅免费、非商业分发后，已上线鲸鱼娘 A/B；六张新增候选仍未上传或进入线上目录。
- 公开目录：https://origin-download.syngnat.top:8443/gonavi/backgrounds/v1/catalog.json
- Catalog SHA-256：`fd0f4a5322e6702bc9fee340ce6a372709cd13425f677734a6d31933df6ed459`。
- 共 7 个不可变资源：2 原图、2 缩略图、3 许可/声明文本；目录最后原子发布。Nginx 配置预检及 reload 成功，既有 health 与 dev 安装包 HEAD 均为 200。
- 线上旧配置 SHA-256：`c74538e90d147e7b301adbb8ffe6eb1afcd5f4594c069fd8b2d908960656a712`；新配置 SHA-256：`cef1e4518b7f6c9e560f7c6362a268899e658d4f966732b090e778eb459a5c69`。
- Bero 备份目录：`/root/gonavi-gallery-backups/20261016-v1`，内含原配置、原目录不存在标记和发布回执。
- 桌面资源必须走 Wails 前置中间件；不能仅依赖静态文件不存在后的 Handler 回退。实测 Vite SPA 回退会返回 200 HTML，掩盖本地图片路由；已补框架实际代理链回归测试。


## Scope and deployment state

This runbook covers the approved **free, noncommercial** five-image gallery: whale-maid A/B and three exact Pixiv originals below. The GLM mirror WebP, GLM study wallpaper, JEV and Hunyuan remain excluded. Publisher inputs are exact source pins, not interchangeable character variants. Approval applies the public author statement to the user-confirmed use; it does not create rights on behalf of the artist.

The publisher is an **offline local preparation tool**, not a deploy command. It has no network code, SSH, upload, destination-host option, paid API or dependency installation. Implementing/testing this tooling does **not** mean the gallery is live. maintainer performs the separately authorized deployment and records its verification results.

Authoritative contract: [shared tasks](<superpowers/specs/2026-10-16-remote-background-gallery-tasks.md>), [design](<superpowers/specs/2026-10-16-remote-background-gallery-design.md>) and [catalog schema](<../deploy/background-gallery/catalog.schema.json>). Do not substitute a release-mirror manifest for this contract.

## Rights matrix (reviewed 2026-10-16)

| ID | Publication gate | Exact source URL | Evidence / restriction |
|---|---|---|---|
| whale-maid-a | APPROVED, conditional noncommercial use | https://raw.githubusercontent.com/Small-tailqwq/dsh-deep-whale/15e9aa0bb3a6281d80cee62185c5482b10d46d19/maid-atelier/assets/maid-atelier-maid-left-v5.webp | CC BY-NC-SA 4.0; full chain, disclaimer and modification notice retained |
| whale-maid-b | APPROVED, conditional noncommercial use | https://raw.githubusercontent.com/Small-tailqwq/dsh-deep-whale/15e9aa0bb3a6281d80cee62185c5482b10d46d19/maid-atelier/assets/maid-atelier-maid-right-v7.webp | Same artwork-specific license; original bytes unchanged |
| glm-maid-portrait | APPROVED — exact original JPEG | https://www.pixiv.net/artworks/148186519 | Page7/p6; ZipZipPipe attribution/noncommercial take-use statement; mirror WebP excluded |
| glm-maid-study | **DEFERRED — excluded** | https://www.bilibili.com/opus/1239259160558698497 | Specific horizontal/study image permission unverified |
| wenxin-wheelchair | APPROVED — exact original JPEG | https://www.pixiv.net/artworks/148186519 | Page12/p11; same custom author statement, not CC |
| jev-portrait | **DEFERRED — excluded** | https://www.bilibili.com/opus/1253808555541135367 | Specific image permission unverified |
| hunyuan-portrait | **DEFERRED — excluded** | https://www.bilibili.com/opus/1242184338245681157 | Specific image permission unverified |
| minimax-maid | APPROVED — exact original JPEG | https://www.pixiv.net/artworks/148186519 | Page16/p15; same custom author statement, not CC |

Evidence for the original whale artwork only (not a license for the three additions):

- [Pinned upstream NOTICE](https://raw.githubusercontent.com/Small-tailqwq/dsh-deep-whale/15e9aa0bb3a6281d80cee62185c5482b10d46d19/maid-atelier/NOTICE).
- [Pinned upstream LICENSE-ARTWORK](https://raw.githubusercontent.com/Small-tailqwq/dsh-deep-whale/15e9aa0bb3a6281d80cee62185c5482b10d46d19/maid-atelier/LICENSE-ARTWORK).
- [Full CC BY-NC-SA 4.0 legal code](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en).
- Complete chain: **上善** ([original character](https://www.pixiv.net/users/62155430)) → **ZipZipPipe** ([DeepSeek maid redesign, GPT Image 2](https://www.pixiv.net/users/18604994)) → **Small-tailqwq** ([tertiary artwork](https://github.com/Small-tailqwq/dsh-deep-whale)). Do not remove intermediate creators or suggest endorsement.

The preserved [NOTICE](<../deploy/background-gallery/NOTICE>) is the exact existing GoNavi same-folder notice, including its unaltered upstream NOTICE and historical bundled-artwork preamble. It is not byte-identical to the upstream NOTICE alone. The preserved [LICENSE-ARTWORK](<../deploy/background-gallery/LICENSE-ARTWORK>) includes the full legal text, warranty disclaimer and scope preamble. Both are independently hash-pinned. The publisher appends a separate remote-gallery/thumbnail modification notice without rewriting this provenance.

Updated audit: comparison against all57 publicly listed Pixiv previews mapped Wenxin/MiniMax to the quoted collection and located the GLM original there; the exact GLM original is used instead of the version-different mirror. JEV/Hunyuan map to a newer collection without the same declaration; study wallpaper has no matched grant in the checked sources. Missing evidence is not a finding that extra individual authorization is mandatory. The DeepSeek-specific CC sentence is never applied to the three additions. Full author text and source chain are preserved in [author terms](<../deploy/background-gallery/LICENSE-ZIPZIPPIPE>) and [provenance notice](<../deploy/background-gallery/NOTICE-ZIPZIPPIPE>).

Future additions need an exact work/statement correspondence and review of actual use. Existing sufficient public permission does not require a duplicate bespoke grant; editing a status or supplying another manifest does not bypass the publisher's reviewed pin.

## Immutable input pins

The [source manifest](<../deploy/background-gallery/source-manifest.json>) describes **input staging**, not the public catalog. Its SHA-256 is pinned in the [publisher](<../tools/publish-background-gallery.py>); passing a modified or unrelated manifest is refused. An intentional metadata/policy update requires review and a new pin, never a CLI bypass. Hashes are integrity checks, not independent signatures or proof of rights.

| External staging filename | Bytes | SHA-256 | Dimensions |
|---|---:|---|---|
| maid-left.webp | 1,034,470 | 2818e5359596b13c5d64f5b1c5d4a9e0c05be477824779af8af37a0e10016b07 | 1122 × 2019 |
| maid-right.webp | 1,209,838 | 7c5a5493e84418bc0435013c8605222718923872c15eb46fdd36158d201c0b1e | 1077 × 2048 |
| NOTICE | 3,432 | cb8764d72cfc8a1143288ed17de5b93ee183a5d70f7a95e0f118880b4a0ba4e6 | UTF-8 |
| LICENSE-ARTWORK | 20,905 | 52de7059eb8d02acd9ad8bb5e3a8d3b3e4f018c9c0826bd676483e54de31345e | UTF-8 |

The table above preserves initial whale input pins. The full current five-original/four-document pin set is in [the source manifest](<../deploy/background-gallery/source-manifest.json>); all inputs are required for five-image preparation.

Before any separate application cleanup, maintainer must preserve the existing A/B originals and same-folder legal documents in a trusted external recovery/source directory. Keep a second verified recovery copy. The publisher never modifies source files; removal of the former bundled originals was handled separately. Do not stage artwork, generated catalogs or thumbnails inside this repository, another Git checkout, build inputs or tracked output directories. Extra source files are ignored, not scanned/uploaded. Symlink files, FIFOs, mismatched hashes/bytes/dimensions and animated or non-approved-format inputs are rejected.

## Local preparation command for maintainer

Dependencies: Python 3.10+ on macOS/Linux (POSIX no-follow file opens), and Pillow 9.1+ with WebP codec support. Tested with Python 3.12 and Pillow 12.3.0. Set `PYTHON` to an existing trusted interpreter with these dependencies. The publisher never installs dependencies or invokes network/image-generation APIs; tests use synthetic images only. The standard-library test runner needs no pytest/jsonschema package.

From the repository root, select an **existing external source directory** containing all five originals and four legal documents listed in the source manifest, then choose a **new, nonexistent external output directory**. Example paths below are placeholders; they are local paths, not server destinations:

```bash
PYTHON="/absolute/path/to/python3"
"$PYTHON" -B tools/publish-background-gallery.py \
  --source-dir /absolute/external/gonavi-gallery-source \
  --source-manifest deploy/background-gallery/source-manifest.json \
  --output /absolute/external/gonavi-gallery-payload-2026-10-16.1 \
  --version 2026-10-16.1 \
  --confirm-noncommercial
```

Confirmation means free/noncommercial distribution, no paid benefits, advertisements or commercial promotion. If actual use changes, stop and obtain permission. The publisher rejects output below the repository even through symlink aliases, refuses existing output, requires source/output separation, checks all inputs before writing and exposes a complete new local directory. Use trusted parent directories: this is not designed for hostile concurrent filesystem mutation.

Payload layout (maps to the fixed remote v1 directory, **not** the origin root):

```text
catalog.json
assets/<sha256>.webp       # whale originals and all bounded thumbnails
assets/<sha256>.jpg        # three unchanged Pixiv originals
licenses/<sha256>.txt      # full original NOTICE, full license, expanded gallery notice
```

Only the five approved entries appear. Every entry has exactly the shared fields: id/version/names/fit/image/thumbnail/attribution/sourceUrl/rightsStatus/license. Six locale names are included. Original bytes remain unchanged. Thumbnails preserve alpha/aspect ratio (integer-pixel rounding), never upscale/crop, use lossless WebP after resizing, are at most 512 pixels per side and at most 256 KiB. Originals are limited to 16 MiB, images to 24 MP, catalog to 2 MiB. The full per-entry notice and applicable CC/custom author statement are embedded for offline reading; public text files are additional copies, not replacements. Entry versions derive from metadata/content, so encoder or legal-text changes invalidate the old version; catalog version is the explicit release value.

Preparation re-reads written assets for integrity and writes the catalog last before exposing the prepared directory. The stdout receipt reports catalog SHA-256 and **uploaded: false**. Retain it externally with the exact source manifest, payload, Python/Pillow versions and review record. Do not put generated files or image bytes in Git.

## Bero configuration (maintainer only; no live actions by this implementation)

Fixed origin: https://origin-download.syngnat.top:8443/gonavi/backgrounds/v1/ . Fixed filesystem destination: /srv/gonavi-downloads/gonavi/backgrounds/v1/ . No new server, certificate, port, general upload endpoint or release retention job is required.

The standalone server-context [gallery locations](<../deploy/background-gallery/bero-locations.conf>) are embedded verbatim in the existing [Bero origin config](<../deploy/download-mirror/bero-origin-download.conf>), between explicit BEGIN/END markers. There is no new include-file installation dependency. If merging manually into a drifted live config, add the block exactly once **inside the existing :8443 server**; do not also include a second copy. Preserve existing health, release, driver and brand routes, log paths, certificates and 80/443/2053 services.

Allowlist:

- Exact catalog path: JSON, no-cache/revalidate, nosniff.
- Anchored lowercase 64-hex .webp and .jpg paths: image/webp or image/jpeg respectively, immutable one year, nosniff. PNG remains outside this publication allowlist.
- Anchored lowercase 64-hex license text paths: text/plain UTF-8, immutable one year, nosniff.
- All other v1 paths: 404; directory listing disabled by existing server config; symlinks disabled in served gallery locations.
- GET and HEAD only (Nginx `limit_except GET` also permits HEAD). Public `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, HEAD`; **no Allow-Credentials header**. Simple GET/HEAD need no OPTIONS. Do not add browser credential mode, authorization/custom request headers or a broad CORS/write endpoint.
- Immutable caching attaches to successful static responses, not missing assets' 404s.

## Safe manual upload and atomic cutover checklist

There is intentionally no general-purpose publish shell or user-supplied destination option. maintainer uses established, authorized Bero access and pins the reviewed host/account, SSH host key and destination. Do not feed untrusted catalog paths into shell commands. Do not run the release/driver/brand publisher against the gallery or use destructive directory synchronization.

1. Record baseline HTTPS status/headers for /healthz, /health.txt and one currently known **existing** release, driver and brand asset. Record current catalog SHA-256 if present. Inspect live config drift, back up that exact config, and preserve the previous catalog with its referenced assets/licenses. Do not replace live configuration blindly with the repository copy.
2. Review the prepared catalog: exactly whale-maid-a, whale-maid-b, glm-maid-portrait, wenxin-wheelchair and minimax-maid; the first two use CC BY-NC-SA 4.0 and the last three use the separate ZipZipPipe attribution/noncommercial statement. Check approved status, pinned source URLs, complete legal texts, names/locales, unchanged original hashes. Independently hash every referenced image/thumbnail and content-addressed license; compare sizes and decode dimensions. Keep the source/recovery package off-server too.
3. Create a private, non-public staging directory **on the same Bero filesystem** as the fixed destination; verify resolved absolute paths and free space. Upload only allowlisted prepared files. No deferred candidates, source tree, credentials or arbitrary extra files. Re-hash after transfer, before moving into the served tree. Apply readable file permissions (0644) and directory traversal permissions (0755); no writable public directory.
4. Install/merge the isolated Nginx block. Run `nginx -t` against the actual complete live configuration; only success permits reload. If it fails, restore the backup; do not reload. Do not replace the running service, claim other ports, change certificates or edit unrelated routes.
5. Place each verified immutable asset/license in the exact fixed namespace by same-filesystem atomic rename from staging. If a hash-named destination exists, verify its bytes; equal means reuse, different means stop. Never overwrite different content under an immutable path. Leave the old catalog untouched. Public assets must be ordinary files, not symlinks.
6. Before cutover, confirm every new referenced public asset/license is readable with expected bytes/hash/MIME/cache/CORS. A failed transfer/verification stops publication without touching the old catalog. On first deployment, a catalog 404 at this stage is expected.
7. Write the verified catalog to a temporary file in the **same final directory**, fsync/close it, then atomically rename to catalog.json **last**. Preserve the old catalog outside the public allowlist first. Never stream into the live catalog, expose half-uploaded JSON or clear the assets directory. Keep an external release record linking old/new catalog hashes and config backup.
8. Verify HTTPS GET/HEAD without credentials: catalog has JSON/no-cache; JPEG/WebP originals, WebP thumbnails and licenses have correct MIME, nosniff, immutable cache and public CORS. Recompute SHA-256/size from downloaded public bytes (not just headers), compare decoded dimensions, and confirm only approved IDs. Unknown IDs/extensions/paths and directory listing return 404; POST/PUT/DELETE/OPTIONS are denied. Browser adapter uses credentials=omit. Repeat baseline health/release/driver/brand checks.
9. Report publication complete only with recorded public checks and app/desktop/Web acceptance results. Successful local preparation or Nginx syntax tests alone are not deployment evidence.

No immediate garbage collection: old content-addressed assets/licenses must remain for older catalogs and rollback. The gallery is outside release-generation retention. Establish a separately reviewed retention policy before deleting unreachable gallery assets.

## Rollback and rights withdrawal

- Before catalog cutover: leave the old catalog untouched; fix/discard only verified private staging. Never recursively delete an unchecked/computed server path.
- After catalog cutover: atomically restore the prior catalog in the same final directory, confirm references still exist and repeat public verification. Do not rename the assets directory, overwrite immutable bytes or invoke release cleanup.
- Configuration regression: restore the exact config backup, run `nginx -t`, reload only if it passes, then check old health/release/driver/brand baselines. This is separate from catalog rollback.
- Rights withdrawal is **not** a normal rollback: remove the affected entry via a reviewed catalog update, stop new distribution, determine whether retained public binaries must be withdrawn, and handle CDN invalidation deliberately. No-cache catalogs cannot revoke downloaded files or browser/CDN immutable caches. Do not promise remote deletion of local user copies. Record the decision and coordinate with the rights holder.

## Offline tests / acceptance limitations

```bash
"$PYTHON" -B -m unittest discover -s tools -p "test_publish_background_gallery*.py" -v
"$PYTHON" -B tools/download-mirror-config.test.py
```

Tests use synthetic JPEG/WebP in temporary directories and preserved license text only. They cover exact manifest shape, hashes, unchanged original bytes, full provenance, explicit rights confirmation, pinned-manifest refusal, no-repository-output/symlink protection, existing-output protection, pending-entry rejection without asset reads, ignored extra pending files, invalid image format/animation/dimensions/limits, bounded thumbnails and Nginx snippet integration. No paid API, real-image download, repository artwork write or server call is made. `-B` avoids repository bytecode.

An isolated temporary Nginx config can test local snippet syntax; it does not validate live certificates, ownership, deployed contents, HTTP/CORS or CDN behavior. maintainer must still complete live checks. No test result authorizes deferred artwork.
