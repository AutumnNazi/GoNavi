import { SelectPluginPackageDirectory, SelectPluginPackageFile } from '../../../wailsjs/go/app/App';
import { isRecord } from '../../plugins/jsonBoundary';
import { isWebRuntime } from '../../utils/browserFileTransfer';

export type PluginPackagePick =
  | { status: 'selected'; path: string }
  | { status: 'canceled' }
  | { status: 'failed' };

// The backend returns Success=false with a stable code for both cancellation and
// failures, so the panel can stay silent on cancel without parsing messages.
const decode = (result: unknown): PluginPackagePick => {
  if (!isRecord(result)) return { status: 'failed' };
  const data = isRecord(result.data) ? result.data : {};
  if (result.success === true && typeof data.path === 'string' && data.path.trim()) {
    return { status: 'selected', path: data.path.trim() };
  }
  if (data.code === 'cancelled') return { status: 'canceled' };
  return { status: 'failed' };
};

export const pickPluginPackageFile = async (currentPath: string): Promise<PluginPackagePick> => {
  if (isWebRuntime()) return { status: 'canceled' };
  try {
    return decode(await SelectPluginPackageFile(currentPath));
  } catch {
    return { status: 'failed' };
  }
};

export const pickPluginPackageDirectory = async (currentPath: string): Promise<PluginPackagePick> => {
  if (isWebRuntime()) return { status: 'canceled' };
  try {
    return decode(await SelectPluginPackageDirectory(currentPath));
  } catch {
    return { status: 'failed' };
  }
};
