import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import client from '../api/client.js';
import { API_URL } from '../api/client.js';
import { useDevise } from '../context/DeviseContext.jsx';

export default function Recu() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);
  const { format } = useDevise();

  useEffect(() => {
    const isNew = searchParams.get('new') !== null;
    client.get(`/paiements/${id}/recu`, { params: isNew ? { new: 1 } : {} }).then((res) => setData(res.data));
    // eslint-disable-next-line
  }, [id]);

  if (!data) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement du reçu...</p></div>;

  const { paiement: p, resteApres, pctPaye, ecole } = data;

  return (
    <div className="receipt-page">
      <div className="no-print receipt-toolbar">
        <button className="btn btn-accent" onClick={() => window.print()}><i className="ph ph-printer"></i> Imprimer</button>
      </div>

      <div className="receipt-card">
        <div className="receipt-header">
          {ecole?.logo && (
            <div className="receipt-logo-placeholder">
              <img src={`${API_URL.replace(/\/api$/, '')}/uploads/logos/${ecole.logo}`} alt="logo" className="receipt-logo-top" />
            </div>
          )}
          <div className="school-name">{ecole?.nom || 'École'}</div>
          <div className="school-meta">{ecole?.adresse}</div>
          <div className="school-meta">{ecole?.telephone} {ecole?.email ? `· ${ecole.email}` : ''}</div>
          <div className="receipt-title">Reçu de paiement</div>
        </div>

        <div className="receipt-body">
          <div className="receipt-top-grid">
            <div>
              <div className="receipt-meta-row-item"><strong>Référence :</strong> {p.reference}</div>
              <div className="receipt-meta-row-item"><strong>Date :</strong> {new Date(p.date_paiement).toLocaleString('fr-FR')}</div>
              <div className="receipt-meta-row-item"><strong>Statut :</strong> {p.statut}</div>
            </div>
          </div>

          <div className="receipt-info-grid">
            <div>
              <div className="receipt-subtitle">Informations de l'élève</div>
              <table className="receipt-table">
                <tbody>
                  <tr><td className="label">Élève</td><td className="value">{p.e_prenom} {p.e_nom}</td></tr>
                  <tr><td className="label">Matricule</td><td className="value">{p.matricule}</td></tr>
                  <tr><td className="label">Classe</td><td className="value">{p.classe}</td></tr>
                  <tr><td className="label">Année scolaire</td><td className="value">{p.e_annee || '—'}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <div className="receipt-subtitle">Détails de paiement</div>
              <table className="receipt-table">
                <tbody>
                  <tr><td className="label">Montant</td><td className="value">{format(p.montant_usd)}</td></tr>
                  <tr><td className="label">Type</td><td className="value">{p.type_paiement}</td></tr>
                  <tr><td className="label">Mode</td><td className="value">{p.mode_paiement}</td></tr>
                  {p.periode && <tr><td className="label">Période</td><td className="value">{p.periode}</td></tr>}
                  {p.description && <tr><td className="label">Libellé</td><td className="value">{p.description}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="receipt-amount">
            <div className="receipt-amount-row">
              <span>Montant payé</span><span>{format(p.montant_usd)}</span>
            </div>
          </div>

          {p.type_paiement === 'scolarite' && (
            <div className="receipt-progress-note">
              Progression scolarité : <strong>{pctPaye}%</strong> · Reste à payer : <strong>{format(resteApres)}</strong>
            </div>
          )}

          <div className="receipt-footer-row">
            <div>Encaissé par : <strong>{p.cpt_prenom} {p.cpt_nom}</strong></div>
            <div className="receipt-signature">Signature : ____________________</div>
          </div>
        </div>
      </div>
      
      <div className="no-print text-muted text-center" style={{ marginTop: 14, fontSize: 12 }}>EcolePay — reçu généré automatiquement</div>
    </div>
  );
}
