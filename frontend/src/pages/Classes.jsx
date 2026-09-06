import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import RowMenu from '../components/RowMenu.jsx';
import { useDevise } from '../context/DeviseContext.jsx';

const empty = { nom: '', frais_scolarite: '', frais_inscription: '', classe_superieure_id: '', classe_inferieure_id: '', effectif_max: 50, ordre: 0, aDesSections: false, nb_sections: 3, tranches: [], est_pivot: false };

export default function Classes() {
  const { viewingAnnee } = useAnnee();
  const { format, devise } = useDevise();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editSections, setEditSections] = useState([]);
  const [nouvelleSection, setNouvelleSection] = useState('');
  const [sectionError, setSectionError] = useState('');
  const [nombreTranchesGlobal, setNombreTranchesGlobal] = useState(1);

  async function load() {
    setLoading(true);
    const params = viewingAnnee ? { all: 1, annee: viewingAnnee } : { all: 1 };
    const res = await client.get('/classes', { params });
    setClasses(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [viewingAnnee]);
  // Nombre de tranches configure dans Parametres > systeme : decide combien de champs de
  // montant proposer a la creation d'une classe (1 = comportement actuel, montant unique).
  useEffect(() => {
    client.get('/parametres').then((r) => setNombreTranchesGlobal(Number(r.data.params?.nombre_tranches_scolarite) || 1));
  }, []);

  function openNew() {
    setEditing(null);
    const nbTranches = nombreTranchesGlobal > 1 ? nombreTranchesGlobal : 0;
    setForm({ ...empty, tranches: Array(nbTranches).fill('') });
    setError(''); setShowModal(true);
  }
  async function openEdit(c) {
    setEditing(c);
    setError(''); setShowModal(true);
    setSectionError('');
    setNouvelleSection('');
    const [sectionsRes, tranchesRes] = await Promise.all([
      client.get(`/classes/${c.id}/sections`),
      client.get(`/classes/${c.id}/tranches`),
    ]);
    setEditSections(sectionsRes.data);
    // Une classe qui a deja des tranches garde exactement son propre decoupage, meme si le
    // reglage global a change depuis ; une classe sans tranches suit le reglage global
    // actuel, comme pour une nouvelle classe.
    const tranchesArr = tranchesRes.data.length > 0
      ? tranchesRes.data.map((t) => String(t.montant))
      : (nombreTranchesGlobal > 1 ? Array(nombreTranchesGlobal).fill('') : []);
    setForm({
      nom: c.nom, frais_scolarite: c.frais_scolarite, frais_inscription: c.frais_inscription,
      classe_superieure_id: c.classe_superieure_id || '', classe_inferieure_id: c.classe_inferieure_id || '',
      effectif_max: c.effectif_max, ordre: c.ordre, tranches: tranchesArr, est_pivot: !!c.est_pivot,
    });
  }

  // Une classe creee au depart sans sections peut en recevoir plus tard (ex: l'ecole ouvre
  // une deuxieme section en cours d'annee) : geree directement depuis "Modifier", sans avoir
  // a passer par la fiche detaillee de la classe.
  async function ajouterSectionEdit(e) {
    e.preventDefault();
    setSectionError('');
    if (!nouvelleSection.trim()) return;
    try {
      const res = await client.post(`/classes/${editing.id}/sections`, { nom: nouvelleSection.trim() });
      setEditSections([...editSections, res.data]);
      setNouvelleSection('');
    } catch (err) {
      setSectionError(err.response?.data?.error || 'Erreur.');
    }
  }

  async function supprimerSectionEdit(section) {
    if (!window.confirm(`Supprimer la section "${editing.nom} ${section.nom}" ?`)) return;
    try {
      await client.delete(`/classes/sections/${section.id}`);
      setEditSections(editSections.filter((s) => s.id !== section.id));
    } catch (err) {
      setSectionError(err.response?.data?.error || 'Erreur.');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (editing) {
        await client.put(`/classes/${editing.id}`, form);
      } else {
        await client.post('/classes', { ...form, nb_sections: form.aDesSections ? form.nb_sections : 0 });
      }
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  function modifierTranche(index, valeur) {
    const copie = [...form.tranches];
    copie[index] = valeur;
    setForm({ ...form, tranches: copie });
  }
  const totalTranches = form.tranches.reduce((s, t) => s + (parseFloat(t) || 0), 0);

  async function supprimer(c) {
    if (!window.confirm(`Supprimer la classe "${c.nom}" ? Elle sera déplacée vers la corbeille et pourra être restaurée pendant 30 jours.`)) return;
    try {
      await client.delete(`/classes/${c.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  async function toggleActif(c) {
    try {
      await client.put(`/classes/${c.id}`, {
        nom: c.nom,
        frais_scolarite: c.frais_scolarite,
        frais_inscription: c.frais_inscription,
        classe_superieure_id: c.classe_superieure_id || '',
        classe_inferieure_id: c.classe_inferieure_id || '',
        effectif_max: c.effectif_max,
        ordre: c.ordre,
        actif: c.actif ? 0 : 1,
        est_pivot: c.est_pivot,
      });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  const navigate = useNavigate();

  function openViewClass(c) {
    navigate(`/classes/${c.id}`);
  }

  async function downloadEleves(classeId, status) {
    try {
      const res = await client.get('/rapports/download/eleves.xlsx', {
        params: { classe_id: classeId, status, devise },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eleves_${status}_${classeId || 'all'}_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors du telechargement du rapport.');
    }
  }

  function sortClasseEleves(field) {
    // no-op: kept for compatibility with older modal code
    return;
  }

  return (
    <div>
      <div className="flex-between mb-16">
        <div className="text-muted">
          {viewingAnnee ? `${classes.length} classe(s) avec des élèves en ${viewingAnnee}` : `${classes.filter((c) => c.actif).length} classe(s) active(s)`}
        </div>
        {!viewingAnnee && <button className="btn btn-accent" onClick={openNew}><i className="ph ph-plus"></i> Nouvelle classe</button>}
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Ordre</th><th>Nom</th><th>Sections</th><th>Frais scolarité</th><th>Frais inscription</th><th>Effectif max</th><th>Classe suivante</th><th>{viewingAnnee ? 'Élèves cette année' : 'Statut'}</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
              {!loading && classes.map((c) => (
                <tr key={c.id}>
                  <td>{c.ordre}</td>
                  <td>
                    <strong>{c.nom}</strong>
                    <div>
                      <button className="btn btn-link btn-sm" onClick={() => openViewClass(c)} style={{ marginLeft: 8 }}>Voir</button>
                    </div>
                  </td>
                  <td>
                    {(c.sections || []).length > 0
                      ? (c.sections || []).map((s) => <span key={s.id} className="badge badge-default" style={{ marginRight: 4 }}>{s.nom}</span>)
                      : <span className="text-muted">—</span>}
                  </td>
                  <td>{format(c.frais_scolarite)}</td>
                  <td>{format(c.frais_inscription)}</td>
                  <td>{c.effectif_max}</td>
                  <td className="text-muted">
                    {c.est_pivot
                      ? <span className="badge badge-warning" title="Chaque élève doit être transféré individuellement vers la classe qu'il a choisie."><i className="ph ph-git-fork"></i> Plusieurs (transfert manuel)</span>
                      : (classes.find((x) => x.id === c.classe_superieure_id)?.nom || '—')}
                  </td>
                  <td>
                    {viewingAnnee
                      ? <span className="badge badge-info">{c.nb_eleves_annee} élève(s)</span>
                      : <span className={`badge ${c.actif ? 'badge-success' : 'badge-default'}`}>{c.actif ? 'Active' : 'Archivée'}</span>}
                  </td>
                  <td>
                    {!viewingAnnee && (
                      <RowMenu>
                        {(close) => (
                          <>
                            <button onClick={() => { openEdit(c); close(); }}><i className="ph ph-pencil-simple"></i> Modifier</button>
                            <button onClick={() => { toggleActif(c); close(); }}>
                              <i className={c.actif ? 'ph ph-eye-slash' : 'ph ph-eye'}></i> {c.actif ? 'Désactiver' : 'Activer'}
                            </button>
                            <div className="row-menu-divider"></div>
                            <button className="danger" onClick={() => { supprimer(c); close(); }}><i className="ph ph-trash"></i> Supprimer</button>
                          </>
                        )}
                      </RowMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`modal-backdrop ${showModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className="ph ph-buildings"></i><h3>{editing ? 'Modifier la classe' : 'Nouvelle classe'}</h3>
            <button className="modal-close" onClick={() => setShowModal(false)}><i className="ph ph-x"></i></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-grid">
                <div className="form-group"><label>Nom *</label><input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required /></div>
                {form.tranches.length > 0 ? (
                  <div className="form-group">
                    <label>Tranches de scolarité *</label>
                    {form.tranches.map((montant, i) => (
                      <div key={i} className="flex gap-8 mb-8" style={{ alignItems: 'center' }}>
                        <span className="text-muted" style={{ minWidth: 80 }}>Tranche {i + 1}</span>
                        <input type="number" step="0.01" min="0" value={montant} onChange={(e) => modifierTranche(i, e.target.value)} required />
                      </div>
                    ))}
                    <div><strong>Total annuel : {totalTranches.toLocaleString('fr-FR')}</strong></div>
                    <div className="form-group" style={{ marginTop: 8 }}>
                      <label>Frais d'inscription</label>
                      <input type="number" step="0.01" value={form.frais_inscription} onChange={(e) => setForm({ ...form, frais_inscription: e.target.value })} />
                    </div>
                  </div>
                ) : (
                  <div className="form-grid form-grid-2">
                    <div className="form-group"><label>Frais scolarité (annuel) *</label><input type="number" step="0.01" value={form.frais_scolarite} onChange={(e) => setForm({ ...form, frais_scolarite: e.target.value })} required /></div>
                    <div className="form-group"><label>Frais d'inscription</label><input type="number" step="0.01" value={form.frais_inscription} onChange={(e) => setForm({ ...form, frais_inscription: e.target.value })} /></div>
                  </div>
                )}
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Effectif max</label><input type="number" value={form.effectif_max} onChange={(e) => setForm({ ...form, effectif_max: e.target.value })} /></div>
                  <div className="form-group"><label>Ordre d'affichage</label><input type="number" value={form.ordre} onChange={(e) => setForm({ ...form, ordre: e.target.value })} /></div>
                </div>
                <div className="form-group">
                  <label className="flex gap-8" style={{ alignItems: 'center' }}>
                    <input type="checkbox" checked={form.est_pivot} onChange={(e) => setForm({ ...form, est_pivot: e.target.checked, classe_superieure_id: e.target.checked ? '' : form.classe_superieure_id })} style={{ width: 'auto' }} />
                    Cette classe est une classe pivot
                  </label>
                  <small className="text-muted">Les élèves de cette classe se séparent vers plusieurs classes différentes au choix (ex: la 8ème avant les options d'humanités). La promotion annuelle ne peut pas choisir à leur place : chaque élève devra être transféré individuellement vers la classe qu'il a choisie.</small>
                </div>
                {form.est_pivot ? (
                  <div className="alert alert-info">
                    <i className="ph ph-info"></i> Après la promotion, les élèves de cette classe resteront visibles ici jusqu'à ce qu'un administrateur les transfère un par un vers leur classe suivante (bouton "Transférer" sur la fiche de chaque élève).
                  </div>
                ) : (
                  <div className="form-group">
                    <label>Classe supérieure (promotion)</label>
                    <select value={form.classe_superieure_id} onChange={(e) => setForm({ ...form, classe_superieure_id: e.target.value })}>
                      <option value="">Aucune (dernière classe / diplôme)</option>
                      {classes.filter((c) => !editing || c.id !== editing.id).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                    <small>Utilisée lors de la promotion annuelle.</small>
                  </div>
                )}
                <div className="form-group">
                  <label>Classe inférieure (redoublement)</label>
                  <select value={form.classe_inferieure_id} onChange={(e) => setForm({ ...form, classe_inferieure_id: e.target.value })}>
                    <option value="">Aucune</option>
                    {classes.filter((c) => !editing || c.id !== editing.id).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
                {!editing && (
                  <div className="form-group">
                    <label className="flex gap-8" style={{ alignItems: 'center' }}>
                      <input type="checkbox" checked={form.aDesSections} onChange={(e) => setForm({ ...form, aDesSections: e.target.checked })} style={{ width: 'auto' }} />
                      Cette classe a des sections (A, B, C...)
                    </label>
                    {form.aDesSections && (
                      <div style={{ marginTop: 8 }}>
                        <label>Nombre de sections</label>
                        <input type="number" min="2" max="26" value={form.nb_sections} onChange={(e) => setForm({ ...form, nb_sections: e.target.value })} />
                        <small className="text-muted">Créera automatiquement "{form.nom || 'Classe'} A", "{form.nom || 'Classe'} B"...</small>
                      </div>
                    )}
                  </div>
                )}
                {editing && (
                  <div className="form-group">
                    <label>Sections</label>
                    {sectionError && <div className="alert alert-danger">{sectionError}</div>}
                    {editSections.length === 0 && (
                      <div className="text-muted mb-8">Aucune section pour l'instant — tous les élèves sont directement dans "{editing.nom}".</div>
                    )}
                    {editSections.length > 0 && (
                      <table className="mb-8">
                        <tbody>
                          {editSections.map((s) => (
                            <tr key={s.id}>
                              <td>{editing.nom} {s.nom}</td>
                              <td><button type="button" className="btn btn-link btn-sm danger" onClick={() => supprimerSectionEdit(s)}><i className="ph ph-trash"></i></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="flex gap-8">
                      <input placeholder="Ex: A, B, C..." value={nouvelleSection} onChange={(e) => setNouvelleSection(e.target.value)} style={{ flex: 1 }} />
                      <button type="button" className="btn btn-outline btn-sm" onClick={ajouterSectionEdit}>Ajouter</button>
                    </div>
                    <small className="text-muted">Une classe créée sans sections peut en recevoir à tout moment, par exemple si l'école ouvre une nouvelle section en cours d'année.</small>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Annuler</button>
              <button type="submit" className="btn btn-accent" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
