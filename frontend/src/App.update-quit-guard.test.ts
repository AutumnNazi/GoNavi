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
    expect(appSource).toContain('const handleApplicationQuitRequest = useCallback(async (');
    expect(appSource).toContain('confirmedAction?: ApplicationQuitConfirmedAction,');
    expect(appSource).toContain('cancelledAction?: () => void,');
    expect(appSource).toContain('const runConfirmedAction = async (): Promise<boolean> => {');
    const runnerStart = appSource.indexOf('const runConfirmedAction = async (): Promise<boolean> => {');
    const runnerEnd = appSource.indexOf('\n      let targets;', runnerStart);
    const runnerSource = appSource.slice(runnerStart, runnerEnd);
    expect(runnerSource).toContain('accepted = await confirmedAction();');
    expect(runnerSource).toContain('await forceQuitApplication();\n                  accepted = true;');
    expect(runnerSource).toContain('} catch (error) {\n              cancelRequest();');
    expect(runnerSource).toContain('if (!accepted) {\n              cancelRequest();');
    expect(appSource).toContain('resetApplicationQuitRequest();\n          cancelledAction?.();');
    expect(runnerSource).toContain('return accepted;');
    expect(appSource).toContain('if (targets.length === 0) {\n          await runConfirmedAction();');
    expect(appSource).toContain('void runConfirmedAction();');
    const saveIndex = appSource.indexOf('await saveApplicationQuitUnsavedSQLTargets(targets, saveQuery);');
    const actionAfterSaveIndex = appSource.indexOf('await runConfirmedAction();', saveIndex);
    expect(saveIndex).toBeGreaterThan(-1);
    expect(actionAfterSaveIndex).toBeGreaterThan(saveIndex);
  });

  it('waits for saved queries and flushes recovery state before quitting', () => {
    const quitHandlerStart = appSource.indexOf('const handleApplicationQuitRequest = useCallback');
    const quitHandlerEnd = appSource.indexOf('\n\n  const handleInstallUpdateRequest', quitHandlerStart);
    const quitHandlerSource = appSource.slice(quitHandlerStart, quitHandlerEnd);
    const ensureLoadedIndex = quitHandlerSource.indexOf('await ensureSavedQueriesLoaded();');
    const readLatestStateIndex = quitHandlerSource.indexOf('const latestState = useStore.getState();');
    const flushDraftsIndex = quitHandlerSource.indexOf('flushQueryTabDraftSnapshots();');
    const flushStoreIndex = quitHandlerSource.indexOf('await flushAppStatePersistence();');
    const confirmedActionIndex = quitHandlerSource.indexOf('accepted = await confirmedAction();');
    const forceQuitIndex = quitHandlerSource.indexOf('await forceQuitApplication();');

    expect(ensureLoadedIndex).toBeGreaterThan(-1);
    expect(readLatestStateIndex).toBeGreaterThan(ensureLoadedIndex);
    expect(flushDraftsIndex).toBeGreaterThan(-1);
    expect(flushStoreIndex).toBeGreaterThan(flushDraftsIndex);
    expect(confirmedActionIndex).toBeGreaterThan(flushStoreIndex);
    expect(forceQuitIndex).toBeGreaterThan(flushStoreIndex);
  });

  it('does not block application quit on saved-query group refresh failures', () => {
    const loaderStart = appSource.indexOf('const ensureSavedQueriesLoaded = useCallback');
    const loaderEnd = appSource.indexOf('\n\n  useEffect(() => {', loaderStart);
    const loaderSource = appSource.slice(loaderStart, loaderEnd);

    expect(loaderSource).toContain('savedQueriesLoadedRef.current = true;');
    expect(loaderSource).toContain('void reloadSavedQueryGroups().catch((error) => {');
    expect(loaderSource).not.toContain('await reloadSavedQueryGroups();');
  });

  it('lets the backend confirm only actually running Windows instances after the unsaved SQL guard', () => {
    expect(appSource).toContain('const handleInstallUpdateRequest = useCallback(async () => {');
    const installRequestStart = appSource.indexOf('const handleInstallUpdateRequest = useCallback(async () => {');
    const installRequestEnd = appSource.indexOf('\n\n  useEffect(() => {', installRequestStart);
    const installRequestSource = appSource.slice(installRequestStart, installRequestEnd);
    expect(installRequestSource.indexOf('hideUpdateDownloadProgress();')).toBeGreaterThan(-1);
    expect(installRequestSource.indexOf('await handleApplicationQuitRequest(')).toBeGreaterThan(-1);
    expect(installRequestSource.indexOf('hideUpdateDownloadProgress();')).toBeLessThan(
      installRequestSource.indexOf('await handleApplicationQuitRequest('),
    );
    expect(installRequestSource).toContain('() => handleInstallFromProgress(false),');
    expect(installRequestSource).toContain('showUpdateDownloadProgress,');
    expect(appSource).not.toContain("title: t('app.about.update_install_confirm.close_instances_title')");
    expect(appSource).not.toContain('handleInstallFromProgress(true)');
    expect(appSource.match(/void handleInstallUpdateRequest\(\);/g)).toHaveLength(2);
    expect(appSource).not.toContain('onClick={handleInstallFromProgress}');
    expect(appSource).toContain("updateInstallAction === 'install-and-restart'");
    expect(appSource).toContain("updateInstallAction === 'launch-installer'");
    expect(appSource.match(/\{updateInstallActionLabel\}/g)).toHaveLength(2);
  });

  it('keeps the unsaved SQL quit confirmation above active settings and update dialogs', () => {
    const unsavedConfirmStart = appSource.indexOf('const confirmRef = Modal.confirm({');
    const installRequestStart = appSource.indexOf('const handleInstallUpdateRequest = useCallback', unsavedConfirmStart);
    const installRequestEnd = appSource.indexOf('\n\n  useEffect(() => {', installRequestStart);
    const unsavedConfirmSource = appSource.slice(unsavedConfirmStart, installRequestStart);
    const installRequestSource = appSource.slice(installRequestStart, installRequestEnd);

    expect(unsavedConfirmStart).toBeGreaterThan(-1);
    expect(installRequestStart).toBeGreaterThan(unsavedConfirmStart);
    expect(installRequestEnd).toBeGreaterThan(installRequestStart);
    expect(appSource).toContain('APP_APPLICATION_QUIT_MODAL_Z_INDEX,');
    expect(appSource).toContain('const applicationQuitModalZIndex = Math.max(');
    expect(appSource).toContain('settingsChildModalZIndex + 100,');
    expect(unsavedConfirmSource).toContain('zIndex: applicationQuitModalZIndex');
    expect(installRequestSource).not.toContain('Modal.confirm({');
  });
});
