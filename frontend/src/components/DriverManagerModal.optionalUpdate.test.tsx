import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { t } from '../i18n';

const storeState = {
  theme: 'light',
  languagePreference: 'zh-CN',
  setLanguagePreference: vi.fn(async () => {}),
  appearance: { opacity: 1 },
};

const backendApp = {
  CancelDriverPackageDownload: vi.fn(),
  CheckDriverNetworkStatus: vi.fn(),
  GetDriverVersionList: vi.fn(),
  GetDriverVersionPackageSize: vi.fn(),
  GetDriverStatusList: vi.fn(),
  InstallLocalDriverPackage: vi.fn(),
  ListDriverDownloadTasks: vi.fn(),
  OpenDriverDownloadDirectory: vi.fn(),
  RemoveDriverPackage: vi.fn(),
  SelectDriverPackageDirectory: vi.fn(),
  SelectDriverPackageFile: vi.fn(),
  StartDriverPackageDownload: vi.fn(),
};

const textContent = (node: any): string => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((item) => textContent(item)).join('');
  return textContent(node.children || []);
};

const OPTIONAL_UPDATE_DISMISS_KEY = 'gonavi.driver.optionalUpdate.dismissedRevision';
const localStorageSpies = { getItem: vi.fn(), setItem: vi.fn() };
const localStorageMap = new Map<string, string>();
const buildWindowStub = () => ({
  localStorage: {
    getItem: (key: string) => {
      localStorageSpies.getItem(key);
      return localStorageMap.has(key) ? localStorageMap.get(key)! : null;
    },
    setItem: (key: string, value: string) => {
      localStorageMap.set(key, value);
      localStorageSpies.setItem(key, value);
    },
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

const findButton = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAll((node) => node.type === 'button' && textContent(node).includes(text))[0];

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof storeState) => unknown) =>
    selector(storeState),
}));

vi.mock('../../wailsjs/go/app/App', () => backendApp);

vi.mock('../../wailsjs/runtime/runtime', () => ({
  EventsOn: vi.fn(() => vi.fn()),
}));

vi.mock('antd', () => {
  const Button = ({ children, disabled, loading, onClick, ...rest }: any) => (
    <button type="button" disabled={disabled || loading} onClick={onClick} {...rest}>
      {children}
    </button>
  );
  const Dropdown: any = ({ children }: any) => <>{children}</>;
  Dropdown.Button = ({ children }: any) => <>{children}</>;
  const Modal: any = ({ title, children, footer, open }: any) =>
    open ? (
      <section>
        <div>{title}</div>
        <div>{children}</div>
        <div>{footer}</div>
      </section>
    ) : null;
  Modal.confirm = vi.fn();
  const Collapse = ({ items }: any) => (
    <div>{items?.map((item: any) => <div key={item.key}>{item.children}</div>)}</div>
  );
  const Input: any = ({ value, onChange, placeholder, ...rest }: any) => (
    <input value={value} onChange={onChange} placeholder={placeholder} {...rest} />
  );
  Input.Search = ({ value, onChange, placeholder, ...rest }: any) => (
    <input value={value} onChange={onChange} placeholder={placeholder} {...rest} />
  );
  const Space = ({ children }: any) => <div>{children}</div>;
  const Tag = ({ children }: any) => <span>{children}</span>;
  const Switch = ({ checked, onChange, ...rest }: any) => (
    <button type="button" data-checked={checked} onClick={() => onChange?.(!checked)} {...rest}>
      switch
    </button>
  );
  const Progress = ({ percent }: any) => <div>{percent}</div>;
  const Select = ({ placeholder }: any) => <div>{placeholder}</div>;
  const Empty: any = ({ description }: any) => <div>{description}</div>;
  Empty.PRESENTED_IMAGE_SIMPLE = 'empty';
  const Alert = ({ message, description }: any) => (
    <div>
      <div>{message}</div>
      <div>{description}</div>
    </div>
  );
  const Typography = {
    Text: ({ children }: any) => <span>{children}</span>,
    Paragraph: ({ children }: any) => <div>{children}</div>,
  };
  const Tooltip = ({ children }: any) => <>{children}</>;
  const Popover = ({ children }: any) => <>{children}</>;
  const Icon = () => <i />;
  return {
    Alert,
    Button,
    Collapse,
    Dropdown,
    Input,
    Modal,
    Progress,
    Select,
    Space,
    Switch,
    Tag,
    Tooltip,
    Typography,
    message: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
    theme: { useToken: () => ({ token: { colorPrimary: '#1677ff' } }) },
    icons: {
      DeleteOutlined: Icon,
      DownOutlined: Icon,
      DownloadOutlined: Icon,
      FileSearchOutlined: Icon,
      FolderOpenOutlined: Icon,
      InfoCircleFilled: Icon,
      ReloadOutlined: Icon,
      StopOutlined: Icon,
      WarningOutlined: Icon,
    },
  };
});

vi.mock('../../utils/webRpc', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    isWebRPCAbortError: () => false,
  };
});

const buildStatusResult = (drivers: Record<string, unknown>[]) => ({
  success: true,
  data: {
    downloadDir: 'D:/drivers',
    drivers,
  },
});

const buildClickHouseDriver = (overrides: Record<string, unknown> = {}) => ({
  type: 'clickhouse',
  name: 'ClickHouse',
  builtIn: false,
  pinnedVersion: '2.43.1',
  installedVersion: '2.43.1',
  runtimeAvailable: true,
  packageInstalled: true,
  connectable: true,
  agentRevision: 'src-installed',
  expectedRevision: 'src-expected',
  optionalUpdate: true,
  message: ' Cause: the driver agent component was updated.',
  ...overrides,
});

const mountModal = async () => {
  const { default: DriverManagerModal } = await import('./DriverManagerModal');
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<DriverManagerModal open onClose={vi.fn()} />);
  });
  return renderer;
};

const waitUntilContains = async (renderer: ReactTestRenderer, text: string, timeoutMs = 4000) => {
  const startedAt = Date.now();
  for (;;) {
    if (textContent(renderer.toJSON()).includes(text)) {
      return;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`content not found within ${timeoutMs}ms: ${text}
=== ACTUAL ===
${textContent(renderer.toJSON()).slice(0, 1500)}`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  }
};

describe('DriverManagerModal optional update tier (issue #1326)', () => {
  beforeEach(() => {
    vi.resetModules();
    storeState.languagePreference = 'zh-CN';
    backendApp.GetDriverVersionList.mockResolvedValue({ success: true, data: { versions: [] } });
    backendApp.GetDriverVersionPackageSize.mockResolvedValue({ success: true, data: { packageSizeText: '' } });
    backendApp.CancelDriverPackageDownload.mockResolvedValue({ success: true, data: { task: null } });
    backendApp.InstallLocalDriverPackage.mockResolvedValue({ success: true });
    backendApp.ListDriverDownloadTasks.mockResolvedValue({ success: true, data: [] });
    backendApp.OpenDriverDownloadDirectory.mockResolvedValue({ success: true });
    backendApp.RemoveDriverPackage.mockResolvedValue({ success: true });
    backendApp.SelectDriverPackageDirectory.mockResolvedValue({ success: false, message: '已取消' });
    backendApp.SelectDriverPackageFile.mockResolvedValue({ success: false, message: '已取消' });
    backendApp.StartDriverPackageDownload.mockResolvedValue({ success: true, data: { task: null } });
    backendApp.CheckDriverNetworkStatus.mockResolvedValue({
      success: true,
      data: { reachable: true, summary: 'ok', downloadChainReachable: true, downloadRequiredHosts: [], recommendedProxy: false, proxyConfigured: false, proxyEnv: {}, checks: [], logPath: '' },
    });
    Object.values(backendApp).forEach((fn) => fn.mockClear());
    localStorageMap.clear();
    localStorageSpies.getItem.mockReset().mockReturnValue(null);
    localStorageSpies.setItem.mockReset();
    vi.stubGlobal('window', buildWindowStub());
  });

  it('renders optional update as weak hint with dismiss entry instead of needs update', { timeout: 30000 }, async () => {
    const { setCurrentLanguage } = await import('../i18n');
    setCurrentLanguage('zh-CN');
    backendApp.GetDriverStatusList.mockResolvedValue({
      success: true,
      data: { downloadDir: 'D:/drivers', drivers: [buildClickHouseDriver()] },
    });

    const renderer = await mountModal();
    await waitUntilContains(renderer, '驱动组件有更新（可选，不影响使用）');
    const content = textContent(renderer.toJSON());

    expect(content).toContain('驱动组件有更新（可选，不影响使用）');
    expect(content).toContain('可更新');
    expect(content).toContain('不再提示此版本');
    expect(content).not.toContain('驱动组件有更新，建议重装以获得最新修复与兼容性改进');
  });

  it('needs update rows keep the reinstall prompt and never render the dismiss entry', { timeout: 30000 }, async () => {
    const { setCurrentLanguage } = await import('../i18n');
    setCurrentLanguage('zh-CN');
    backendApp.GetDriverStatusList.mockResolvedValue({
      success: true,
      data: {
        downloadDir: 'D:/drivers',
        drivers: [
          buildClickHouseDriver({
            needsUpdate: true,
            optionalUpdate: false,
            updateReason: '驱动组件有更新，建议重装以获得最新修复与兼容性改进；当前版本仍可正常使用。',
          }),
        ],
      },
    });

    const renderer = await mountModal();
    await waitUntilContains(renderer, '驱动组件有更新，建议重装以获得最新修复与兼容性改进');
    const content = textContent(renderer.toJSON());

    expect(content).toContain('驱动组件有更新，建议重装以获得最新修复与兼容性改进');
    expect(content).not.toContain('驱动组件有更新（可选，不影响使用）');
    expect(findButton(renderer, '不再提示此版本')).toBeUndefined();
  });

  it('dismiss click persists the expected revision and hides the weak hint', { timeout: 30000 }, async () => {
    const { setCurrentLanguage } = await import('../i18n');
    setCurrentLanguage('zh-CN');
    backendApp.GetDriverStatusList.mockResolvedValue({
      success: true,
      data: { downloadDir: 'D:/drivers', drivers: [buildClickHouseDriver()] },
    });

    const renderer = await mountModal();
    await waitUntilContains(renderer, '不再提示此版本');
    expect(textContent(renderer.toJSON())).toContain('不再提示此版本');

    const dismiss = findButton(renderer, '不再提示此版本');
    await act(async () => {
      dismiss.props.onClick();
    });

    expect(localStorageSpies.setItem).toHaveBeenCalledWith(
      OPTIONAL_UPDATE_DISMISS_KEY,
      JSON.stringify(['src-expected']),
    );
    expect(textContent(renderer.toJSON())).not.toContain('驱动组件有更新（可选，不影响使用）');
    expect(textContent(renderer.toJSON())).not.toContain('不再提示此版本');
    expect(textContent(renderer.toJSON())).toContain('纯 Go 驱动已启用，可直接连接');
  });

  it('hides the weak hint when the dismissed revision matches on remount', { timeout: 30000 }, async () => {
    const { setCurrentLanguage } = await import('../i18n');
    setCurrentLanguage('zh-CN');
    localStorageMap.set(OPTIONAL_UPDATE_DISMISS_KEY, JSON.stringify(['src-expected']));


    backendApp.GetDriverStatusList.mockResolvedValue({
      success: true,
      data: { downloadDir: 'D:/drivers', drivers: [buildClickHouseDriver()] },
    });

    const renderer = await mountModal();
    expect(localStorageSpies.getItem).toHaveBeenCalledWith(OPTIONAL_UPDATE_DISMISS_KEY);
    expect(textContent(renderer.toJSON())).not.toContain('驱动组件有更新（可选，不影响使用）');
    expect(findButton(renderer, '不再提示此版本')).toBeUndefined();
  });
});
