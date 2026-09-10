import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useDevise } from '../context/DeviseContext.jsx';

export default function Familles() {
  const navigate = useNavigate();
  const { format } = useDevise();
  const [familles, setFamilles] = useState([]);
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [selection, setSelection] = useState([]);
  const [nom, setNom] = useState('');
  const [reduction, setReduction] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function loadFamilles() {
    setLoading(true);
    try {
      const res = await client.get('/familles');
      setFamilles(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Impossible de charger les familles.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadFamilles(); }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const res = await client.get('/familles/search', { params: { q: q.trim() } });
        setResultats(res.data);
      } catch (err) {
        setError(err.response?.data?.error || 'Erreur lors de la recherche.');
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  function ajouterEleve(eleve) {
    if (!selection.some((item) => item.id === eleve.id)) setSelection([...selection, eleve]);
    setQ('');
    setResultats([]);
  }

  function retirerEleve(id) {
    setSelection(selection.filter((eleve) => eleve.id !== id));
  }

  async function creerFamille(event) {
    event.preventDefault();
    setError('');
    if (!selection.length) { setError('Ajoutez au moins un élève.'); return; }
    setSaving(true);
    try {
      await client.post('/familles', {
        nom: nom.trim(),
        pourcentage_reduction: Number(reduction) || 0,
        eleve_ids: selection.map((eleve) => eleve.id),
      });
      setNom('');
      setReduction('');
      setSelection([]);
      await loadFamilles();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la création de la famille.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="familles-page">
      <div className="familles-intro">
        <div><span className="familles-eyebrow">Gestion familiale</span><h2>Familles et réductions</h2><p>Regroupez les élèves d’une même famille et appliquez une réduction sur leur dernière tranche.</p></div>
        <div className="familles-intro-icon"><i className="ph ph-users-three"></i></div>
      </div>

      <div className="card familles-create-card">
        <div className="card-header"><div><h3>Créer une famille</h3><p className="text-muted">Ajoutez les membres, puis définissez la réduction familiale.</p></div></div>
        <form onSubmit={creerFamille} className="card-body">
          {error && <div className="alert alert-danger mb-16">{error}</div>}
          <div className="familles-form-grid">
            <div className="form-group"><label>Nom de la famille *</label><input value={nom} onChange={(e) => setNom(e.target.value)} required placeholder="Ex. Famille MAYOKA" /></div>
            <div className="form-group"><label>Réduction familiale (%)</label><input type="number" min="0" max="100" step="0.01" value={reduction} onChange={(e) => setReduction(e.target.value)} placeholder="0" /></div>
          </div>
          <div className="form-group familles-member-picker" style={{ position: 'relative' }}>
            <label>Ajouter des élèves</label>
            <div className="search-input-wrap"><i className="ph ph-magnifying-glass"></i><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par nom ou matricule..." /></div>
            {q.trim().length >= 2 && resultats.length === 0 && <div className="familles-search-empty">Aucun élève disponible trouvé.</div>}
            {resultats.length > 0 && <div className="familles-search-results">{resultats.map((eleve) => <button type="button" className="familles-search-result" key={eleve.id} onClick={() => ajouterEleve(eleve)}><span className={eleve.genre === 'F' ? 'genre-f' : 'genre-m'}>{eleve.genre}</span><span className="familles-search-result-main"><strong>{eleve.prenom} {eleve.postnom ? `${eleve.postnom} ` : ''}{eleve.nom}</strong><small>{eleve.matricule} · {eleve.classe}</small></span><span className="familles-search-result-restant">Reste<br /><strong>{format(eleve.reste)}</strong></span><i className="ph ph-plus-circle"></i></button>)}</div>}
          </div>
          {selection.length > 0 ? <div className="familles-selected"><div className="familles-selected-heading"><strong>Membres sélectionnés</strong><span>{selection.length} élève(s)</span></div>{selection.map((eleve) => <div className="famille-selected-member" key={eleve.id}><span className={eleve.genre === 'F' ? 'genre-f' : 'genre-m'}>{eleve.genre}</span><span><strong>{eleve.prenom} {eleve.nom}</strong><small>{eleve.matricule} · {eleve.classe}</small></span><button type="button" onClick={() => retirerEleve(eleve.id)} title="Retirer cet élève"><i className="ph ph-x"></i></button></div>)}</div> : <div className="familles-selection-hint"><i className="ph ph-info"></i> Aucun élève ajouté pour le moment.</div>}
          <div className="familles-form-footer"><span className="text-muted">La réduction ne concerne pas les frais d’inscription.</span><button className="btn btn-accent" type="submit" disabled={saving}>{saving ? 'Enregistrement...' : 'Créer la famille'}</button></div>
        </form>
      </div>

      <div className="card familles-list-card">
        <div className="card-header"><h3>Familles enregistrées</h3></div>
        <div className="table-container"><table><thead><tr><th>Famille</th><th>Réduction</th><th>Membres</th><th>Frais restants</th></tr></thead><tbody>
          {loading && <tr><td colSpan={4}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
          {!loading && familles.length === 0 && <tr><td colSpan={4}><div className="empty-state"><i className="ph ph-users-three"></i><h3>Aucune famille</h3><p>Créez une famille pour regrouper les élèves concernés.</p></div></td></tr>}
          {!loading && familles.map((famille) => <tr key={famille.id} className="clickable-row" onClick={() => navigate(`/familles/${famille.id}`)} title="Ouvrir la fiche de la famille"><td><strong>{famille.nom}</strong></td><td><span className="badge badge-info">{famille.pourcentage_reduction}%</span></td><td><span className="badge badge-default">{(famille.membres || []).length} membre(s)</span></td><td>{(famille.membres || []).reduce((total, eleve) => total + Math.max(0, Number(eleve.reste) || 0), 0).toLocaleString('fr-FR')}</td></tr>)}
        </tbody></table></div>
      </div>
    </div>
  );
}