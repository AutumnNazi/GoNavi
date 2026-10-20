import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { message, Modal } from 'antd';
import { RestartApplication, SetApplicationBrandIcon } from '../../wailsjs/go/app/App';
import { Environment } from '../../wailsjs/runtime';
import { useI18n } from '../i18n/provider';
import { useStore } from '../store';
import {
  brandAssetKeysFor,
  previewBrandAssetKeys,
  resolveBrandNativeSrc,
  resolveBrandNativeIconZoom,
  resolveBrandIconSrc,
  resolveBrandIcon,
  startupBrandAssetKeys,
  type BrandIconId,
} from './brandIcons';
import { ensureBrandAssets, getBrandAssetsRevision, subscribeBrandAssets } from './brandAssetLoader';
import {
  composeMacOSDockIconBase64,
  composeWindowsNativeIconBase64,
  APPLE_DOCK_ICON_GRID_INSET,
  shouldSyncApplicationBrandIcon,
} from './macDockIcon';

// 品牌图标的原生同步领域逻辑：favicon、Windows/macOS 原生图标应用、
// 远端品牌资源加载与设置面板的选择流程。App.tsx 只保留接线。
export function useBrandIconSync(runtimePlatform: string) {
  const { t } = useI18n();
  const brandIconId = useStore(state => state.brandIconId);
  const setBrandIconId = useStore(state => state.setBrandIconId);
  const brandAssetRevision = useSyncExternalStore(subscribeBrandAssets, getBrandAssetsRevision);
  // Suppresses the brand-icon sync effect while the explicit selection flow is
  // applying the same icon through the native bridge, so the shortcut update
  // and window identity rotation run exactly once.
  const windowsBrandIconApplyingRef = useRef<BrandIconId | null>(null);
  // 重启确认框去重：连续切换连续失败时 antd 静态 confirm 会叠加多个弹窗。
  const restartConfirmActiveRef = useRef(false);

  // Apply the selected brand mascot to the favicon and supported native OS surfaces.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const href = resolveBrandIconSrc(brandIconId);
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon'][data-brand-icon='true']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      link.setAttribute('data-brand-icon', 'true');
      document.head.appendChild(link);
    }
    // The current ribbon assets are SVG, while the restored 0.9.7 mascot
    // assets are lossless WebP files. Keep the favicon MIME in sync with
    // the selected asset so browsers do not discard the mascot icon.
    link.type = /\.webp(?:[?#]|$)/i.test(href) ? 'image/webp' : 'image/svg+xml';
    link.href = href;

    // Windows restores the persisted native icon before the Wails window is
    // shown. A second bridge call here can race an explicit picker selection
    // and apply the old icon after the new selection succeeds.
    if (runtimePlatform === 'windows') {
      return;
    }

    let cancelled = false;
    const applyNativeIcon = async () => {
      try {
        const environment = await Environment();
        if (cancelled || !shouldSyncApplicationBrandIcon(environment)) {
          return;
        }
        const dockHref = resolveBrandNativeSrc(brandIconId);
        // The compact fallback is suitable for UI placeholders, but it
        // must never become the cached Windows taskbar or macOS Dock icon.
        if (!dockHref) return;
        const b64 = runtimePlatform === 'windows'
          ? await composeWindowsNativeIconBase64(dockHref)
          : await composeMacOSDockIconBase64(dockHref, {
            // 严格 Apple 网格：全家族统一 1024 画布 / 824 内容区 / Apple 圆角，
            // 与烘焙进 icns 的图标和相邻应用对齐。缎带 SVG 的 20% 呼吸边距按
            // zoom 裁掉填满网格；吉祥物 webp 先铺白色圆角底再叠图，自身圆角
            // 小于 Apple 弧线的角缺口不会透出壁纸。
            inset: APPLE_DOCK_ICON_GRID_INSET,
            zoom: resolveBrandNativeIconZoom(brandIconId),
            fillTileBackground: resolveBrandIcon(brandIconId).mascot === true,
          });
        if (cancelled) return;
        const result = await SetApplicationBrandIcon(b64);
        if (!result.success && !cancelled) {
          console.warn('Failed to update the native application icon:', result.message);
          message.warning(t('app.settings.entry.brand_icon.native_sync_failed'));
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('Failed to update the native application icon:', error);
          message.warning(t('app.settings.entry.brand_icon.native_sync_failed'));
        }
      }
    };
    void applyNativeIcon();
    return () => {
      cancelled = true;
    };
  }, [brandIconId, brandAssetRevision, runtimePlatform, t]);

  // 启动即拉取缎带 SVG、当前选中图标的资源，并后台补齐选择器全部预览资源：
  // 若吉祥物等到打开选择器才下载，首次打开会先渲染一排深色占位剪影，
  // 资源到达后才突变为真图。预取走 GetBrandIconDataURL 的磁盘缓存，
  // 只有首次安装或清缓存后才真正联网；about / titlebar 仍只在选中后拉取。
  useEffect(() => {
    void ensureBrandAssets(startupBrandAssetKeys(brandIconId));
    void ensureBrandAssets(previewBrandAssetKeys());
  }, [brandIconId]);

  const handleBrandIconChange = useCallback(async (id: BrandIconId) => {
    if (id === brandIconId) return;
    const previousId = brandIconId;
    if (runtimePlatform !== 'windows') {
      setBrandIconId(id);
      message.success(t('app.settings.entry.brand_icon.applied'));
      return;
    }

    // Windows writes the new ICO onto existing shortcuts and the live window.
    // The process, live window, and recognized GoNavi pin all keep the same
    // stable Syngnat.GoNavi AppUserModelID — only the icon bitmap changes, so
    // pinned buttons keep launching this process instead of splitting.
    windowsBrandIconApplyingRef.current = id;
    setBrandIconId(id);
    try {
      let source = resolveBrandNativeSrc(id);
      if (!source) {
        // 远端品牌资源可能还没下载完成（首屏加载失败/离线）。重试一次；
        // 仍不可用就必须如实回退并警告——绝不能弹「已应用」却什么都不改。
        await ensureBrandAssets(brandAssetKeysFor(id));
        source = resolveBrandNativeSrc(id);
        if (!source) {
          throw Object.assign(new Error(t('app.settings.entry.brand_icon.asset_not_ready')), { assetNotReady: true });
        }
      }
      // Windows fills the whole taskbar tile; the macOS Dock safe-area
      // inset would shrink the ICO mark relative to neighbouring apps.
      // The composed ICO is shared by the window, the taskbar and every
      // shortcut, so bundled mascots keep their full artwork (tile and
      // word mark) exactly as shown in the picker - cutting the tile away
      // made the desktop and Start Menu shortcuts look unfinished.
      // The zoom normalizes each asset family's designed framing (ribbon
      // breathing margin, mascot white margins) so the visible artwork
      // reads at the same size as the picker preview; without it the
      // ribbon tile lands at ~80% of the tile and users read the icon as
      // a size smaller than neighbouring apps.
      const b64 = await composeWindowsNativeIconBase64(source, {
        zoom: resolveBrandNativeIconZoom(id),
      });
      const result = await SetApplicationBrandIcon(b64);
      if (!result || result.success === false) {
        throw new Error(result?.message || 'Windows brand icon update failed');
      }
      message.success(t('app.settings.entry.brand_icon.applied'));
      // 固定项按钮重建失败时，热应用覆盖不了已固定的任务栏按钮（Explorer
      // 快照不重采样）；引导用户重启应用，让按钮按新快捷方式重建。复用
      // f71b318b 时代的重启文案与 RestartApplication 绑定。
      const restartRecommended = (result?.data as { restartRecommended?: boolean } | undefined)?.restartRecommended === true;
      if (restartRecommended && !restartConfirmActiveRef.current) {
        restartConfirmActiveRef.current = true;
        Modal.confirm({
          title: t('app.settings.entry.brand_icon.windows_restart.title'),
          content: t('app.settings.entry.brand_icon.windows_restart.description'),
          okText: t('app.settings.entry.brand_icon.windows_restart.now'),
          cancelText: t('app.settings.entry.brand_icon.windows_restart.later'),
          // 无论确定/取消/ESC 关闭后才允许再弹，避免连续失败时弹窗堆叠。
          afterClose: () => { restartConfirmActiveRef.current = false; },
          onOk: async () => {
            // RestartApplication 返回 QueryResult 不抛异常：子进程拉起失败
            // 时必须显式报错，否则用户以为在重启、实际毫无动静。
            const res = await RestartApplication();
            if (res && res.success === false) {
              message.error(res.message || t('common.unknown'));
            }
          },
        });
      }
    } catch (error) {
      // 只有当没有更新的选择接管时才回退：A 失败时用户可能已经改选 B，
      // 无条件回退会把过期的 previousId 写回 store——随后 B 成功时选择器
      // 显示旧图标、原生表面已是 B，直到下一次选择才收敛。
      if (windowsBrandIconApplyingRef.current === id) {
        setBrandIconId(previousId);
      }
      const isAssetNotReady = typeof error === 'object' && error !== null && (error as { assetNotReady?: boolean }).assetNotReady === true;
      if (!isAssetNotReady) {
        console.warn('Failed to apply the Windows brand icon:', error);
      }
      if (isAssetNotReady) {
        message.warning(error instanceof Error ? error.message : t('app.settings.entry.brand_icon.asset_not_ready'));
      } else {
        message.error(t('app.settings.entry.brand_icon.native_sync_failed'));
      }
    } finally {
      if (windowsBrandIconApplyingRef.current === id) {
        windowsBrandIconApplyingRef.current = null;
      }
    }
  }, [brandIconId, runtimePlatform, setBrandIconId, t]);

  return { brandIconId, handleBrandIconChange };
}
