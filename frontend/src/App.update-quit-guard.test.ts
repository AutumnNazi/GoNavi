import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appSource = readFileSync(
  fileURLToPath(new globalThis.URL('./App.tsx', import.meta.url)),
  'utf8',
);

describe('restart-to-update unsaved SQL guard', () => {
  it('runs the confirmed update action through every application quit path', () => {
    expect(appSource).toContain('type ApplicationQuitConfirmedAction = () => Promise<boolean>;');
    expect(appSource).toContain('const handleApplicationQuitRequest = useCallback(async (confirmedAction?: ApplicationQuitConfirmedAction) => {');
    expect(appSource).toContain('const runConfirmedAction = async (): Promise<boolean> => {');
    const runnerStart = appSource.indexOf('const runConfirmedAction = async (): Promise<boolean> => {');
    const runnerEnd = appSource.indexOf('\n      let targets;', runnerStart);
    const runnerSource = appSource.slice(runnerStart, runnerEnd);
    expect(runnerSource).toContain('accepted = await confirmedAction();');
    expect(runnerSource).toContain('await forceQuitApplication();\n                  accepted = true;');
    expect(runnerSource).toContain('} catch (error) {\n              resetApplicationQuitRequest();');
    expect(runnerSource).toContain('if (!accepted) {\n              resetApplicationQuitRequest();');
    expect(runnerSource).toContain('return accepted;');
    expect(appSource).toContain('if (targets.length === 0) {\n          await runConfirmedAction();');
    expect(appSource).toContain('void runConfirmedAction();');
    const saveIndex = appSource.indexOf('await saveApplicationQuitUnsavedSQLTargets(targets, saveQuery);');
    const actionAfterSaveIndex = appSource.indexOf('await runConfirmedAction();', saveIndex);
    expect(saveIndex).toBeGreaterThan(-1);
    expect(actionAfterSaveIndex).toBeGreaterThan(saveIndex);
  });

  it('confirms closing every Windows instance before entering the unsaved SQL guard', () => {
    expect(appSource).toContain('const handleInstallUpdateRequest = useCallback(async () => {');
    expect(appSource).toContain("if (installMode === 'portable' || installMode === 'msi') {");
    expect(appSource).toContain("title: t('app.about.update_install_confirm.close_instances_title')");
    expect(appSource).toContain("content: t('app.about.update_install_confirm.close_instances_content')");
    expect(appSource).toContain("okText: t('app.about.update_install_confirm.close_instances_ok')");
    expect(appSource).toContain("cancelText: t('common.cancel')");
    expect(appSource).toContain('await handleApplicationQuitRequest(() => handleInstallFromProgress(true));');
    expect(appSource).toContain('await handleApplicationQuitRequest(() => handleInstallFromProgress(false));');
    expect(appSource.match(/void handleInstallUpdateRequest\(\);/g)).toHaveLength(2);
    expect(appSource).not.toContain('onClick={handleInstallFromProgress}');
    expect(appSource).toContain("updateInstallAction === 'install-and-restart'");
    expect(appSource).toContain("updateInstallAction === 'launch-installer'");
    expect(appSource.match(/\{updateInstallActionLabel\}/g)).toHaveLength(2);
  });
});
