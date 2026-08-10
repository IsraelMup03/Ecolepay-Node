import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(email, password);
      if (data.mustChangePassword) {
        navigate('/changer-mot-de-passe');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de connexion.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <div className="school-logo-placeholder"><i className="ph-fill ph-graduation-cap"></i></div>
          <h1>EcolePay</h1>
          <p>Gestion des paiements scolaires</p>
        </div>
        <div className="login-body">
          <h2>Connexion</h2>
          <p className="subtitle">Accédez à votre espace de gestion</p>

          {error && <div className="alert alert-danger"><i className="ph-bold ph-warning-circle"></i> {error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Adresse email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="vous@ecole.com" />
              </div>
              <div className="form-group">
                <label>Mot de passe</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
              </div>
              <button className="btn btn-accent" type="submit" disabled={loading} style={{ justifyContent: 'center', padding: '11px' }}>
                {loading ? 'Connexion...' : <><i className="ph-bold ph-sign-in"></i> Se connecter</>}
              </button>
            </div>
          </form>

          <div className="default-creds">
            <strong>Compte par défaut :</strong> admin@ecolepay.com / Admin@2024<br />
            (changement de mot de passe requis à la première connexion)
          </div>
        </div>
      </div>
    </div>
  );
}
