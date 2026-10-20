import { useId } from 'react';
import { Button, Select } from 'antd';
import {
  DEFAULT_MONO_FONT_FAMILY, DEFAULT_UI_FONT_FAMILY,
  matchFontFamilyOption, sanitizeFontFamilyInput, type FontFamilyOption,
} from '../../utils/fontFamilies';
import { resolveFontSelection } from '../../utils/fontFamilyDisplay';
import './FontFamilySelect.css';
import { FontFamilyPreview } from './FontFamilyPreview';

interface FontFamilySelectProps {
  kind: 'ui' | 'mono';
  value: string | null | undefined;
  options: FontFamilyOption[];
  loading: boolean;
  onChange: (value: string | null) => void;
  t: (key: string) => string;
}

export const FontFamilySelect = ({ kind, value, options, loading, onChange, t }: FontFamilySelectProps) => {
  const id = useId();
  const isMono = kind === 'mono';
  const defaultValue = isMono ? DEFAULT_MONO_FONT_FAMILY : DEFAULT_UI_FONT_FAMILY;
  const defaultLabel = t(isMono ? 'app.theme.font_family.default_mono_option' : 'app.theme.font_family.default_ui_option');
  const label = t(isMono ? 'app.theme.font_family.mono_title' : 'app.theme.font_family.ui_title');
  const selected = resolveFontSelection(value, options, defaultValue, defaultLabel);
  const status = (option: FontFamilyOption) => {
    if (option.keywords?.includes('downloaded')) return t('app.theme.font_family.gallery.status_downloaded');
    return option.keywords?.includes('installed')
      ? t('app.theme.font_family.source_installed')
      : t('app.theme.font_family.source_preset');
  };

  return (
    <div className="gonavi-font-picker">
      <label htmlFor={id} className="gonavi-settings-label">{label}</label>
      <div className="gonavi-font-picker-controls">
        <Select<{ value: string; label: string }, FontFamilyOption>
          id={id}
          aria-label={label}
          aria-describedby={id + '-hint'}
          className="gonavi-font-picker-select"
          showSearch
          allowClear={Boolean(sanitizeFontFamilyInput(value))}
          labelInValue
          optionLabelProp="label"
          loading={loading}
          placeholder={defaultLabel}
          value={selected}
          options={options}
          filterOption={matchFontFamilyOption}
          onChange={(next) => onChange(next?.value === defaultValue ? null : sanitizeFontFamilyInput(next?.value))}
          popupMatchSelectWidth
          listHeight={288}
          optionRender={({ data }) => (
            <div className="gonavi-font-option">
              <span className="gonavi-font-option-name" title={data.label}>{data.label}</span>
              {!data.isDefault && <span className="gonavi-font-option-source">{status(data)}</span>}
            </div>
          )}
        />
        <Button type="text" disabled={!sanitizeFontFamilyInput(value)} onClick={() => onChange(null)}>
          {t('app.theme.font_family.reset')}
        </Button>
      </div>
      <FontFamilyPreview kind={kind} family={selected.value} name={selected.label} t={t} />
      <div id={id + '-hint'} className="gonavi-settings-inline-meta">
        {t('app.theme.font_family.preview_hint')}
      </div>
      <details className="gonavi-font-details">
        <summary>{t('app.theme.font_family.details')}</summary>
        <code>{selected.value}</code>
      </details>
    </div>
  );
};
