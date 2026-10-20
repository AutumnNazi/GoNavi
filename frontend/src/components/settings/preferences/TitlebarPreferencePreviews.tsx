import { useEffect, useState } from 'react';
import { useStore } from '../../../store';
import { ActionPlacementPreferencePreview } from './ActionPlacementPreferencePreview';

export function TitlebarPreferencePreviews() {
  const activePlacement = useStore(state => state.appearance.titlebarActionsPlacement);
  const [placement, setPlacement] = useState(activePlacement);
  useEffect(() => setPlacement(activePlacement), [activePlacement]);
  return <>
    <ActionPlacementPreferencePreview area="titlebar" placementPreview={{ value: placement, onChange: setPlacement }} />
    <ActionPlacementPreferencePreview area="titlebar-display" visible={placement === 'titlebar'} />
  </>;
}
