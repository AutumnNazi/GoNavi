import { collectPreviewStyles } from './previewStyleScope';

type Listener = (css: string) => void;
type Subscription = { listeners: Set<Listener>; css: string; dispose: () => void };
const subscriptions = new WeakMap<Document, Subscription>();
const stylesheetSelector = 'style, link[rel~="stylesheet"]';

function containsStylesheet(node: Node): boolean {
  return node instanceof Element && (node.matches(stylesheetSelector) || !!node.querySelector(stylesheetSelector));
}

function changesStylesheet(record: MutationRecord): boolean {
  const element = record.target instanceof Element ? record.target : record.target.parentElement;
  if (element?.closest(stylesheetSelector)) return true;
  // A link whose rel was changed away from stylesheet still invalidates the old CSS.
  if (record.type === 'attributes' && element?.tagName === 'LINK' && record.attributeName === 'rel') return true;
  return [...record.addedNodes, ...record.removedNodes].some(containsStylesheet);
}

function createSubscription(doc: Document): Subscription {
  let frame: number | null = null;
  const subscription: Subscription = { listeners: new Set(), css: collectPreviewStyles(doc), dispose: () => undefined };
  const schedule = () => {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const css = collectPreviewStyles(doc);
      if (css === subscription.css) return;
      subscription.css = css;
      subscription.listeners.forEach(listener => listener(css));
    });
  };
  const observer = new MutationObserver(records => {
    if (records.some(changesStylesheet)) schedule();
  });
  observer.observe(doc.head, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['href', 'media', 'disabled', 'rel', 'type'],
  });
  // Linked CSS may finish loading after its node was inserted (production chunks).
  const onLoad = (event: Event) => {
    if (event.target instanceof Element && event.target.matches('link[rel~="stylesheet"]')) schedule();
  };
  doc.head.addEventListener('load', onLoad, true);
  subscription.dispose = () => {
    observer.disconnect();
    doc.head.removeEventListener('load', onLoad, true);
    if (frame !== null) cancelAnimationFrame(frame);
  };
  return subscription;
}

// One collection/observer per document, shared by all mounted preview surfaces.
// Drop the cache with the last surface so revisiting settings cannot use stale CSS.
export function subscribePreviewStyles(doc: Document, listener: Listener): () => void {
  let subscription = subscriptions.get(doc);
  if (!subscription) {
    subscription = createSubscription(doc);
    subscriptions.set(doc, subscription);
  }
  const current = subscription;
  current.listeners.add(listener);
  listener(current.css);
  return () => {
    if (!current.listeners.delete(listener) || current.listeners.size) return;
    current.dispose();
    subscriptions.delete(doc);
  };
}
