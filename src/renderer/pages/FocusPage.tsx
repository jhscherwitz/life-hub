import type { DashboardSnapshot, FocusSession } from '../../shared/types';
import { FocusCard } from '../components/FocusCard';

/** The focus timer, full size. */
export function FocusPage({ snapshot, now, focusSession }: { snapshot: DashboardSnapshot; now: number; focusSession: FocusSession | null }) {
  return (
    <div className="page-grid">
      <div className="span-8 focus-page">
        <FocusCard snapshot={snapshot} now={now} session={focusSession} />
      </div>
    </div>
  );
}
