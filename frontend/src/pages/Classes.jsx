import React, { useEffect, useState } from 'react';
import client from '../api/client.js';

function fmt(n) { return (parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const empty = { nom: '', frais_scolarite: '', frais_inscription: '', classe_superieure_id: '', classe_inferieure_id: '', effectif_max: 50, ordre: 0 };

export default function Classes() {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const res = await client.get('/classes', { params: { all: 1 } });
    setClasses(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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

  async function archiver(c) {
    if (!window.confirm(`Archiver la classe "${c.nom}" ?`)) return;
    try {
      await client.delete(`/classes/${c.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  return (
    <div>
      <div className="flex-between mb-16">
        <div className="text-muted">{classes.filter((c) => c.actif).length} classe(s) active(s)</div>
        <button className="btn btn-accent" onClick={openNew}><i className="ri-add-line"></i> Nouvelle classe</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Ordre</th><th>Nom</th><th>Frais scolarité</th><th>Frais inscription</th><th>Effectif max</th><th>Classe suivante</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8} className="text-center text-muted">Chargement...</td></tr>}
              {!loading && classes.map((c) => (
                <tr key={c.id}>
                  <td>{c.ordre}</td>
                  <td><strong>{c.nom}</strong></td>
                  <td>{fmt(c.frais_scolarite)} {c.devise}</td>
                  <td>{fmt(c.frais_inscription)} {c.devise}</td>
                  <td>{c.effectif_max}</td>
                  <td className="text-muted">{classes.find((x) => x.id === c.classe_superieure_id)?.nom || '—'}</td>
                  <td><span className={`badge ${c.actif ? 'badge-success' : 'badge-default'}`}>{c.actif ? 'Active' : 'Archivée'}</span></td>
                  <td className="flex gap-8">
                    <button className="btn btn-outline btn-sm" onClick={() => openEdit(c)}><i className="ri-edit-line"></i></button>
                    {c.actif ? <button className="btn btn-danger btn-sm" onClick={() => archiver(c)}><i className="ri-archive-line"></i></button> : null}
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
            <i className="ri-building-4-line"></i><h3>{editing ? 'Modifier la classe' : 'Nouvelle classe'}</h3>
            <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
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
