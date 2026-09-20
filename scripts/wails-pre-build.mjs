#!/usr/bin/env node
// wails preBuildHook：构建前刷新派生资源。
//
// cwd 由 wails 固定为 build/bin（见 wails v2 pkg/commands/build/build.go 中的
// shell.RunCommand(options.BinDirectory, ...)），因此这里按脚本自身位置反推仓库
// 根目录，不依赖 cwd，也不依赖调用方传入路径。
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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
