import { useCallback, useEffect, useRef, useState } from 'react';
import { packagedSkillAPI } from './api';
import { packagedSkillErrorKey } from './errors';
import { skillKey, skillSnapshotKey } from './decode';
import { subscribePackagedSkillInvalidation } from './invalidation';
import { SKILL_REQUEST_TIMEOUT_MS } from './usePackagedSkillCatalog';
import type { PackagedSkillDescriptor } from './types';

export function usePackagedSkillPreview(items: readonly PackagedSkillDescriptor[], active: boolean) {
  const [selection, setSelection] = useState<PackagedSkillDescriptor | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const latest = useRef({ items, active }); latest.current = { items, active };
  const selected = useRef<PackagedSkillDescriptor | null>(null);
  const mounted = useRef(true); const epoch = useRef(0); const transport = useRef(false); const cancel = useRef<() => void>();
  const close = useCallback(() => {
    epoch.current++; cancel.current?.(); selected.current = null;
    setSelection(null); setContent(null); setError(''); setLoading(false);
  }, []);
  const current = useCallback((skill: PackagedSkillDescriptor) => {
    const item = latest.current.items.find((value) => value.pluginId === skill.pluginId && value.id === skill.id);
    return latest.current.active && Boolean(item?.available && skillSnapshotKey(item) === skillSnapshotKey(skill));
  }, []);
  const preview = useCallback((candidate: PackagedSkillDescriptor): Promise<void> => {
    if (transport.current || !current(candidate)) return Promise.resolve();
    const skill = { ...candidate }; const ticket = ++epoch.current;
    selected.current = skill; setSelection(skill); setContent(null); setError(''); setLoading(true); setBusy(true); transport.current = true;
    let cancelWait: () => void = () => {};
    const cancellation = new Promise<void>((resolve) => { cancelWait = resolve; }); cancel.current = cancelWait;
    const deadline = setTimeout(() => {
      if (mounted.current && ticket === epoch.current) {
        epoch.current++; setLoading(false); setContent(null); setError('plugin.skills.error.timeout');
      }
      cancelWait();
    }, SKILL_REQUEST_TIMEOUT_MS);
    const request = (async () => {
      try {
        const result = await packagedSkillAPI.read(skill);
        if (mounted.current && ticket === epoch.current && current(skill)) setContent(result.content);
      } catch (cause) {
        if (mounted.current && ticket === epoch.current && current(skill)) setError(packagedSkillErrorKey(cause));
      } finally { transport.current = false; if (mounted.current) setBusy(false); }
    })();
    return Promise.race([request, cancellation]).finally(() => {
      clearTimeout(deadline); if (cancel.current === cancelWait) cancel.current = undefined;
      if (mounted.current && ticket === epoch.current) setLoading(false);
    });
  }, [current]);
  useEffect(() => { if (!active || (selected.current && !current(selected.current))) close(); }, [active, items, close, current]);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribePackagedSkillInvalidation((pluginId) => { if (selected.current?.pluginId === pluginId) close(); });
    return () => { mounted.current = false; epoch.current++; cancel.current?.(); unsubscribe(); selected.current = null; };
  }, [close]);
  const visible = selection && current(selection) ? selection : null;
  return { selection: visible, content: visible ? content : null, loading, busy, error, preview, close, selectedKey: visible ? skillKey(visible) : null };
}
