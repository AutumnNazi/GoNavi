import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('antd', async () => {
  const ReactModule = await import('react');
  type Props = Record<string, any> & { children?: React.ReactNode };

  const omit = (props: Props, keys: string[]) => Object.fromEntries(
    Object.entries(props).filter(([key]) => !keys.includes(key)),
  );
  const Button = ({ children, icon, ...props }: Props) => ReactModule.createElement(
    'button',
    omit(props, ['size', 'type']),
    icon,
    children,
  );
  const Input = (props: Props) => ReactModule.createElement(
    'input',
    omit(props, ['size', 'status', 'onPressEnter']),
  );
  const Select = ({ popupRender, open, ...props }: Props) => ReactModule.createElement(
    'div',
    omit(props, ['size', 'popupMatchSelectWidth', 'options', 'onChange', 'onOpenChange', 'showSearch']),
    open ? popupRender?.(ReactModule.createElement('div', { 'data-max-rows-menu': 'true' })) : null,
  );
  const Tooltip = ({ children }: Props) => ReactModule.createElement(ReactModule.Fragment, null, children);

  return { Button, Input, Select, Tooltip };
});

vi.mock('@ant-design/icons', async () => {
  const ReactModule = await import('react');
  const Icon = () => ReactModule.createElement('span');
  return { CheckOutlined: Icon };
});

import { Select } from 'antd';

import QueryEditorToolbarMaxRowsSelect, {
  QUERY_EDITOR_MAX_ROWS_UPPER_BOUND,
  buildQueryEditorMaxRowsOptions,
  isValidQueryEditorCustomMaxRows,
} from './QueryEditorToolbarMaxRowsSelect';

const FIXED_OPTIONS = [
  { label: '100', value: 100 },
  { label: '0', value: 0 },
];

const renderSelect = async (maxRows: number, onMaxRowsChange = vi.fn()) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <QueryEditorToolbarMaxRowsSelect maxRows={maxRows} onMaxRowsChange={onMaxRowsChange} />,
    );
  });
  const openMenu = async () => {
    await act(async () => {
      renderer.root.findAllByType(Select)[0].props.onOpenChange(true);
    });
  };
  const closeMenu = async () => {
    await act(async () => {
      renderer.root.findAllByType(Select)[0].props.onOpenChange(false);
    });
  };
  return { renderer, onMaxRowsChange, openMenu, closeMenu };
};

describe('isValidQueryEditorCustomMaxRows', () => {
  it.each([
    '',
    ' ',
    '0',
    '00',
    '-1',
    '12.5',
    '1e3',
    'abc',
    '1 000',
    String(QUERY_EDITOR_MAX_ROWS_UPPER_BOUND + 1),
    '9007199254740992',
  ])('rejects %j', (value) => {
    expect(isValidQueryEditorCustomMaxRows(value)).toBe(false);
  });

  it.each(['1', '3000', '50000', '007', ' 2500 '])('accepts %j', (value) => {
    expect(isValidQueryEditorCustomMaxRows(value)).toBe(true);
  });
});

describe('buildQueryEditorMaxRowsOptions', () => {
  it('keeps the fixed options untouched for enumerated and sentinel values', () => {
    expect(buildQueryEditorMaxRowsOptions(100, FIXED_OPTIONS)).toEqual(FIXED_OPTIONS);
    expect(buildQueryEditorMaxRowsOptions(0, FIXED_OPTIONS)).toEqual(FIXED_OPTIONS);
  });

  it('appends a non-enumerated value so a controlled Select can echo it', () => {
    expect(buildQueryEditorMaxRowsOptions(3000, FIXED_OPTIONS)).toEqual([
      ...FIXED_OPTIONS,
      { label: '3000', value: 3000 },
    ]);
  });
});

describe('QueryEditorToolbarMaxRowsSelect custom rows', () => {
  it('renders the custom input only inside the dropdown and submits a typed value', async () => {
    const { renderer, onMaxRowsChange, openMenu } = await renderSelect(5000);

    expect(renderer.root.findAllByProps({ 'data-query-editor-max-rows-input': 'true' })).toHaveLength(0);

    await openMenu();
    const select = renderer.root.findAllByType(Select)[0];
    expect(select.props.popupMatchSelectWidth).toBe(false);
    expect(select.props.options.map((option: { value: number }) => option.value)).toEqual([100, 500, 1000, 5000, 20000, 0]);

    const input = renderer.root.findByProps({ 'data-query-editor-max-rows-input': 'true' });
    expect(input.props.value).toBe('5000');

    await act(async () => {
      input.props.onChange({ target: { value: '  3000  ' } });
    });
    await act(async () => {
      renderer.root.findByProps({ 'data-query-editor-max-rows-confirm': 'true' }).props.onClick();
    });

    expect(onMaxRowsChange).toHaveBeenCalledTimes(1);
    expect(onMaxRowsChange).toHaveBeenCalledWith(3000);
    expect(renderer.root.findAllByProps({ 'data-query-editor-max-rows-dropdown': 'true' })).toHaveLength(0);
    renderer.unmount();
  });

  // 回归：勾号按钮曾只做 stopPropagation，挡不住 mousedown 的默认焦点转移，
  // 内嵌输入框随即失焦，rc-select 收到 blur 后关闭弹层并播放退场动画，
  // 按钮在 mouseup 之前被滑走，click 落到 body 上，onClick 永不触发 ——
  // 表现为「填了数字点勾没反应」。必须 preventDefault 拦下焦点转移。
  it('prevents the confirm button mousedown from stealing focus', async () => {
    const { renderer, openMenu } = await renderSelect(5000);
    await openMenu();
    const confirmButton = renderer.root.findByProps({ 'data-query-editor-max-rows-confirm': 'true' });

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    await act(async () => {
      confirmButton.props.onMouseDown(event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    // stopPropagation 既非必要（window 捕获监听在它之前就执行），也非充分，
    // 不应再依赖它来维持弹层开启。
    expect(event.stopPropagation).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('submits on Enter and normalizes leading zeros', async () => {
    const { renderer, onMaxRowsChange, openMenu } = await renderSelect(5000);
    await openMenu();
    const input = renderer.root.findByProps({ 'data-query-editor-max-rows-input': 'true' });
    await act(async () => {
      input.props.onChange({ target: { value: '007' } });
    });
    await act(async () => {
      renderer.root.findByProps({ 'data-query-editor-max-rows-input': 'true' }).props.onPressEnter();
    });
    expect(onMaxRowsChange).toHaveBeenCalledWith(7);
    renderer.unmount();
  });

  it.each(['', '0', '-1', '12.5', '1e3', 'abc', '50001'])(
    'keeps the dropdown open and reports an error for invalid value %j',
    async (value) => {
      const { renderer, onMaxRowsChange, openMenu } = await renderSelect(5000);
      await openMenu();
      const input = renderer.root.findByProps({ 'data-query-editor-max-rows-input': 'true' });
      await act(async () => {
        input.props.onChange({ target: { value } });
      });
      await act(async () => {
        renderer.root.findByProps({ 'data-query-editor-max-rows-confirm': 'true' }).props.onClick();
      });
      expect(onMaxRowsChange).not.toHaveBeenCalled();
      expect(renderer.root.findByProps({ 'data-query-editor-max-rows-error': 'true' })).toBeDefined();
      expect(renderer.root.findAllByType(Select)[0].props.open).toBe(true);
      renderer.unmount();
    },
  );

  it('prefills an empty input instead of the unlimited sentinel', async () => {
    const { renderer, openMenu } = await renderSelect(0);
    await openMenu();
    expect(renderer.root.findByProps({ 'data-query-editor-max-rows-input': 'true' }).props.value).toBe('');
    renderer.unmount();
  });

  it('echoes a non-enumerated value by appending it to the options', async () => {
    const { renderer, openMenu } = await renderSelect(12345);
    await openMenu();
    const select = renderer.root.findAllByType(Select)[0];
    expect(select.props.value).toBe(12345);
    expect(select.props.options.map((option: { value: number }) => option.value)).toEqual([100, 500, 1000, 5000, 20000, 0, 12345]);
    expect(renderer.root.findByProps({ 'data-query-editor-max-rows-input': 'true' }).props.value).toBe('12345');
    renderer.unmount();
  });

  // 回归：曾经只在「ref 为空」时预填，导致整个会话只预填一次。用户用固定选项改过后
  // 再展开，输入框仍显示上一次残留的数字，此时直接点勾会把过期数字写回，
  // 静默覆盖掉刚选的固定项。
  it('re-syncs the custom input to the effective value on every reopen', async () => {
    const onMaxRowsChange = vi.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <QueryEditorToolbarMaxRowsSelect maxRows={5000} onMaxRowsChange={onMaxRowsChange} />,
      );
    });
    const select = () => renderer.root.findAllByType(Select)[0];
    const customInput = () => renderer.root.findByProps({ 'data-query-editor-max-rows-input': 'true' });
    const toggleMenu = async (open: boolean) => {
      await act(async () => {
        select().props.onOpenChange(open);
      });
    };

    await toggleMenu(true);
    expect(customInput().props.value).toBe('5000');

    // 输入一个与当前生效值不同的数字，但不提交，直接关掉下拉。
    await act(async () => {
      customInput().props.onChange({ target: { value: '3000' } });
    });
    await toggleMenu(false);

    // 模拟用户改选固定项：生效值变为 1000。
    await act(async () => {
      renderer.update(
        <QueryEditorToolbarMaxRowsSelect maxRows={1000} onMaxRowsChange={onMaxRowsChange} />,
      );
    });

    await toggleMenu(true);
    expect(customInput().props.value).toBe('1000');
    renderer.unmount();
  });

  it('clears a previous error when the dropdown is reopened', async () => {
    const { renderer, openMenu, closeMenu } = await renderSelect(5000);
    await openMenu();
    await act(async () => {
      renderer.root.findByProps({ 'data-query-editor-max-rows-input': 'true' }).props.onChange({ target: { value: 'abc' } });
    });
    await act(async () => {
      renderer.root.findByProps({ 'data-query-editor-max-rows-confirm': 'true' }).props.onClick();
    });
    expect(renderer.root.findByProps({ 'data-query-editor-max-rows-error': 'true' })).toBeDefined();
    await closeMenu();
    await openMenu();
    expect(renderer.root.findAllByProps({ 'data-query-editor-max-rows-error': 'true' })).toHaveLength(0);
    renderer.unmount();
  });
});
