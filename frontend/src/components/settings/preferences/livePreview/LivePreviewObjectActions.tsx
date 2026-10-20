import { useOptionalI18n } from '../../../../i18n/provider';
import { t as defaultTranslate } from '../../../../i18n';
import WorkbenchToolbarObjectActions, { type WorkbenchToolbarObjectActionItem } from '../../../../appShell/layout/WorkbenchToolbarObjectActions';
import {
  TitlebarTableIcon, TitlebarViewIcon, TitlebarFunctionIcon, TitlebarEventIcon,
  TitlebarSavedQueryIcon, TitlebarBackupIcon, TitlebarOpenTableIcon, TitlebarDesignTableIcon,
  TitlebarImportIcon, TitlebarExportIcon, TitlebarErModelIcon, TitlebarExternalSqlIcon,
} from '../../../titlebar/gonaviTitlebarObjectIcons';

type Props = { onOpenTable: () => void; onLocalAction: () => void };
export function LivePreviewObjectActions({ onOpenTable, onLocalAction }: Props) {
  const t = useOptionalI18n()?.t ?? defaultTranslate;
  const definitions = [
    ['tables', TitlebarTableIcon], ['views', TitlebarViewIcon], ['functions', TitlebarFunctionIcon],
    ['events', TitlebarEventIcon], ['saved_queries', TitlebarSavedQueryIcon], ['backup', TitlebarBackupIcon],
    ['open_table', TitlebarOpenTableIcon], ['design_table', TitlebarDesignTableIcon],
    ['import_wizard', TitlebarImportIcon], ['export_wizard', TitlebarExportIcon],
    ['model', TitlebarErModelIcon], ['external_sql', TitlebarExternalSqlIcon],
  ] as const;
  const items = definitions.flatMap(([key, Icon]): WorkbenchToolbarObjectActionItem[] => {
    const label = t(`workbench.toolbar.${key}`);
    const button: WorkbenchToolbarObjectActionItem = { type: 'button', key, label, title: label,
      icon: <Icon size="100%" />, disabled: false, onClick: key === 'open_table' || key === 'tables' ? onOpenTable : onLocalAction };
    return ['open_table', 'import_wizard', 'model', 'external_sql'].includes(key)
      ? [{ type: 'divider', key: `divider-${key}` }, button] : [button];
  });
  return <WorkbenchToolbarObjectActions items={items} />;
}
