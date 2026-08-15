import React, { useEffect, useState } from 'react';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useAnnee } from '../context/AnneeContext.jsx';
import HistoricalBlock from '../components/HistoricalBlock.jsx';

export default function Parametres() {
  const { user, setEcole: setAuthEcole } = useAuth();
  const { viewingAnnee } = useAnnee();
  const [ecole, setEcole] = useState(null);
  const [params, setParams] = useState({});
  const [ecoleForm, setEcoleForm] = useState(null);
  const [paramsForm, setParamsForm] = useState({});
  const [logoFile, setLogoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [showEcoleModal, setShowEcoleModal] = useState(false);
  const [showSystemeModal, setShowSystemeModal] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [resetLoading, setResetLoading] = useState(false);

  async function load() {
    const res = await client.get('/parametres');
    setEcole(res.data.ecole);
    setParams(res.data.params);
  }
  useEffect(() => { load(); }, []);

  function openEcoleEdit() { setEcoleForm(ecole); setLogoFile(null); setShowEcoleModal(true); }
  function openSystemeEdit() { setParamsForm(params); setShowSystemeModal(true); }

  async function saveEcole(e) {
    e.preventDefault();
    setSaving(true); setNotice('');
    const fd = new FormData();
    Object.entries(ecoleForm).forEach(([k, v]) => { if (v !== null && k !== 'logo' && k !== 'id' && k !== 'date_creation' && k !== 'updated_at') fd.append(k, v); });
    if (logoFile) fd.append('logo', logoFile);
    try {
      const res = await client.put('/parametres/ecole', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setEcole(res.data.ecole);
      setAuthEcole(res.data.ecole);
      setNotice("Informations de l'école mises à jour.");
      setShowEcoleModal(false);
    } finally {
      setSaving(false);
    }
  }

  async function saveSysteme(e) {
    e.preventDefault();
    setSaving(true); setNotice('');
    try {
      await client.put('/parametres/systeme', paramsForm);
      setParams(paramsForm);
      setNotice('Paramètres système mis à jour.');
      setShowSystemeModal(false);
    } finally {
      setSaving(false);
    }
  }

  async function reinitialiser() {
    if (confirmation !== 'CONFIRMER') return;
    if (!window.confirm("Dernière confirmation : TOUT sera définitivement supprimé (élèves, classes, paiements, dépenses, historique, corbeille, journal d'activité, et tous les comptes utilisateurs sauf le vôtre). Le profil de l'école et les paramètres système seront aussi remis à zéro. Continuer ?")) return;
    setResetLoading(true);
    try {
      await client.post('/parametres/reinitialiser', { confirmation });
      setNotice('Application réinitialisée avec succès. Rechargement...');
      setConfirmation('');
      // Rechargement complet (et non une simple navigation cote client) : le profil ecole,
      // la devise/le taux et la liste des utilisateurs ont tous change, il faut repartir
      // d'un etat frontend totalement frais plutot que de rafraichir chaque contexte un par un.
      setTimeout(() => { window.location.href = '/'; }, 1500);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
      setResetLoading(false);
    }
  }

  if (viewingAnnee) return <HistoricalBlock />;
  if (!ecole) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement...</p></div>;

  return (
    <div>
      {notice && <div className="alert alert-success"><i className="ph ph-check"></i> {notice}</div>}

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header">
            <i className="ph ph-chalkboard-teacher"></i><h3>Informations de l'école</h3>
            <div className="card-actions">
              <button className="btn btn-outline btn-sm" onClick={openEcoleEdit}><i className="ph ph-pencil-simple"></i> Modifier</button>
            </div>
          </div>
          <div className="card-body">
            <div className="info-grid">
              <div className="info-item" style={{ gridColumn: '1 / -1' }}><div className="label">Nom de l'école</div><div className="value">{ecole.nom || <span className="muted">—</span>}</div></div>
              <div className="info-item"><div className="label">Téléphone</div><div className="value">{ecole.telephone || <span className="muted">—</span>}</div></div>
              <div className="info-item"><div className="label">Email</div><div className="value">{ecole.email || <span className="muted">—</span>}</div></div>
              <div className="info-item"><div className="label">Devise principale</div><div className="value">{ecole.devise || 'USD'}</div></div>
              <div className="info-item"><div className="label">Année scolaire</div><div className="value">{ecole.annee_scolaire || <span className="muted">—</span>}</div></div>
              <div className="info-item" style={{ gridColumn: '1 / -1' }}><div className="label">Adresse</div><div className="value">{ecole.adresse || <span className="muted">—</span>}</div></div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <i className="ph ph-gear-six"></i><h3>Paramètres système</h3>
            <div className="card-actions">
              <button className="btn btn-outline btn-sm" onClick={openSystemeEdit}><i className="ph ph-pencil-simple"></i> Modifier</button>
            </div>
          </div>
          <div className="card-body">
            <div className="info-grid">
              <div className="info-item"><div className="label">Taux de change USD → CDF</div><div className="value">{params.taux_usd_cdf || <span className="muted">—</span>}</div></div>
              <div className="info-item"><div className="label">Délai conservation corbeille</div><div className="value">{params.delai_corbeille ? `${params.delai_corbeille} jours` : <span className="muted">—</span>}</div></div>
              <div className="info-item" style={{ gridColumn: '1 / -1' }}><div className="label">Format des matricules</div><div className="value">{params.format_matricule || <span className="muted">—</span>}</div></div>
            </div>
          </div>
        </div>
      </div>

      {user.role === 'admin' && (
        <div className="card" style={{ borderColor: '#fecaca' }}>
          <div className="card-header"><i className="ph ph-warning-circle" style={{ color: 'var(--danger)' }}></i><h3 style={{ color: 'var(--danger)' }}>Zone dangereuse</h3></div>
          <div className="card-body">
            <p className="text-muted mb-16">Cette action remet le logiciel à l'état d'un tout premier lancement : élèves, classes, paiements, remboursements, dépenses, historique, corbeille, journal d'activité, tous les comptes utilisateurs (sauf le vôtre), ainsi que le profil de l'école et les paramètres système sont supprimés ou remis à zéro. Elle est irréversible. Tapez <code>CONFIRMER</code> pour activer le bouton.</p>
            <div className="flex gap-8">
              <input placeholder="Tapez CONFIRMER" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} style={{ maxWidth: 240, padding: 10, border: '1.5px solid var(--border)', borderRadius: 8 }} />
              <button className="btn btn-danger" disabled={confirmation !== 'CONFIRMER' || resetLoading} onClick={reinitialiser}>
                {resetLoading ? 'Réinitialisation...' : <><i className="ph ph-trash"></i> Réinitialiser l'application</>}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`modal-backdrop ${showEcoleModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowEcoleModal(false)}>
        <div className="modal">
          <div className="modal-header"><i className="ph ph-chalkboard-teacher"></i><h3>Modifier les informations de l'école</h3><button className="modal-close" onClick={() => setShowEcoleModal(false)}><i className="ph ph-x"></i></button></div>
          {ecoleForm && (
            <form onSubmit={saveEcole}>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group"><label>Nom de l'école</label><input value={ecoleForm.nom || ''} onChange={(e) => setEcoleForm({ ...ecoleForm, nom: e.target.value })} required /></div>
                  <div className="form-group"><label>Adresse</label><textarea value={ecoleForm.adresse || ''} onChange={(e) => setEcoleForm({ ...ecoleForm, adresse: e.target.value })} /></div>
                  <div className="form-grid form-grid-2">
                    <div className="form-group"><label>Téléphone</label><input value={ecoleForm.telephone || ''} onChange={(e) => setEcoleForm({ ...ecoleForm, telephone: e.target.value })} /></div>
                    <div className="form-group"><label>Email</label><input type="email" value={ecoleForm.email || ''} onChange={(e) => setEcoleForm({ ...ecoleForm, email: e.target.value })} /></div>
                  </div>
                  <div className="form-grid form-grid-2">
                    <div className="form-group">
                      <label>Devise principale</label>
                      <select value={ecoleForm.devise || 'USD'} onChange={(e) => setEcoleForm({ ...ecoleForm, devise: e.target.value })}>
                        <option value="USD">USD</option><option value="CDF">CDF</option>
                      </select>
                    </div>
                    <div className="form-group"><label>Année scolaire</label><input value={ecoleForm.annee_scolaire || ''} onChange={(e) => setEcoleForm({ ...ecoleForm, annee_scolaire: e.target.value })} /></div>
                  </div>
                  <div className="form-group"><label>Logo de l'école</label><input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files[0])} /></div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowEcoleModal(false)}>Annuler</button>
                <button type="submit" className="btn btn-accent" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
              </div>
            </form>
          )}
        </div>
      </div>

      <div className={`modal-backdrop ${showSystemeModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowSystemeModal(false)}>
        <div className="modal">
          <div className="modal-header"><i className="ph ph-gear-six"></i><h3>Modifier les paramètres système</h3><button className="modal-close" onClick={() => setShowSystemeModal(false)}><i className="ph ph-x"></i></button></div>
          <form onSubmit={saveSysteme}>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-group">
                  <label>Taux de change USD → CDF</label>
                  <input type="number" step="0.01" value={paramsForm.taux_usd_cdf || ''} onChange={(e) => setParamsForm({ ...paramsForm, taux_usd_cdf: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Délai de conservation corbeille (jours)</label>
                  <input type="number" value={paramsForm.delai_corbeille || ''} onChange={(e) => setParamsForm({ ...paramsForm, delai_corbeille: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Format des matricules</label>
                  <input value={paramsForm.format_matricule || ''} onChange={(e) => setParamsForm({ ...paramsForm, format_matricule: e.target.value })} />
                  <small>Variables : {'{ANNEE}'} {'{NUM}'}</small>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowSystemeModal(false)}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
