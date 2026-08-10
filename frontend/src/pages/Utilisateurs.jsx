import React, { useEffect, useState } from 'react';
import client from '../api/client.js';

const empty = { nom: '', prenom: '', email: '', role: 'comptable', telephone: '', permissions: [] };

export default function Utilisateurs() {
  const [users, setUsers] = useState([]);
  const [permsDispo, setPermsDispo] = useState({});
  const [defaultPassword, setDefaultPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  async function load() {
    setLoading(true);
    const res = await client.get('/utilisateurs');
    setUsers(res.data.users);
    setPermsDispo(res.data.permissionsDisponibles);
    setDefaultPassword(res.data.defaultPassword);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function togglePerm(key) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key],
    }));
  }

  function openNew() { setEditing(null); setForm(empty); setError(''); setShowModal(true); }
  function openEdit(u) {
    setEditing(u);
    let perms = {};
    try { perms = JSON.parse(u.permissions || '{}'); } catch (e) { /* noop */ }
    setForm({ nom: u.nom, prenom: u.prenom, email: u.email, role: u.role, telephone: u.telephone || '', permissions: Object.keys(perms).filter((k) => perms[k]) });
    setError(''); setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (editing) {
        await client.put(`/utilisateurs/${editing.id}`, { ...form, actif: editing.actif });
      } else {
        const res = await client.post('/utilisateurs', form);
        setNotice(`Utilisateur créé. Mot de passe par défaut : ${res.data.defaultPassword}`);
      }
      setShowModal(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function reinitMdp(u) {
    if (!window.confirm(`Réinitialiser le mot de passe de ${u.prenom} ${u.nom} ?`)) return;
    const res = await client.post(`/utilisateurs/${u.id}/reinitialiser-mdp`);
    setNotice(`Mot de passe réinitialisé pour ${u.prenom} ${u.nom} : ${res.data.defaultPassword}`);
  }

  async function desactiver(u) {
    if (!window.confirm(`Désactiver le compte de ${u.prenom} ${u.nom} ?`)) return;
    try {
      await client.delete(`/utilisateurs/${u.id}`);
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    }
  }

  return (
    <div>
      {notice && <div className="alert alert-success"><i className="ph ph-info"></i> {notice}</div>}
      <div className="flex-between mb-16">
        <div className="text-muted">{users.length} utilisateur(s)</div>
        <button className="btn btn-accent" onClick={openNew}><i className="ph ph-user-plus"></i> Nouvel utilisateur</button>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
              {!loading && users.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.prenom} {u.nom}</strong></td>
                  <td>{u.email}</td>
                  <td><span className="badge badge-info">{u.role}</span></td>
                  <td><span className={`badge ${u.actif ? 'badge-success' : 'badge-default'}`}>{u.actif ? 'Actif' : 'Désactivé'}</span></td>
                  <td className="text-muted">{u.derniere_connexion ? new Date(u.derniere_connexion).toLocaleString('fr-FR') : 'Jamais'}</td>
                  <td className="flex gap-8">
                    <button className="btn btn-outline btn-sm" onClick={() => openEdit(u)}><i className="ph ph-pencil-simple"></i></button>
                    <button className="btn btn-warning btn-sm" onClick={() => reinitMdp(u)}><i className="ph ph-key"></i></button>
                    {u.actif ? <button className="btn btn-danger btn-sm" onClick={() => desactiver(u)}><i className="ph ph-user-minus"></i></button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`modal-backdrop ${showModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
        <div className="modal">
          <div className="modal-header"><i className="ph ph-user-gear"></i><h3>{editing ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}</h3><button className="modal-close" onClick={() => setShowModal(false)}><i className="ph ph-x"></i></button></div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-grid">
                <div className="form-section-title">Identité</div>
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Nom *</label><input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required /></div>
                  <div className="form-group"><label>Prénom *</label><input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required /></div>
                </div>
                <div className="form-group">
                  <label>Email *</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required disabled={!!editing} />
                </div>
                <div className="form-section-title">Rôle &amp; permissions</div>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Rôle</label>
                    <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                      <option value="admin">Administrateur</option>
                      <option value="comptable">Comptable</option>
                      <option value="directeur">Directeur</option>
                      <option value="caissier">Agent / Caissier</option>
                    </select>
                  </div>
                  <div className="form-group"><label>Téléphone</label><input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></div>
                </div>
                {form.role !== 'admin' && (
                  <div className="form-group">
                    <label>Permissions</label>
                    {Object.entries(permsDispo).map(([key, label]) => (
                      <label key={key} className="checkbox-row">
                        <input type="checkbox" checked={form.permissions.includes(key)} onChange={() => togglePerm(key)} /> {label}
                      </label>
                    ))}
                  </div>
                )}
                {!editing && <div className="alert alert-info">Mot de passe par défaut attribué : <strong>{defaultPassword}</strong> (l'utilisateur devra le changer à sa première connexion).</div>}
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
