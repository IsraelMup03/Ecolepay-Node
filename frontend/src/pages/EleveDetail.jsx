import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import client from '../api/client.js';

function fmt(n, devise = 'USD') {
  return `${(parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export default function EleveDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  async function load() {
    setLoading(true);
    const res = await client.get(`/eleves/${id}`);
    setData(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function retrograder() {
    if (!window.confirm('Confirmer la rétrogradation de cet élève vers la classe inférieure ?')) return;
    try {
      await client.post(`/eleves/${id}/retrograder`);
      setMsg('Élève rétrogradé avec succès.');
      load();
    } catch (err) {
      setMsg(err.response?.data?.error || 'Erreur.');
    }
  }

  async function archiver() {
    if (!window.confirm("Archiver cet élève ? Il sera déplacé vers la corbeille et pourra être restauré pendant 30 jours.")) return;
    await client.delete(`/eleves/${id}`);
    navigate('/eleves');
  }

  if (loading) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement...</p></div>;
  if (!data) return <div className="alert alert-danger">Élève introuvable.</div>;

  const { eleve, paiements, totaux } = data;

  return (
    <div>
      {msg && <div className="alert alert-info">{msg}</div>}

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><i className="ph ph-user"></i><h3>Informations de l'élève</h3></div>
          <div className="card-body">
            <div className="flex gap-14 mb-16" style={{ alignItems: 'center' }}>
              <div className={eleve.genre === 'F' ? 'genre-f' : 'genre-m'} style={{ width: 48, height: 48, fontSize: 16 }}>{eleve.genre}</div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{eleve.prenom} {eleve.nom}</div>
                <div className="text-muted">{eleve.matricule} · {eleve.classe_nom}</div>
              </div>
            </div>
            <table>
              <tbody>
                <tr><td className="text-muted">Statut</td><td><span className="badge badge-success">{eleve.statut}</span></td></tr>
                <tr><td className="text-muted">Date de naissance</td><td>{eleve.date_naissance || '—'}</td></tr>
                <tr><td className="text-muted">Lieu de naissance</td><td>{eleve.lieu_naissance || '—'}</td></tr>
                <tr><td className="text-muted">Parent/tuteur</td><td>{eleve.nom_parent || '—'}</td></tr>
                <tr><td className="text-muted">Téléphone</td><td>{eleve.telephone_parent || '—'}</td></tr>
                <tr><td className="text-muted">Email</td><td>{eleve.email_parent || '—'}</td></tr>
                <tr><td className="text-muted">Date d'inscription</td><td>{eleve.date_inscription || '—'}</td></tr>
                <tr><td className="text-muted">Année scolaire</td><td>{eleve.annee_scolaire || '—'}</td></tr>
              </tbody>
            </table>

            <div className="flex gap-8" style={{ marginTop: 18 }}>
              <button className="btn btn-outline" onClick={() => navigate('/caisse')}><i className="ph ph-money"></i> Enregistrer un paiement</button>
              {eleve.classe_inf_nom && <button className="btn btn-warning" onClick={retrograder}><i className="ph ph-arrow-circle-down"></i> Rétrograder</button>}
              <button className="btn btn-danger" onClick={archiver}><i className="ph ph-archive"></i> Archiver</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><i className="ph ph-wallet"></i><h3>Situation financière</h3></div>
          <div className="card-body">
            <div className="mb-16">
              <div className="flex-between mb-12"><span>Scolarité</span><span><strong>{fmt(totaux.totalPayeScolarite)}</strong> / {fmt(eleve.frais_scolarite_total)}</span></div>
              <div className="progress-bar-wrap">
                <div className={`progress-bar-fill ${totaux.pctScolarite >= 100 ? 'green' : totaux.pctScolarite >= 50 ? 'orange' : 'red'}`} style={{ width: `${totaux.pctScolarite}%` }} />
              </div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{totaux.pctScolarite}% payé · Reste {fmt(totaux.resteScolarite)}</div>
            </div>
            <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="stat-card">
                <div className="stat-icon green"><i className="ph ph-check-circle"></i></div>
                <div className="stat-info"><div className="label">Inscription payée</div><div className="value" style={{ fontSize: 16 }}>{fmt(totaux.totalPayeInscription)}</div></div>
              </div>
              <div className="stat-card">
                <div className="stat-icon red"><i className="ph ph-arrow-counter-clockwise"></i></div>
                <div className="stat-info"><div className="label">Total remboursé</div><div className="value" style={{ fontSize: 16 }}>{fmt(totaux.totalRembourse)}</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><i className="ph ph-clock-counter-clockwise"></i><h3>Historique des paiements</h3></div>
        <div className="table-container">
          <table>
            <thead><tr><th>Référence</th><th>Type</th><th>Montant</th><th>Mode</th><th>Statut</th><th>Date</th><th>Comptable</th><th></th></tr></thead>
            <tbody>
              {paiements.length === 0 && <tr><td colSpan={8} className="text-center text-muted">Aucun paiement enregistré.</td></tr>}
              {paiements.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.reference}</code></td>
                  <td><span className="badge badge-info">{p.type_paiement}</span></td>
                  <td><strong>{fmt(p.montant, p.devise)}</strong></td>
                  <td>{p.mode_paiement}</td>
                  <td><span className={`badge ${p.statut === 'valide' ? 'badge-success' : p.statut === 'rembourse' ? 'badge-danger' : 'badge-default'}`}>{p.statut}</span></td>
                  <td className="text-muted">{new Date(p.date_paiement).toLocaleDateString('fr-FR')}</td>
                  <td className="text-muted">{p.cpt_prenom} {p.cpt_nom}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => window.open(`/recu/${p.id}`, '_blank')}><i className="ph ph-printer"></i></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
