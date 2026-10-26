export interface PackagedSkillDescriptor {
  pluginId: string;
  id: string;
  name: string;
  description: string;
  entry: string;
  resources?: string[];
  version: string;
  digest: string;
  generation: number;
  available: boolean;
  reason?: string;
}
export interface PackagedSkillContent {
  pluginId: string;
  skillId: string;
  name: string;
  description: string;
  version: string;
  digest: string;
  generation: number;
  content: string;
  resource?: string;
}
