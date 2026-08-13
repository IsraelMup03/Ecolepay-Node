import React, { useEffect, useRef, useState } from 'react';
import { API_URL } from '../api/client.js';
import { useDevise } from '../context/DeviseContext.jsx';

const RAPPORT_OPTIONS = [
  { type: 'jour', label: 'Rapport journalier', icon: 'ph-sun' },
  { type: 'semaine', label: 'Rapport hebdomadaire', icon: 'ph-calendar-blank' },
  { type: 'mois', label: 'Rapport mensuel', icon: 'ph-calendar' },
];

export default function GenererRapportButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { devise } = useDevise();

  useEffect(() => {
    if (!open) return;
    function onClick(e) { if (!ref.current?.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function telecharger(type) {
    setOpen(false);
    const token = localStorage.getItem('ecolepay_token');
    fetch(`${API_URL}/rapports/download/periode.xlsx?type=${type}&devise=${devise}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `rapport_${type}_${Date.now()}.xlsx`; a.click();
        window.URL.revokeObjectURL(url);
      });
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn btn-accent" onClick={() => setOpen((o) => !o)}>
        <i className="ph-bold ph-file-arrow-down"></i> Générer un rapport
      </button>
      {open && (
        <div className="row-menu" style={{ position: 'absolute', top: '110%', right: 0 }}>
          {RAPPORT_OPTIONS.map((o) => (
            <button key={o.type} onClick={() => telecharger(o.type)}><i className={`ph ${o.icon}`}></i> {o.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
