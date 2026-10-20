// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DataGridColumnTitle, { type DataGridColumnTitleProps } from './DataGridColumnTitle';

const renderTitle = (props: Partial<DataGridColumnTitleProps> = {}) => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <DataGridColumnTitle
      columnName="visitor_id"
      columnMeta={{ type: 'bigint(20)', comment: '访客基本信息 ID', key: 'MUL' }}
      showColumnType
      showColumnComment
      metaFontSize={11}
      columnMetaHintColor="#595959"
      columnMetaTooltipColor="#262626"
      darkMode={false}
      {...props}
    />,
  );
  const title = container.querySelector<HTMLElement>('.gn-v2-column-title');
  expect(title).not.toBeNull();
  return title!;
};

describe('DataGridColumnTitle metadata layout', () => {
  it.each([false, true])('keeps metadata on separate rows for foreign key = %s', (hasForeignKey) => {
    const title = renderTitle({
      foreignKeyTarget: hasForeignKey ? { refTableName: 'visitors', refColumnName: 'id' } : undefined,
    });
    const heading = title.querySelector('.gn-v2-column-title-heading');
    const type = title.querySelector('.gn-v2-column-title-type');
    const comment = title.querySelector('.gn-v2-column-title-comment');

    expect(heading?.textContent).toBe('visitor_id');
    expect(type?.parentElement).toBe(title);
    expect(comment?.parentElement).toBe(title);
    expect(Array.from(title.children)).toEqual([heading, type, comment]);
    expect(title.style.flexDirection).toBe('column');
    expect(type?.textContent).toBe('bigint(20)');
  });

  it.each([
    { showColumnType: true, showColumnComment: false, singleLine: false },
    { showColumnType: false, showColumnComment: true, singleLine: false },
    { showColumnType: false, showColumnComment: false, singleLine: true },
  ])('handles metadata visibility: %j', ({ singleLine, ...props }) => {
    const title = renderTitle(props);

    expect(title.classList.contains('is-single-line')).toBe(singleLine);
    expect(title.querySelector('.gn-v2-column-title-heading')?.textContent).toBe('visitor_id');
    expect(Boolean(title.querySelector('.gn-v2-column-title-type'))).toBe(props.showColumnType);
    expect(Boolean(title.querySelector('.gn-v2-column-title-comment'))).toBe(props.showColumnComment);
  });

  it('keeps a name-only header on one line when metadata is unavailable', () => {
    const title = renderTitle({ columnMeta: { type: '', comment: '' } });

    expect(title.classList.contains('is-single-line')).toBe(true);
    expect(title.children).toHaveLength(1);
  });
});
