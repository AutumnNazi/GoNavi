import { PluginSkills, PluginSkillRead, PluginSkillResourceRead } from '../../../wailsjs/go/app/App';
import { PluginAPIError, pluginResult } from '../apiResult';
import { decodePackagedSkills, decodePackagedSkillContent } from './decode';
import type { PackagedSkillDescriptor } from './types';

export const packagedSkillAPI = {
  list: () => pluginResult(PluginSkills(), decodePackagedSkills),
  read: async (skill: PackagedSkillDescriptor) => {
    const expected = decodePackagedSkills({ items: [skill] })[0];
    if (!expected.available || expected.generation <= 0) throw new PluginAPIError('plugin.skills.error.unavailable');
    return pluginResult(PluginSkillRead(expected.pluginId, expected.id, expected.digest, expected.generation), (data) => decodePackagedSkillContent(data, expected));
  },
  readResource: async (skill: PackagedSkillDescriptor, resource: string) => {
    const expected = decodePackagedSkills({ items: [skill] })[0];
    if (!expected.available || expected.generation <= 0 || !expected.resources?.includes(resource)) throw new PluginAPIError('plugin.skills.error.unavailable');
    return pluginResult(PluginSkillResourceRead(expected.pluginId, expected.id, expected.digest, resource, expected.generation), (data) => {
      const decoded = decodePackagedSkillContent(data, expected);
      if (decoded.resource !== resource) throw new PluginAPIError('plugin.skills.error.stale');
      return decoded;
    });
  },
};
