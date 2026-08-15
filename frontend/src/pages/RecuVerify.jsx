import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import client from '../api/client.js';

function fmt(n, devise = 'USD') {
  return `${(parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export default function RecuVerify() {
  const { reference } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError('');
      try {
        const res = await client.get(`/paiements/verify/${reference}`);
        setData(res.data);
      } catch (err) {
        setError(err.response?.data?.error || 'Impossible de vérifier ce reçu.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [reference]);

  if (loading) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Vérification en cours...</p></div>;
  if (error) return <div className="alert alert-danger">{error}</div>;

  const { verified, paiement: p, ecole } = data;

  return (
    <div className="receipt-page">
      <div className="no-print receipt-toolbar">
        <button className="btn btn-outline" onClick={() => navigate(-1)}><i className="ph ph-arrow-left"></i> Retour</button>
      </div>

      <div className="receipt-card">
        <div className="receipt-header">
          <div className="school-name">{ecole?.nom || 'EcolePay'}</div>
          <div className="school-meta">{ecole?.adresse}</div>
          <div className="school-meta">{ecole?.telephone} {ecole?.email ? `· ${ecole.email}` : ''}</div>
          <div className="receipt-title">Vérification du reçu</div>
        </div>

        <div className="receipt-body">
          <div className="receipt-status-badge">{verified ? 'Reçu valide' : 'Reçu non valide'}</div>
          {verified ? (
            <>
              <div className="receipt-meta-row">
                <div><strong>Référence :</strong> {p.reference}</div>
                <div><strong>Date :</strong> {new Date(p.date_paiement).toLocaleString('fr-FR')}</div>
              </div>
              <div className="receipt-info-grid">
                <div>
                  <div className="receipt-subtitle">Élève</div>
                  <table className="receipt-table">
                    <tbody>
                      <tr><td className="label">Nom</td><td className="value">{p.e_prenom} {p.e_nom}</td></tr>
                      <tr><td className="label">Matricule</td><td className="value">{p.matricule}</td></tr>
                      <tr><td className="label">Classe</td><td className="value">{p.classe}</td></tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="receipt-subtitle">Paiement</div>
                  <table className="receipt-table">
                    <tbody>
                      <tr><td className="label">Montant</td><td className="value">{fmt(p.montant, p.devise)}</td></tr>
                      <tr><td className="label">Type</td><td className="value">{p.type_paiement}</td></tr>
                      <tr><td className="label">Comptable</td><td className="value">{p.cpt_prenom} {p.cpt_nom}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="alert alert-warning">Ce reçu est invalide ou n'existe pas.</div>
          )}
        </div>
      </div>
    </div>
  );
}
