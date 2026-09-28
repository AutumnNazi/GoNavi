import { Modal, Radio, Space, Typography } from 'antd';
import { useI18n } from '../../i18n/provider';
import {
  actionHelperKey,
  actionLabelKey,
  availableSessionActions,
  type DatabaseSession,
  type SessionAction,
  type SessionCapability,
} from './sessionWorkbenchModel';

export interface SessionActionChooserProps {
  open: boolean;
  session: DatabaseSession | null;
  capability: SessionCapability;
  onSelect: (action: SessionAction) => void;
  onCancel: () => void;
}

export default function SessionActionChooser({
  open,
  session,
  capability,
  onSelect,
  onCancel,
}: SessionActionChooserProps) {
  const { t } = useI18n();
  if (!session) return null;
  const actions = availableSessionActions(capability, session);
  return (
    <Modal
      open={open}
      title={t('session_workbench.action.choose')}
      onCancel={onCancel}
      footer={null}
      destroyOnClose
    >
      <Radio.Group
        className="gn-session-workbench-action-chooser"
        onChange={(event) => onSelect(event.target.value as SessionAction)}
      >
        <Space direction="vertical" size={12}>
          {actions.map((action) => (
            <Radio.Button
              key={action}
              value={action}
            >
              <span className="gn-session-workbench-action-option">
                <strong>{t(actionLabelKey(action))}</strong>
                <Typography.Text type="secondary">{t(actionHelperKey(action))}</Typography.Text>
              </span>
            </Radio.Button>
          ))}
        </Space>
      </Radio.Group>
    </Modal>
  );
}
