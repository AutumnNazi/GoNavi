import { useEffect, useMemo } from 'react';
import { useBackgroundImageStore } from '../backgroundImageStore';
import { resolvedBackground } from '../utils/resolvedBackground';

export function useResolvedBackground(language?: string) {
  const image = useBackgroundImageStore(state => state.image);
  const builtinId = useBackgroundImageStore(state => state.builtinId);
  const builtinVersion = useBackgroundImageStore(state => state.builtinVersion);
  const gallery = useBackgroundImageStore(state => state.resolvedGallery);
  const revision = useBackgroundImageStore(state => state.resolutionRevision);
  const resolve = useBackgroundImageStore(state => state.resolveSelected);
  useEffect(() => { if (builtinId && !gallery) void resolve(); }, [builtinId, builtinVersion, gallery, revision, resolve]);
  return useMemo(() => resolvedBackground({ image, builtinId, builtinVersion, gallery }, language), [image, builtinId, builtinVersion, gallery, language]);
}
