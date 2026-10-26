import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('antd', () => ({
  Typography: { Paragraph: (p: React.HTMLAttributes<HTMLElement>) => <p>{p.children}</p> },
  Alert: ({ message }: { message: string }) => <p role="alert">{message}</p>,
  Button: (p: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...p} />,
  Table: () => <table />,
}));
import { DeclarativePanel } from './DeclarativePanel';
describe('declarative renderer boundary', () => {
  it('renders plugin strings as escaped text, never executable HTML', () => {
    const html = renderToStaticMarkup(<DeclarativePanel body={{ type: 'text', text: '<script>evil()</script>' }} commands={[]} disabled={false} invoke={vi.fn()} />);
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
  it('rejects an undeclared button command before any component renders', () => {
    const html = renderToStaticMarkup(<DeclarativePanel body={{ type: 'button', title: 'Bad', command: 'not-declared' }} commands={[]} disabled={false} invoke={vi.fn()} />);
    expect(html).toContain('plugin.ui.invalid_schema');
    expect(html).not.toContain('<button');
  });
});
