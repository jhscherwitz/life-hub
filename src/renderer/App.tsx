import { useEffect, useState } from 'react';
import { Capture } from './Capture';
import { Dashboard } from './Dashboard';

function routeFromHash(): string {
  return window.location.hash.replace(/^#\/?/, '');
}

export function App() {
  const [route, setRoute] = useState(routeFromHash);
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return route === 'capture' ? <Capture /> : <Dashboard />;
}
