import { ConfigProvider } from 'antd';

export const APP_OVERLAY_Z_INDEX_BASE = 10_000;
export const APP_DETACHED_WINDOW_Z_INDEX_BASE = APP_OVERLAY_Z_INDEX_BASE + 1_000;
export const APP_POPUP_Z_INDEX = APP_OVERLAY_Z_INDEX_BASE + 9_000;
export const APP_FOREGROUND_MODAL_Z_INDEX = APP_OVERLAY_Z_INDEX_BASE + 10_000;
export const APP_NESTED_MODAL_Z_INDEX = APP_FOREGROUND_MODAL_Z_INDEX + 1_000;
export const APP_COMMAND_PALETTE_Z_INDEX = APP_NESTED_MODAL_Z_INDEX + 1_000;
export const APP_APPLICATION_QUIT_MODAL_Z_INDEX = APP_COMMAND_PALETTE_Z_INDEX + 1_000;

export const configureAntdStaticOverlayLayer = (): void => {
  ConfigProvider.config({
    theme: {
      token: {
        zIndexPopupBase: APP_POPUP_Z_INDEX,
      },
    },
  });
};
