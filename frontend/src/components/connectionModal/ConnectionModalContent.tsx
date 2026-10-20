import { useEffect, useState, type ReactNode } from 'react';
import { ConnectionRetainedPanel } from './ConnectionRetainedPanel';
import './connectionRetainedPanels.css';

function PickerContent({ render }: { render: () => ReactNode }) { return <>{render()}</>; }

interface Props { open: boolean; step: number; formKey: string; renderPicker: () => ReactNode; renderForm: () => ReactNode }
// The modal uses forceRender so rc-dialog cannot freeze the last open children
// on close: the credential-bearing form must unmount immediately. Only the
// harmless picker survives; nothing is created before the first open.
export function ConnectionModalContent({ open, step, formKey, renderPicker, renderForm }: Props) {
  const showPicker = open && step === 1;
  const [visitedPicker, setVisitedPicker] = useState(showPicker);
  useEffect(() => { if (showPicker) setVisitedPicker(true); }, [showPicker]);
  return <>
    {(showPicker || visitedPicker) && <ConnectionRetainedPanel active={showPicker} className="gn-connection-content-stage">
      <PickerContent render={renderPicker} />
    </ConnectionRetainedPanel>}
    {open && step !== 1 && <div key={formKey} className="gn-connection-content-stage">{renderForm()}</div>}
  </>;
}
