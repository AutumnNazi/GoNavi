import React from 'react';
import { Input } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

import { t } from '../../i18n';

interface SettingsCenterTreeSearchProps {
  value: string;
  /** Number of top-level groups left after filtering; drives the empty state. */
  resultCount: number;
  onChange: (value: string) => void;
  /** ArrowDown from the box moves keyboard focus into the tree. */
  onArrowDown: () => void;
  /** Enter opens the first match. */
  onEnter: () => void;
}

const SettingsCenterTreeSearch: React.FC<SettingsCenterTreeSearchProps> = ({
  value,
  resultCount,
  onChange,
  onArrowDown,
  onEnter,
}) => {
  const showEmpty = value.trim().length > 0 && resultCount === 0;
  const label = t('app.settings.search.placeholder');

  return (
    <div className="gonavi-settings-center-tree-search">
      <Input
        size="small"
        allowClear
        prefix={<SearchOutlined aria-hidden="true" />}
        placeholder={label}
        aria-label={label}
        value={value}
        data-settings-tree-search="true"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value) {
            event.preventDefault();
            event.stopPropagation();
            onChange('');
            return;
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            onArrowDown();
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            onEnter();
          }
        }}
      />
      {showEmpty ? (
        <div className="gonavi-settings-center-tree-search-empty" role="status">
          {t('app.settings.search.empty')}
        </div>
      ) : null}
    </div>
  );
};

export default SettingsCenterTreeSearch;
