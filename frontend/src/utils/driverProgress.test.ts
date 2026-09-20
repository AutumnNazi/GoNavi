import { describe, expect, it } from 'vitest';

import {
  normalizeDriverProgressUpdate,
  resolveDriverProgressDisplay,
  type DriverProgressState,
} from './driverProgress';

describe('normalizeDriverProgressUpdate', () => {
  it('keeps downloading progress monotonic within one install session', () => {
    const previous: DriverProgressState = {
      status: 'downloading',
      message: '写入驱动元数据',
      percent: 90,
    };

    const actual = normalizeDriverProgressUpdate(previous, {
      status: 'downloading',
      message: '下载驱动总包',
      percent: 30,
    });

    expect(actual).toEqual({
      status: 'downloading',
      message: '下载驱动总包',
      percent: 90,
    });
  });

  it('allows start to reset progress for a new install session', () => {
    const actual = normalizeDriverProgressUpdate({
      status: 'error',
      message: '安装失败',
      percent: 90,
    }, {
      status: 'start',
      message: '开始安装',
      percent: 0,
    });

    expect(actual).toEqual({
      status: 'start',
      message: '开始安装',
      percent: 0,
    });
  });

  it('does not let stale downloading events overwrite terminal states', () => {
    const done = normalizeDriverProgressUpdate({
      status: 'downloading',
      message: '写入驱动元数据',
      percent: 95,
    }, {
      status: 'done',
      message: '驱动代理安装完成',
      percent: 100,
    });

    expect(normalizeDriverProgressUpdate(done, {
      status: 'downloading',
      message: '下载驱动总包',
      percent: 40,
    })).toBe(done);

    const failed = normalizeDriverProgressUpdate({
      status: 'downloading',
      message: '写入驱动元数据',
      percent: 95,
    }, {
      status: 'error',
      message: '安装失败',
      percent: 0,
    });

    expect(failed).toEqual({
      status: 'error',
      message: '安装失败',
      percent: 95,
    });
    expect(normalizeDriverProgressUpdate(failed, {
      status: 'downloading',
      message: '下载驱动总包',
      percent: 40,
    })).toBe(failed);
  });

  it('treats a user cancellation as a terminal state that keeps the reached percent', () => {
    const canceled = normalizeDriverProgressUpdate({
      status: 'downloading',
      message: '下载预编译包',
      percent: 42,
    }, {
      status: 'canceled',
      message: '已取消下载',
      percent: 0,
    });

    expect(canceled).toEqual({
      status: 'canceled',
      message: '已取消下载',
      percent: 42,
    });
    expect(normalizeDriverProgressUpdate(canceled, {
      status: 'downloading',
      message: '迟到的进度',
      percent: 60,
    })).toBe(canceled);
    expect(normalizeDriverProgressUpdate(canceled, {
      status: 'start',
      message: '重新开始安装',
      percent: 0,
    })).toEqual({
      status: 'start',
      message: '重新开始安装',
      percent: 0,
    });
  });
});

describe('resolveDriverProgressDisplay', () => {
  it('floors an in-flight start at 1% so the card is already cancelable', () => {
    expect(resolveDriverProgressDisplay({ status: 'start', message: '开始安装', percent: 0 })).toEqual({
      percent: 1,
      status: 'active',
    });
  });

  it('keeps a canceled install from looking like a finished success', () => {
    expect(resolveDriverProgressDisplay({
      status: 'canceled',
      message: '已取消下载',
      percent: 1,
    }, true)).toEqual({
      percent: 1,
      status: 'normal',
    });
  });
});
