import React from 'react';
import { createRoot } from 'react-dom/client';
import PublicApp from './PublicApp';
import { sanitizeLandingUrl } from './metrica';
import './public.css';

// No Metrica script or requests are created at bootstrap. Even on the
// production host, an explicit consent click is required in this document.
sanitizeLandingUrl();

const root = document.getElementById('root');
if (!root) throw new Error('Public root DOM element not found');
createRoot(root).render(<React.StrictMode><PublicApp /></React.StrictMode>);
