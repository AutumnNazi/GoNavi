import { CopyOutlined } from '@ant-design/icons';
import type { DataGridCopyMenuGroup } from './useDataGridCopyContent';
import { V2TableContextMenuItem } from '../../v2ContextMenu/v2ContextMenuPrimitives';

export const DataGridCopyContentMenu = ({ groups, onCopied }: {
  groups: readonly DataGridCopyMenuGroup[];
  onCopied?: () => void;
}) => <>{groups.map((group) => (
  <section key={group.scope} data-grid-copy-scope={group.scope}>
    <div className="gn-v2-context-menu-section-title">{group.label}</div>
    {group.items.map((item) => (
      <V2TableContextMenuItem
        key={item.content}
        item={{ action: `copy-${group.scope}-${item.content}`, title: item.label, disabled: item.disabled, icon: <CopyOutlined /> }}
        onAction={() => { item.onClick(); onCopied?.(); }}
      />
    ))}
  </section>
))}</>;
