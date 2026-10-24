import React, { Suspense, lazy, useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

// Developer-only page: loaded on demand so it never ships in the start-up chunk (#2357).
const DesignSystemGallery = lazy(() =>
  import('./components/ui/DesignSystemGallery').then((m) => ({ default: m.DesignSystemGallery })),
);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element not found');

const GALLERY_HASH = '#design-system';

/** The design-system gallery (docs/design-system.md) opens on #design-system; everything else is the app. */
function Root() {
  const [gallery, setGallery] = useState(window.location.hash === GALLERY_HASH);
  useEffect(() => {
    const onHashChange = () => setGallery(window.location.hash === GALLERY_HASH);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return gallery ? (
    <Suspense fallback={null}>
      <DesignSystemGallery />
    </Suspense>
  ) : (
    <App />
  );
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
