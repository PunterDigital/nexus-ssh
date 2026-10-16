import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { DesignSystemGallery } from './components/ui/DesignSystemGallery';
import './styles/globals.css';

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
  return gallery ? <DesignSystemGallery /> : <App />;
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
