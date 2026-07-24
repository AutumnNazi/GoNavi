import { ConfigProvider } from 'antd';

export const APP_OVERLAY_Z_INDEX_BASE = 10_000;
export const APP_POPUP_Z_INDEX = APP_OVERLAY_Z_INDEX_BASE + 50;
export const APP_FOREGROUND_MODAL_Z_INDEX = APP_OVERLAY_Z_INDEX_BASE + 100;
export const APP_NESTED_MODAL_Z_INDEX = APP_FOREGROUND_MODAL_Z_INDEX + 100;
export const APP_COMMAND_PALETTE_Z_INDEX = APP_NESTED_MODAL_Z_INDEX + 100;

export const configureAntdStaticOverlayLayer = (): void => {
  ConfigProvider.config({
    theme: {
      token: {
        zIndexPopupBase: APP_OVERLAY_Z_INDEX_BASE,
      },
    },
  });
};
