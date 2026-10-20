import { getDbIcon } from '../DatabaseIcons';
import { buildConnectionTypeGroups } from '../../utils/connectionTypeCatalog';

export function buildPickerTypeGroups(translate: NonNullable<Parameters<typeof buildConnectionTypeGroups>[0]>) {
  const groups = buildConnectionTypeGroups(translate).map(group => ({
    ...group, items: group.items.map(item => ({ ...item, icon: getDbIcon(item.key, undefined, 32) })),
  }));
  const seen = new Set<string>();
  const items = groups.flatMap(group => group.items).filter(item => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
  return [{ labelKey: 'connection_modal.step1.group.all', label: translate('connection.modal.step1.group.all'), items }, ...groups];
}
