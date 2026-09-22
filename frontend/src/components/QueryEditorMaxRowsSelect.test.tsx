import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import QueryEditorMaxRowsSelect from './QueryEditorMaxRowsSelect';

const antdState = vi.hoisted(() => ({
  confirm: vi.fn(),
  selectProps: null as any,
}));

vi.mock('antd', () => ({
  Modal: { confirm: antdState.confirm },
  Select: (props: any) => {
    antdState.selectProps = props;
    return <div data-max-rows-select="true" />;
  },
  Tooltip: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../i18n/provider', () => ({ useOptionalI18n: () => null }));

describe('QueryEditorMaxRowsSelect', () => {
  afterEach(() => vi.clearAllMocks());

  it('confirms the safe cap before enabling unlimited mode', () => {
    const onChange = vi.fn();
    const renderer = TestRenderer.create(<QueryEditorMaxRowsSelect value={5000} onChange={onChange} />);

    act(() => antdState.selectProps.onChange(0));
    expect(onChange).not.toHaveBeenCalled();
    expect(antdState.confirm).toHaveBeenCalledOnce();

    act(() => antdState.confirm.mock.calls[0][0].onOk());
    expect(onChange).toHaveBeenCalledWith(0);
    renderer.unmount();
  });

  it('applies finite limits without confirmation', () => {
    const onChange = vi.fn();
    const renderer = TestRenderer.create(<QueryEditorMaxRowsSelect value={5000} onChange={onChange} />);

    act(() => antdState.selectProps.onChange(1000));
    expect(onChange).toHaveBeenCalledWith(1000);
    expect(antdState.confirm).not.toHaveBeenCalled();
    renderer.unmount();
  });
});
