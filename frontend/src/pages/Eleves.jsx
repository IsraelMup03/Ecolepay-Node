import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import client, { API_URL } from '../api/client.js';

function fmt(n) {
  return (parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Eleves() {
  const [eleves, setEleves] = useState([]);
  const [classes, setClasses] = useState([]);
  const [q, setQ] = useState('');
  const [classeId, setClasseId] = useState('');
  const [statut, setStatut] = useState('actif');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ nom: '', prenom: '', genre: 'M', classe_id: '', date_naissance: '', lieu_naissance: '', nom_parent: '', telephone_parent: '', email_parent: '', adresse: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadEleves() {
    setLoading(true);
    const res = await client.get('/eleves', { params: { q, classe_id: classeId, statut } });
    setEleves(res.data);
    setLoading(false);
  }

  useEffect(() => { client.get('/classes').then((r) => setClasses(r.data)); }, []);
  useEffect(() => {
    const t = setTimeout(loadEleves, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [q, classeId, statut]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await client.post('/eleves', form);
      setShowModal(false);
      setForm({ nom: '', prenom: '', genre: 'M', classe_id: '', date_naissance: '', lieu_naissance: '', nom_parent: '', telephone_parent: '', email_parent: '', adresse: '' });
      loadEleves();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  function exportCsv() {
    const token = localStorage.getItem('ecolepay_token');
    const params = new URLSearchParams({ q, classe_id: classeId, statut }).toString();
    fetch(`${API_URL}/eleves/export.csv?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'eleves.csv'; a.click();
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
        <div className="form-group">
          <select value={statut} onChange={(e) => setStatut(e.target.value)}>
            <option value="actif">Actifs</option>
            <option value="redoublant">Redoublants</option>
            <option value="diplome">Diplômés</option>
            <option value="suspendu">Suspendus</option>
          </select>
        </div>
        <button className="btn btn-outline" onClick={exportCsv}><i className="ph ph-download-simple"></i> Exporter CSV</button>
        <button className="btn btn-accent" onClick={() => setShowModal(true)}><i className="ph ph-plus"></i> Inscrire un élève</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr><th>Matricule</th><th>Élève</th><th>Classe</th><th>Statut</th><th>Payé</th><th>Reste</th><th></th></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
              {!loading && eleves.length === 0 && <tr><td colSpan={7}><div className="empty-state"><i className="ph ph-user-focus"></i><h3>Aucun élève trouvé</h3><p>Essayez d'autres critères ou inscrivez un nouvel élève.</p></div></td></tr>}
              {eleves.map((e) => {
                const reste = Math.max(0, e.frais_scolarite_total - e.total_paye);
                return (
                  <tr key={e.id}>
                    <td><code>{e.matricule}</code></td>
                    <td className="flex gap-8" style={{ alignItems: 'center' }}>
                      <div className={e.genre === 'F' ? 'genre-f' : 'genre-m'}>{e.genre}</div>
                      <div><strong>{e.prenom} {e.nom}</strong></div>
                    </td>
                    <td>{e.classe_nom}</td>
                    <td><span className={`badge ${e.statut === 'actif' ? 'badge-success' : e.statut === 'redoublant' ? 'badge-warning' : 'badge-default'}`}>{e.statut}</span></td>
                    <td>{fmt(e.total_paye)}</td>
                    <td className={reste > 0 ? '' : 'text-muted'}><strong style={{ color: reste > 0 ? 'var(--danger)' : 'var(--success)' }}>{fmt(reste)}</strong></td>
                    <td><Link to={`/eleves/${e.id}`} className="btn btn-outline btn-sm"><i className="ph ph-eye"></i> Fiche</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`modal-backdrop ${showModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className="ph ph-user-plus"></i><h3>Inscrire un nouvel élève</h3>
            <button className="modal-close" onClick={() => setShowModal(false)}><i className="ph ph-x"></i></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-grid">
                <div className="form-section-title">Informations de l'élève</div>
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Nom *</label><input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required /></div>
                  <div className="form-group"><label>Prénom *</label><input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required /></div>
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Genre</label>
                    <select value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })}>
                      <option value="M">Masculin</option><option value="F">Féminin</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Classe *</label>
                    <select value={form.classe_id} onChange={(e) => setForm({ ...form, classe_id: e.target.value })} required>
                      <option value="">Sélectionner...</option>
                      {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                  </div>
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
              <button type="submit" className="btn btn-accent" disabled={saving}>{saving ? 'Enregistrement...' : 'Inscrire'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
