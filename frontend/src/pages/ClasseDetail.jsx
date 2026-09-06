import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import client from '../api/client.js';
import { useDevise } from '../context/DeviseContext.jsx';
import RowMenu from '../components/RowMenu.jsx';

export default function ClasseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { format, devise } = useDevise();
  const [classe, setClasse] = useState(null);
  const [stats, setStats] = useState(null);
  const [sections, setSections] = useState([]);
  const [nouvelleSection, setNouvelleSection] = useState('');
  const [sectionError, setSectionError] = useState('');
  const [eleves, setEleves] = useState([]);
  const [eleveSearch, setEleveSearch] = useState('');
  const [eleveSort, setEleveSort] = useState({ field: 'nom', order: 'asc' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allClasses, setAllClasses] = useState([]);
  const [nombreTranchesGlobal, setNombreTranchesGlobal] = useState(1);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  useEffect(() => { loadClasse(); }, [id]);
  useEffect(() => {
    client.get('/classes', { params: { all: 1 } }).then((r) => setAllClasses(r.data));
    client.get('/parametres').then((r) => setNombreTranchesGlobal(Number(r.data.params?.nombre_tranches_scolarite) || 1));
  }, []);

  async function loadClasse() {
    setLoading(true);
    setError('');
    try {
      const [classeRes, elevesRes] = await Promise.all([
        client.get(`/classes/${id}/stats`),
        client.get(`/eleves/by-classe/${id}`),
      ]);
      setClasse(classeRes.data.classe);
      setStats(classeRes.data.stats);
      setSections(classeRes.data.sections || []);
      setEleves(elevesRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du chargement de la classe.');
      setClasse(null);
      setEleves([]);
    } finally {
      setLoading(false);
    }
  }

  async function ajouterSection(e) {
    e.preventDefault();
    setSectionError('');
    if (!nouvelleSection.trim()) return;
    try {
      await client.post(`/classes/${id}/sections`, { nom: nouvelleSection.trim() });
      setNouvelleSection('');
      loadClasse();
    } catch (err) {
      setSectionError(err.response?.data?.error || 'Erreur.');
    }
  }

  async function supprimerSection(section) {
    if (!window.confirm(`Supprimer la section "${classe?.nom} ${section.nom}" ?`)) return;
    try {
      await client.delete(`/classes/sections/${section.id}`);
      loadClasse();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  async function openEditModal() {
    setEditError('');
    setSectionError('');
    setNouvelleSection('');
    setShowEditModal(true);
    const { data: tranches } = await client.get(`/classes/${id}/tranches`);
    // Une classe qui a deja des tranches garde exactement son propre decoupage, meme si le
    // reglage global a change depuis ; une classe sans tranches suit le reglage global actuel.
    const tranchesArr = tranches.length > 0
      ? tranches.map((t) => String(t.montant))
      : (nombreTranchesGlobal > 1 ? Array(nombreTranchesGlobal).fill('') : []);
    setEditForm({
      nom: classe.nom, frais_scolarite: classe.frais_scolarite, frais_inscription: classe.frais_inscription,
      classe_superieure_id: classe.classe_superieure_id || '', classe_inferieure_id: classe.classe_inferieure_id || '',
      effectif_max: classe.effectif_max, ordre: classe.ordre, tranches: tranchesArr, est_pivot: !!classe.est_pivot,
    });
  }

  function modifierTranche(index, valeur) {
    const copie = [...editForm.tranches];
    copie[index] = valeur;
    setEditForm({ ...editForm, tranches: copie });
  }

  async function submitEditModal(e) {
    e.preventDefault();
    setEditSaving(true);
    setEditError('');
    try {
      await client.put(`/classes/${id}`, editForm);
      setShowEditModal(false);
      loadClasse();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Erreur.');
    } finally {
      setEditSaving(false);
    }
  }

  async function toggleActif() {
    try {
      await client.put(`/classes/${id}`, {
        nom: classe.nom, frais_scolarite: classe.frais_scolarite, frais_inscription: classe.frais_inscription,
        classe_superieure_id: classe.classe_superieure_id || '', classe_inferieure_id: classe.classe_inferieure_id || '',
        effectif_max: classe.effectif_max, ordre: classe.ordre, actif: classe.actif ? 0 : 1, est_pivot: classe.est_pivot,
      });
      loadClasse();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  async function supprimer() {
    if (!window.confirm(`Supprimer la classe "${classe.nom}" ? Elle sera déplacée vers la corbeille et pourra être restaurée pendant 30 jours.`)) return;
    try {
      await client.delete(`/classes/${id}`);
      navigate('/classes');
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  function sortEleves(field) {
    setEleveSort((current) => {
      const order = current.field === field && current.order === 'asc' ? 'desc' : 'asc';
      return { field, order };
    });
  }

  async function downloadEleves(status) {
    try {
      const res = await client.get('/rapports/download/eleves.xlsx', {
        params: { classe_id: id, status, devise },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `classe_${id}_${status}_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors du téléchargement du rapport.');
    }
  }

  const filteredEleves = eleves
    .filter((e) => {
      const search = eleveSearch.trim().toLowerCase();
      if (!search) return true;
      return [e.matricule, e.nom, e.prenom, e.perce_par].some((value) => (value || '').toLowerCase().includes(search));
    })
    .sort((a, b) => {
      const field = eleveSort.field;
      const order = eleveSort.order === 'asc' ? 1 : -1;
      if (field === 'total_paye' || field === 'reste') {
        return (parseFloat(a[field] || 0) - parseFloat(b[field] || 0)) * order;
      }
      const va = (a[field] || '').toString().toLowerCase();
      const vb = (b[field] || '').toString().toLowerCase();
      return va.localeCompare(vb) * order;
    });

  const totalTranches = editForm ? editForm.tranches.reduce((s, t) => s + (parseFloat(t) || 0), 0) : 0;

  // Classe pivot : les eleves fraichement promus depuis la classe inferieure (normaux, pas
  // encore concernes par un transfert) ne doivent jamais etre meles a ceux qui etaient deja
  // presents avant la derniere promotion et sont maintenant en retard de transfert manuel.
  const estPivot = !!classe?.est_pivot;
  const elevesEnAttente = estPivot ? filteredEleves.filter((e) => !!e.en_attente_orientation) : [];
  const elevesDeCetteAnnee = estPivot ? filteredEleves.filter((e) => !e.en_attente_orientation) : filteredEleves;

  function tableEleves(liste, emptyLabel) {
    return (
      <div className="table-container" style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th onClick={() => sortEleves('matricule')} style={{ cursor: 'pointer' }}>Matricule</th>
              <th onClick={() => sortEleves('nom')} style={{ cursor: 'pointer' }}>Nom</th>
              <th onClick={() => sortEleves('prenom')} style={{ cursor: 'pointer' }}>Prénom</th>
              <th>Section</th>
              <th onClick={() => sortEleves('total_paye')} style={{ cursor: 'pointer' }}>Total payé</th>
              <th onClick={() => sortEleves('reste')} style={{ cursor: 'pointer' }}>Reste</th>
              <th onClick={() => sortEleves('dernier_paiement_date')} style={{ cursor: 'pointer' }}>Date paiement</th>
              <th>Perçu par</th>
            </tr>
          </thead>
          <tbody>
            {liste.length === 0 && (
              <tr><td colSpan={8} className="text-center text-muted">{emptyLabel}</td></tr>
            )}
            {liste.map((e) => (
              <tr key={e.id} onClick={() => navigate(`/eleves/${e.id}`)} style={{ cursor: 'pointer' }} title="Ouvrir la fiche de l'élève">
                <td>{e.matricule}</td>
                <td>{e.nom} {!!e.redoublant && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Redoublant</span>}</td>
                <td>{e.prenom}</td>
                <td>{e.section_nom || '—'}</td>
                <td>{format(e.total_paye)}</td>
                <td>{format(Math.max(0, (e.frais_scolarite_total || 0) - (e.total_paye || 0)))}</td>
                <td>{e.dernier_paiement_date || '—'}</td>
                <td>{e.perce_par || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg"></div>
        <p>Chargement...</p>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }

  return (
    <div>
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <button className="btn btn-outline" onClick={() => navigate('/classes')}><i className="ph ph-arrow-left"></i> Retour aux classes</button>
        <div>
          <h2 style={{ margin: 0 }}>{classe?.nom || 'Classe'}</h2>
          <div className="text-muted">{eleves.length} élève(s) actif(s)</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={() => downloadEleves('solde')}>Télécharger élèves soldés</button>
          <button className="btn btn-outline btn-sm" onClick={() => downloadEleves('non_solde')}>Télécharger élèves non soldés</button>
          <RowMenu>
            {(close) => (
              <>
                <button onClick={() => { openEditModal(); close(); }}><i className="ph ph-pencil-simple"></i> Modifier</button>
                <button onClick={() => { toggleActif(); close(); }}>
                  <i className={classe?.actif ? 'ph ph-eye-slash' : 'ph ph-eye'}></i> {classe?.actif ? 'Désactiver' : 'Activer'}
                </button>
                <div className="row-menu-divider"></div>
                <button className="danger" onClick={() => { supprimer(); close(); }}><i className="ph ph-trash"></i> Supprimer</button>
              </>
            )}
          </RowMenu>
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><h3>Informations</h3></div>
          <div className="card-body">
            <table>
              <tbody>
                <tr><td className="text-muted">Nom</td><td>{classe?.nom || '—'}</td></tr>
                <tr><td className="text-muted">Statut</td><td>{classe?.actif ? 'Active' : 'Archivée'}</td></tr>
                <tr><td className="text-muted">Ordre</td><td>{classe?.ordre || '—'}</td></tr>
                <tr><td className="text-muted">Effectif max</td><td>{classe?.effectif_max || '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Résultats</h3></div>
          <div className="card-body">
            <div className="stat-card"><div className="stat-info"><div className="label">Total attendu</div><div className="value">{format(stats?.total_attendu)}</div></div></div>
            <div className="stat-card"><div className="stat-info"><div className="label">Total payé</div><div className="value">{format(stats?.total_paye)}</div></div></div>
            <div className="stat-card"><div className="stat-info"><div className="label">Reste</div><div className="value">{format((stats?.total_attendu || 0) - (stats?.total_paye || 0))}</div></div></div>
          </div>
        </div>
      </div>

      {estPivot ? (
        <>
          <div className="card mb-16">
            <div className="card-header">
              <h3><i className="ph ph-git-fork"></i> En attente de transfert <span className="badge badge-warning" style={{ marginLeft: 8 }}>{elevesEnAttente.length}</span></h3>
            </div>
            <div className="card-body">
              <div className="alert alert-warning mb-8">
                Ces élèves étaient déjà dans "{classe?.nom}" avant la dernière promotion : ils doivent être transférés individuellement vers la classe qu'ils ont choisie (ouvrir leur fiche → bouton "Transférer").
              </div>
              {tableEleves(elevesEnAttente, 'Aucun élève en attente de transfert.')}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3>Élèves de cette année</h3></div>
            <div className="card-body">
              <div className="flex-between mb-8" style={{ flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <label style={{ margin: 0 }}>Recherche</label>
                  <input type="search" value={eleveSearch} onChange={(e) => setEleveSearch(e.target.value)} placeholder="Matricule, Nom, Prénom, Perçu par..." style={{ minWidth: 240 }} />
                </div>
                <div className="text-muted">{elevesDeCetteAnnee.length} résultat(s)</div>
              </div>
              {tableEleves(elevesDeCetteAnnee, 'Aucun élève actif trouvé pour cette classe.')}
            </div>
          </div>
        </>
      ) : (
        <div className="card">
          <div className="card-header"><h3>Liste des élèves</h3></div>
          <div className="card-body">
            <div className="flex-between mb-8" style={{ flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <label style={{ margin: 0 }}>Recherche</label>
                <input type="search" value={eleveSearch} onChange={(e) => setEleveSearch(e.target.value)} placeholder="Matricule, Nom, Prénom, Perçu par..." style={{ minWidth: 240 }} />
              </div>
              <div className="text-muted">{filteredEleves.length} résultat(s)</div>
            </div>
            {tableEleves(filteredEleves, 'Aucun élève actif trouvé pour cette classe.')}
          </div>
        </div>
      )}

      <div className={`modal-backdrop ${showEditModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className="ph ph-pencil-simple"></i><h3>Modifier {classe?.nom}</h3>
            <button className="modal-close" onClick={() => setShowEditModal(false)}><i className="ph ph-x"></i></button>
          </div>
          {editForm && (
            <form onSubmit={submitEditModal}>
              <div className="modal-body">
                {editError && <div className="alert alert-danger">{editError}</div>}
                <div className="form-grid">
                  <div className="form-group"><label>Nom *</label><input value={editForm.nom} onChange={(e) => setEditForm({ ...editForm, nom: e.target.value })} required /></div>
                  {editForm.tranches.length > 0 ? (
                    <div className="form-group">
                      <label>Tranches de scolarité *</label>
                      {editForm.tranches.map((montant, i) => (
                        <div key={i} className="flex gap-8 mb-8" style={{ alignItems: 'center' }}>
                          <span className="text-muted" style={{ minWidth: 80 }}>Tranche {i + 1}</span>
                          <input type="number" step="0.01" min="0" value={montant} onChange={(e) => modifierTranche(i, e.target.value)} required />
                        </div>
                      ))}
                      <div><strong>Total annuel : {totalTranches.toLocaleString('fr-FR')}</strong></div>
                      <div className="form-group" style={{ marginTop: 8 }}>
                        <label>Frais d'inscription</label>
                        <input type="number" step="0.01" value={editForm.frais_inscription} onChange={(e) => setEditForm({ ...editForm, frais_inscription: e.target.value })} />
                      </div>
                    </div>
                  ) : (
                    <div className="form-grid form-grid-2">
                      <div className="form-group"><label>Frais scolarité (annuel) *</label><input type="number" step="0.01" value={editForm.frais_scolarite} onChange={(e) => setEditForm({ ...editForm, frais_scolarite: e.target.value })} required /></div>
                      <div className="form-group"><label>Frais d'inscription</label><input type="number" step="0.01" value={editForm.frais_inscription} onChange={(e) => setEditForm({ ...editForm, frais_inscription: e.target.value })} /></div>
                    </div>
                  )}
                  <div className="form-grid form-grid-2">
                    <div className="form-group"><label>Effectif max</label><input type="number" value={editForm.effectif_max} onChange={(e) => setEditForm({ ...editForm, effectif_max: e.target.value })} /></div>
                    <div className="form-group"><label>Ordre d'affichage</label><input type="number" value={editForm.ordre} onChange={(e) => setEditForm({ ...editForm, ordre: e.target.value })} /></div>
                  </div>
                  <div className="form-group">
                    <label className="flex gap-8" style={{ alignItems: 'center' }}>
                      <input type="checkbox" checked={editForm.est_pivot} onChange={(e) => setEditForm({ ...editForm, est_pivot: e.target.checked, classe_superieure_id: e.target.checked ? '' : editForm.classe_superieure_id })} style={{ width: 'auto' }} />
                      Cette classe est une classe pivot
                    </label>
                    <small className="text-muted">Les élèves de cette classe se séparent vers plusieurs classes différentes au choix (ex: la 8ème avant les options d'humanités). La promotion annuelle ne peut pas choisir à leur place : chaque élève devra être transféré individuellement vers la classe qu'il a choisie.</small>
                  </div>
                  {editForm.est_pivot ? (
                    <div className="alert alert-info">
                      <i className="ph ph-info"></i> Après la promotion, les élèves de cette classe resteront visibles ici jusqu'à ce qu'un administrateur les transfère un par un vers leur classe suivante (bouton "Transférer" sur la fiche de chaque élève).
                    </div>
                  ) : (
                    <div className="form-group">
                      <label>Classe supérieure (promotion)</label>
                      <select value={editForm.classe_superieure_id} onChange={(e) => setEditForm({ ...editForm, classe_superieure_id: e.target.value })}>
                        <option value="">Aucune (dernière classe / diplôme)</option>
                        {allClasses.filter((c) => c.id !== Number(id)).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                      </select>
                      <small>Utilisée lors de la promotion annuelle.</small>
                    </div>
                  )}
                  <div className="form-group">
                    <label>Classe inférieure (redoublement)</label>
                    <select value={editForm.classe_inferieure_id} onChange={(e) => setEditForm({ ...editForm, classe_inferieure_id: e.target.value })}>
                      <option value="">Aucune</option>
                      {allClasses.filter((c) => c.id !== Number(id)).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Sections</label>
                    {sectionError && <div className="alert alert-danger">{sectionError}</div>}
                    {sections.length === 0 && (
                      <div className="text-muted mb-8">Aucune section pour l'instant — tous les élèves sont directement dans "{classe?.nom}".</div>
                    )}
                    {sections.length > 0 && (
                      <table className="mb-8">
                        <tbody>
                          {sections.map((s) => (
                            <tr key={s.id}>
                              <td>{classe?.nom} {s.nom}</td>
                              <td><button type="button" className="btn btn-link btn-sm danger" onClick={() => supprimerSection(s)}><i className="ph ph-trash"></i></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="flex gap-8">
                      <input placeholder="Ex: A, B, C..." value={nouvelleSection} onChange={(e) => setNouvelleSection(e.target.value)} style={{ flex: 1 }} />
                      <button type="button" className="btn btn-outline btn-sm" onClick={ajouterSection}>Ajouter</button>
                    </div>
                    <small className="text-muted">Une classe créée sans sections peut en recevoir à tout moment, par exemple si l'école ouvre une nouvelle section en cours d'année.</small>
                  </div>
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
    </div>
  );
}
