import React from 'react';
import { useSolo } from '../store.js';

export function SoloToasts() {
  const toasts = useSolo((s) => s.toasts);
  const dismiss = useSolo((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <button key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}
