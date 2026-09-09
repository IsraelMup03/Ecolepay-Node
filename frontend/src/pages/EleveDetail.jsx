import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import { useDevise } from '../context/DeviseContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useAlertes } from '../context/AlertesContext.jsx';
import RowMenu from '../components/RowMenu.jsx';

const STATUT_BADGE = { actif: 'badge-success', suspendu: 'badge-danger', diplome: 'badge-info', transfere: 'badge-default' };
const STATUT_LABELS = { actif: 'Actif', suspendu: 'Suspendu', diplome: 'Diplômé', transfere: 'Transféré' };
const PAIEMENT_STATUT_LABELS = { valide: 'Valide', rembourse: 'Remboursé', annule: 'Annulé', partiel: 'Partiel' };
const PAIEMENT_STATUT_BADGE = { valide: 'badge-success', rembourse: 'badge-danger', annule: 'badge-default' };

const PAIEMENT_FORM_INIT = { montant: '', devise: 'USD', type_paiement: 'scolarite', mode_paiement: 'especes', periode: '', description: '' };

export default function EleveDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { viewingAnnee } = useAnnee();
  const { format, formatOriginal, formatRepartition } = useDevise();
  const { user } = useAuth();
  const { refreshAlertes } = useAlertes();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState(PAIEMENT_FORM_INIT);
  const [paymentSectionId, setPaymentSectionId] = useState('');
  const [paymentError, setPaymentError] = useState('');
  const [paymentSuccess, setPaymentSuccess] = useState(null);
  const [paying, setPaying] = useState(false);
  const [classes, setClasses] = useState([]);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferForm, setTransferForm] = useState({ classe_id: '', section_id: '' });
  const [transferSections, setTransferSections] = useState([]);
  const [transferError, setTransferError] = useState('');
  const [transferSaving, setTransferSaving] = useState(false);
  const [showRemiseModal, setShowRemiseModal] = useState(false);
  const [remiseForm, setRemiseForm] = useState('');
  const [remiseError, setRemiseError] = useState('');
  const [remiseSaving, setRemiseSaving] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [annulerCible, setAnnulerCible] = useState(null);
  const [annulerMotif, setAnnulerMotif] = useState('');
  const [annulerError, setAnnulerError] = useState('');
  const [annulerSaving, setAnnulerSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await client.get(`/eleves/${id}`, { params: viewingAnnee ? { annee: viewingAnnee } : {} });
    setData(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id, viewingAnnee]);
  useEffect(() => { client.get('/classes').then((r) => setClasses(r.data)); }, []);
  useEffect(() => {
    if (!transferForm.classe_id) { setTransferSections([]); return; }
    client.get(`/classes/${transferForm.classe_id}/sections`).then((r) => setTransferSections(r.data));
  }, [transferForm.classe_id]);

  function openPaymentModal() {
    setPaymentForm(PAIEMENT_FORM_INIT);
    setPaymentSectionId('');
    setPaymentError('');
    setPaymentSuccess(null);
    setShowPaymentModal(true);
  }

  const besoinSection = !!(data?.sectionsDisponibles?.length
    && (paymentForm.type_paiement === 'scolarite' || paymentForm.type_paiement === 'inscription'));

  async function submitPayment(ev) {
    ev.preventDefault();
    setPaymentError('');
    if (besoinSection && !paymentSectionId) { setPaymentError('Veuillez préciser la section de cet élève.'); return; }
    setPaying(true);
    try {
      const res = await client.post('/paiements', {
        eleve_id: id,
        montant: parseFloat(paymentForm.montant),
        devise: paymentForm.devise,
        type_paiement: paymentForm.type_paiement,
        mode_paiement: paymentForm.mode_paiement,
        section_id: paymentSectionId || undefined,
        periode: paymentForm.periode,
        description: paymentForm.description,
      });
      // Ferme le formulaire et laisse place a une petite fenetre de confirmation dediee :
      // si le formulaire restait ouvert avec juste un message de succes, un clic reflexe sur
      // "Valider le paiement" (avant meme d'avoir vu le message) l'enregistrerait une 2e fois.
      setShowPaymentModal(false);
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

  function openTransfer() {
    setTransferForm({ classe_id: '', section_id: '' });
    setTransferSections([]);
    setTransferError('');
    setShowTransferModal(true);
  }

  async function submitTransfer(ev) {
    ev.preventDefault();
    setTransferError('');
    setTransferSaving(true);
    try {
      await client.post(`/eleves/${id}/transferer`, {
        classe_id: transferForm.classe_id,
        section_id: transferForm.section_id || null,
      });
      setShowTransferModal(false);
      setMsg('Élève transféré avec succès.');
      load();
      refreshAlertes();
    } catch (err) {
      setTransferError(err.response?.data?.error || 'Erreur.');
    } finally {
      setTransferSaving(false);
    }
  }

  function openRemise() {
    setRemiseForm(String(data.eleve.remise_pourcentage || 0));
    setRemiseError('');
    setShowRemiseModal(true);
  }

  async function submitRemise(ev) {
    ev.preventDefault();
    setRemiseError('');
    setRemiseSaving(true);
    try {
      await client.put(`/eleves/${id}/remise`, { remise_pourcentage: parseFloat(remiseForm) });
      setShowRemiseModal(false);
      setMsg('Remise mise à jour.');
      load();
    } catch (err) {
      setRemiseError(err.response?.data?.error || 'Erreur.');
    } finally {
      setRemiseSaving(false);
    }
  }

  function openEditInfo() {
    setEditForm({
      nom: eleve.nom || '', postnom: eleve.postnom || '', prenom: eleve.prenom || '', genre: eleve.genre || 'M',
      date_naissance: eleve.date_naissance || '', lieu_naissance: eleve.lieu_naissance || '',
      nom_parent: eleve.nom_parent || '', telephone_parent: eleve.telephone_parent || '', email_parent: eleve.email_parent || '', adresse: eleve.adresse || '',
    });
    setEditError('');
    setShowEditModal(true);
  }

  async function submitEditInfo(ev) {
    ev.preventDefault();
    setEditError('');
    setEditSaving(true);
    try {
      await client.put(`/eleves/${id}`, { ...editForm, statut: eleve.statut });
      setShowEditModal(false);
      setMsg('Informations mises à jour.');
      load();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Erreur.');
    } finally {
      setEditSaving(false);
    }
  }

  async function archiver() {
    if (!window.confirm("Archiver cet élève ? Il sera déplacé vers la corbeille et pourra être restauré pendant 30 jours.")) return;
    await client.delete(`/eleves/${id}`);
    navigate('/eleves');
  }

  function openAnnuler(p) {
    setAnnulerCible(p);
    setAnnulerMotif('');
    setAnnulerError('');
  }

  async function submitAnnuler(ev) {
    ev.preventDefault();
    setAnnulerError('');
    setAnnulerSaving(true);
    try {
      await client.post(`/paiements/${annulerCible.id}/annuler`, { motif: annulerMotif });
      setAnnulerCible(null);
      setMsg('Paiement annulé.');
      load();
    } catch (err) {
      setAnnulerError(err.response?.data?.error || 'Erreur.');
    } finally {
      setAnnulerSaving(false);
    }
  }

  async function marquerSurplusRendu(paiementId) {
    if (!window.confirm('Confirmer que ce surplus a bien été rendu au parent/tuteur ?')) return;
    try {
      await client.post(`/paiements/${paiementId}/surplus-rembourse`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
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

      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 12 }}>
        <button className="btn btn-outline" onClick={() => navigate('/eleves')}><i className="ph ph-arrow-left"></i> Retour aux élèves</button>
        <div className="flex gap-14" style={{ alignItems: 'center' }}>
          <div className={eleve.genre === 'F' ? 'genre-f' : 'genre-m'} style={{ width: 44, height: 44, fontSize: 15, flexShrink: 0 }}>{eleve.genre}</div>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{eleve.prenom} {eleve.postnom ? `${eleve.postnom} ` : ''}{eleve.nom}</h2>
            <div className="text-muted flex gap-8" style={{ alignItems: 'center', flexWrap: 'wrap', marginTop: 2 }}>
              <span>{eleve.matricule} · {eleve.classe_nom}{eleve.section_nom ? ` ${eleve.section_nom}` : ''}</span>
              <span className={`badge ${STATUT_BADGE[eleve.statut] || 'badge-default'}`}>{STATUT_LABELS[eleve.statut] || eleve.statut}</span>
              {!!eleve.redoublant && <span className="badge badge-warning">Redoublant</span>}
              {!!eleve.en_attente_orientation && <span className="badge badge-warning" title="Classe pivot : transfert manuel requis"><i className="ph ph-git-fork"></i> En attente de transfert</span>}
            </div>
          </div>
        </div>
        {!viewingAnnee && (
          <div className="flex gap-8">
            <button className="btn btn-accent" onClick={openPaymentModal}><i className="ph ph-money"></i> Enregistrer un paiement</button>
            <RowMenu>
              {(close) => (
                <>
                  <button onClick={() => { openEditInfo(); close(); }}><i className="ph ph-pencil-simple"></i> Modifier les informations</button>
                  <div className="row-menu-divider"></div>
                  {eleve.classe_inf_nom && eleve.statut === 'actif' && (
                    <button onClick={() => { retrograder(); close(); }}><i className="ph ph-arrow-circle-down"></i> Rétrograder</button>
                  )}
                  {eleve.statut === 'actif' && user?.role === 'admin' && (
                    <button onClick={() => { openTransfer(); close(); }}><i className="ph ph-arrows-left-right"></i> Transférer</button>
                  )}
                  {(eleve.statut === 'actif' || eleve.statut === 'suspendu') && (
                    <button onClick={() => { toggleStatut(); close(); }}>
                      <i className={eleve.statut === 'actif' ? 'ph ph-eye-slash' : 'ph ph-eye'}></i> {eleve.statut === 'actif' ? 'Suspendre' : 'Réactiver'}
                    </button>
                  )}
                  {eleve.statut !== 'transfere' && (
                    <button className="danger" onClick={() => { archiver(); close(); }}><i className="ph ph-archive"></i> Archiver</button>
                  )}
                </>
              )}
            </RowMenu>
          </div>
        )}
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><i className="ph ph-user"></i><h3>Informations de l'élève</h3></div>
          <div className="card-body">
            <table>
              <tbody>
                <tr><td className="text-muted">Date de naissance</td><td>{eleve.date_naissance || '—'}</td></tr>
                <tr><td className="text-muted">Lieu de naissance</td><td>{eleve.lieu_naissance || '—'}</td></tr>
                <tr><td className="text-muted">Parent/tuteur</td><td>{eleve.nom_parent || '—'}</td></tr>
                <tr><td className="text-muted">Téléphone</td><td>{eleve.telephone_parent || '—'}</td></tr>
                <tr><td className="text-muted">Email</td><td>{eleve.email_parent || '—'}</td></tr>
                <tr><td className="text-muted">Date d'inscription</td><td>{eleve.date_inscription || '—'}</td></tr>
                <tr><td className="text-muted">Année scolaire</td><td>{eleve.annee_scolaire || '—'}</td></tr>
                <tr><td className="text-muted">Remise sur la scolarité</td><td>
                  {eleve.remise_pourcentage > 0 ? <span className="badge badge-info">{eleve.remise_pourcentage}%</span> : <span className="text-muted">Aucune</span>}
                  {!viewingAnnee && <button className="btn btn-link btn-sm" style={{ marginLeft: 8 }} onClick={openRemise}>Modifier</button>}
                </td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><i className="ph ph-wallet"></i><h3>Situation financière</h3></div>
          <div className="card-body">
            <div className="mb-16">
              <div className="flex-between mb-12"><span>Scolarité</span><span><strong>{format(totaux.totalPayeScolarite)}</strong> / {format(eleve.frais_scolarite_total)}</span></div>
              {formatRepartition(totaux.totalPayeScolariteParDevise) && (
                <div className="text-muted" style={{ fontSize: 11, marginTop: -8, marginBottom: 8 }}>{formatRepartition(totaux.totalPayeScolariteParDevise)}</div>
              )}
              {data.tranches && data.tranches.length > 0 ? (
                <div>
                  {data.tranches.map((t) => (
                    <div key={t.numero} className="tranche-row">
                      <div className="tranche-label"><span>Tranche {t.numero}</span><span>{format(t.paye)} / {format(t.montant)}</span></div>
                      <div className="progress-bar-wrap sm">
                        <div className={`progress-bar-fill ${t.pct >= 100 ? 'green' : t.pct >= 50 ? 'orange' : 'red'}`} style={{ width: `${t.pct}%` }} />
                      </div>
                    </div>
                  ))}
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>{totaux.pctScolarite}% payé au total · Reste {format(totaux.resteScolarite)}</div>
                </div>
              ) : (
                <>
                  <div className="progress-bar-wrap">
                    <div className={`progress-bar-fill ${totaux.pctScolarite >= 100 ? 'green' : totaux.pctScolarite >= 50 ? 'orange' : 'red'}`} style={{ width: `${totaux.pctScolarite}%` }} />
                  </div>
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{totaux.pctScolarite}% payé · Reste {format(totaux.resteScolarite)}</div>
                </>
              )}
            </div>
            <div className="stat-grid" style={{ gridTemplateColumns: totaux.totalSurplusNonRendu > 0 ? '1fr 1fr 1fr' : '1fr 1fr' }}>
              <div className="stat-card">
                <div className="stat-icon green"><i className="ph ph-check-circle"></i></div>
                <div className="stat-info">
                  <div className="label">Inscription payée</div>
                  <div className="value" style={{ fontSize: 16 }}>{format(totaux.totalPayeInscription)}</div>
                  {formatRepartition(totaux.totalPayeInscriptionParDevise) && <div className="sub">{formatRepartition(totaux.totalPayeInscriptionParDevise)}</div>}
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-icon red"><i className="ph ph-arrow-counter-clockwise"></i></div>
                <div className="stat-info"><div className="label">Total remboursé</div><div className="value" style={{ fontSize: 16 }}>{format(totaux.totalRembourse)}</div></div>
              </div>
              {totaux.totalSurplusNonRendu > 0 && (
                <div className="stat-card">
                  <div className="stat-icon orange"><i className="ph ph-warning"></i></div>
                  <div className="stat-info"><div className="label">Surplus à rendre</div><div className="value" style={{ fontSize: 16 }}>{format(totaux.totalSurplusNonRendu)}</div></div>
                </div>
              )}
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
                    <strong style={p.statut === 'rembourse' || p.statut === 'annule' ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : {}}>{formatOriginal(p)}</strong>
                    {p.montant_rembourse_usd > 0 && (
                      <div className="text-muted" style={{ fontSize: 11 }}><i className="ph ph-arrow-counter-clockwise"></i> Remboursé de {format(p.montant_rembourse_usd)}</div>
                    )}
                    {p.montant_surplus > 0 && (
                      <div style={{ fontSize: 11, color: p.surplus_rembourse ? 'var(--text-muted)' : 'var(--warning)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <i className="ph ph-warning"></i> Surplus de {format(p.montant_surplus)}{p.surplus_rembourse ? ' (rendu)' : ' à rendre'}
                        {!p.surplus_rembourse && !viewingAnnee && (
                          <button className="btn btn-outline btn-sm" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => marquerSurplusRendu(p.id)}>Marquer rendu</button>
                        )}
                      </div>
                    )}
                  </td>
                  <td>{p.mode_paiement}</td>
                  <td><span className={`badge ${PAIEMENT_STATUT_BADGE[p.statut] || 'badge-default'}`} title={p.statut === 'annule' && p.motif_annulation ? p.motif_annulation : undefined}>{PAIEMENT_STATUT_LABELS[p.statut] || p.statut}</span></td>
                  <td className="text-muted">{new Date(p.date_paiement).toLocaleDateString('fr-FR')}</td>
                  <td className="text-muted">{p.cpt_prenom} {p.cpt_nom}</td>
                  <td className="flex gap-8">
                    <button className="btn btn-outline btn-sm" onClick={() => window.open(`/recu/${p.id}`, '_blank')} title="Imprimer le reçu"><i className="ph ph-printer"></i></button>
                    {p.statut === 'valide' && !viewingAnnee && (
                      <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger-light)' }} onClick={() => openAnnuler(p)} title="Annuler ce paiement"><i className="ph ph-x-circle"></i></button>
                    )}
                  </td>
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
                {besoinSection && (
                  <div className="form-group">
                    <label>Section de l'élève *</label>
                    <select value={paymentSectionId} onChange={(e) => setPaymentSectionId(e.target.value)} required>
                      <option value="">Sélectionner...</option>
                      {data.sectionsDisponibles.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
                    </select>
                    <small className="text-muted">Premier paiement de l'année pour cet élève : sa section reste ensuite celle-ci.</small>
                  </div>
                )}
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
                <button type="submit" className="btn btn-accent" disabled={paying || (besoinSection && !paymentSectionId)}>{paying ? 'Enregistrement...' : <><i className="ph ph-check-circle"></i> Valider le paiement</>}</button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <div className={`modal-backdrop ${paymentSuccess ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setPaymentSuccess(null)}>
        <div className="modal" style={{ maxWidth: 380 }}>
          <div className="modal-body text-center" style={{ padding: '32px 28px' }}>
            <i className="ph-fill ph-check-circle" style={{ fontSize: 48, color: 'var(--success)' }}></i>
            <h3 style={{ marginTop: 14, marginBottom: 4 }}>Paiement enregistré</h3>
            <p className="text-muted" style={{ marginBottom: 22 }}>Référence : <code>{paymentSuccess?.reference}</code></p>
            <div className="flex gap-8" style={{ justifyContent: 'center' }}>
              <button className="btn btn-outline" onClick={() => setPaymentSuccess(null)}>Fermer</button>
              <button className="btn btn-accent" onClick={() => window.open(`/recu/${paymentSuccess?.id}`, '_blank')}>
                <i className="ph ph-printer"></i> Imprimer le reçu
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`modal-backdrop ${showTransferModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowTransferModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className="ph ph-arrows-left-right"></i><h3>Transférer {eleve.prenom} {eleve.nom}</h3>
            <button className="modal-close" onClick={() => setShowTransferModal(false)}><i className="ph ph-x"></i></button>
          </div>
          <form onSubmit={submitTransfer}>
            <div className="modal-body">
              {transferError && <div className="alert alert-danger">{transferError}</div>}
              <p className="text-muted">Classe actuelle : <strong>{eleve.classe_nom}{eleve.section_nom ? ` ${eleve.section_nom}` : ''}</strong></p>
              <div className="form-group">
                <label>Nouvelle classe *</label>
                <select value={transferForm.classe_id} onChange={(e) => setTransferForm({ classe_id: e.target.value, section_id: '' })} required>
                  <option value="">Sélectionner...</option>
                  {classes.filter((c) => c.id !== eleve.classe_id).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
              </div>
              {transferSections.length > 0 && (
                <div className="form-group">
                  <label>Section</label>
                  <select value={transferForm.section_id} onChange={(e) => setTransferForm({ ...transferForm, section_id: e.target.value })}>
                    <option value="">Non assignée pour l'instant</option>
                    {transferSections.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
                  </select>
                </div>
              )}
              <p className="text-muted">Les frais de scolarité et d'inscription de l'élève seront mis à jour selon ceux de la nouvelle classe.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowTransferModal(false)}>Annuler</button>
              <button type="submit" className="btn btn-accent" disabled={transferSaving}>{transferSaving ? 'Transfert...' : 'Transférer'}</button>
            </div>
          </form>
        </div>
      </div>

      <div className={`modal-backdrop ${showRemiseModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowRemiseModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className="ph ph-percent"></i><h3>Remise — {eleve.prenom} {eleve.nom}</h3>
            <button className="modal-close" onClick={() => setShowRemiseModal(false)}><i className="ph ph-x"></i></button>
          </div>
          <form onSubmit={submitRemise}>
            <div className="modal-body">
              {remiseError && <div className="alert alert-danger">{remiseError}</div>}
              <div className="form-group">
                <label>Pourcentage de remise sur la scolarité</label>
                <input type="number" min="0" max="100" step="0.5" value={remiseForm} onChange={(e) => setRemiseForm(e.target.value)} required />
                <small className="text-muted">S'applique uniquement à la scolarité (ex: réduction familiale), jamais aux frais d'inscription. Le montant dû est recalculé immédiatement.</small>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowRemiseModal(false)}>Annuler</button>
              <button type="submit" className="btn btn-accent" disabled={remiseSaving}>{remiseSaving ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </form>
        </div>
      </div>

      <div className={`modal-backdrop ${showEditModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className="ph ph-pencil-simple"></i><h3>Modifier les informations — {eleve.prenom} {eleve.nom}</h3>
            <button className="modal-close" onClick={() => setShowEditModal(false)}><i className="ph ph-x"></i></button>
          </div>
          {editForm && (
            <form onSubmit={submitEditInfo}>
              <div className="modal-body">
                {editError && <div className="alert alert-danger">{editError}</div>}
                <div className="form-grid">
                  <div className="form-section-title">Informations de l'élève</div>
                  <div className="form-grid form-grid-2">
                    <div className="form-group"><label>Nom *</label><input value={editForm.nom} onChange={(e) => setEditForm({ ...editForm, nom: e.target.value })} required /></div>
                    <div className="form-group"><label>Post-nom</label><input value={editForm.postnom} onChange={(e) => setEditForm({ ...editForm, postnom: e.target.value })} /></div>
                  </div>
                  <div className="form-grid form-grid-2">
                    <div className="form-group"><label>Prénom *</label><input value={editForm.prenom} onChange={(e) => setEditForm({ ...editForm, prenom: e.target.value })} required /></div>
                    <div className="form-group">
                      <label>Genre</label>
                      <select value={editForm.genre} onChange={(e) => setEditForm({ ...editForm, genre: e.target.value })}>
                        <option value="M">Masculin</option><option value="F">Féminin</option>
                      </select>
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Classe</label>
                    <input value={eleve.classe_nom || ''} disabled />
                    <small className="text-muted">Pour changer de classe, utilisez "Transférer" ou "Rétrograder" depuis le menu "Gérer".</small>
                  </div>
                  <div className="form-grid form-grid-2">
                    <div className="form-group"><label>Date de naissance</label><input type="date" value={editForm.date_naissance} onChange={(e) => setEditForm({ ...editForm, date_naissance: e.target.value })} /></div>
                    <div className="form-group"><label>Lieu de naissance</label><input value={editForm.lieu_naissance} onChange={(e) => setEditForm({ ...editForm, lieu_naissance: e.target.value })} /></div>
                  </div>
                  <div className="form-section-title">Parent / tuteur</div>
                  <div className="form-group"><label>Nom du parent/tuteur</label><input value={editForm.nom_parent} onChange={(e) => setEditForm({ ...editForm, nom_parent: e.target.value })} /></div>
                  <div className="form-grid form-grid-2">
                    <div className="form-group"><label>Téléphone parent</label><input value={editForm.telephone_parent} onChange={(e) => setEditForm({ ...editForm, telephone_parent: e.target.value })} /></div>
                    <div className="form-group"><label>Email parent</label><input type="email" value={editForm.email_parent} onChange={(e) => setEditForm({ ...editForm, email_parent: e.target.value })} /></div>
                  </div>
                  <div className="form-group"><label>Adresse</label><textarea value={editForm.adresse} onChange={(e) => setEditForm({ ...editForm, adresse: e.target.value })} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowEditModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-accent" disabled={editSaving}>{editSaving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className={`modal-backdrop ${annulerCible ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setAnnulerCible(null)}>
        <div className="modal">
          <div className="modal-header">
            <i className="ph ph-x-circle"></i><h3>Annuler le paiement {annulerCible?.reference}</h3>
            <button className="modal-close" onClick={() => setAnnulerCible(null)}><i className="ph ph-x"></i></button>
          </div>
          <form onSubmit={submitAnnuler}>
            <div className="modal-body">
              {annulerError && <div className="alert alert-danger">{annulerError}</div>}
              <p className="text-muted">
                {annulerCible && formatOriginal(annulerCible)}. Ce paiement ne comptera plus dans aucun total (tableau de bord, comptabilité, situation financière de l'élève...). Un administrateur pourra le restaurer depuis la Corbeille en cas d'erreur.
              </p>
              <div className="form-group">
                <label>Motif de l'annulation *</label>
                <textarea value={annulerMotif} onChange={(e) => setAnnulerMotif(e.target.value)} placeholder="Ex: paiement enregistré deux fois par erreur" required />
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setAnnulerCible(null)}>Fermer</button>
              <button type="submit" className="btn btn-danger" disabled={annulerSaving}>{annulerSaving ? 'Annulation...' : 'Annuler le paiement'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
