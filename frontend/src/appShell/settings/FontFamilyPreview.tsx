import { useId, type CSSProperties } from 'react';
import { theme } from 'antd';
import { CodeOutlined, FontSizeOutlined } from '@ant-design/icons';
import './FontFamilyPreview.css';

interface Props {
  kind: 'ui' | 'mono';
  family: string;
  name: string;
  t: (key: string) => string;
}

const sqlTokens = (line: string) => line.split(/('(?:''|[^'])*'|\b(?:SELECT|FROM|WHERE|GROUP|BY|AS|COUNT)\b)/g);

function HighlightedSQL({ source }: { source: string }) {
  return <div className="gonavi-font-specimen-sql">
    {source.split('\n').map((line, index) => (
      <div className="gonavi-font-specimen-line" key={index}>
        <span className="gonavi-font-specimen-line-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <code>{sqlTokens(line).map((token, part) => token && (
          <span key={part} className={token.startsWith("'") ? 'is-string' : /^(SELECT|FROM|WHERE|GROUP|BY|AS|COUNT)$/.test(token) ? 'is-keyword' : undefined}>{token}</span>
        ))}</code>
      </div>
    ))}
  </div>;
}

export function FontFamilyPreview({ kind, family, name, t }: Props) {
  const { token } = theme.useToken();
  const id = useId();
  const style: CSSProperties & Record<string, string> = {
    '--font-preview-bg': token.colorBgContainer,
    '--font-preview-subtle': token.colorFillAlter,
    '--font-preview-border': token.colorBorderSecondary,
    '--font-preview-text': token.colorText,
    '--font-preview-muted': token.colorTextSecondary,
    '--font-preview-accent': token.colorPrimary,
    '--font-preview-string': token.colorSuccessText,
  };
  return <section className="gonavi-font-preview" style={style} aria-labelledby={id}>
    <div className="gonavi-font-specimen-header">
      <span className="gonavi-font-specimen-caption" id={id}>
        {kind === 'mono' ? <CodeOutlined aria-hidden="true" /> : <FontSizeOutlined aria-hidden="true" />}
        {t('app.theme.font_family.preview')}
      </span>
      <span className="gonavi-font-specimen-family" title={name}>{name}</span>
    </div>
    <div className="gonavi-font-preview-sample" style={{ fontFamily: family }}>
      {kind === 'ui' ? <div className="gonavi-font-specimen-ui">
        <div className="gonavi-font-specimen-copy">
          <div className="gonavi-font-specimen-title">{t('app.theme.font_family.specimen.ui_title')}</div>
          <div className="gonavi-font-specimen-description">{t('app.theme.font_family.specimen.ui_description')}</div>
        </div>
        <span className="gonavi-font-specimen-glyph" aria-hidden="true">{t('app.theme.font_family.specimen.glyph')}</span>
      </div> : <HighlightedSQL source={t('app.theme.font_family.specimen.sql')} />}
      <div className="gonavi-font-specimen-footer">
        <span className="gonavi-font-specimen-footer-label">{t('app.theme.font_family.specimen.characters')}</span>
        <span className="gonavi-font-specimen-character-sample">{t(kind === 'mono' ? 'app.theme.font_family.specimen.code_characters' : 'app.theme.font_family.specimen.ui_characters')}</span>
      </div>
    </div>
  </section>;
}
