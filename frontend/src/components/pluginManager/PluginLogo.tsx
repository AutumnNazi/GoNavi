import { useEffect, useState } from 'react';
import { PluginIcon } from '../../../wailsjs/go/app/App';

// 图标按「插件 + 版本」缓存：同一卡片重渲染、翻页回来都不再走一次绑定调用。
const iconCache = new Map<string, string>();

interface Props {
  pluginId: string;
  name: string;
  version: string;
}

/** 插件 Logo：宿主回包内的 raster 图片；没有声明或读取失败时退回首字母。 */
export function PluginLogo({ pluginId, name, version }: Props) {
  const key = `${pluginId}@${version}`;
  const [src, setSrc] = useState(() => iconCache.get(key) ?? '');
  useEffect(() => {
    if (iconCache.has(key)) {
      setSrc(iconCache.get(key) ?? '');
      return;
    }
    let alive = true;
    // 绑定调用在非 Wails 环境（纯 Web 运行时、单测）里会同步抛错，先转成拒绝再统一兜底。
    Promise.resolve()
      .then(() => PluginIcon(pluginId))
      .then((value) => {
        iconCache.set(key, value ?? '');
        if (alive) setSrc(value ?? '');
      })
      .catch(() => iconCache.set(key, ''));
    return () => { alive = false; };
  }, [key, pluginId]);
  const monogram = (name.trim().charAt(0) || '?').toUpperCase();
  return <div className="plugin-logo" data-loaded={src ? 'true' : 'false'}>
    {src
      ? <img className="plugin-logo-image" src={src} alt="" />
      : <span className="plugin-logo-monogram" aria-hidden>{monogram}</span>}
  </div>;
}
