/** Every lifecycle state the manager can report; keys stay literal so the i18n invariant can resolve them. */
export const PLUGIN_STATE_KEYS = [
  'plugin.state.disabled',
  'plugin.state.starting',
  'plugin.state.running',
  'plugin.state.stopping',
  'plugin.state.faulted',
  'plugin.state.blocked',
] as const;
