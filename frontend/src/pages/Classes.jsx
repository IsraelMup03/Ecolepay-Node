import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import { useDevise } from '../context/DeviseContext.jsx';

const empty = { nom: '', frais_scolarite: '', frais_inscription: '', classe_superieure_id: '', classe_inferieure_id: '', effectif_max: 50, ordre: 0, aDesSections: false, nb_sections: 3, tranches: [], est_pivot: false };

export default function Classes() {
  const { viewingAnnee } = useAnnee();
  const { format, devise } = useDevise();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
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
    const nbTranches = nombreTranchesGlobal > 1 ? nombreTranchesGlobal : 0;
    setForm({ ...empty, tranches: Array(nbTranches).fill('') });
    setError(''); setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await client.post('/classes', { ...form, nb_sections: form.aDesSections ? form.nb_sections : 0 });
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

  return (
    <div>
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="text-muted">
          {viewingAnnee ? `${classes.length} classe(s) avec des élèves en ${viewingAnnee}` : `${classes.filter((c) => c.actif).length} classe(s) active(s)`}
        </div>
        {!viewingAnnee && <button className="btn btn-accent" onClick={openNew}><i className="ph ph-plus"></i> Nouvelle classe</button>}
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Ordre</th><th>Nom</th><th>Sections</th><th>Frais scolarité</th><th>Frais inscription</th><th>Effectif max</th><th>Classe suivante</th><th>{viewingAnnee ? 'Élèves cette année' : 'Statut'}</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
              {!loading && classes.map((c) => (
                <tr key={c.id} onClick={() => openViewClass(c)} style={{ cursor: 'pointer' }} title="Ouvrir la fiche de la classe">
                  <td>{c.ordre}</td>
                  <td><strong>{c.nom}</strong></td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`modal-backdrop ${showModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className="ph ph-buildings"></i><h3>Nouvelle classe</h3>
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
                      {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                    <small>Utilisée lors de la promotion annuelle.</small>
                  </div>
                )}
                <div className="form-group">
                  <label>Classe inférieure (redoublement)</label>
                  <select value={form.classe_inferieure_id} onChange={(e) => setForm({ ...form, classe_inferieure_id: e.target.value })}>
                    <option value="">Aucune</option>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                </div>
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
                  <small className="text-muted" style={{ display: 'block', marginTop: 4 }}>D'autres sections pourront être ajoutées ou supprimées à tout moment depuis le bouton "Gérer" de la fiche de la classe.</small>
                </div>
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
