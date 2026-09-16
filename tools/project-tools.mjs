#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const projectRoot = path.resolve(scriptDir, '..');
const projectBinDir = path.join(projectRoot, '.tools', 'bin');

const tools = {
  wails: {
    binaryName: process.platform === 'win32' ? 'wails.exe' : 'wails',
    installModule: 'github.com/wailsapp/wails/v2/cmd/wails',
    versionModule: 'github.com/wailsapp/wails/v2',
  },
};

const usage = `Usage:
  node tools/project-tools.mjs install wails
  node tools/project-tools.mjs resolve wails
  node tools/project-tools.mjs run wails [args...]`;

const getTool = (name) => {
  const tool = tools[name];
  if (!tool) {
    throw new Error(`Unsupported project tool: ${name}`);
  }
  return tool;
};

const getToolPath = (name) => path.join(projectBinDir, getTool(name).binaryName);

export const resolveProjectTool = (name) => {
  const toolPath = getToolPath(name);
  const accessMode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;

  try {
    accessSync(toolPath, accessMode);
  } catch {
    const relativePath = path.relative(projectRoot, toolPath);
    throw new Error(
      `Project-local ${name} is missing or not executable: ${relativePath}\n` +
        `Install it with:\n  node tools/project-tools.mjs install ${name}`,
    );
  }

  return toolPath;
};

const readToolVersion = (tool) => {
  const goMod = readFileSync(path.join(projectRoot, 'go.mod'), 'utf8');
  const escapedModule = tool.versionModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = goMod.match(new RegExp(`^\\s*(?:require\\s+)?${escapedModule}\\s+(v\\S+)`, 'm'));
  if (!match) {
    throw new Error(`Unable to resolve ${tool.versionModule} version from go.mod`);
  }
  return match[1];
};

const installProjectTool = (name) => {
  const tool = getTool(name);
  const version = readToolVersion(tool);
  mkdirSync(projectBinDir, { recursive: true });

  const result = spawnSync('go', ['install', `${tool.installModule}@${version}`], {
    cwd: projectRoot,
    env: { ...process.env, GOBIN: projectBinDir },
    stdio: 'inherit',
  });

  if (result.error) {
    throw new Error(`Failed to start Go: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const error = new Error(`Failed to install ${name} ${version}`);
    error.exitCode = result.status ?? 1;
    throw error;
  }

  const installedPath = resolveProjectTool(name);
  console.log(`Installed ${name} ${version}: ${installedPath}`);
};

const runProjectTool = (name, args) => {
  const child = spawn(resolveProjectTool(name), args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });

  child.on('error', (error) => {
    console.error(`Failed to start ${name}: ${error.message}`);
    process.exit(1);
  });
};

const main = () => {
  const [command, name, ...args] = process.argv.slice(2);
  if (!command || !name || command === '--help' || command === '-h') {
    console.log(usage);
    process.exit(command === '--help' || command === '-h' ? 0 : 1);
  }

  try {
    if (command === 'install') {
      installProjectTool(name);
      return;
    }
    if (command === 'resolve') {
      console.log(resolveProjectTool(name));
      return;
    }
    if (command === 'run') {
      runProjectTool(name, args);
      return;
    }
    throw new Error(`Unsupported project-tools command: ${command}`);
  } catch (error) {
    console.error(error.message);
    process.exit(error.exitCode ?? 1);
  }
};

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(scriptPath)) {
  main();
}
