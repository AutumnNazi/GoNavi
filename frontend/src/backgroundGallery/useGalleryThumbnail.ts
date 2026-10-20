import { useEffect, useRef, useState } from 'react';
import { getGalleryAdapter } from './adapter';
import type { GalleryEntry } from './types';

export function useGalleryThumbnail(entry: GalleryEntry) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setURL] = useState<string | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const controller = new AbortController();
    let started = false;
    setURL(null);
    const load = () => {
      if (started || controller.signal.aborted) return;
      started = true;
      void getGalleryAdapter().then(adapter => adapter.thumbnail(entry, controller.signal)).then(value => {
        if (!controller.signal.aborted) setURL(value);
      }).catch(() => undefined);
    };
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(changes => { if (changes.some(change => change.isIntersecting)) { observer?.disconnect(); load(); } }) : null;
    if (observer) observer.observe(node);
    else {
      const bounds = node.getBoundingClientRect();
      if (bounds.bottom > 0 && bounds.top < window.innerHeight) load();
    }
    return () => { controller.abort(); observer?.disconnect(); };
  }, [entry]);
  return { ref, url };
}
