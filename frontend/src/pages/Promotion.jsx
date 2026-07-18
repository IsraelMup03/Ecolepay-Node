import React, { useEffect, useState } from 'react';
import client from '../api/client.js';

function fmt(n) { return (parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export default function Promotion() {
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(true);
  const [nouvelleAnnee, setNouvelleAnnee] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/promotion/preview').then((res) => setPreview(res.data)).finally(() => setLoading(false));
  }, []);

  const nbDiplomes = preview.filter((e) => !e.classe_suivante).length;
  const nbPromouvables = preview.filter((e) => e.classe_suivante).length;

  async function executer() {
    if (!nouvelleAnnee.trim()) { setError('Veuillez saisir la nouvelle année scolaire (ex: 2027-2028).'); return; }
    if (!window.confirm(`Confirmer la promotion de ${preview.length} élèves vers l'année ${nouvelleAnnee} ? Cette action est irréversible.`)) return;
    setConfirming(true); setError('');
    try {
      const res = await client.post('/promotion/executer', { nouvelle_annee: nouvelleAnnee });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la promotion.');
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return <div className="text-center text-muted" style={{ padding: 60 }}>Chargement...</div>;

  if (result) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 50 }}>
          <i className="ri-checkbox-circle-fill" style={{ fontSize: 48, color: 'var(--success)' }}></i>
          <h2 style={{ marginTop: 14, marginBottom: 8 }}>Promotion terminée</h2>
          <p className="text-muted">{result.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="alert alert-warning">
        <i className="ri-alert-line"></i> Cette opération est irréversible. Elle archive la situation financière de l'année en cours,
        puis fait passer chaque élève actif vers sa classe supérieure (ou le diplôme, si aucune classe supérieure n'est définie).
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-icon blue"><i className="ri-graduation-cap-line"></i></div>
          <div className="stat-info"><div className="label">Élèves concernés</div><div className="value">{preview.length}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><i className="ri-arrow-up-circle-line"></i></div>
          <div className="stat-info"><div className="label">Seront promus</div><div className="value">{nbPromouvables}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple"><i className="ri-award-line"></i></div>
          <div className="stat-info"><div className="label">Seront diplômés</div><div className="value">{nbDiplomes}</div></div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><i className="ri-calendar-event-line"></i><h3>Lancer la promotion</h3></div>
        <div className="card-body">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="form-grid form-grid-2" style={{ alignItems: 'end' }}>
            <div className="form-group">
              <label>Nouvelle année scolaire</label>
              <input placeholder="Ex: 2027-2028" value={nouvelleAnnee} onChange={(e) => setNouvelleAnnee(e.target.value)} />
            </div>
            <button className="btn btn-accent" onClick={executer} disabled={confirming}>
              {confirming ? 'Traitement en cours...' : <><i className="ri-rocket-line"></i> Exécuter la promotion</>}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><i className="ri-list-check-2"></i><h3>Aperçu des changements</h3></div>
        <div className="table-container">
          <table>
            <thead><tr><th>Élève</th><th>Classe actuelle</th><th>Payé</th><th>Devient</th></tr></thead>
            <tbody>
              {preview.map((e) => (
                <tr key={e.id}>
                  <td>{e.prenom} {e.nom}</td>
                  <td>{e.classe_actuelle}</td>
                  <td>{fmt(e.total_paye)}</td>
                  <td>
                    {e.classe_suivante
                      ? <span className="badge badge-info"><i className="ri-arrow-right-line"></i> {e.classe_suivante}</span>
                      : <span className="badge badge-success">Diplômé</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
