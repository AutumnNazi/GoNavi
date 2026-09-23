import React, { useCallback, useState } from 'react';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';
import type { DataSyncBackupEditorProps } from './dataSyncBackupEditorProps';

export const DataSyncBackupOutput: React.FC<DataSyncBackupEditorProps> = ({ task, gateway, onPatch }) => {
  const tr = useOptionalI18n()?.t || translate;
  const backup = task.backup || { directory: '', content: 'both' as const };
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState('');

  // 目录必须由本机文件系统决定，用户不该手敲绝对路径。选择器取消时返回 null，
  // 此时保持原值不动；真正的失败（例如无桌面运行时）才提示，因为静默失败会让
  // 用户以为按钮坏了。
  const pickDirectory = useCallback(async () => {
    setPicking(true);
    setPickError('');
    try {
      const selected = await gateway.selectBackupDirectory(backup.directory);
      if (selected) {
        onPatch({ backup: { ...backup, directory: selected } });
      }
    } catch (error) {
      setPickError(
        error instanceof Error && error.message
          ? error.message
          : tr('data_sync.backup.directory_pick_failed'),
      );
    } finally {
      setPicking(false);
    }
  }, [backup, gateway, onPatch, tr]);

  return <section className="gn-data-sync-section gn-data-sync-backup-output">
    <h2>{tr('data_sync.backup.directory')}</h2>
    <label className="gn-data-sync-field"><span>{tr('data_sync.backup.directory')}</span>
      <div className="gn-data-sync-inline-control gn-data-sync-backup-directory-control">
        <input className="gn-data-sync-control" value={backup.directory} onChange={(event) => onPatch({ backup: { ...backup, directory: event.target.value } })} />
        <button type="button" className="gn-data-sync-button" disabled={picking} onClick={() => { void pickDirectory(); }}>{tr('data_sync.backup.directory_browse')}</button>
      </div>
      <small>{tr('data_sync.backup.directory_help')}</small>
      {pickError ? <small className="gn-data-sync-inline-error" role="alert">{pickError || tr('data_sync.backup.directory_pick_failed')}</small> : null}
    </label>
    <label className="gn-data-sync-field"><span>{tr('data_sync.backup.content')}</span>
      <select className="gn-data-sync-control" value={backup.content} onChange={(event) => onPatch({ backup: { ...backup, content: event.target.value as typeof backup.content } })}>
        <option value="both">{tr('data_sync.backup.content_both')}</option>
        <option value="schema">{tr('data_sync.backup.content_schema')}</option>
        <option value="data">{tr('data_sync.backup.content_data')}</option>
      </select>
    </label>
    <p className="gn-data-sync-inline-note" role="note">{tr('data_sync.backup.consistency')}</p>
  </section>;
};
