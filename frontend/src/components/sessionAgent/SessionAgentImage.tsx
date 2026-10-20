import React from 'react';
import { Tooltip } from 'antd';
import { fileDisplayName, localFilePath } from './sessionAgentFileLinks';
import { wailsSessionAgentApi } from './sessionAgentApi';
import { SessionAgentFileLink } from './SessionAgentFileLink';

/**
 * 正文里的本机图片。webview 不能直接加载本机路径（站点相对路径与
 * file:// 都会被拦掉，实测图片只剩 alt 文本），所以由后端把图片读成
 * data URL 再显示。
 *
 * 读取失败（文件没了、类型不支持、超过大小上限）时降级成文件卡片，
 * 至少还留个文件名和路径，不至于整段空白。
 */

/** 图片加载器（默认走 Wails 绑定；测试可注入）。 */
export type SessionAgentImageLoader = (path: string) => Promise<string>;

/** data URL 缓存：同一张图在详情里可能重复出现。 */
const dataUrlCache = new Map<string, string>();

/** 清空缓存（会话切换时不需要，图片是全局路径，缓存可长期复用）。 */
export const clearSessionAgentImageCache = (): void => {
  dataUrlCache.clear();
};

const loadDataUrl = async (path: string, loader: SessionAgentImageLoader): Promise<string> => {
  const cached = dataUrlCache.get(path);
  if (cached) return cached;
  const dataUrl = await loader(path);
  if (dataUrl) dataUrlCache.set(path, dataUrl);
  return dataUrl;
};

export const SessionAgentImage: React.FC<{
  /** 本机图片路径（盘符绝对路径）。 */
  path: string;
  alt?: string;
  loadImage?: SessionAgentImageLoader;
}> = ({ path, alt, loadImage }) => {
  const loader = loadImage ?? wailsSessionAgentApi.imageDataUrl;
  const [dataUrl, setDataUrl] = React.useState<string>('');
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setDataUrl('');
    setFailed(false);
    if (!path) {
      setFailed(true);
      return () => {
        cancelled = true;
      };
    }
    void loadDataUrl(path, loader).then((url) => {
      if (cancelled) return;
      if (url) setDataUrl(url);
      else setFailed(true);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [path, loader]);

  const filePath = localFilePath(path);
  const name = fileDisplayName(filePath);

  if (failed) {
    return <SessionAgentFileLink href={filePath} label={alt} />;
  }
  if (!dataUrl) {
    return (
      <span className="gn-session-agent-image is-loading" data-session-agent-image="loading">
        {name}
      </span>
    );
  }
  return (
    <Tooltip title={filePath}>
      <img
        className="gn-session-agent-image"
        data-session-agent-image="true"
        src={dataUrl}
        alt={alt || name}
        loading="lazy"
      />
    </Tooltip>
  );
};
