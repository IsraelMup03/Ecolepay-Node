import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import { useDevise } from '../context/DeviseContext.jsx';

const STATUT_BADGE = { actif: 'badge-success', suspendu: 'badge-danger', diplome: 'badge-info', transfere: 'badge-default' };
const STATUT_LABELS = { actif: 'Actif', suspendu: 'Suspendu', diplome: 'Diplômé', transfere: 'Transféré' };

const PAIEMENT_FORM_INIT = { montant: '', devise: 'USD', type_paiement: 'scolarite', mode_paiement: 'especes', periode: '', description: '' };

export default function EleveDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { viewingAnnee } = useAnnee();
  const { format } = useDevise();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState(PAIEMENT_FORM_INIT);
  const [paymentError, setPaymentError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(null);
  const [paying, setPaying] = useState(false);

  async function load() {
    setLoading(true);
    const res = await client.get(`/eleves/${id}`, { params: viewingAnnee ? { annee: viewingAnnee } : {} });
    setData(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id, viewingAnnee]);

  function openPaymentModal() {
    setPaymentForm(PAIEMENT_FORM_INIT);
    setPaymentError('');
    setPaymentSuccess(null);
    setShowPaymentModal(true);
  }

  async function submitPayment(ev) {
    ev.preventDefault();
    setPaymentError('');
    setPaying(true);
    try {
      const res = await client.post('/paiements', {
        eleve_id: id,
        montant: parseFloat(paymentForm.montant),
        devise: paymentForm.devise,
        type_paiement: paymentForm.type_paiement,
        mode_paiement: paymentForm.mode_paiement,
        periode: paymentForm.periode,
        description: paymentForm.description,
      });
      setPaymentSuccess(res.data);
      load();
      if (res.data.surplus) {
        alert(`Seul le montant restant dû a été enregistré (la scolarité est maintenant soldée). Surplus à rendre : ${res.data.surplus.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${res.data.surplusDevise}.`);
      }
    } catch (err) {
      setPaymentError(err.response?.data?.error || "Erreur lors de l'enregistrement.");
    } finally {
      setPaying(false);
    }
  }

  async function retrograder() {
    if (!window.confirm('Confirmer la rétrogradation de cet élève vers la classe inférieure ?')) return;
    try {
      await client.post(`/eleves/${id}/retrograder`);
      setMsg('Élève rétrogradé avec succès.');
      load();
    } catch (err) {
      setMsg(err.response?.data?.error || 'Erreur.');
    }
  }

  async function archiver() {
    if (!window.confirm("Archiver cet élève ? Il sera déplacé vers la corbeille et pourra être restauré pendant 30 jours.")) return;
    await client.delete(`/eleves/${id}`);
    navigate('/eleves');
  }

  async function toggleStatut() {
    const nouveau = data.eleve.statut === 'actif' ? 'suspendu' : 'actif';
    const label = nouveau === 'suspendu' ? 'suspendre' : 'réactiver';
    if (!window.confirm(`Confirmer : ${label} cet élève ?`)) return;
    try {
      await client.put(`/eleves/${id}/statut`, { statut: nouveau });
      setMsg(nouveau === 'suspendu' ? 'Élève suspendu.' : 'Élève réactivé.');
      load();
    } catch (err) {
      setMsg(err.response?.data?.error || 'Erreur.');
    }
  }

  if (loading) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement...</p></div>;
  if (!data) return <div className="alert alert-danger">Élève introuvable.</div>;

  const { eleve, paiements, totaux } = data;

  return (
    <div>
      {msg && <div className="alert alert-info">{msg}</div>}

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><i className="ph ph-user"></i><h3>Informations de l'élève</h3></div>
          <div className="card-body">
            <div className="flex gap-14 mb-16" style={{ alignItems: 'center' }}>
              <div className={eleve.genre === 'F' ? 'genre-f' : 'genre-m'} style={{ width: 48, height: 48, fontSize: 16 }}>{eleve.genre}</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{eleve.prenom} {eleve.nom}</div>
                <div className="text-muted">{eleve.matricule} · {eleve.classe_nom}</div>
              </div>
            </div>
            <table>
              <tbody>
                <tr><td className="text-muted">Statut</td><td>
                  <span className={`badge ${STATUT_BADGE[eleve.statut] || 'badge-default'}`}>{STATUT_LABELS[eleve.statut] || eleve.statut}</span>
                  {!!eleve.redoublant && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Redoublant</span>}
                </td></tr>
                <tr><td className="text-muted">Date de naissance</td><td>{eleve.date_naissance || '—'}</td></tr>
                <tr><td className="text-muted">Lieu de naissance</td><td>{eleve.lieu_naissance || '—'}</td></tr>
                <tr><td className="text-muted">Parent/tuteur</td><td>{eleve.nom_parent || '—'}</td></tr>
                <tr><td className="text-muted">Téléphone</td><td>{eleve.telephone_parent || '—'}</td></tr>
                <tr><td className="text-muted">Email</td><td>{eleve.email_parent || '—'}</td></tr>
                <tr><td className="text-muted">Date d'inscription</td><td>{eleve.date_inscription || '—'}</td></tr>
                <tr><td className="text-muted">Année scolaire</td><td>{eleve.annee_scolaire || '—'}</td></tr>
              </tbody>
            </table>

            {!viewingAnnee && (
              <div className="flex gap-8" style={{ marginTop: 18, flexWrap: 'wrap' }}>
                <button className="btn btn-outline" onClick={openPaymentModal}><i className="ph ph-money"></i> Enregistrer un paiement</button>
                {eleve.classe_inf_nom && eleve.statut === 'actif' && <button className="btn btn-warning" onClick={retrograder}><i className="ph ph-arrow-circle-down"></i> Rétrograder</button>}
                {(eleve.statut === 'actif' || eleve.statut === 'suspendu') && (
                  <button className="btn btn-outline" onClick={toggleStatut}>
                    <i className={eleve.statut === 'actif' ? 'ph ph-eye-slash' : 'ph ph-eye'}></i> {eleve.statut === 'actif' ? 'Suspendre' : 'Réactiver'}
                  </button>
                )}
                {eleve.statut !== 'transfere' && <button className="btn btn-danger" onClick={archiver}><i className="ph ph-archive"></i> Archiver</button>}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><i className="ph ph-wallet"></i><h3>Situation financière</h3></div>
          <div className="card-body">
            <div className="mb-16">
              <div className="flex-between mb-12"><span>Scolarité</span><span><strong>{format(totaux.totalPayeScolarite)}</strong> / {format(eleve.frais_scolarite_total)}</span></div>
              <div className="progress-bar-wrap">
                <div className={`progress-bar-fill ${totaux.pctScolarite >= 100 ? 'green' : totaux.pctScolarite >= 50 ? 'orange' : 'red'}`} style={{ width: `${totaux.pctScolarite}%` }} />
              </div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{totaux.pctScolarite}% payé · Reste {format(totaux.resteScolarite)}</div>
            </div>
            <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="stat-card">
                <div className="stat-icon green"><i className="ph ph-check-circle"></i></div>
                <div className="stat-info"><div className="label">Inscription payée</div><div className="value" style={{ fontSize: 16 }}>{format(totaux.totalPayeInscription)}</div></div>
              </div>
              <div className="stat-card">
                <div className="stat-icon red"><i className="ph ph-arrow-counter-clockwise"></i></div>
                <div className="stat-info"><div className="label">Total remboursé</div><div className="value" style={{ fontSize: 16 }}>{format(totaux.totalRembourse)}</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><i className="ph ph-clock-counter-clockwise"></i><h3>Historique des paiements</h3></div>
        <div className="table-container">
          <table>
            <thead><tr><th>Référence</th><th>Type</th><th>Montant</th><th>Mode</th><th>Statut</th><th>Date</th><th>Comptable</th><th></th></tr></thead>
            <tbody>
              {paiements.length === 0 && <tr><td colSpan={8} className="text-center text-muted">Aucun paiement enregistré.</td></tr>}
              {paiements.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.reference}</code></td>
                  <td><span className="badge badge-info">{p.type_paiement}</span></td>
                  <td>
                    <strong style={p.statut === 'rembourse' ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {}}>{format(p.montant_usd)}</strong>
                    {p.montant_rembourse_usd > 0 && (
                      <div className="text-muted" style={{ fontSize: 11 }}><i className="ph ph-arrow-counter-clockwise"></i> Remboursé de {format(p.montant_rembourse_usd)}</div>
                    )}
                  </td>
                  <td>{p.mode_paiement}</td>
                  <td><span className={`badge ${p.statut === 'valide' ? 'badge-success' : p.statut === 'rembourse' ? 'badge-danger' : 'badge-default'}`}>{p.statut}</span></td>
                  <td className="text-muted">{new Date(p.date_paiement).toLocaleDateString('fr-FR')}</td>
                  <td className="text-muted">{p.cpt_prenom} {p.cpt_nom}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => window.open(`/recu/${p.id}`, '_blank')}><i className="ph ph-printer"></i></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`modal-backdrop ${showPaymentModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowPaymentModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className="ph ph-money"></i><h3>Enregistrer un paiement — {eleve.prenom} {eleve.nom}</h3>
            <button className="modal-close" onClick={() => setShowPaymentModal(false)}><i className="ph ph-x"></i></button>
          </div>
          <div className="modal-body">
            {paymentError && <div className="alert alert-danger"><i className="ph ph-warning-circle"></i> {paymentError}</div>}
            {paymentSuccess && (
              <div className="alert alert-success">
                <i className="ph ph-check"></i> Paiement enregistré ! Réf: {paymentSuccess.reference}
                <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => window.open(`/recu/${paymentSuccess.id}`, '_blank')}>
                  <i className="ph ph-printer"></i> Imprimer le reçu
                </button>
              </div>
            )}
            <div className="text-muted mb-16">Scolarité : {format(totaux.totalPayeScolarite)} / {format(eleve.frais_scolarite_total)} — Reste {format(totaux.resteScolarite)}</div>
            <form onSubmit={submitPayment}>
              <div className="form-grid">
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Type de paiement</label>
                    <select value={paymentForm.type_paiement} onChange={(e) => setPaymentForm({ ...paymentForm, type_paiement: e.target.value })}>
                      <option value="scolarite">Scolarité</option>
                      <option value="inscription">Inscription</option>
                      <option value="uniforme">Uniforme scolaire</option>
                      <option value="fournitures">Fournitures scolaires</option>
                      <option value="cantine">Cantine / Restauration</option>
                      <option value="transport">Transport scolaire</option>
                      <option value="excursion">Excursion / Sortie</option>
                      <option value="examen">Frais d'examen</option>
                      <option value="assurance">Assurance scolaire</option>
                      <option value="activites">Activités parascolaires</option>
                      <option value="autre">Autre</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Mode de paiement</label>
                    <select value={paymentForm.mode_paiement} onChange={(e) => setPaymentForm({ ...paymentForm, mode_paiement: e.target.value })}>
                      <option value="especes">Espèces</option>
                      <option value="mobile_money">Mobile Money</option>
                      <option value="virement">Virement</option>
                      <option value="cheque">Chèque</option>
                    </select>
                  </div>
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Montant</label>
                    <input type="number" step="0.01" min="0" value={paymentForm.montant} onChange={(e) => setPaymentForm({ ...paymentForm, montant: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Devise</label>
                    <select value={paymentForm.devise} onChange={(e) => setPaymentForm({ ...paymentForm, devise: e.target.value })}>
                      <option value="USD">USD</option>
                      <option value="CDF">CDF</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Période (optionnel)</label>
                  <input placeholder="Ex: Septembre 2026, Trimestre 1..." value={paymentForm.periode} onChange={(e) => setPaymentForm({ ...paymentForm, periode: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Description (optionnel)</label>
                  <textarea value={paymentForm.description} onChange={(e) => setPaymentForm({ ...paymentForm, description: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowPaymentModal(false)}>Fermer</button>
                <button type="submit" className="btn btn-accent" disabled={paying}>{paying ? 'Enregistrement...' : <><i className="ph ph-check-circle"></i> Valider le paiement</>}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
