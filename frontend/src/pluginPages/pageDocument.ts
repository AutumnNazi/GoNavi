import { sandboxedPanelDocument } from '../plugins/SandboxedHTMLPanel';
import { createPageBridgeRuntime } from './bridgeRuntime';

/**
 * The page document keeps the panel CSP unchanged (no network, forms, frames or base
 * changes) and prepends the bridge runtime carrying this frame's token, so page scripts
 * already see window.gonavi and every call is bound to this one iframe.
 */
export function sandboxedPageDocument(source: string, token: string): string {
  return sandboxedPanelDocument('<script>' + createPageBridgeRuntime(token) + '</script>' + source);
}
