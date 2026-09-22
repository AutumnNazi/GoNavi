import { createPortal } from 'react-dom';

import TitleBarQuickActions, { type TitleBarQuickAction } from './TitleBarQuickActions';

interface TitleBarQuickActionsHostProps {
  label: string;
  actions: TitleBarQuickAction[];
  trailingActions?: TitleBarQuickAction[];
}

const findSlot = (id: string): HTMLElement | null => (
  typeof document === 'undefined' ? null : document.getElementById(id)
);

/**
 * 工具入口和「关于」分开放，标题栏才能把「视图」插在「关于」前面。
 */
export default function TitleBarQuickActionsHost({
  label,
  actions,
  trailingActions,
}: TitleBarQuickActionsHostProps) {
  const quickTarget = findSlot('gonavi-titlebar-quick-actions');
  const aboutTarget = findSlot('gonavi-titlebar-about-action');
  if (!quickTarget) {
    return null;
  }
  if (!aboutTarget || !trailingActions?.length) {
    return createPortal(
      <TitleBarQuickActions label={label} actions={actions} trailingActions={trailingActions} />,
      quickTarget,
    );
  }
  return (
    <>
      {createPortal(
        <TitleBarQuickActions label={label} actions={actions} />,
        quickTarget,
      )}
      {createPortal(
        <TitleBarQuickActions label={label} actions={trailingActions} />,
        aboutTarget,
      )}
    </>
  );
}
