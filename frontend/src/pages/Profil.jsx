import React, { useEffect, useState } from 'react';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Profil() {
  const { setUser } = useAuth();
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ nom: '', prenom: '', telephone: '' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [pwd, setPwd] = useState({ current_password: '', new_password: '', confirm_password: '' });
  const [pwdError, setPwdError] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  async function load() {
    const res = await client.get('/profil');
    setData(res.data);
    setForm({ nom: res.data.user.nom, prenom: res.data.user.prenom, telephone: res.data.user.telephone || '' });
  }
  useEffect(() => { load(); }, []);

  async function saveProfil(e) {
    e.preventDefault();
    setSaving(true); setNotice('');
    await client.put('/profil', form);
    const updated = { ...data.user, ...form };
    setUser(updated);
    localStorage.setItem('ecolepay_user', JSON.stringify(updated));
    setNotice('Profil mis à jour.');
    setSaving(false);
  }

  async function changePwd(e) {
    e.preventDefault();
    setPwdError(''); setPwdSaving(true);
    try {
      await client.post('/auth/change-password', pwd);
      setPwd({ current_password: '', new_password: '', confirm_password: '' });
      setNotice('Mot de passe modifié.');
    } catch (err) {
      setPwdError(err.response?.data?.error || 'Erreur.');
    } finally {
      setPwdSaving(false);
    }
  }

  if (!data) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement...</p></div>;

  return (
    <div className="grid-2">
      {notice && <div className="alert alert-success" style={{ gridColumn: '1 / -1' }}><i className="ph ph-check"></i> {notice}</div>}

      <div className="card">
        <div className="card-header"><i className="ph ph-user"></i><h3>Mes informations</h3></div>
        <form onSubmit={saveProfil}>
          <div className="card-body">
            <div className="form-grid">
              <div className="form-grid form-grid-2">
                <div className="form-group"><label>Nom</label><input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} required /></div>
                <div className="form-group"><label>Prénom</label><input value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} required /></div>
              </div>
              <div className="form-group"><label>Email</label><input value={data.user.email} disabled /></div>
              <div className="form-group"><label>Téléphone</label><input value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} /></div>
              <div className="form-group"><label>Rôle</label><input value={data.user.role} disabled /></div>
              <div className="text-muted" style={{ fontSize: 12 }}>{data.nbPaiements} paiement(s) enregistré(s) par ce compte.</div>
              <button className="btn btn-accent btn-block" type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer'}</button>
            </div>
          </div>
        </form>
      </div>

      <div className="card">
        <div className="card-header"><i className="ph ph-lock-key"></i><h3>Changer le mot de passe</h3></div>
        <form onSubmit={changePwd}>
          <div className="card-body">
            {pwdError && <div className="alert alert-danger">{pwdError}</div>}
            <div className="form-grid">
              <div className="form-group"><label>Mot de passe actuel</label><input type="password" value={pwd.current_password} onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })} required /></div>
              <div className="form-group"><label>Nouveau mot de passe</label><input type="password" value={pwd.new_password} onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })} required minLength={8} /></div>
              <div className="form-group"><label>Confirmer</label><input type="password" value={pwd.confirm_password} onChange={(e) => setPwd({ ...pwd, confirm_password: e.target.value })} required minLength={8} /></div>
              <button className="btn btn-primary btn-block" type="submit" disabled={pwdSaving}>{pwdSaving ? 'Enregistrement...' : 'Changer le mot de passe'}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
