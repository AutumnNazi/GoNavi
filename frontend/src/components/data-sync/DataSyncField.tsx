import React from 'react';

/**
 * The labeled field wrapper used across the data sync task editor. Extracted so
 * feature panels split out of `DataSyncTaskEditor.tsx` can keep the same markup.
 */
export const DataSyncField: React.FC<{
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}> = ({ label, children, wide = false }) => (
  <label className="gn-data-sync-field" data-wide={wide ? 'true' : 'false'}>
    <span>{label}</span>
    {children}
  </label>
);
