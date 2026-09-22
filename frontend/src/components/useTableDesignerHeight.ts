import { useLayoutEffect, useState, type RefObject } from 'react';

export function useTableDesignerHeight(containerRef: RefObject<HTMLDivElement>, activeKey: string) {
  const [height, setHeight] = useState(500);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const header = container.querySelector<HTMLElement>('.ant-table-header');
    const measure = () => {
      if (container.clientHeight <= 0) return;
      const headerHeight = header?.offsetHeight || 40;
      setHeight(Math.max(1, container.clientHeight - headerHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [containerRef, activeKey]);
  return height;
}
