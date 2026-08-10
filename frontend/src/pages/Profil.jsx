import React, { useEffect, useState } from 'react';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Profil() {
  const { setUser } = useAuth();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ nom: '', prenom: '', telephone: '' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPwdModal, setShowPwdModal] = useState(false);
  const [pwd, setPwd] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  async function load() {
    const res = await client.get('/profil');
    setData(res.data);
    setForm({ nom: res.data.user.nom, prenom: res.data.user.prenom, telephone: res.data.user.telephone || '' });
  }
  useEffect(() => { load(); }, []);

  function openEdit() {
    setForm({ nom: data.user.nom, prenom: data.user.prenom, telephone: data.user.telephone || '' });
    setShowEditModal(true);
  }

  async function saveProfil(e) {
    e.preventDefault();
    setSaving(true); setNotice('');
    await client.put('/profil', form);
    const updated = { ...data.user, ...form };
    setUser(updated);
    localStorage.setItem('ecolepay_user', JSON.stringify(updated));
    setData((d) => ({ ...d, user: updated }));
    setNotice('Profil mis à jour.');
    setSaving(false);
    setShowEditModal(false);
  }

  async function changePwd(e) {
    e.preventDefault();
    setPwdError(''); setPwdSaving(true);
    try {
      await client.post('/auth/change-password', pwd);
      setPwd({ current_password: '', new_password: '', confirm_password: '' });
      setNotice('Mot de passe modifié.');
      setShowPwdModal(false);
    } catch (err) {
      setPwdError(err.response?.data?.error || 'Erreur.');
    } finally {
      setPwdSaving(false);
    }
  }

  function closePwdModal() {
    setShowPwdModal(false);
    setPwdError('');
    setPwd({ current_password: '', new_password: '', confirm_password: '' });
  }

  if (!data) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement...</p></div>;

  return (
    <div className="grid-2">
      {notice && <div className="alert alert-success" style={{ gridColumn: '1 / -1' }}><i className="ph ph-check"></i> {notice}</div>}

      <div className="card">
        <div className="card-header">
          <i className="ph ph-user"></i><h3>Mes informations</h3>
          <div className="card-actions">
            <button className="btn btn-outline btn-sm" onClick={openEdit}><i className="ph ph-pencil-simple"></i> Modifier</button>
          </div>
        </div>
        <div className="card-body">
          <div className="info-grid">
            <div className="info-item"><div className="label">Nom</div><div className="value">{data.user.nom}</div></div>
            <div className="info-item"><div className="label">Prénom</div><div className="value">{data.user.prenom}</div></div>
            <div className="info-item"><div className="label">Email</div><div className="value">{data.user.email}</div></div>
            <div className="info-item"><div className="label">Téléphone</div><div className="value">{data.user.telephone || <span className="muted">—</span>}</div></div>
            <div className="info-item"><div className="label">Rôle</div><div className="value"><span className="badge badge-info">{data.user.role}</span></div></div>
          </div>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 18 }}>{data.nbPaiements} paiement(s) enregistré(s) par ce compte.</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><i className="ph ph-lock-key"></i><h3>Sécurité</h3></div>
        <div className="card-body">
          <div className="info-item">
            <div className="label">Mot de passe</div>
            <div className="value">••••••••</div>
          </div>
          <button className="btn btn-outline btn-sm" style={{ marginTop: 18 }} onClick={() => setShowPwdModal(true)}>
            <i className="ph ph-key"></i> Changer le mot de passe
          </button>
        </div>
      </div>

      <div className={`modal-backdrop ${showEditModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowEditModal(false)}>
        <div className="modal">
          <div className="modal-header"><i className="ph ph-pencil-simple"></i><h3>Modifier mes informations</h3><button className="modal-close" onClick={() => setShowEditModal(false)}><i className="ph ph-x"></i></button></div>
          <form onSubmit={saveProfil}>
            <div className="modal-body">
              <div className="form-grid">
                <div className="form-grid form-grid-2">
                  <div className="form-group"><label>Nom</label><input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required /></div>
                  <div className="form-group"><label>Prénom</label><input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required /></div>
                </div>
                <div className="form-group"><label>Téléphone</label><input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowEditModal(false)}>Annuler</button>
              <button type="submit" className="btn btn-accent" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </form>
        </div>
      </div>

      <div className={`modal-backdrop ${showPwdModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && closePwdModal()}>
        <div className="modal">
          <div className="modal-header"><i className="ph ph-lock-key"></i><h3>Changer le mot de passe</h3><button className="modal-close" onClick={closePwdModal}><i className="ph ph-x"></i></button></div>
          <form onSubmit={changePwd}>
            <div className="modal-body">
              {pwdError && <div className="alert alert-danger">{pwdError}</div>}
              <div className="form-grid">
                <div className="form-group"><label>Mot de passe actuel</label><input type="password" value={pwd.current_password} onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })} required /></div>
                <div className="form-group"><label>Nouveau mot de passe</label><input type="password" value={pwd.new_password} onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })} required minLength={8} /></div>
                <div className="form-group"><label>Confirmer</label><input type="password" value={pwd.confirm_password} onChange={(e) => setPwd({ ...pwd, confirm_password: e.target.value })} required minLength={8} /></div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={closePwdModal}>Annuler</button>
              <button type="submit" className="btn btn-primary" disabled={pwdSaving}>{pwdSaving ? 'Enregistrement...' : 'Changer le mot de passe'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
