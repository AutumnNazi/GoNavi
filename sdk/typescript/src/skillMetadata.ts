function declaredSkillText(value: string, limit: number): boolean {
  return value.trim() !== '' && !value.includes('\0') && new TextEncoder().encode(value).length <= limit;
}

export function validateSkillMetadata(skill: { name: string; description: string }): void {
  if (!declaredSkillText(skill.name, 256)) throw new Error('invalid skill name');
  if (!declaredSkillText(skill.description, 2048)) throw new Error('invalid skill description');
}
