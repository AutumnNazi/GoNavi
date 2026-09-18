import React from 'react';

import type { SettingsCenterTreeGroup, SettingsCenterTreeItem } from './SettingsCenterTreeNav';

export const normalizeSettingsCenterSearchQuery = (query: string): string => (
  query.trim().toLocaleLowerCase()
);

const includesQuery = (text: string, normalizedQuery: string): boolean => (
  text.toLocaleLowerCase().includes(normalizedQuery)
);

const nodeMatches = (
  node: { title: string; description: string },
  normalizedQuery: string,
): boolean => (
  includesQuery(node.title, normalizedQuery) || includesQuery(node.description, normalizedQuery)
);

const filterSettingsCenterTreeItems = (
  items: ReadonlyArray<SettingsCenterTreeItem>,
  normalizedQuery: string,
): SettingsCenterTreeItem[] => items.flatMap((item) => {
  // A matching node keeps its whole subtree so the user still sees its context.
  if (nodeMatches(item, normalizedQuery)) {
    return [item];
  }
  const children = item.children
    ? filterSettingsCenterTreeItems(item.children, normalizedQuery)
    : [];
  return children.length > 0 ? [{ ...item, children }] : [];
});

/**
 * Keep groups / items whose title or description contains the query, plus the
 * ancestors that lead to them. Keys and `onClick` handlers are preserved, so
 * selection and activation keep working on the filtered tree.
 */
export const filterSettingsCenterTreeGroups = (
  groups: ReadonlyArray<SettingsCenterTreeGroup>,
  query: string,
): ReadonlyArray<SettingsCenterTreeGroup> => {
  const normalizedQuery = normalizeSettingsCenterSearchQuery(query);
  if (!normalizedQuery) {
    return groups;
  }
  return groups.flatMap((group) => {
    if (nodeMatches(group, normalizedQuery)) {
      return [group];
    }
    const items = filterSettingsCenterTreeItems(group.items, normalizedQuery);
    return items.length > 0 ? [{ ...group, items }] : [];
  });
};

/** Wrap the first occurrence of the query in `<mark>` so hits are visible. */
export const renderSettingsCenterTreeLabel = (
  title: string,
  normalizedQuery: string,
): React.ReactNode => {
  if (!normalizedQuery) {
    return title;
  }
  const start = title.toLocaleLowerCase().indexOf(normalizedQuery);
  if (start < 0) {
    return title;
  }
  const end = start + normalizedQuery.length;
  return (
    <>
      {title.slice(0, start)}
      <mark className="gonavi-settings-center-tree-highlight">{title.slice(start, end)}</mark>
      {title.slice(end)}
    </>
  );
};
