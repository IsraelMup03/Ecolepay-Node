import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import RowMenu from '../components/RowMenu.jsx';

function fmt(n) { return (parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const empty = { nom: '', frais_scolarite: '', frais_inscription: '', classe_superieure_id: '', classe_inferieure_id: '', effectif_max: 50, ordre: 0 };

export default function Classes() {
  const { viewingAnnee } = useAnnee();
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const params = viewingAnnee ? { all: 1, annee: viewingAnnee } : { all: 1 };
    const res = await client.get('/classes', { params });
    setClasses(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [viewingAnnee]);

  function openNew() { setEditing(null); setForm(empty); setError(''); setShowModal(true); }
  function openEdit(c) {
    setEditing(c);
    setForm({
      nom: c.nom, frais_scolarite: c.frais_scolarite, frais_inscription: c.frais_inscription,
      classe_superieure_id: c.classe_superieure_id || '', classe_inferieure_id: c.classe_inferieure_id || '',
      effectif_max: c.effectif_max, ordre: c.ordre,
    });
    setError(''); setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (editing) await client.put(`/classes/${editing.id}`, form);
      else await client.post('/classes', form);
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

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
      const res = await client.get('/rapports/download/eleves.csv', {
        params: { classe_id: classeId, status },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=UTF-8' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eleves_${status}_${classeId || 'all'}_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors du telechargement du CSV.');
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
            <thead><tr><th>Ordre</th><th>Nom</th><th>Frais scolarité</th><th>Frais inscription</th><th>Effectif max</th><th>Classe suivante</th><th>{viewingAnnee ? 'Élèves cette année' : 'Statut'}</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
              {!loading && classes.map((c) => (
                <tr key={c.id}>
                  <td>{c.ordre}</td>
                  <td>
                    <strong>{c.nom}</strong>
                    <div>
                      <button className="btn btn-link btn-sm" onClick={() => openViewClass(c)} style={{ marginLeft: 8 }}>Voir</button>
                    </div>
                  </td>
                  <td>{fmt(c.frais_scolarite)} {c.devise}</td>
                  <td>{fmt(c.frais_inscription)} {c.devise}</td>
                  <td>{c.effectif_max}</td>
                  <td className="text-muted">{classes.find((x) => x.id === c.classe_superieure_id)?.nom || '—'}</td>
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
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Frais scolarité (annuel) *</label><input type="number" step="0.01" value={form.frais_scolarite} onChange={(e) => setForm({ ...form, frais_scolarite: e.target.value })} required /></div>
                  <div className="form-group"><label>Frais d'inscription</label><input type="number" step="0.01" value={form.frais_inscription} onChange={(e) => setForm({ ...form, frais_inscription: e.target.value })} /></div>
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Effectif max</label><input type="number" value={form.effectif_max} onChange={(e) => setForm({ ...form, effectif_max: e.target.value })} /></div>
                  <div className="form-group"><label>Ordre d'affichage</label><input type="number" value={form.ordre} onChange={(e) => setForm({ ...form, ordre: e.target.value })} /></div>
                </div>
                <div className="form-group">
                  <label>Classe supérieure (promotion)</label>
                  <select value={form.classe_superieure_id} onChange={(e) => setForm({ ...form, classe_superieure_id: e.target.value })}>
                    <option value="">Aucune (dernière classe / diplôme)</option>
                    {classes.filter((c) => !editing || c.id !== editing.id).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
                  <small>Utilisée lors de la promotion annuelle.</small>
                </div>
                <div className="form-group">
                  <label>Classe inférieure (redoublement)</label>
                  <select value={form.classe_inferieure_id} onChange={(e) => setForm({ ...form, classe_inferieure_id: e.target.value })}>
                    <option value="">Aucune</option>
                    {classes.filter((c) => !editing || c.id !== editing.id).map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                  </select>
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
