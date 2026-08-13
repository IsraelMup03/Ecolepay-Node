import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import HistoricalBlock from '../components/HistoricalBlock.jsx';

function fmt(n, devise = 'USD') {
  return `${(parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export default function Caisse() {
  const navigate = useNavigate();
  const { viewingAnnee } = useAnnee();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [caisseInfo, setCaisseInfo] = useState(null);
  const [montant, setMontant] = useState('');
  const [devise, setDevise] = useState('USD');
  const [typePaiement, setTypePaiement] = useState('scolarite');
  const [modePaiement, setModePaiement] = useState('especes');
  const [periode, setPeriode] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);

  function handleSearch(v) {
    setQuery(v);
    setSuccess(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 2) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await client.get('/eleves/search', { params: { q: v } });
      setResults(res.data);
    }, 300);
  }

  async function selectEleve(e) {
    setSelected(e);
    setResults([]);
    setQuery(`${e.prenom} ${e.nom} (${e.matricule})`);
    const res = await client.get(`/eleves/${e.id}/caisse-info`);
    setCaisseInfo(res.data);
  }

  async function handleSubmit(ev) {
    ev.preventDefault();
    setError('');
    if (!selected) { setError('Veuillez sélectionner un élève.'); return; }
    setLoading(true);
    try {
      const res = await client.post('/paiements', {
        eleve_id: selected.id,
        montant: parseFloat(montant),
        devise,
        type_paiement: typePaiement,
        mode_paiement: modePaiement,
        periode,
        description,
      });
      setSuccess(res.data);
      setMontant(''); setPeriode(''); setDescription('');
      const info = await client.get(`/eleves/${selected.id}/caisse-info`);
      setCaisseInfo(info.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de l\'enregistrement.');
    } finally {
      setLoading(false);
    }
  }

  if (viewingAnnee) return <HistoricalBlock />;

  return (
    <div className="grid-2">
      <div>
        <div className="card mb-16">
          <div className="card-header"><i className="ph ph-user-focus"></i><h3>Rechercher un élève</h3></div>
          <div className="card-body">
            <div className="search-input-wrap">
              <i className="ph ph-magnifying-glass"></i>
              <input placeholder="Nom, prénom ou matricule..." value={query} onChange={(e) => handleSearch(e.target.value)} />
            </div>
            {results.length > 0 && (
              <div className="search-results">
                {results.map((e) => (
                  <div key={e.id} className="search-result-item" onClick={() => selectEleve(e)}>
                    <span><strong>{e.prenom} {e.nom}</strong> — {e.matricule} · {e.classe}</span>
                    <span className="text-muted">Reste: {fmt(e.reste)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {caisseInfo && (
          <div className="card">
            <div className="card-header"><i className="ph ph-identification-card"></i><h3>Fiche élève</h3></div>
            <div className="card-body">
              <div className="mb-12"><strong>{caisseInfo.eleve.prenom} {caisseInfo.eleve.nom}</strong> — {caisseInfo.eleve.matricule}</div>
              <div className="text-muted mb-16">{caisseInfo.eleve.classe_nom}</div>

              <div className="mb-12">
                <div className="flex-between mb-12"><span>Scolarité</span><span>{fmt(caisseInfo.eleve.total_paye_scolarite)} / {fmt(caisseInfo.eleve.frais_scolarite_total)}</span></div>
                <div className="progress-bar-wrap">
                  <div className={`progress-bar-fill ${caisseInfo.eleve.reste_scolarite <= 0 ? 'green' : 'orange'}`}
                    style={{ width: `${Math.min(100, (caisseInfo.eleve.total_paye_scolarite / (caisseInfo.eleve.frais_scolarite_total || 1)) * 100)}%` }} />
                </div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Reste: {fmt(caisseInfo.eleve.reste_scolarite)}</div>
              </div>

              <h4 style={{ fontSize: 13, marginTop: 16, marginBottom: 8 }}>Historique récent</h4>
              <div className="table-container">
                <table>
                  <tbody>
                    {caisseInfo.historique.slice(0, 5).map((p) => (
                      <tr key={p.id}>
                        <td>{new Date(p.date_paiement).toLocaleDateString('fr-FR')}</td>
                        <td><span className="badge badge-info">{p.type_paiement}</span></td>
                        <td><strong>{fmt(p.montant, p.devise)}</strong></td>
                      </tr>
                    ))}
                    {caisseInfo.historique.length === 0 && <tr><td className="text-muted">Aucun paiement encore.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header"><i className="ph ph-money"></i><h3>Enregistrer un paiement</h3></div>
        <div className="card-body">
          {error && <div className="alert alert-danger"><i className="ph ph-warning-circle"></i> {error}</div>}
          {success && (
            <div className="alert alert-success">
              <i className="ph ph-check"></i> Paiement enregistré ! Réf: {success.reference}
              <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => window.open(`/recu/${success.id}`, '_blank')}>
                <i className="ph ph-printer"></i> Imprimer le reçu
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group form-grid-2" style={{ display: 'grid' }}>
                <div>
                  <label>Type de paiement</label>
                  <select value={typePaiement} onChange={(e) => setTypePaiement(e.target.value)}>
                    <option value="scolarite">Scolarité</option>
                    <option value="inscription">Inscription</option>
                    <option value="uniforme">Uniforme scolaire</option>
                    <option value="fournitures">Fournitures scolaires</option>
                    <option value="cantine">Cantine / Restauration</option>
                    <option value="transport">Transport scolaire</option>
                    <option value="excursion">Excursion / Sortie</option>
                    <option value="examen">Frais d'examen</option>
                    <option value="assurance">Assurance scolaire</option>
                    <option value="activites">Activités parascolaires</option>
                    <option value="autre">Autre</option>
                  </select>
                </div>
                <div>
                  <label>Mode de paiement</label>
                  <select value={modePaiement} onChange={(e) => setModePaiement(e.target.value)}>
                    <option value="especes">Espèces</option>
                    <option value="mobile_money">Mobile Money</option>
                    <option value="virement">Virement</option>
                    <option value="cheque">Chèque</option>
                  </select>
                </div>
              </div>

              <div className="form-grid form-grid-2">
                <div className="form-group">
                  <label>Montant</label>
                  <input type="number" step="0.01" min="0" value={montant} onChange={(e) => setMontant(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Devise</label>
                  <select value={devise} onChange={(e) => setDevise(e.target.value)}>
                    <option value="USD">USD</option>
                    <option value="CDF">CDF</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>Période (optionnel)</label>
                <input placeholder="Ex: Septembre 2026, Trimestre 1..." value={periode} onChange={(e) => setPeriode(e.target.value)} />
              </div>

              <div className="form-group">
                <label>Description (optionnel)</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>

              <button className="btn btn-accent btn-block" type="submit" disabled={loading || !selected}>
                {loading ? 'Enregistrement...' : <><i className="ph ph-check-circle"></i> Valider le paiement</>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
