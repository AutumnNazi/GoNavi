export function validateSkillDocument(content: string): void {
  if (content.length === 0 || content.includes('\0') || new TextEncoder().encode(content).length > 64 * 1024) {
    throw new Error('skill document is empty or exceeds size limit');
  }
}
