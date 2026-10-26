import { Alert, Button, Table, Typography } from 'antd';
import type { JSONValue, UINode } from './types';

interface Props { node: UINode; disabled: boolean; invoke: (command: string, args: JSONValue) => void }
export function DeclarativeNode({ node, disabled, invoke }: Props) {
  if (node.type === 'text') return <Typography.Paragraph>{node.text ?? node.title}</Typography.Paragraph>;
  if (node.type === 'alert') return <Alert type="info" showIcon message={node.title ?? node.text} description={node.title ? node.text : undefined} />;
  if (node.type === 'button') return <Button disabled={disabled} onClick={() => invoke(node.command!, node.arguments ?? {})}>{node.title ?? node.text ?? node.command}</Button>;
  if (node.type === 'table') return <Table size="small" pagination={{ pageSize: 20, hideOnSinglePage: true }} scroll={{ x: true }}
    rowKey={(_, index) => String(index)} dataSource={node.rows}
    columns={node.columns?.map((col) => ({ title: col.title, key: col.key,
      render: (_: unknown, row: Record<string, JSONValue>) => { const value = row[col.key]; return typeof value === 'string' ? value : JSON.stringify(value ?? null); },
    }))} />;
  return <div className={node.type === 'row' ? 'plugin-ui-row' : 'plugin-ui-column'}>
    {node.children?.map((child, index) => <DeclarativeNode key={index} node={child} disabled={disabled} invoke={invoke} />)}
  </div>;
}
