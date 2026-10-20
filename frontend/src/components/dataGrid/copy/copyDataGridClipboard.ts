import { message } from 'antd';
import { writeClipboardPayload, type DataGridClipboardPayload } from '../../dataGridClipboardPayload';

export const copyDataGridClipboard = async (
  value: string | DataGridClipboardPayload,
  translate: (key: string) => string,
): Promise<void> => {
  const payload = typeof value === 'string' ? { plainText: value } : value;
  if (!payload.plainText) return;
  try {
    await writeClipboardPayload(payload);
    void message.success(translate('data_grid.message.copied_to_clipboard'));
  } catch {
    void message.error(translate('table_designer.message.clipboard_write_failed'));
  }
};
