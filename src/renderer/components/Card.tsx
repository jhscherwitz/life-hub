import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Card(props: { title: string; icon?: IconName; action?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      <header className="card-header">
        <h2>
          {props.icon && (
            <span className="card-icon">
              <Icon name={props.icon} size={15} />
            </span>
          )}
          {props.title}
        </h2>
        {props.action}
      </header>
      <div className="card-body">{props.children}</div>
    </section>
  );
}
