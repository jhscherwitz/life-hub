import type { ReactNode } from 'react';

export function Card(props: { title: string; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      <header className="card-header">
        <h2>{props.title}</h2>
        {props.action}
      </header>
      <div className="card-body">{props.children}</div>
    </section>
  );
}
