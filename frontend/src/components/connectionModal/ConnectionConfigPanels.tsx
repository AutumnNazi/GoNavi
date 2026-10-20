import { useEffect, useState, type ReactNode } from 'react';
import { ConnectionRetainedPanel } from './ConnectionRetainedPanel';
import './connectionRetainedPanels.css';

type Section = 'basic' | 'network' | 'appearance' | 'advanced';
interface Props { active: Section; sections: Record<Section, ReactNode> }
// Lazily mount only visited sections, for the lifetime of this open form.
export function ConnectionConfigPanels({ active, sections }: Props) {
  const [visited, setVisited] = useState<Section[]>([active]);
  const visibleSections = visited.includes(active) ? visited : [...visited, active];
  useEffect(() => { setVisited(previous => previous.includes(active) ? previous : [...previous, active]); }, [active]);
  return <>{visibleSections.map(section => <ConnectionRetainedPanel key={section} active={section === active} className="gn-connection-config-panel">
    {sections[section]}
  </ConnectionRetainedPanel>)}</>;
}
