import type { PrincipalDraft } from '../userManagementDraft';
import type { UMOptionDescriptor, UMServerProfile } from '../userManagementTypes';
import OptionField from './OptionField';

interface OptionsFormProps {
  profile: UMServerProfile;
  draft: PrincipalDraft;
  tab: string;
  writable: boolean;
  onChange: (id: string, value: string) => void;
  exclude?: string[];
}

export const optionsForTab = (profile: UMServerProfile, draft: PrincipalDraft, tab: string, exclude: string[] = []): UMOptionDescriptor[] => (
  profile.options.filter((option) => option.tab === tab
    && !exclude.includes(option.id)
    && (option.kinds.length === 0 || option.kinds.includes(draft.kind)))
);

/** 渲染某个编辑页下适用于当前主体种类的全部属性字段。 */
export default function OptionsForm({ profile, draft, tab, writable, onChange, exclude }: OptionsFormProps) {
  const options = optionsForTab(profile, draft, tab, exclude);
  if (options.length === 0) return null;
  return (
    <div className="gn-user-mgmt-form-grid">
      {options.map((descriptor) => (
        <OptionField
          key={descriptor.id}
          descriptor={descriptor}
          value={draft.options[descriptor.id] ?? ''}
          disabled={!writable || descriptor.readOnly === true || (descriptor.createOnly === true && draft.mode === 'edit')}
          onChange={(value) => onChange(descriptor.id, value)}
        />
      ))}
    </div>
  );
}
