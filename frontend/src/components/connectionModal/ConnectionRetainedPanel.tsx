import { memo, type ReactNode } from 'react';

interface Props { active: boolean; className: string; children: ReactNode }
// Hidden panels keep their DOM but do not reconcile fresh element trees from
// unrelated parent updates. React context and field subscriptions still work.
export const ConnectionRetainedPanel = memo(function ConnectionRetainedPanel({ active, className, children }: Props) {
  return <div className={className} hidden={!active} aria-hidden={!active}>{children}</div>;
}, (previous, next) => !previous.active && !next.active && previous.className === next.className);
