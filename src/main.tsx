import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Dropping a file outside the drop zone must never navigate the window to it.
for (const evt of ['dragover', 'drop'] as const) window.addEventListener(evt, (e) => e.preventDefault());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
