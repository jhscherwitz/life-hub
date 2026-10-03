import type { ReactNode } from 'react';

/** One section of the dashboard: a small label row on top, then the content. */
export function Card(props: { title: string; meta?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel ${props.className ?? ''}`}>
      <header className="label-row">
        <h2>{props.title}</h2>
        {props.action}
        {props.meta !== undefined && <span className="label-meta">{props.meta}</span>}
      </header>
      {props.children}
    </section>
  );
}
