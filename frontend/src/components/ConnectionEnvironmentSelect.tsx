import React from 'react';
import { Select } from 'antd';
import type { SelectProps } from 'antd';

import { t } from '../i18n';
import type { ConnectionEnvironmentType } from '../types';
import { getConnectionEnvironmentOptions } from '../utils/connectionEnvironment';

type ConnectionEnvironmentSelectProps = Omit<
  SelectProps<ConnectionEnvironmentType>,
  'options'
>;

const ConnectionEnvironmentSelect: React.FC<ConnectionEnvironmentSelectProps> = (props) => (
  <Select
    {...props}
    data-connection-environment-select="true"
    options={getConnectionEnvironmentOptions(t).map((option) => ({
      value: option.value,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              flex: '0 0 8px',
              borderRadius: '50%',
              background: option.color,
              boxShadow: `0 0 0 2px ${option.color}20`,
            }}
          />
          <span>{option.label}</span>
        </span>
      ),
    }))}
  />
);

export default ConnectionEnvironmentSelect;
