import React, { useEffect, useState } from 'react';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useAnnee } from '../context/AnneeContext.jsx';
import { useDevise } from '../context/DeviseContext.jsx';

const STATUT_LABELS = { en_attente: 'En attente', approuve: 'Approuvé', rejete: 'Rejeté', rendu: 'Rendu' };

export default function Remboursements() {
  const { user, hasPermission } = useAuth();
  const { viewingAnnee } = useAnnee();
  const { format } = useDevise();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [refPaiement, setRefPaiement] = useState('');
  const [paiementTrouve, setPaiementTrouve] = useState(null);
  const [montant, setMontant] = useState('');
  const [motif, setMotif] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await client.get('/remboursements', { params: viewingAnnee ? { annee: viewingAnnee } : {} });
    setRows(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [viewingAnnee]);

  async function chercherPaiement() {
    setError('');
    setPaiementTrouve(null);
    setMontant('');
    if (!refPaiement.trim()) return;
    const res = await client.get('/paiements/by-reference', { params: { ref: refPaiement.trim() } });
    if (!res.data) setError('Aucun paiement valide trouvé pour cette référence.');
    else { setPaiementTrouve(res.data); setMontant(res.data.montant); }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!paiementTrouve) { setError('Recherchez un paiement valide d\'abord.'); return; }
    setSaving(true); setError('');
    try {
      await client.post('/remboursements', { paiement_id: paiementTrouve.id, motif, montant });
      setShowModal(false);
      setRefPaiement(''); setPaiementTrouve(null); setMotif(''); setMontant('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function approuver(id, r) {
    if (!window.confirm(`Approuver ce remboursement de ${r.montant} ${r.devise} ? Le montant sera déduit du paiement ${r.pay_ref}.`)) return;
    try {
      await client.post(`/remboursements/${id}/approuver`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }
  async function rejeter(id) {
    if (!window.confirm('Rejeter cette demande de remboursement ?')) return;
    await client.post(`/remboursements/${id}/rejeter`);
    load();
  }
  async function marquerRendu(r) {
    if (!window.confirm(`Confirmer que ce surplus de ${format(r.montant_usd)} a bien été rendu au parent/tuteur ?`)) return;
    try {
      await client.post(`/paiements/${r.paiement_id}/surplus-rembourse`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  const canManage = !viewingAnnee && (user.role === 'admin' || hasPermission('paiements'));

  return (
    <div>
      <div className="flex-between mb-16">
        <div className="text-muted">{rows.length} mouvement(s) de remboursement{viewingAnnee ? ` — ${viewingAnnee}` : ''}</div>
        {!viewingAnnee && <button className="btn btn-accent" onClick={() => setShowModal(true)}><i className="ph ph-plus"></i> Nouvelle demande</button>}
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Référence</th><th>Type</th><th>Élève</th><th>Paiement</th><th>Montant</th><th>Motif</th><th>Statut</th><th>Date</th>{canManage && <th></th>}</tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={9}><div className="empty-state"><i className="ph ph-arrow-counter-clockwise"></i><h3>Aucune demande</h3></div></td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><code>{r.reference_remboursement}</code></td>
                  <td><span className={`badge ${r.type === 'surplus' ? 'badge-warning' : 'badge-info'}`}>{r.type === 'surplus' ? 'Surplus' : 'Remboursement'}</span></td>
                  <td>{r.prenom} {r.nom} <span className="text-muted">({r.matricule})</span></td>
                  <td><code>{r.pay_ref}</code></td>
                  <td><strong>{format(r.montant_usd)}</strong></td>
                  <td className="text-muted">{r.motif}</td>
                  <td><span className={`badge ${r.statut === 'approuve' || r.statut === 'rendu' ? 'badge-success' : r.statut === 'rejete' ? 'badge-danger' : 'badge-warning'}`}>{STATUT_LABELS[r.statut] || r.statut}</span></td>
                  <td className="text-muted">{new Date(r.date_remboursement).toLocaleDateString('fr-FR')}</td>
                  {canManage && (
                    <td className="flex gap-8">
                      {r.type === 'remboursement' && r.statut === 'en_attente' && user.role === 'admin' && (
                        <>
                          <button className="btn btn-success btn-sm" onClick={() => approuver(r.id, r)}><i className="ph ph-check"></i></button>
                          <button className="btn btn-danger btn-sm" onClick={() => rejeter(r.id)}><i className="ph ph-x"></i></button>
                        </>
                      )}
                      {r.type === 'surplus' && r.statut === 'en_attente' && (
                        <button className="btn btn-outline btn-sm" onClick={() => marquerRendu(r)}>Marquer rendu</button>
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
          <div className="modal-header"><i className="ph ph-arrow-counter-clockwise"></i><h3>Nouvelle demande de remboursement</h3><button className="modal-close" onClick={() => setShowModal(false)}><i className="ph ph-x"></i></button></div>
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
                  <>
                    <div className="alert alert-info">
                      {paiementTrouve.prenom} {paiementTrouve.nom} ({paiementTrouve.matricule}) — payé {format(paiementTrouve.montant_usd)}
                    </div>
                    <div className="form-group">
                      <label>Montant à rembourser *</label>
                      <div className="flex gap-8" style={{ alignItems: 'center' }}>
                        <input
                          type="number" step="0.01" min="0.01" max={paiementTrouve.montant}
                          value={montant} onChange={(e) => setMontant(e.target.value)} required
                        />
                        <span className="text-muted">{paiementTrouve.devise}</span>
                      </div>
                      <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                        Maximum {paiementTrouve.montant} {paiementTrouve.devise}. Un montant inférieur au total payé ne rembourse que la différence — le paiement reste valide pour le reste.
                      </p>
                    </div>
                  </>
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
