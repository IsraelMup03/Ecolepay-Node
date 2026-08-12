import React from 'react';
import { useAnnee } from '../context/AnneeContext.jsx';

export default function HistoricalBlock() {
  const { viewingAnnee, setViewingAnnee } = useAnnee();
  return (
    <div className="card">
      <div className="empty-state">
        <i className="ph ph-lock-simple"></i>
        <h3>Non disponible en mode historique</h3>
        <p>Cette section modifie des données et ne peut pas être utilisée pendant que vous consultez l'année {viewingAnnee}.</p>
        <button className="btn btn-accent" style={{ marginTop: 14 }} onClick={() => setViewingAnnee(null)}>
          Retour à l'année en cours
        </button>
      </div>
    </div>
  );
}
