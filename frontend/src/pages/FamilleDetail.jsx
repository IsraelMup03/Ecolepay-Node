import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import client from '../api/client.js';
import { useDevise } from '../context/DeviseContext.jsx';

export default function FamilleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { format } = useDevise();
  const [famille, setFamille] = useState(null);
  const [q, setQ] = useState('');
  const [resultats, setResultats] = useState([]);
  const [nom, setNom] = useState('');
  const [reduction, setReduction] = useState('');
  const [membres, setMembres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const res = await client.get(`/familles/${id}`);
      setFamille(res.data);
      setNom(res.data.nom);
      setReduction(String(res.data.pourcentage_reduction || 0));
      setMembres(res.data.membres || []);
    } catch (err) { setError(err.response?.data?.error || 'Impossible de charger la famille.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (q.trim().length < 2) { setResultats([]); return undefined; }
    const timer = setTimeout(async () => {
      try { const res = await client.get('/familles/search', { params: { q: q.trim() } }); setResultats(res.data); }
      catch (err) { setError(err.response?.data?.error || 'Erreur de recherche.'); }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  function ajouter(eleve) { if (!membres.some((m) => m.id === eleve.id)) setMembres([...membres, eleve]); setQ(''); setResultats([]); }
  function retirer(eleveId) { setMembres(membres.filter((m) => m.id !== eleveId)); }

  async function enregistrer(event) {
    event.preventDefault(); setSaving(true); setError('');
    try { await client.put(`/familles/${id}`, { nom: nom.trim(), pourcentage_reduction: Number(reduction) || 0, eleve_ids: membres.map((m) => m.id) }); await load(); }
    catch (err) { setError(err.response?.data?.error || 'Erreur lors de la modification.'); }
    finally { setSaving(false); }
  }

  async function supprimer() {
    if (!window.confirm(`Archiver la famille « ${famille.nom} » ? Elle sera conservée dans la corbeille et ses membres retrouveront leur remise individuelle.`)) return;
    try { await client.delete(`/familles/${id}`); navigate('/familles'); }
    catch (err) { setError(err.response?.data?.error || 'Erreur lors de l’archivage.'); }
  }

  if (loading) return <div className="loading-inline"><div className="spinner"></div> Chargement...</div>;
  if (!famille) return <div className="alert alert-danger">{error || 'Famille introuvable.'}</div>;

  return (
    <div className="famille-detail-page">
      <button className="btn btn-link" onClick={() => navigate('/familles')}><i className="ph ph-arrow-left"></i> Retour aux familles</button>
      <div className="famille-detail-hero"><div><span className="familles-eyebrow">Fiche famille</span><h2>{famille.nom}</h2><p>{membres.length} membre(s) · Réduction familiale de <strong>{famille.pourcentage_reduction}%</strong> sur la dernière tranche</p></div><button className="btn btn-danger" onClick={supprimer}><i className="ph ph-trash"></i> Archiver</button></div>
      <div className="famille-detail-grid">
        <div className="card"><div className="card-header"><i className="ph ph-pencil-simple"></i><h3>Gérer la famille</h3></div><form className="card-body famille-edit-form" onSubmit={enregistrer}>
          {error && <div className="alert alert-danger">{error}</div>}
          <div className="form-group"><label>Nom de la famille</label><input value={nom} onChange={(e) => setNom(e.target.value)} required /></div>
          <div className="form-group"><label>Réduction familiale (%)</label><input type="number" min="0" max="100" step="0.01" value={reduction} onChange={(e) => setReduction(e.target.value)} required /></div>
          <div className="form-group famille-detail-search" style={{ position: 'relative' }}><label>Ajouter un élève</label><div className="search-input-wrap"><i className="ph ph-magnifying-glass"></i><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, prénom ou matricule..." /></div>{resultats.length > 0 && <div className="familles-search-results">{resultats.map((eleve) => <button type="button" className="familles-search-result" key={eleve.id} onClick={() => ajouter(eleve)}><span className={eleve.genre === 'F' ? 'genre-f' : 'genre-m'}>{eleve.genre}</span><span className="familles-search-result-main"><strong>{eleve.prenom} {eleve.nom}</strong><small>{eleve.matricule} · {eleve.classe}</small></span><i className="ph ph-plus-circle"></i></button>)}</div>}</div>
          <button className="btn btn-accent" disabled={saving}>{saving ? 'Enregistrement...' : 'Enregistrer les modifications'}</button>
        </form></div>
        <div className="card"><div className="card-header"><i className="ph ph-users-three"></i><h3>Membres de la famille</h3></div><div className="famille-members-list">{membres.map((eleve) => <div className="famille-member-row" key={eleve.id}><span className={eleve.genre === 'F' ? 'genre-f' : 'genre-m'}>{eleve.genre}</span><span className="famille-member-main"><strong>{eleve.prenom} {eleve.postnom ? `${eleve.postnom} ` : ''}{eleve.nom}</strong><small>{eleve.matricule} · {eleve.classe_nom || eleve.classe || '—'}</small></span><span className="famille-member-restant">Reste<strong>{format(eleve.reste)}</strong></span><button className="icon-btn-danger" type="button" onClick={() => retirer(eleve.id)} title="Retirer de la famille"><i className="ph ph-x"></i></button></div>)}</div></div>
      </div>
    </div>
  );
}
