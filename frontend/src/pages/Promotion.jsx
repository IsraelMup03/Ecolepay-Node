import React, { useEffect, useState } from 'react';
import client from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import HistoricalBlock from '../components/HistoricalBlock.jsx';

function fmt(n) { return (parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// Calcule automatiquement l'année scolaire suivante à partir de l'année en cours (ex: "2024-2025" -> "2025-2026")
function suggererAnneeSuivante(anneeCourante) {
  const nums = (anneeCourante || '').match(/\d{4}/g);
  if (!nums || !nums.length) return '';
  if (nums.length === 1) { const y = parseInt(nums[0], 10); return `${y + 1}-${y + 2}`; }
  return `${parseInt(nums[0], 10) + 1}-${parseInt(nums[1], 10) + 1}`;
}

export default function Promotion() {
  const { viewingAnnee } = useAnnee();
  const [preview, setPreview] = useState([]);
  const [anneeCourante, setAnneeCourante] = useState('');
  const [loading, setLoading] = useState(true);
  const [nouvelleAnnee, setNouvelleAnnee] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    client.get('/promotion/preview').then((res) => {
      setPreview(res.data.eleves);
      setAnneeCourante(res.data.anneeCourante);
      setNouvelleAnnee(suggererAnneeSuivante(res.data.anneeCourante));
    }).finally(() => setLoading(false));
  }, []);

  if (viewingAnnee) return <HistoricalBlock />;

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

  if (loading) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement...</p></div>;

  if (result) {
    return (
      <div className="card">
        <div className="card-body text-center" style={{ padding: 50 }}>
          <i className="ph-fill ph-check-circle" style={{ fontSize: 48, color: 'var(--success)' }}></i>
          <h2 style={{ marginTop: 14, marginBottom: 8 }}>Promotion terminée</h2>
          <p className="text-muted">{result.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="alert alert-warning">
        <i className="ph ph-warning"></i> Cette opération est irréversible. Elle archive la situation financière de l'année en cours,
        puis fait passer chaque élève actif vers sa classe supérieure (ou le diplôme, si aucune classe supérieure n'est définie).
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-icon blue"><i className="ph ph-graduation-cap"></i></div>
          <div className="stat-info"><div className="label">Élèves concernés</div><div className="value">{preview.length}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><i className="ph ph-arrow-circle-up"></i></div>
          <div className="stat-info"><div className="label">Seront promus</div><div className="value">{nbPromouvables}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple"><i className="ph ph-medal"></i></div>
          <div className="stat-info"><div className="label">Seront diplômés</div><div className="value">{nbDiplomes}</div></div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><i className="ph ph-calendar"></i><h3>Lancer la promotion</h3></div>
        <div className="card-body">
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="form-grid form-grid-2" style={{ alignItems: 'end' }}>
            <div className="form-group">
              <label>Nouvelle année scolaire</label>
              <input value={nouvelleAnnee} onChange={(e) => setNouvelleAnnee(e.target.value)} />
              <small>Calculée automatiquement à partir de l'année en cours ({anneeCourante}) — modifiable si besoin.</small>
            </div>
            <button className="btn btn-accent" onClick={executer} disabled={confirming}>
              {confirming ? 'Traitement en cours...' : <><i className="ph ph-rocket-launch"></i> Exécuter la promotion</>}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><i className="ph ph-list-checks"></i><h3>Aperçu des changements</h3></div>
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
                      ? <span className="badge badge-info"><i className="ph ph-arrow-right"></i> {e.classe_suivante}</span>
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
