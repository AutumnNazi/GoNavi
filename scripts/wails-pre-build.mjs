#!/usr/bin/env node
// wails preBuildHook：构建前刷新派生资源，并在 Linux 上提前校验 WebKitGTK 开发包。
//
// cwd 由 wails 固定为 build/bin（见 wails v2 pkg/commands/build/build.go 中的
// shell.RunCommand(options.BinDirectory, ...)），因此这里按脚本自身位置反推仓库
// 根目录，不依赖 cwd，也不依赖调用方传入路径。
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// wails 会把 ${platform} 替换成 "GOOS/GOARCH"（build.go：options.Platform + "/" + options.Arch）。
const targetPlatform = process.argv[2] ?? '';

// frontend/dist.zip 占位：沿用原 preBuildHook 行为，本地未构建前端时保证
// wails 能找到 embed 目标。
const stubDistZip = join(repoRoot, 'tools', 'stub-dist.zip');
const frontendDistZip = join(repoRoot, 'frontend', 'dist.zip');
if (!existsSync(frontendDistZip)) {
  copyFileSync(stubDistZip, frontendDistZip);
}

// shared/i18n/catalog.zip 是提交进 git 的派生物，二进制无法参与三方合并。
// 历史上出现过合并后 zip 与 JSON 源文件漂移的事故：Go 侧 T() 取不到键会直接
// 返回裸 key，用户界面显示成 table_designer.message.xxx 这种原文。
// 所有 wails 构建入口在此强制重新生成，使漂移无法进入产物；漂移本身仍由
// shared/i18n 的 TestCatalogZipInSyncWithJSON 在 CI 拦下（该测试刻意不预生成，
// 以保留探测能力）。
execFileSync('go', ['generate', './shared/i18n'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

assertLinuxWebKitDevPackages();

// assertLinuxWebKitDevPackages 在编译前校验 pkg-config 能否找到目标 WebKitGTK。
//
// 背景：wails.json 的 build:tags 决定链接 webkit2gtk-4.0 还是 4.1，而命令行
// -tags 无法覆盖它（wails v2.15 做的是 projectTags + userTags 合并）。一旦标签
// 与本机装的版本不匹配，用户拿到的是一屏 cgo/pkg-config 报错，看不出该装哪个包。
//
// 只在「目标为 linux 且宿主也是 linux」时校验：跨平台交叉编译不在本机链接
// WebKitGTK，探测本机环境只会误报。
function assertLinuxWebKitDevPackages() {
  const target = targetPlatform.split('/')[0];
  if (target !== 'linux' || process.platform !== 'linux') {
    return;
  }

  const projectTags = readProjectBuildTags();
  const usesWebKit41 = projectTags.includes('webkit2_41');
  const pkgConfigName = usesWebKit41 ? 'webkit2gtk-4.1' : 'webkit2gtk-4.0';
  const probe = spawnSync('pkg-config', ['--exists', pkgConfigName], { stdio: 'ignore' });

  if (probe.status === 0) {
    return;
  }
  if (probe.error?.code === 'ENOENT') {
    fail(
      '未找到 pkg-config，无法校验 WebKitGTK 开发包。请先安装 pkg-config 与 WebKitGTK 开发包。',
    );
  }

  const installHint = usesWebKit41
    ? `  Debian 13 / Ubuntu 24.04+：sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev
  Fedora / RHEL 9+：sudo dnf install -y gtk3-devel webkit2gtk4.1-devel libsoup3-devel`
    : `  Ubuntu 22.04 / Debian 12：sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev
  Fedora / RHEL 9+：sudo dnf install -y gtk3-devel webkit2gtk4.0-devel`;

  // 两条出路：装当前标签对应的包，或把标签切到本机已装的版本。
  // 后者不能靠命令行 -tags 覆盖（wails 做的是 projectTags + userTags 合并），
  // 必须改写 wails.json —— 这正是 ci-apply-wails-webkit-tags.py 的用途。
  const otherApi = usesWebKit41 ? '4.0' : '4.1';
  const otherPkgConfigName = usesWebKit41 ? 'webkit2gtk-4.0' : 'webkit2gtk-4.1';
  const switchHint =
    `若本机装的是 WebKitGTK ${otherApi}（pkg-config ${otherPkgConfigName}），` +
    `请改用该版本：\n  python3 scripts/ci-apply-wails-webkit-tags.py ${otherApi}`;

  fail(
    `未找到 WebKitGTK 开发包（pkg-config ${pkgConfigName}）。\n` +
      `当前 wails.json 的 build:tags = ${JSON.stringify(projectTags)}，` +
      `链接目标是 ${pkgConfigName}。\n\n` +
      `方案一 · 安装缺失的开发包：\n${installHint}\n\n` +
      `方案二 · 改用本机已有的 WebKitGTK：\n${switchHint}\n\n` +
      `只想跑无界面的 web-server / CLI（完全不依赖 WebKitGTK）：\n` +
      `  CGO_ENABLED=0 go build -o gonavi .\n` +
      `  ./gonavi web-server --addr 127.0.0.1:34116`,
  );
}

function readProjectBuildTags() {
  try {
    const config = JSON.parse(readFileSync(join(repoRoot, 'wails.json'), 'utf8'));
    return config['build:tags'] ?? '';
  } catch {
    // 配置文件不可读时不阻断构建：真正的解析错误会由 wails 自己报出来。
    return '';
  }
}

function fail(message) {
  console.error(`\n[GoNavi] ${message}\n`);
  process.exit(1);
}
