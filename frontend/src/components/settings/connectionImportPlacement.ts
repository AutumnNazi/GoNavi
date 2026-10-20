import type { ConnectionTag } from '../../types';

export type ConnectionImportGroupOption = {
  value: string;
  label: string;
};

export type ConnectionImportGroupAssignment = {
  connectionIds: string[];
  targetGroupId: string;
};

export type ConnectionImportPlacement = {
  groupAssignment: ConnectionImportGroupAssignment | null;
  manualOrderTargetGroupIds: Array<string | null>;
};

export type ConnectionImportNotice = {
  type: 'success' | 'warning';
  message: string;
};

export const buildConnectionImportGroupOptions = (
  tags: ConnectionTag[],
): ConnectionImportGroupOption[] => {
  const tagByID = new Map(tags.map((tag) => [tag.id, tag]));
  const pathCache = new Map<string, string>();

  const resolvePath = (tag: ConnectionTag, visiting = new Set<string>()): string => {
    const cached = pathCache.get(tag.id);
    if (cached) return cached;

    const name = String(tag.name || tag.id).trim() || tag.id;
    const parentID = String(tag.parentTagId || '').trim();
    if (!parentID || visiting.has(tag.id)) {
      pathCache.set(tag.id, name);
      return name;
    }
    const parent = tagByID.get(parentID);
    if (!parent) {
      pathCache.set(tag.id, name);
      return name;
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(tag.id);
    const path = `${resolvePath(parent, nextVisiting)} / ${name}`;
    pathCache.set(tag.id, path);
    return path;
  };

  return tags.map((tag) => ({
    value: tag.id,
    label: resolvePath(tag),
  }));
};

export const resolveConnectionImportPlacement = (
  connectionIDs: string[],
  targetGroupID: string,
  tags: ConnectionTag[],
): ConnectionImportPlacement => {
  const imported = Array.from(new Set(
    connectionIDs.map((connectionID) => String(connectionID || '').trim()).filter(Boolean),
  ));
  const targetGroupId = String(targetGroupID || '').trim();
  if (targetGroupId) {
    const connectionIDsAlreadyInTarget = tags.find((tag) => tag.id === targetGroupId)?.connectionIds ?? [];
    const alreadyInTarget = new Set(
      connectionIDsAlreadyInTarget
        .map((connectionID) => String(connectionID || '').trim())
        .filter(Boolean),
    );
    const connectionIds = imported.filter((connectionID) => !alreadyInTarget.has(connectionID));
    const groupAssignment = connectionIds.length > 0
      ? { connectionIds, targetGroupId }
      : null;
    return {
      groupAssignment,
      manualOrderTargetGroupIds: imported.length > 0 ? [targetGroupId] : [],
    };
  }

  const ownerByConnectionID = new Map<string, string>();
  tags.forEach((tag) => tag.connectionIds.forEach((connectionID) => {
    const normalizedConnectionID = String(connectionID || '').trim();
    if (normalizedConnectionID && !ownerByConnectionID.has(normalizedConnectionID)) {
      ownerByConnectionID.set(normalizedConnectionID, tag.id);
    }
  }));
  const manualOrderTargetGroupIds: Array<string | null> = [];
  const seenTargets = new Set<string>();
  imported.forEach((connectionID) => {
    const owner = ownerByConnectionID.get(connectionID) || null;
    const key = owner || '__root__';
    if (seenTargets.has(key)) return;
    seenTargets.add(key);
    manualOrderTargetGroupIds.push(owner);
  });
  return {
    groupAssignment: null,
    manualOrderTargetGroupIds,
  };
};
