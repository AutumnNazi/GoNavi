import { useEffect, useState, type RefObject } from 'react';

// Keep a sized placeholder until it enters the settings scroll viewport. Once
// visited, retain the local demo state when scrolling to another preview.
export function usePreviewVisibility(host: RefObject<HTMLElement>): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible || !host.current) return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [host, visible]);
  return visible;
}
