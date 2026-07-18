import React, { useEffect, useState } from 'react';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

function fmt(n, devise = 'USD') {
  return `${(parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export default function Remboursements() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [refPaiement, setRefPaiement] = useState('');
  const [paiementTrouve, setPaiementTrouve] = useState(null);
  const [motif, setMotif] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await client.get('/remboursements');
    setRows(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function chercherPaiement() {
    setError('');
    setPaiementTrouve(null);
    if (!refPaiement.trim()) return;
    const res = await client.get('/paiements/by-reference', { params: { ref: refPaiement.trim() } });
    if (!res.data) setError('Aucun paiement valide trouvé pour cette référence.');
    else setPaiementTrouve(res.data);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!paiementTrouve) { setError('Recherchez un paiement valide d\'abord.'); return; }
    setSaving(true); setError('');
    try {
      await client.post('/remboursements', { paiement_id: paiementTrouve.id, motif });
      setShowModal(false);
      setRefPaiement(''); setPaiementTrouve(null); setMotif('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function approuver(id) {
    if (!window.confirm('Approuver ce remboursement ? Le paiement associé sera marqué comme remboursé.')) return;
    await client.post(`/remboursements/${id}/approuver`);
    load();
  }
  async function rejeter(id) {
    if (!window.confirm('Rejeter cette demande de remboursement ?')) return;
    await client.post(`/remboursements/${id}/rejeter`);
    load();
  }

  return (
    <div>
      <div className="flex-between mb-16">
        <div className="text-muted">{rows.length} demande(s) de remboursement</div>
        <button className="btn btn-accent" onClick={() => setShowModal(true)}><i className="ri-add-line"></i> Nouvelle demande</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Référence</th><th>Élève</th><th>Paiement</th><th>Montant</th><th>Motif</th><th>Statut</th><th>Date</th>{user.role === 'admin' && <th></th>}</tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="text-center text-muted">Chargement...</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={8}><div className="empty-state"><i className="ri-refund-2-line"></i><h3>Aucune demande</h3></div></td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.reference_remboursement}</code></td>
                  <td>{r.prenom} {r.nom} <span className="text-muted">({r.matricule})</span></td>
                  <td><code>{r.pay_ref}</code></td>
                  <td><strong>{fmt(r.montant, r.devise)}</strong></td>
                  <td className="text-muted">{r.motif}</td>
                  <td><span className={`badge ${r.statut === 'approuve' ? 'badge-success' : r.statut === 'rejete' ? 'badge-danger' : 'badge-warning'}`}>{r.statut}</span></td>
                  <td className="text-muted">{new Date(r.date_remboursement).toLocaleDateString('fr-FR')}</td>
                  {user.role === 'admin' && (
                    <td className="flex gap-8">
                      {r.statut === 'en_attente' && (
                        <>
                          <button className="btn btn-success btn-sm" onClick={() => approuver(r.id)}><i className="ri-check-line"></i></button>
                          <button className="btn btn-danger btn-sm" onClick={() => rejeter(r.id)}><i className="ri-close-line"></i></button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`modal-backdrop ${showModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
        <div className="modal">
          <div className="modal-header"><i className="ri-refund-2-line"></i><h3>Nouvelle demande de remboursement</h3><button className="modal-close" onClick={() => setShowModal(false)}>✕</button></div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-grid">
                <div className="form-group">
                  <label>Référence du paiement</label>
                  <div className="flex gap-8">
                    <input value={refPaiement} onChange={(e) => setRefPaiement(e.target.value)} placeholder="Ex: PAY-20260717-AB12CD" />
                    <button type="button" className="btn btn-outline" onClick={chercherPaiement}>Rechercher</button>
                  </div>
                </div>
                {paiementTrouve && (
                  <div className="alert alert-info">
                    {paiementTrouve.prenom} {paiementTrouve.nom} ({paiementTrouve.matricule}) — {fmt(paiementTrouve.montant, paiementTrouve.devise)}
                  </div>
                )}
                <div className="form-group">
                  <label>Motif du remboursement *</label>
                  <textarea value={motif} onChange={(e) => setMotif(e.target.value)} required />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Annuler</button>
              <button type="submit" className="btn btn-accent" disabled={saving}>{saving ? 'Envoi...' : 'Soumettre la demande'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
