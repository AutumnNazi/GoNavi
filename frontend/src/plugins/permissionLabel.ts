const knownPermissions: Record<string, string> = {
  'ai.tools': 'plugin.permission.ai_tools',
  'ai.skills': 'plugin.permission.ai_skills',
  'ai.providers': 'plugin.permission.ai_providers',
  'data.sources': 'plugin.permission.data_sources',
  'ui.html-panel': 'plugin.permission.ui_html_panel',
  'data.export': 'plugin.permission.data_export',
  'host.log': 'plugin.permission.host_log',
  'host.describe': 'plugin.permission.host_describe',
};

export function pluginPermissionText(permission: string, t: (key: string) => string, note?: string): string {
  const custom = cleanPermissionNote(note);
  if (custom) return custom + ' (' + permission + ')';
  const key = knownPermissions[permission];
  return key ? t(key) + ' (' + permission + ')' : permission;
}

function cleanPermissionNote(note?: string): string {
  if (!note) return '';
  const trimmed = note.trim();
  if (trimmed.length === 0 || new TextEncoder().encode(note).length > 160 || /[<>\u0000-\u001f\u007f]/.test(trimmed)) return '';
  return trimmed;
}
