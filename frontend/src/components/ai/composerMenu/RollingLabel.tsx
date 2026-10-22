import React, { useEffect, useState } from 'react';

interface RollItem {
  id: number;
  label: string;
  leaving: boolean;
}

let rollSerial = 0;

const RollingLabel: React.FC<{ label: string }> = ({ label }) => {
  const [items, setItems] = useState<RollItem[]>(() => [{ id: 0, label, leaving: false }]);

  useEffect(() => {
    setItems((current) => {
      const visible = current.find((item) => !item.leaving);
      if (!visible || visible.label === label) return current;
      rollSerial += 1;
      return [{ ...visible, leaving: true }, { id: rollSerial, label, leaving: false }];
    });
  }, [label]);

  useEffect(() => {
    if (!items.some((item) => item.leaving)) return undefined;
    const timer = window.setTimeout(() => {
      setItems((current) => current.filter((item) => !item.leaving));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [items]);

  return (
    <span className="gn-zcode-roll" title={label}>
      {items.map((item) => (
        <span key={item.id} className={item.leaving ? 'gn-zcode-roll-text is-leaving' : 'gn-zcode-roll-text'}>
          {item.label}
        </span>
      ))}
    </span>
  );
};

export default RollingLabel;
