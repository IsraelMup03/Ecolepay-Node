import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ChangerMotDePasse() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!user) { navigate('/login'); return null; }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await client.post('/auth/change-password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      setSuccess(true);
      const updated = { ...user, premier_connexion: 0 };
      setUser(updated);
      localStorage.setItem('ecolepay_user', JSON.stringify(updated));
      setTimeout(() => navigate('/'), 1200);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <div className="school-logo-placeholder"><i className="ph ph-lock-key"></i></div>
          <h1>EcolePay</h1>
          <p>{user.premier_connexion ? 'Première connexion' : 'Sécurité du compte'}</p>
        </div>
        <div className="login-body">
          <h2>Changer le mot de passe</h2>
          <p className="subtitle">
            {user.premier_connexion
              ? 'Pour votre sécurité, vous devez définir un nouveau mot de passe avant de continuer.'
              : 'Définissez un nouveau mot de passe.'}
          </p>

          {error && <div className="alert alert-danger"><i className="ph ph-warning-circle"></i> {error}</div>}
          {success && <div className="alert alert-success"><i className="ph ph-check"></i> Mot de passe modifié avec succès.</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              {!user.premier_connexion && (
                <div className="form-group">
                  <label>Mot de passe actuel</label>
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
                </div>
              )}
              <div className="form-group">
                <label>Nouveau mot de passe</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
                <small>Au moins 8 caractères.</small>
              </div>
              <div className="form-group">
                <label>Confirmer le mot de passe</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} />
              </div>
              <button className="btn btn-accent" type="submit" disabled={loading} style={{ justifyContent: 'center', padding: '11px' }}>
                {loading ? 'Enregistrement...' : 'Valider'}
              </button>
              <button type="button" className="btn btn-outline" style={{ justifyContent: 'center' }} onClick={logout}>
                Annuler et se déconnecter
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
