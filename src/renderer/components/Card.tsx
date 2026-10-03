import type { ReactNode } from 'react';

/** A rounded card: a title row (with an optional count and action), then the content. */
export function Card(props: { title: string; meta?: ReactNode; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      <header className="card-head">
        <h2>{props.title}</h2>
        {props.meta !== undefined && <span className="count">{props.meta}</span>}
        {props.action}
      </header>
      {props.children}
    </section>
  );
}
