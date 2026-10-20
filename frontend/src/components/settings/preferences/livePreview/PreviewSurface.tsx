import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ConfigProvider } from 'antd';
import { StyleProvider, createCache } from '@ant-design/cssinjs';
import { subscribePreviewStyles } from './previewStyleSubscription';
import { usePreviewVisibility } from './usePreviewVisibility';
import './livePreview.css';

type Props = { mode: 'classic' | 'navicat'; children: ReactNode; height?: number; label: string };
export function PreviewSurface({ mode, children, height = 640, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const [width, setWidth] = useState(1080);
  const visible = usePreviewVisibility(host);
  const cache = useMemo(() => visible ? createCache() : null, [visible]);
  useLayoutEffect(() => {
    if (!host.current) return;
    const resize = () => setWidth(host.current?.clientWidth || 1080);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (visible && host.current) setShadow(host.current.shadowRoot || host.current.attachShadow({ mode: 'open' }));
  }, [visible]);
  useEffect(() => {
    if (!shadow) return;
    const style = document.createElement('style');
    shadow.prepend(style);
    const unsubscribe = subscribePreviewStyles(document, css => { style.textContent = css; });
    return () => { unsubscribe(); style.remove(); };
  }, [shadow]);
  useEffect(() => {
    if (!shadow) return;
    let frame = 0;
    const sync = () => {
      for (const [source, target] of [[document.body, body.current], [document.documentElement, root.current]] as const) {
        if (!target) continue;
        for (const attribute of Array.from(target.attributes)) {
          if (attribute.name.startsWith('data-preview-') || attribute.name === 'data-ui-layout') continue;
          if ((attribute.name.startsWith('data-') || ['class', 'lang'].includes(attribute.name)) && !source.hasAttribute(attribute.name)) target.removeAttribute(attribute.name);
        }
        for (const attribute of Array.from(source.attributes)) {
          if (attribute.name.startsWith('data-') || attribute.name === 'class' || attribute.name === 'lang') target.setAttribute(attribute.name, attribute.value);
        }
        for (const name of Array.from(target.style)) if (name.startsWith('--')) target.style.removeProperty(name);
        for (const name of Array.from(source.style)) {
          if (!name.startsWith('--')) continue;
          if (target === body.current && mode === 'navicat' && ['--gn-window-opacity', '--gn-window-opacity-percent'].includes(name)) continue;
          target.style.setProperty(name, source.style.getPropertyValue(name));
        }
      }
      body.current?.setAttribute('data-ui-layout', modeRef.current);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(sync); };
    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { attributes: true });
    observer.observe(document.documentElement, { attributes: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [shadow, mode]);
  const scale = Math.min(1, width / 1080);
  useLayoutEffect(() => {
    if (host.current) { host.current.scrollTop = 0; host.current.scrollLeft = 0; }
  }, [mode, scale]);
  return <div className="gn-live-preview-host" ref={host} style={{ height: height * scale }} role="region" aria-label={label}>
    {shadow && cache && createPortal(<StyleProvider container={shadow} cache={cache}>
      <div ref={root} data-preview-root="true" style={{ width: 1080, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        <div ref={body} data-preview-body="true" data-ui-layout={mode} style={{ width: 1080, height }} onKeyDown={event => event.stopPropagation()}>
          <ConfigProvider getPopupContainer={() => body.current || host.current!}>{children}</ConfigProvider>
        </div>
      </div>
    </StyleProvider>, shadow)}
  </div>;
}
