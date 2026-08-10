import React, { useEffect, useState } from 'react';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Parametres() {
  const { user } = useAuth();
  const [ecole, setEcole] = useState(null);
  const [params, setParams] = useState({});
  const [logoFile, setLogoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  async function load() {
    const res = await client.get('/parametres');
    setEcole(res.data.ecole);
    setParams(res.data.params);
  }
  useEffect(() => { load(); }, []);

  async function saveEcole(e) {
    e.preventDefault();
    setSaving(true); setNotice('');
    const fd = new FormData();
    Object.entries(ecole).forEach(([k, v]) => { if (v !== null && k !== 'logo' && k !== 'id' && k !== 'date_creation' && k !== 'updated_at') fd.append(k, v); });
    if (logoFile) fd.append('logo', logoFile);
    try {
      await client.put('/parametres/ecole', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setNotice("Informations de l'école mises à jour.");
      load();
    } finally {
      setSaving(false);
    }
  }

  async function saveSysteme(e) {
    e.preventDefault();
    setSaving(true); setNotice('');
    try {
      await client.put('/parametres/systeme', params);
      setNotice('Paramètres système mis à jour.');
    } finally {
      setSaving(false);
    }
  }

  async function reinitialiser() {
    if (confirmation !== 'CONFIRMER') return;
    if (!window.confirm('Dernière confirmation : TOUTES les données (élèves, classes, paiements) seront définitivement supprimées. Continuer ?')) return;
    setResetLoading(true);
    try {
      await client.post('/parametres/reinitialiser', { confirmation });
      setNotice('Application réinitialisée avec succès.');
      setConfirmation('');
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    } finally {
      setResetLoading(false);
    }
  }

  if (!ecole) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement...</p></div>;

  return (
    <div>
      {notice && <div className="alert alert-success"><i className="ph ph-check"></i> {notice}</div>}

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><i className="ph ph-chalkboard-teacher"></i><h3>Informations de l'école</h3></div>
          <form onSubmit={saveEcole}>
            <div className="card-body">
              <div className="form-grid">
                <div className="form-group"><label>Nom de l'école</label><input value={ecole.nom || ''} onChange={(e) => setEcole({ ...ecole, nom: e.target.value })} required /></div>
                <div className="form-group"><label>Adresse</label><textarea value={ecole.adresse || ''} onChange={(e) => setEcole({ ...ecole, adresse: e.target.value })} /></div>
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Téléphone</label><input value={ecole.telephone || ''} onChange={(e) => setEcole({ ...ecole, telephone: e.target.value })} /></div>
                  <div className="form-group"><label>Email</label><input type="email" value={ecole.email || ''} onChange={(e) => setEcole({ ...ecole, email: e.target.value })} /></div>
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Devise principale</label>
                    <select value={ecole.devise || 'USD'} onChange={(e) => setEcole({ ...ecole, devise: e.target.value })}>
                      <option value="USD">USD</option><option value="CDF">CDF</option>
                    </select>
                  </div>
                  <div className="form-group"><label>Année scolaire</label><input value={ecole.annee_scolaire || ''} onChange={(e) => setEcole({ ...ecole, annee_scolaire: e.target.value })} /></div>
                </div>
                <div className="form-group"><label>Logo de l'école</label><input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files[0])} /></div>
                <button className="btn btn-accent btn-block" type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </div>
          </form>
        </div>

        <div className="card">
          <div className="card-header"><i className="ph ph-gear-six"></i><h3>Paramètres système</h3></div>
          <form onSubmit={saveSysteme}>
            <div className="card-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Taux de change USD → CDF</label>
                  <input type="number" step="0.01" value={params.taux_usd_cdf || ''} onChange={(e) => setParams({ ...params, taux_usd_cdf: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Délai de conservation corbeille (jours)</label>
                  <input type="number" value={params.delai_corbeille || ''} onChange={(e) => setParams({ ...params, delai_corbeille: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Format des matricules</label>
                  <input value={params.format_matricule || ''} onChange={(e) => setParams({ ...params, format_matricule: e.target.value })} />
                  <small>Variables : {'{ANNEE}'} {'{NUM}'}</small>
                </div>
                <button className="btn btn-primary btn-block" type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {user.role === 'admin' && (
        <div className="card" style={{ borderColor: '#fecaca' }}>
          <div className="card-header"><i className="ph ph-warning-circle" style={{ color: 'var(--danger)' }}></i><h3 style={{ color: 'var(--danger)' }}>Zone dangereuse</h3></div>
          <div className="card-body">
            <p className="text-muted mb-16">Cette action supprime définitivement tous les élèves, classes et paiements. Elle est irréversible. Tapez <code>CONFIRMER</code> pour activer le bouton.</p>
            <div className="flex gap-8">
              <input placeholder="Tapez CONFIRMER" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} style={{ maxWidth: 240, padding: 10, border: '1.5px solid var(--border)', borderRadius: 8 }} />
              <button className="btn btn-danger" disabled={confirmation !== 'CONFIRMER' || resetLoading} onClick={reinitialiser}>
                {resetLoading ? 'Réinitialisation...' : <><i className="ph ph-trash"></i> Réinitialiser l'application</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
