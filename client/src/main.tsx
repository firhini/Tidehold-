import React from 'react';
import { createRoot } from 'react-dom/client';
import { SoloApp } from './solo/SoloApp.js';
import './theme.css';

// TIDEHOLD is now a serverless single-player flood-survival roguelite.
// The original multiplayer client (App.tsx + store/api/ws) is kept in the tree
// as the "director's cut" and is not imported here, so it's tree-shaken out.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SoloApp />
  </React.StrictMode>,
);
