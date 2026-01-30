import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const renderApp = () => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

const bootstrap = async () => {
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Ignore font readiness errors
    }
  }
  renderApp();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
  });
} else {
  void bootstrap();
}
