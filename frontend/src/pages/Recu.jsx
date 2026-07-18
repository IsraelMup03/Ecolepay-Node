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

  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}>Chargement du reçu...</div>;

  const { paiement: p, resteApres, pctPaye, ecole } = data;

  return (
    <div style={{ maxWidth: 640, margin: '30px auto', fontFamily: 'Inter, sans-serif' }}>
      <div className="no-print" style={{ textAlign: 'right', marginBottom: 16 }}>
        <button className="btn btn-accent" onClick={() => window.print()}><i className="ri-printer-line"></i> Imprimer</button>
      </div>

      <div style={{ border: '2px solid #1a3c5e', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1a3c5e,#2557a7)', color: '#fff', padding: '24px 30px', textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontFamily: 'Playfair Display, serif', fontWeight: 700 }}>{ecole?.nom || 'École'}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>{ecole?.adresse}</div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{ecole?.telephone} {ecole?.email ? `· ${ecole.email}` : ''}</div>
          <div style={{ marginTop: 12, fontSize: 15, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700 }}>Reçu de paiement</div>
        </div>

        <div style={{ padding: '24px 30px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 18, fontSize: 13 }}>
            <div><strong>Référence :</strong> {p.reference}</div>
            <div><strong>Date :</strong> {new Date(p.date_paiement).toLocaleString('fr-FR')}</div>
          </div>

          <table style={{ width: '100%', fontSize: 13, marginBottom: 18 }}>
            <tbody>
              <tr><td style={{ padding: '5px 0', color: '#6b7a8d' }}>Élève</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{p.e_prenom} {p.e_nom}</td></tr>
              <tr><td style={{ padding: '5px 0', color: '#6b7a8d' }}>Matricule</td><td style={{ textAlign: 'right' }}>{p.matricule}</td></tr>
              <tr><td style={{ padding: '5px 0', color: '#6b7a8d' }}>Classe</td><td style={{ textAlign: 'right' }}>{p.classe}</td></tr>
              <tr><td style={{ padding: '5px 0', color: '#6b7a8d' }}>Type de paiement</td><td style={{ textAlign: 'right' }}>{p.type_paiement}</td></tr>
              <tr><td style={{ padding: '5px 0', color: '#6b7a8d' }}>Mode de paiement</td><td style={{ textAlign: 'right' }}>{p.mode_paiement}</td></tr>
              {p.periode && <tr><td style={{ padding: '5px 0', color: '#6b7a8d' }}>Période</td><td style={{ textAlign: 'right' }}>{p.periode}</td></tr>}
            </tbody>
          </table>

          <div style={{ background: '#f0f4f8', borderRadius: 10, padding: '14px 18px', marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 16, fontWeight: 800, color: '#1a3c5e' }}>
              <span>Montant payé</span><span>{fmt(p.montant, p.devise)}</span>
            </div>
          </div>

          {p.type_paiement === 'scolarite' && (
            <div style={{ fontSize: 12, color: '#6b7a8d', marginBottom: 18 }}>
              Progression scolarité : <strong>{pctPaye}%</strong> · Reste à payer : <strong>{fmt(resteApres)}</strong>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 30, fontSize: 12, color: '#6b7a8d' }}>
            <div>Encaissé par : {p.cpt_prenom} {p.cpt_nom}</div>
            <div>Signature : ______________</div>
          </div>
        </div>
      </div>
      <div className="no-print text-muted text-center" style={{ marginTop: 14, fontSize: 12 }}>EcolePay v2.0 — reçu généré automatiquement</div>
    </div>
  );
}
