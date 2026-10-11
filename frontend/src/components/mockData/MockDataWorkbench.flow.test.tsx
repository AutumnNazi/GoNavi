// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { Modal } from 'antd';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../i18n';
import type { TabData } from '../../types';
import type { MockDataInspection } from './mockDataModel';

const api = vi.hoisted(() => ({
  inspectMockDataTable: vi.fn(),
  previewMockData: vi.fn(),
  generateMockData: vi.fn(),
  cancelMockDataJob: vi.fn(),
}));

vi.mock('./mockDataApi', () => api);
vi.mock('../../../wailsjs/runtime/runtime', () => ({ EventsOn: vi.fn(() => () => undefined) }));
vi.mock('../../utils/productionRiskConfirm', () => ({ confirmProductionRisk: vi.fn(async () => true) }));
vi.mock('../../store', () => {
  const state = {
    connections: [{ id: 'conn-1', name: 'local', config: { type: 'mysql', host: 'localhost', port: 3306, user: 'root' } }],
  };
  return { useStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

const inspection: MockDataInspection = {
  dbType: 'mysql',
  family: 'mysql',
  maxRowCount: 1_000_000,
  columns: [
    {
      profile: { name: 'id', type: 'int', category: 'integer', nullable: false, hasDefault: false, autoIncrement: true, computed: false, primaryKey: true, unique: true },
      allowedKinds: ['sequence', 'int_range', 'reference', 'fixed', 'list', 'null'],
      required: false,
      referenceCount: 0,
    },
    {
      profile: { name: 'email', type: 'varchar(64)', category: 'string', nullable: true, hasDefault: false, autoIncrement: false, computed: false, primaryKey: false, unique: false, maxLength: 64 },
      allowedKinds: ['random_string', 'email', 'fixed', 'list', 'null'],
      required: false,
      referenceCount: 0,
    },
  ],
  plans: [
    { name: 'id', skip: true, generator: { kind: 'sequence', start: '1', step: '1' } },
    { name: 'email', skip: false, generator: { kind: 'email' } },
  ],
};

const tab: TabData = { id: 'mock-data:conn-1:app:users', title: 'users', type: 'mock-data', connectionId: 'conn-1', dbName: 'app', tableName: 'users' };

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const clickButton = async (label: string) => {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.replace(/\s/g, '') === label.replace(/\s/g, ''));
  expect(button, label).toBeTruthy();
  await act(async () => {
    button!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await flush();
};

describe('MockDataWorkbench flow', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = window.matchMedia || ((() => ({ matches: false, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    api.inspectMockDataTable.mockResolvedValue({ success: true, message: '', data: inspection });
    api.previewMockData.mockResolvedValue({ success: true, message: '', data: { columns: ['email'], rows: [{ email: 'james.smith1@example.com' }, { email: null }] } });
    api.generateMockData.mockResolvedValue({ success: true, message: 'done-message', data: { total: 100, success: 100, failed: 0, durationMs: 1200 } });
    vi.spyOn(Modal, 'confirm').mockImplementation((config) => {
      void config.onOk?.();
      return { destroy: () => undefined, update: () => undefined } as unknown as ReturnType<typeof Modal.confirm>;
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it('loads suggestions, previews the plan and writes after confirmation', async () => {
    const { default: MockDataWorkbench } = await import('./MockDataWorkbench');
    await act(async () => {
      root.render(<MockDataWorkbench tab={tab} />);
    });
    await flush();

    expect(api.inspectMockDataTable).toHaveBeenCalledWith(expect.objectContaining({ dbName: 'app', tableName: 'users' }), expect.any(String));
    expect(document.body.textContent).toContain('email');

    await clickButton(t('mock_data.workbench.preview'));
    const previewPlan = api.previewMockData.mock.calls[0][1];
    expect(previewPlan).toMatchObject({ rowCount: 100, columns: inspection.plans });
    expect(document.body.textContent).toContain('james.smith1@example.com');
    expect(document.body.textContent).toContain('NULL');

    await clickButton(t('mock_data.workbench.generate'));
    expect(Modal.confirm).toHaveBeenCalledTimes(1);
    expect(api.generateMockData).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: 'users' }),
      expect.objectContaining({ rowCount: 100 }),
      expect.objectContaining({ continueOnError: false, jobId: expect.stringMatching(/^mockdata-/) }),
    );
    expect(document.body.textContent).toContain('done-message');
  });

  it('does not write when the confirmation is dismissed', async () => {
    vi.mocked(Modal.confirm).mockImplementation((config) => {
      config.onCancel?.();
      return { destroy: () => undefined, update: () => undefined } as unknown as ReturnType<typeof Modal.confirm>;
    });
    const { default: MockDataWorkbench } = await import('./MockDataWorkbench');
    await act(async () => {
      root.render(<MockDataWorkbench tab={tab} />);
    });
    await flush();
    await clickButton(t('mock_data.workbench.generate'));
    expect(api.generateMockData).not.toHaveBeenCalled();
  });
});
