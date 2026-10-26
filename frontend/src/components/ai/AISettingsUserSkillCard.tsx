import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import { SKILL_SCOPE_OPTIONS } from './AISettingsUserSkillOptions';
import { AISettingsUserSkillFields, type UserSkillFieldsProps } from './AISettingsUserSkillFields';
interface Props extends UserSkillFieldsProps { overlayTheme: OverlayWorkbenchTheme; expanded: boolean; onExpandedChange: (open: boolean) => void }
export function AISettingsUserSkillCard({ overlayTheme, expanded, onExpandedChange, ...fields }: Props) {
  const { skill, copy, cardBorder } = fields;
  const scopeSummary = (skill.scopes || []).map((scope) => SKILL_SCOPE_OPTIONS.find((option) => option.value === scope))
    .filter((option): option is (typeof SKILL_SCOPE_OPTIONS)[number] => Boolean(option)).map((option) => copy(option.labelKey)).join(' / ');
  const summaryTitle = skill.name.trim() || copy('ai_settings.skill.action.add');
  return (
    <details
      key={skill.id}
      className="gonavi-ai-skill-editor"
      open={expanded}
      onToggle={(event) => onExpandedChange(event.currentTarget.open)}
      style={{ borderRadius: 4 }}
    >
      <summary style={{ cursor: 'pointer', padding: '13px 2px', color: overlayTheme.titleText }}>
        <span
          style={{
            display: 'inline-grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            alignItems: 'center',
            gap: 12,
            width: 'calc(100% - 18px)',
            marginLeft: 8,
            verticalAlign: 'middle',
          }}
        >
          <span style={{ minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 'var(--gn-settings-font-secondary, 13px)', fontWeight: 650 }}>{summaryTitle}</span>
            {(skill.description || scopeSummary) && (
              <span
                style={{
                  display: 'block',
                  marginTop: 3,
                  color: overlayTheme.mutedText,
                  fontSize: 'var(--gn-font-size-sm, 12px)',
                  lineHeight: 1.45,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {skill.description || scopeSummary}
              </span>
            )}
          </span>
          <span
            style={{
              padding: '2px 7px',
              borderRadius: 999,
              color: skill.enabled ? overlayTheme.selectedText : overlayTheme.mutedText,
              background: skill.enabled ? overlayTheme.selectedBg : 'transparent',
              border: `1px solid ${skill.enabled ? overlayTheme.selectedText : cardBorder}`,
              fontSize: 'var(--gn-font-size-sm, 12px)',
              fontWeight: 650,
              whiteSpace: 'nowrap',
            }}
          >
            {copy(skill.enabled ? 'ai_settings.skill.status.enabled' : 'ai_settings.skill.status.disabled')}
          </span>
        </span>
      </summary>

      <AISettingsUserSkillFields {...fields} />
    </details>
  );
}
