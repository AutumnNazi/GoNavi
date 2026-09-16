import DOMPurify from 'dompurify';

export const MERMAID_MAX_SOURCE_LENGTH = 50_000;
export const MERMAID_MAX_SVG_LENGTH = 1_500_000;
export const MERMAID_RENDER_TIMEOUT_MS = 5_000;

const MERMAID_MAX_EDGES = 500;
const unsafeDirectivePattern = /%%\s*\{/u;
const unsafeFrontmatterPattern = /^---[\s\S]*?\n[\t ]*(?:config|securityLevel|themeCSS)\s*:/imu;
const unsafePrototypePattern = /(?:__proto__|constructor\s*\.?\s*prototype)/iu;
const safePaintServerPattern = /^url\(\s*#[A-Za-z_][\w:.-]*\s*\)$/u;

export const buildMermaidConfig = (darkMode: boolean) => ({
  startOnLoad: false,
  securityLevel: 'strict' as const,
  theme: darkMode ? 'dark' as const : 'default' as const,
  maxTextSize: MERMAID_MAX_SOURCE_LENGTH,
  maxEdges: MERMAID_MAX_EDGES,
  htmlLabels: false,
  suppressErrorRendering: true,
  flowchart: { htmlLabels: false },
});

export const assertSafeMermaidSource = (source: string): void => {
  if (source.length > MERMAID_MAX_SOURCE_LENGTH) {
    throw new Error(`source exceeds ${MERMAID_MAX_SOURCE_LENGTH} characters`);
  }
  if (unsafeDirectivePattern.test(source) || unsafeFrontmatterPattern.test(source)) {
    throw new Error('configuration directives are not allowed');
  }
  if (unsafePrototypePattern.test(source)) {
    throw new Error('prototype mutation keys are not allowed');
  }
};

const removeUnsafeSvgAttributes = (svg: SVGSVGElement): void => {
  const elements = [svg, ...Array.from(svg.querySelectorAll('*'))];
  elements.forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith('on') || name === 'style' || name === 'target' || name === 'formaction') {
        element.removeAttribute(attribute.name);
        return;
      }
      if (name === 'href' || name.endsWith(':href')) {
        if (!value.startsWith('#')) element.removeAttribute(attribute.name);
        return;
      }
      if (/url\(/iu.test(value) && !safePaintServerPattern.test(value)) {
        element.removeAttribute(attribute.name);
      }
    });
  });
};

export const sanitizeMermaidSvg = (rawSvg: string): string => {
  if (rawSvg.length > MERMAID_MAX_SVG_LENGTH) {
    throw new Error(`renderer output exceeds ${MERMAID_MAX_SVG_LENGTH} characters`);
  }
  const purified = DOMPurify.sanitize(rawSvg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: [
      'a',
      'animate',
      'animateMotion',
      'animateTransform',
      'embed',
      'foreignObject',
      'iframe',
      'link',
      'meta',
      'object',
      'script',
      'set',
      'style',
      'template',
    ],
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    RETURN_TRUSTED_TYPE: false,
  });
  const document = new DOMParser().parseFromString(String(purified), 'image/svg+xml');
  const svg = document.documentElement;
  if (svg.localName !== 'svg' || document.querySelector('parsererror')) {
    throw new Error('renderer output is not valid SVG');
  }
  removeUnsafeSvgAttributes(svg as unknown as SVGSVGElement);
  const sanitized = new XMLSerializer().serializeToString(svg);
  if (sanitized.length > MERMAID_MAX_SVG_LENGTH) {
    throw new Error(`sanitized output exceeds ${MERMAID_MAX_SVG_LENGTH} characters`);
  }
  return sanitized;
};

export const buildMermaidSandboxDocument = (svg: string, darkMode: boolean): string => `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'">
<style>html,body{margin:0;padding:0;background:transparent;color-scheme:${darkMode ? 'dark' : 'light'}}body{display:flex;justify-content:flex-start;overflow:auto}svg{display:block;max-width:100%;height:auto}</style></head>
<body>${svg}</body></html>`;

export const withMermaidRenderTimeout = <T>(
  promise: Promise<T>,
  timeoutMs = MERMAID_RENDER_TIMEOUT_MS,
): Promise<T> => new Promise<T>((resolve, reject) => {
  let settled = false;
  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    globalThis.clearTimeout(timeoutId);
    callback();
  };
  const timeoutId = globalThis.setTimeout(() => {
    finish(() => reject(new Error('mermaid render timeout')));
  }, timeoutMs);
  promise.then(
    (value) => finish(() => resolve(value)),
    (error) => finish(() => reject(error)),
  );
});

let renderQueue: Promise<void> = Promise.resolve();

export const enqueueMermaidRender = <T>(render: () => Promise<T>): Promise<T> => {
  const result = renderQueue.then(render, render);
  renderQueue = result.then(() => undefined, () => undefined);
  return result;
};
