import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import client from '../api/client.js';

function fmt(n, devise = 'USD') {
  return `${(parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export default function Recu() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState(null);

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
          <div className="school-name">{ecole?.nom || 'École'}</div>
          <div className="school-meta">{ecole?.adresse}</div>
          <div className="school-meta">{ecole?.telephone} {ecole?.email ? `· ${ecole.email}` : ''}</div>
          <div className="receipt-title">Reçu de paiement</div>
        </div>

        <div className="receipt-body">
          <div className="receipt-meta-row">
            <div><strong>Référence :</strong> {p.reference}</div>
            <div><strong>Date :</strong> {new Date(p.date_paiement).toLocaleString('fr-FR')}</div>
          </div>

          <table className="receipt-table">
            <tbody>
              <tr><td className="label">Élève</td><td className="value">{p.e_prenom} {p.e_nom}</td></tr>
              <tr><td className="label">Matricule</td><td className="value" style={{ fontWeight: 400 }}>{p.matricule}</td></tr>
              <tr><td className="label">Classe</td><td className="value" style={{ fontWeight: 400 }}>{p.classe}</td></tr>
              <tr><td className="label">Type de paiement</td><td className="value" style={{ fontWeight: 400 }}>{p.type_paiement}</td></tr>
              <tr><td className="label">Mode de paiement</td><td className="value" style={{ fontWeight: 400 }}>{p.mode_paiement}</td></tr>
              {p.periode && <tr><td className="label">Période</td><td className="value" style={{ fontWeight: 400 }}>{p.periode}</td></tr>}
            </tbody>
          </table>

          <div className="receipt-amount">
            <div className="receipt-amount-row">
              <span>Montant payé</span><span>{fmt(p.montant, p.devise)}</span>
            </div>
          </div>

          {p.type_paiement === 'scolarite' && (
            <div className="receipt-progress-note">
              Progression scolarité : <strong>{pctPaye}%</strong> · Reste à payer : <strong>{fmt(resteApres)}</strong>
            </div>
          )}

          <div className="receipt-footer-row">
            <div>Encaissé par : {p.cpt_prenom} {p.cpt_nom}</div>
            <div className="receipt-signature">Signature : ______________</div>
          </div>
        </div>
      </div>
      <div className="no-print text-muted text-center" style={{ marginTop: 14, fontSize: 12 }}>EcolePay — reçu généré automatiquement</div>
    </div>
  );
}
