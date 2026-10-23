import { PluginAPIError } from '../apiResult';
export function packagedSkillErrorKey(cause: unknown): string {
  return cause instanceof PluginAPIError ? cause.key : 'plugin.skills.error.unavailable';
}
