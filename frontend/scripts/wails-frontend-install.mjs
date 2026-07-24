#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(scriptDir, '..');
const packageJsonPath = path.join(frontendDir, 'package.json');
const packageLockPath = path.join(frontendDir, 'package-lock.json');
const patchesDirPath = path.join(frontendDir, 'patches');
const nodeModulesPath = path.join(frontendDir, 'node_modules');
const npmHiddenLockPath = path.join(nodeModulesPath, '.package-lock.json');
const installStatePath = path.join(nodeModulesPath, '.gonavi-install-state.json');
const npmCommand = 'npm';
const commonArgs = [
  '--prefer-offline',
  '--no-audit',
  '--fund=false',
  '--fetch-retries=5',
  '--fetch-retry-mintimeout=20000',
  '--fetch-retry-maxtimeout=120000',
];
const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

const fail = (message) => {
  console.error(`[gonavi-frontend-install] ${message}`);
  process.exit(1);
};

const exitWithStatus = (status) => {
  process.exit(typeof status === 'number' && status > 0 && status <= 255 ? status : 1);
};

const hashFile = (filePath) => {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
};

const patchFiles = () => {
  if (!existsSync(patchesDirPath)) return [];
  return readdirSync(patchesDirPath)
    .filter((name) => name.endsWith('.patch'))
    .sort()
    .map((name) => path.join(patchesDirPath, name));
};

const hashPatches = () => {
  const hash = createHash('sha256');
  for (const filePath of patchFiles()) {
    hash.update(path.basename(filePath));
    hash.update(readFileSync(filePath));
  }
  return hash.digest('hex');
};

const currentState = () => ({
  packageJson: hashFile(packageJsonPath),
  packageLock: existsSync(packageLockPath) ? hashFile(packageLockPath) : '',
  patches: hashPatches(),
});

const readInstalledState = () => {
  if (!existsSync(installStatePath)) return null;
  try {
    return JSON.parse(readFileSync(installStatePath, 'utf8'));
  } catch {
    return null;
  }
};

const writeInstalledState = (state) => {
  writeFileSync(installStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
};

const packageInputsAreOlderThanNpmLock = () => {
  if (!existsSync(npmHiddenLockPath)) return false;
  const markerTime = statSync(npmHiddenLockPath).mtimeMs;
  return [packageJsonPath, packageLockPath, ...patchFiles()]
    .filter(existsSync)
    .every((filePath) => statSync(filePath).mtimeMs <= markerTime);
};

const runNpm = (subcommand) => {
  const args = [subcommand, ...commonArgs];
  if (isCI) {
    console.log(
      `[gonavi-frontend-install] cwd=${process.cwd()} frontend=${frontendDir} node=${process.version} platform=${process.platform}/${process.arch} command=${npmCommand} ${args.join(' ')}`,
    );
  }

  const result = spawnSync(npmCommand, args, {
    cwd: frontendDir,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    fail(`failed to start npm: ${result.error.message}`);
  }
  if (result.signal) {
    fail(`npm was terminated by signal ${result.signal}`);
  }
  if (result.status !== 0) {
    console.error(`[gonavi-frontend-install] npm exited with status ${result.status ?? 'unknown'}`);
    exitWithStatus(result.status);
  }
};

if (!existsSync(packageJsonPath)) {
  fail(`package.json not found at ${packageJsonPath}; cwd=${process.cwd()}`);
}

const state = currentState();
const installedState = readInstalledState();
const forceInstall = process.env.GONAVI_FORCE_FRONTEND_INSTALL === '1';

if (!forceInstall && existsSync(nodeModulesPath)) {
  if (
    installedState?.packageJson === state.packageJson &&
    installedState?.packageLock === state.packageLock &&
    installedState?.patches === state.patches
  ) {
    console.log('Frontend dependencies are up to date; skipping npm install.');
    process.exit(0);
  }

  if (!installedState && isCI && existsSync(npmHiddenLockPath)) {
    writeInstalledState(state);
    console.log('Frontend dependencies are up to date from CI cache; recorded install state.');
    process.exit(0);
  }

  if (!installedState && packageInputsAreOlderThanNpmLock()) {
    writeInstalledState(state);
    console.log('Frontend dependencies are up to date; recorded install state.');
    process.exit(0);
  }
}

runNpm(isCI ? 'ci' : 'install');
writeInstalledState(state);
