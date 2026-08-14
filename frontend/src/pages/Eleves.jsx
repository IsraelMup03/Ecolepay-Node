import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client, { API_URL } from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import { useDevise } from '../context/DeviseContext.jsx';
import RowMenu from '../components/RowMenu.jsx';

const STATUT_PAIEMENT_LABELS = { solde: 'Soldé', partiel: 'Partiel', non_paye: 'Non payé' };
const STATUT_PAIEMENT_BADGE = { solde: 'badge-success', partiel: 'badge-warning', non_paye: 'badge-danger' };
const STATUT_BADGE = { actif: 'badge-success', suspendu: 'badge-danger', diplome: 'badge-info', transfere: 'badge-default' };
const STATUT_LABELS = { actif: 'Actif', suspendu: 'Suspendu', diplome: 'Diplômé', transfere: 'Transféré' };

export default function Eleves() {
  const { viewingAnnee } = useAnnee();
  const { format, devise } = useDevise();
  const [eleves, setEleves] = useState([]);
  const [classes, setClasses] = useState([]);
  const [q, setQ] = useState('');
  const [classeId, setClasseId] = useState('');
  const [statut, setStatut] = useState('actif');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ nom: '', postnom: '', prenom: '', genre: 'M', classe_id: '', date_naissance: '', lieu_naissance: '', nom_parent: '', telephone_parent: '', email_parent: '', adresse: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadEleves() {
    setLoading(true);
    // "Redoublant" n'est plus un statut a part (un redoublant reste actif) : c'est un
    // simple filtre supplementaire sur le flag redoublant, pour que l'admin puisse les
    // retrouver un par un et reguler la situation de chaque classe lui-meme.
    const statutParams = statut === 'redoublant' ? { statut: 'actif', redoublant: 1 } : { statut };
    const params = viewingAnnee ? { q, classe_id: classeId, annee: viewingAnnee, page } : { q, classe_id: classeId, page, ...statutParams };
    const res = await client.get('/eleves', { params });
    setEleves(res.data.rows);
    setTotal(res.data.total);
    setTotalPages(res.data.totalPages);
    setLoading(false);
  }

  async function toggleStatut(e) {
    const nouveau = e.statut === 'actif' ? 'suspendu' : 'actif';
    const label = nouveau === 'suspendu' ? 'suspendre' : 'réactiver';
    if (!window.confirm(`Confirmer : ${label} ${e.prenom} ${e.nom} ?`)) return;
    try {
      await client.put(`/eleves/${e.id}/statut`, { statut: nouveau });
      loadEleves();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  async function retrograder(e) {
    if (!window.confirm(`Rétrograder ${e.prenom} ${e.nom} vers la classe inférieure ?`)) return;
    try {
      await client.post(`/eleves/${e.id}/retrograder`);
      loadEleves();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  async function archiver(e) {
    if (!window.confirm(`Archiver ${e.prenom} ${e.nom} ? Il sera déplacé vers la corbeille et pourra être restauré pendant 30 jours.`)) return;
    try {
      await client.delete(`/eleves/${e.id}`);
      loadEleves();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  function openNew() {
    setEditing(null);
    setForm({ nom: '', postnom: '', prenom: '', genre: 'M', classe_id: '', date_naissance: '', lieu_naissance: '', nom_parent: '', telephone_parent: '', email_parent: '', adresse: '' });
    setError('');
    setShowModal(true);
  }

  function openEdit(e) {
    setEditing(e);
    setForm({
      nom: e.nom || '', postnom: e.postnom || '', prenom: e.prenom || '', genre: e.genre || 'M', classe_id: e.classe_id || '',
      date_naissance: e.date_naissance || '', lieu_naissance: e.lieu_naissance || '',
      nom_parent: e.nom_parent || '', telephone_parent: e.telephone_parent || '', email_parent: e.email_parent || '', adresse: e.adresse || '',
    });
    setError('');
    setShowModal(true);
  }

  useEffect(() => { client.get('/classes').then((r) => setClasses(r.data)); }, []);
  useEffect(() => { setPage(1); }, [q, classeId, statut, viewingAnnee]);
  useEffect(() => {
    const t = setTimeout(loadEleves, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q, classeId, statut, viewingAnnee, page]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editing) {
        // statut n'est pas modifiable ici (dediee au toggle Suspendre/Reactiver) mais le PUT
        // l'exige : on renvoie la valeur actuelle pour ne pas l'ecraser par erreur.
        await client.put(`/eleves/${editing.id}`, { ...form, statut: editing.statut });
      } else {
        await client.post('/eleves', form);
      }
      setShowModal(false);
      loadEleves();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const token = localStorage.getItem('ecolepay_token');
    const params = new URLSearchParams({ q, classe_id: classeId, statut, devise }).toString();
    fetch(`${API_URL}/eleves/export.xlsx?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `eleves_${Date.now()}.xlsx`; a.click();
        window.URL.revokeObjectURL(url);
      });
  }

  return (
    <div>
      <div className="filters-bar">
        <div className="search-input-wrap" style={{ flex: 1, minWidth: 220 }}>
          <i className="ph ph-magnifying-glass"></i>
          <input placeholder="Rechercher un élève..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="form-group">
          <select value={classeId} onChange={(e) => setClasseId(e.target.value)}>
            <option value="">Toutes les classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
        {!viewingAnnee && (
          <div className="form-group">
            <select value={statut} onChange={(e) => setStatut(e.target.value)}>
              <option value="actif">Actifs</option>
              <option value="redoublant">Redoublants</option>
              <option value="diplome">Diplômés</option>
              <option value="suspendu">Suspendus</option>
            </select>
          </div>
        )}
        {!viewingAnnee && (
          <>
            <button className="btn btn-outline" onClick={exportCsv}><i className="ph ph-file-xls"></i> Exporter (Excel)</button>
            <button className="btn btn-accent" onClick={openNew}><i className="ph ph-plus"></i> Inscrire un élève</button>
          </>
        )}
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr><th>Matricule</th><th>Élève</th><th>Classe</th><th>Statut</th><th>Payé</th><th>Reste</th><th></th><th></th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
              {!loading && eleves.length === 0 && <tr><td colSpan={8}><div className="empty-state"><i className="ph ph-user-focus"></i><h3>Aucun élève trouvé</h3><p>Essayez d'autres critères ou inscrivez un nouvel élève.</p></div></td></tr>}
              {eleves.map((e) => {
                const reste = Math.max(0, e.frais_scolarite_total - e.total_paye);
                return (
                  <tr key={e.id}>
                    <td><code>{e.matricule}</code></td>
                    <td className="flex gap-8" style={{ alignItems: 'center' }}>
                      <div className={e.genre === 'F' ? 'genre-f' : 'genre-m'}>{e.genre}</div>
                      <div><strong>{e.prenom} {e.postnom ? `${e.postnom} ` : ''}{e.nom}</strong></div>
                    </td>
                    <td>{e.classe_nom}</td>
                    <td>
                      {e.archive
                        ? <span className={`badge ${STATUT_PAIEMENT_BADGE[e.statut_paiement] || 'badge-default'}`}>{STATUT_PAIEMENT_LABELS[e.statut_paiement] || e.statut_paiement}</span>
                        : (
                          <span className="flex gap-8" style={{ alignItems: 'center' }}>
                            <span className={`badge ${STATUT_BADGE[e.statut] || 'badge-default'}`}>{STATUT_LABELS[e.statut] || e.statut}</span>
                            {!!e.redoublant && <span className="badge badge-warning">Redoublant</span>}
                          </span>
                        )}
                    </td>
                    <td>{format(e.total_paye)}</td>
                    <td className={reste > 0 ? '' : 'text-muted'}><strong style={{ color: reste > 0 ? 'var(--danger)' : 'var(--success)' }}>{format(reste)}</strong></td>
                    <td><Link to={`/eleves/${e.id}`} className="btn btn-outline btn-sm"><i className="ph ph-eye"></i> Fiche</Link></td>
                    <td>
                      {e.statut !== 'transfere' && (
                        <RowMenu>
                          {(close) => (
                            <>
                              <button onClick={() => { openEdit(e); close(); }}><i className="ph ph-pencil-simple"></i> Modifier</button>
                              {(e.statut === 'actif' || e.statut === 'suspendu') && (
                                <button onClick={() => { toggleStatut(e); close(); }}>
                                  <i className={e.statut === 'actif' ? 'ph ph-eye-slash' : 'ph ph-eye'}></i> {e.statut === 'actif' ? 'Suspendre' : 'Réactiver'}
                                </button>
                              )}
                              {e.statut === 'actif' && (
                                <button onClick={() => { retrograder(e); close(); }}><i className="ph ph-arrow-circle-down"></i> Rétrograder</button>
                              )}
                              <button className="danger" onClick={() => { archiver(e); close(); }}><i className="ph ph-archive"></i> Archiver</button>
                            </>
                          )}
                        </RowMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="pagination">
            <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Précédent</button>
            <span className="text-muted" style={{ padding: '6px 10px' }}>Page {page} / {totalPages} ({total} élèves)</span>
            <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Suivant</button>
          </div>
        )}
      </div>

      <div className={`modal-backdrop ${showModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className={editing ? 'ph ph-pencil-simple' : 'ph ph-user-plus'}></i><h3>{editing ? `Modifier ${editing.prenom} ${editing.nom}` : 'Inscrire un nouvel élève'}</h3>
            <button className="modal-close" onClick={() => setShowModal(false)}><i className="ph ph-x"></i></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-grid">
                <div className="form-section-title">Informations de l'élève</div>
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Nom *</label><input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required /></div>
                  <div className="form-group"><label>Post-nom</label><input value={form.postnom} onChange={(e) => setForm({ ...form, postnom: e.target.value })} /></div>
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Prénom *</label><input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required /></div>
                  <div className="form-group">
                    <label>Genre</label>
                    <select value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })}>
                      <option value="M">Masculin</option><option value="F">Féminin</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Classe *</label>
                  <select value={form.classe_id} onChange={(e) => setForm({ ...form, classe_id: e.target.value })} required>
                    <option value="">Sélectionner...</option>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Date de naissance</label><input type="date" value={form.date_naissance} onChange={(e) => setForm({ ...form, date_naissance: e.target.value })} /></div>
                  <div className="form-group"><label>Lieu de naissance</label><input value={form.lieu_naissance} onChange={(e) => setForm({ ...form, lieu_naissance: e.target.value })} /></div>
                </div>
                <div className="form-section-title">Parent / tuteur</div>
                <div className="form-group"><label>Nom du parent/tuteur</label><input value={form.nom_parent} onChange={(e) => setForm({ ...form, nom_parent: e.target.value })} /></div>
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Téléphone parent</label><input value={form.telephone_parent} onChange={(e) => setForm({ ...form, telephone_parent: e.target.value })} /></div>
                  <div className="form-group"><label>Email parent</label><input type="email" value={form.email_parent} onChange={(e) => setForm({ ...form, email_parent: e.target.value })} /></div>
                </div>
                <div className="form-group"><label>Adresse</label><textarea value={form.adresse} onChange={(e) => setForm({ ...form, adresse: e.target.value })} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Annuler</button>
              <button type="submit" className="btn btn-accent" disabled={saving}>{saving ? 'Enregistrement...' : editing ? 'Enregistrer' : 'Inscrire'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
