export interface FixedVirtualRangeInput {
  itemCount: number;
  itemHeight: number;
  viewportHeight: number;
  scrollTop: number;
}

export interface FixedVirtualRange {
  scrollHeight: number;
  start: number;
  end: number;
  offset: number;
}
const normalizeHorizontalOffset = (offset: number): number => (
  Number.isFinite(offset) ? Math.max(0, offset) : 0
);

const DATA_GRID_FIXED_CELL_SELECTOR = [
  '.ant-table-tbody-virtual-holder-inner .ant-table-cell-fix-left',
  '.ant-table-tbody-virtual-holder-inner .ant-table-cell-fix-left-first',
  '.ant-table-tbody-virtual-holder-inner .ant-table-cell-fix-left-last',
  '.ant-table-tbody-virtual-holder-inner .ant-table-cell-fix-right',
  '.ant-table-tbody-virtual-holder-inner .ant-table-cell-fix-right-first',
  '.ant-table-tbody-virtual-holder-inner .ant-table-cell-fix-right-last',
  '.ant-table-tbody-virtual-holder-inner .ant-table-selection-column',
].join(',');

/**
 * Elements that paint pinned during a horizontal preview: the header/first-column
 * cell plus the selection and row-number columns. The same list drives both the
 * header override and the body override so a row mounted later is picked up.
 */
const DATA_GRID_PINNED_CELL_SELECTOR = [
  '.ant-table-cell-fix-left',
  '.ant-table-cell-fix-left-first',
  '.ant-table-cell-fix-left-last',
  '.ant-table-selection-column',
].join(',');

const DATA_GRID_PINNED_RIGHT_CELL_SELECTOR = [
  '.ant-table-cell-fix-right',
  '.ant-table-cell-fix-right-first',
  '.ant-table-cell-fix-right-last',
].join(',');

/**
 * Paint the horizontal preview offset straight onto the pinned cells.
 *
 * The stylesheet rule that pins these cells reads an inherited custom property
 * (`--gn-datagrid-h-scroll`), so a per-frame write has to land on a shared
 * ancestor and every cell below it — including the ~615 ordinary cells of a
 * 99-column grid — is invalidated and restyled each frame. That showed up as
 * ~2s of style recalculation over a 2s drag and is why a horizontal drag felt
 * stuck. Writing the resolved transform on each pinned cell instead touches only
 * the ~82 cells that actually pin, and the drag drops to a flat 60fps.
 *
 * `transform` is written with `important` because the stylesheet pins these cells
 * with `!important` itself.
 */
const writePinnedCellTransform = (root: ParentNode, offset: number, maxScroll: number): number => {
  const normalized = normalizeHorizontalOffset(offset);
  const leftTransform = `translate3d(${normalized}px, 0, 0)`;
  const rightOffset = normalized - normalizeHorizontalOffset(maxScroll);
  const rightTransform = `translate3d(${rightOffset}px, 0, 0)`;
  let writes = 0;
  const leftCells = root.querySelectorAll<HTMLElement>(DATA_GRID_PINNED_CELL_SELECTOR);
  leftCells.forEach((cell) => {
    if (cell.style.getPropertyValue('transform') === leftTransform) {
      return;
    }
    cell.style.setProperty('transform', leftTransform, 'important');
    writes += 1;
  });
  const rightCells = root.querySelectorAll<HTMLElement>(DATA_GRID_PINNED_RIGHT_CELL_SELECTOR);
  rightCells.forEach((cell) => {
    if (cell.style.getPropertyValue('transform') === rightTransform) {
      return;
    }
    cell.style.setProperty('transform', rightTransform, 'important');
    writes += 1;
  });
  return writes;
};

const clearPinnedCellTransform = (root: ParentNode): number => {
  const cells = root.querySelectorAll<HTMLElement>(`${DATA_GRID_PINNED_CELL_SELECTOR},${DATA_GRID_PINNED_RIGHT_CELL_SELECTOR}`);
  let cleared = 0;
  cells.forEach((cell) => {
    if (cell.style.getPropertyValue('transform')) {
      cell.style.removeProperty('transform');
      cleared += 1;
    }
  });
  return cleared;
};


const queryDataGridFixedCells = (root: ParentNode): NodeListOf<HTMLElement> => (
  root.querySelectorAll<HTMLElement>(DATA_GRID_FIXED_CELL_SELECTOR)
);

const DATA_GRID_COLUMN_VIRTUALIZATION_THRESHOLD = 16;

/**
 * 表头固定列（含选择列、行号列）。native 横滚时表头整体靠 translate 跟随，
 * 这些单元格再用自身偏移钉回视口。
 */
const DATA_GRID_HEADER_FIXED_CELL_SELECTOR = [
  '.ant-table-header .ant-table-cell-fix-left',
  '.ant-table-header .ant-table-cell-fix-left-first',
  '.ant-table-header .ant-table-cell-fix-left-last',
  '.ant-table-header .ant-table-cell-fix-right',
  '.ant-table-header .ant-table-cell-fix-right-first',
  '.ant-table-header .ant-table-cell-fix-right-last',
  '.ant-table-header .ant-table-selection-column',
  '.ant-table-header .data-grid-row-number-cell',
].join(',');

/**
 * 把固定表头单元格的横向偏移写到单元格自身，而不是表头容器。
 * 容器上的变量会被每个表头单元格继承，写一次就让全部表头单元格样式失效；
 * 宽表（数百字段）横滚时这笔开销随字段数线性增长，直接吃掉整帧预算。
 * 只写命中的固定单元格则与字段数无关。
 */
export const applyDataGridHeaderPinOffset = (
  headerRoot: ParentNode,
  offset: number,
): number => {
  const cells = headerRoot.querySelectorAll<HTMLElement>(DATA_GRID_HEADER_FIXED_CELL_SELECTOR);
  if (cells.length === 0) {
    return 0;
  }
  const scrollVar = `${normalizeHorizontalOffset(offset)}px`;
  let writes = 0;
  cells.forEach((cell) => {
    if (cell.style.getPropertyValue('--gn-datagrid-h-scroll') === scrollVar) {
      return;
    }
    cell.style.setProperty('--gn-datagrid-h-scroll', scrollVar);
    writes += 1;
  });
  return writes;
};

export const clearDataGridHeaderPinOffset = (headerRoot: ParentNode): number => {
  const cells = headerRoot.querySelectorAll<HTMLElement>(DATA_GRID_HEADER_FIXED_CELL_SELECTOR);
  let cleared = 0;
  cells.forEach((cell) => {
    if (cell.style.getPropertyValue('--gn-datagrid-h-scroll')) {
      cell.style.removeProperty('--gn-datagrid-h-scroll');
      cleared += 1;
    }
  });
  return cleared;
};

export const syncDataGridHeaderHorizontalOffset = (
  header: HTMLElement,
  offset: number,
  nativeScroll: boolean,
  measuredHeaderScrollLeft?: number,
): void => {
  // rc-table may update header.scrollLeft after a result pane is reactivated.
  const normalizedOffset = normalizeHorizontalOffset(offset);
  const table = header.querySelector('table') as HTMLElement | null;
  if (nativeScroll) {
    const translate = `${(measuredHeaderScrollLeft ?? header.scrollLeft) - normalizedOffset}px 0`;
    applyDataGridHeaderPinOffset(header, normalizedOffset);
    if (table && table.style.translate !== translate) table.style.translate = translate;
    return;
  }
  clearDataGridHeaderPinOffset(header);
  if (table?.style.translate) table.style.translate = '';
  if (Math.abs(header.scrollLeft - normalizedOffset) > 1) header.scrollLeft = normalizedOffset;
};

export const shouldVirtualizeDataGridColumns = (columnCount: number): boolean => (
  Number.isFinite(columnCount)
  && Math.max(0, Math.floor(columnCount)) > DATA_GRID_COLUMN_VIRTUALIZATION_THRESHOLD
);

export const readDataGridVirtualInnerOffset = (inner: HTMLElement): number => {
  const translated = Math.abs(Number.parseFloat(inner.style.translate));
  if (Number.isFinite(translated)) {
    return translated;
  }
  const legacyMargin = Math.abs(Number.parseFloat(inner.style.marginLeft));
  return Number.isFinite(legacyMargin) ? legacyMargin : 0;
};

/**
 * Keeps fixed cells visually pinned during a continuous horizontal preview.
 * See writePinnedCellTransform for why the offset is written per cell and not
 * onto a shared ancestor as an inherited custom property.
 */
export const applyDataGridFixedCellPreviewOffset = (
  inner: HTMLElement,
  offset: number,
  maxScroll = 0,
): number => (
  writePinnedCellTransform(inner, offset, maxScroll)
);

/**
 * Settles the offset after a drag or a programmatic jump.
 *
 * The drag path writes inline transforms; this pass repaints the pinned cells of
 * whatever rows are mounted right now, releases those preview overrides, and
 * leaves the resolved offset on the container so rows that mount later start
 * from the right place instead of snapping from zero.
 */
export const commitDataGridFixedCellOffset = (
  root: ParentNode,
  inner: HTMLElement,
  offset: number,
  maxScroll = 0,
): number => {
  const scrollVar = `${normalizeHorizontalOffset(offset)}px`;
  if (inner.style.getPropertyValue('--gn-datagrid-h-scroll') !== scrollVar) {
    inner.style.setProperty('--gn-datagrid-h-scroll', scrollVar);
  }
  const cleared = clearPinnedCellTransform(root);
  void queryDataGridFixedCells(root);
  return cleared;
};

export const coversFixedVirtualRange = (
  range: Pick<FixedVirtualRange, 'start' | 'end'>,
  itemHeight: number,
  viewportHeight: number,
  scrollTop: number,
): boolean => {
  const height = Number.isFinite(itemHeight) ? Math.max(0, itemHeight) : 0;
  const viewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  if (height <= 0) {
    return true;
  }
  const requestedScrollTop = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const safety = height * 2;
  const startTop = Math.max(0, range.start) * height;
  const endBottom = (Math.max(range.start, range.end) + 1) * height;
  const leadingCovered = range.start <= 0 || startTop + safety <= requestedScrollTop;
  const trailingCovered = endBottom - safety >= requestedScrollTop + viewport;
  return leadingCovered && trailingCovered;
};

/**
 * Mirrors rc-virtual-list's visible range semantics for a fixed-height list,
 * but calculates the range arithmetically instead of scanning every item.
 */
export const calculateFixedVirtualRange = ({
  itemCount,
  itemHeight,
  viewportHeight,
  scrollTop,
}: FixedVirtualRangeInput): FixedVirtualRange => {
  const count = Number.isFinite(itemCount) ? Math.max(0, Math.floor(itemCount)) : 0;
  const height = Number.isFinite(itemHeight) ? Math.max(0, itemHeight) : 0;
  const viewport = Number.isFinite(viewportHeight) ? Math.max(0, viewportHeight) : 0;
  if (count === 0 || height <= 0) {
    return {
      scrollHeight: count * height,
      start: 0,
      end: count - 1,
      offset: 0,
    };
  }

  const scrollHeight = count * height;
  const maxScrollTop = Math.max(0, scrollHeight - viewport);
  const requestedScrollTop = Number.isFinite(scrollTop)
    ? scrollTop
    : scrollTop === Number.POSITIVE_INFINITY
      ? maxScrollTop
      : 0;
  const clampedScrollTop = Math.max(0, Math.min(maxScrollTop, requestedScrollTop));

  // Native scrolling can advance multiple screens before WebKit dispatches
  // the next main-thread event. Keep two viewports mounted on each side so a
  // fast trackpad fling cannot expose the unmounted filler.
  const overscanRows = Math.max(8, Math.ceil(viewport / height) * 2);
  const start = Math.min(count - 1, Math.max(0, Math.ceil(clampedScrollTop / height) - overscanRows));
  const end = Math.min(count - 1, Math.floor((clampedScrollTop + viewport) / height) + overscanRows);

  return {
    scrollHeight,
    start,
    end,
    offset: start * height,
  };
};

export interface DataGridIdleCommitSchedulerOptions<T> {
  delayMs: number;
  onCommit: (value: T) => void;
  canCommit?: () => boolean;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DataGridIdleCommitScheduler<T> {
  schedule: (value: T) => void;
  flush: () => boolean;
  cancel: () => void;
  hasPending: () => boolean;
}

export interface DataGridVisualFrameGuardOptions<T> {
  onFrame: (value: T) => void;
  shouldContinue?: () => boolean;
  onStop?: () => void;
  trailingFrameCount?: number;
  requestFrame?: (callback: (timestamp: number) => void) => unknown;
  cancelFrame?: (handle: unknown) => void;
}

export interface DataGridVisualFrameGuard<T> {
  update: (value: T) => void;
  start: () => boolean;
  cancel: () => void;
  hasPending: () => boolean;
}

const NO_PENDING_IDLE_COMMIT = Symbol('data-grid-no-pending-idle-commit');

/**
 * Coalesces a continuous stream of visual scroll previews into one commit
 * after the stream has been idle. Only one timer is live at any time.
 */
export const createDataGridIdleCommitScheduler = <T>({
  delayMs,
  onCommit,
  canCommit = () => true,
  now = () => Date.now(),
  setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimer = (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}: DataGridIdleCommitSchedulerOptions<T>): DataGridIdleCommitScheduler<T> => {
  const delay = Math.max(0, Number.isFinite(delayMs) ? delayMs : 0);
  let timer: unknown = null;
  let timerToken = 0;
  let pending: T | typeof NO_PENDING_IDLE_COMMIT = NO_PENDING_IDLE_COMMIT;
  let lastScheduleTime = 0;

  const armTimer = (waitMs: number) => {
    const token = ++timerToken;
    timer = setTimer(() => runTimer(token), Math.max(0, waitMs));
  };

  const runTimer = (token: number) => {
    if (token !== timerToken) return;
    timer = null;
    if (pending === NO_PENDING_IDLE_COMMIT) return;

    const remaining = lastScheduleTime + delay - now();
    if (remaining > 0 || !canCommit()) {
      armTimer(remaining > 0 ? remaining : delay);
      return;
    }

    const value = pending;
    pending = NO_PENDING_IDLE_COMMIT;
    onCommit(value);
  };

  return {
    schedule(value) {
      pending = value;
      lastScheduleTime = now();
      if (timer === null) {
        armTimer(delay);
      }
    },
    flush() {
      if (pending === NO_PENDING_IDLE_COMMIT || !canCommit()) {
        return false;
      }
      timerToken += 1;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      const value = pending;
      pending = NO_PENDING_IDLE_COMMIT;
      onCommit(value);
      return true;
    },
    cancel() {
      timerToken += 1;
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      pending = NO_PENDING_IDLE_COMMIT;
    },
    hasPending() {
      return pending !== NO_PENDING_IDLE_COMMIT;
    },
  };
};

const NO_VISUAL_FRAME_GUARD_VALUE = Symbol('data-grid-no-visual-frame-guard-value');

/**
 * Keeps reasserting the latest visual scroll offset while an async internal
 * commit can still repaint an older offset into the DOM.
 */
export const createDataGridVisualFrameGuard = <T>({
  onFrame,
  shouldContinue = () => false,
  onStop = () => {},
  trailingFrameCount = 1,
  requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
  cancelFrame = (handle) => globalThis.cancelAnimationFrame(handle as number),
}: DataGridVisualFrameGuardOptions<T>): DataGridVisualFrameGuard<T> => {
  const trailingFrames = Number.isFinite(trailingFrameCount)
    ? Math.max(0, Math.floor(trailingFrameCount))
    : 0;
  let active = false;
  let frame: unknown = null;
  let frameToken = 0;
  let remainingTrailingFrames = 0;
  let latestValue: T | typeof NO_VISUAL_FRAME_GUARD_VALUE = NO_VISUAL_FRAME_GUARD_VALUE;

  const armFrame = () => {
    const token = ++frameToken;
    frame = requestFrame(() => {
      if (token !== frameToken) return;
      frame = null;
      if (latestValue === NO_VISUAL_FRAME_GUARD_VALUE) {
        active = false;
        return;
      }

      onFrame(latestValue);
      if (shouldContinue()) {
        remainingTrailingFrames = trailingFrames;
        armFrame();
        return;
      }
      if (remainingTrailingFrames > 0) {
        remainingTrailingFrames -= 1;
        armFrame();
        return;
      }
      active = false;
      onStop();
    });
  };

  return {
    update(value) {
      latestValue = value;
    },
    start() {
      if (latestValue === NO_VISUAL_FRAME_GUARD_VALUE) {
        return false;
      }
      active = true;
      remainingTrailingFrames = trailingFrames;
      if (frame === null) {
        armFrame();
      }
      return true;
    },
    cancel() {
      active = false;
      frameToken += 1;
      if (frame !== null) {
        cancelFrame(frame);
        frame = null;
      }
      remainingTrailingFrames = 0;
      latestValue = NO_VISUAL_FRAME_GUARD_VALUE;
    },
    hasPending() {
      return active;
    },
  };
};
