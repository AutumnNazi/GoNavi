import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderSidebarV2TreeTitle } from './SidebarTreeTitle';

const baseOptions = {
  hoverTitle: 'Oracle object',
  connectionStatus: undefined,
  getV2TreeMetaText: () => '',
  sidebarTableMetadataFields: [],
};

describe('Oracle object compilation status in the V2 sidebar tree', () => {
  it('renders an invalid compiler-status badge for a trigger', () => {
    const markup = renderToStaticMarkup(renderSidebarV2TreeTitle({
      ...baseOptions,
      node: {
        type: 'db-trigger',
        key: 'oracle-trigger',
        title: 'TRG_AUDIT',
        dataRef: { objectStatus: 'INVALID' },
      },
    }));

    expect(markup).toContain('gn-v2-tree-object-status is-invalid');
    expect(markup).toContain('data-sidebar-object-status="INVALID"');
  });
});

describe('message queue nodes in the V2 sidebar tree', () => {
  it('leaves message-object dragging to the unified tree source', () => {
    const markup = renderToStaticMarkup(renderSidebarV2TreeTitle({
      ...baseOptions,
      node: {
        type: 'message-object',
        key: 'mqtt-topic',
        title: 'devices/+/telemetry',
        dataRef: {
          messageQueue: true,
          messageObjectName: 'devices/+/telemetry',
          messageObjectKind: 'topic-filter',
        },
      },
    }));

    expect(markup).not.toContain('draggable="true"');
    expect(markup).toContain('data-sidebar-node-type="message-object"');
    expect(markup).toContain('is-mono');
  });
});
