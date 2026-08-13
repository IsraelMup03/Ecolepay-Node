import React, { useEffect, useState } from 'react';
import client, { API_URL } from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';

function fmt(n, devise = 'USD') {
  return `${(parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export default function Paiements() {
  const { viewingAnnee } = useAnnee();
  const [rows, setRows] = useState([]);
  const [classes, setClasses] = useState([]);
  const [q, setQ] = useState('');
  const [classeId, setClasseId] = useState('');
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, somme: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const params = { p: page, q, classe_id: classeId, type };
    if (viewingAnnee) params.annee = viewingAnnee;
    else { params.debut = debut; params.fin = fin; }
    const res = await client.get('/paiements', { params });
    setRows(res.data.paiements);
    setMeta(res.data);
    setLoading(false);
  }

  useEffect(() => { client.get('/classes').then((r) => setClasses(r.data)); }, []);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, classeId, debut, fin, type, page, viewingAnnee]);

  function exportCsv() {
    const token = localStorage.getItem('ecolepay_token');
    const params = { q, classe_id: classeId, type };
    if (viewingAnnee) params.annee = viewingAnnee;
    else { params.debut = debut; params.fin = fin; }
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString();
    fetch(`${API_URL}/paiements/export.csv?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'paiements.csv'; a.click();
        window.URL.revokeObjectURL(url);
      });
  }

  return (
    <div>
      <div className="filters-bar">
        <div className="search-input-wrap" style={{ flex: 1, minWidth: 200 }}>
          <i className="ph ph-magnifying-glass"></i>
          <input placeholder="Référence, nom, matricule..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="form-group">
          <select value={classeId} onChange={(e) => { setClasseId(e.target.value); setPage(1); }}>
            <option value="">Toutes les classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
        <div className="form-group">
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
            <option value="">Tous types</option>
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
        {!viewingAnnee && (
          <>
            <div className="form-group"><input type="date" value={debut} onChange={(e) => { setDebut(e.target.value); setPage(1); }} /></div>
            <div className="form-group"><input type="date" value={fin} onChange={(e) => { setFin(e.target.value); setPage(1); }} /></div>
          </>
        )}
        <button className="btn btn-outline" onClick={exportCsv}><i className="ph ph-download-simple"></i> Exporter CSV</button>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="stat-card">
          <div className="stat-icon blue"><i className="ph ph-list-checks"></i></div>
          <div className="stat-info"><div className="label">Paiements trouvés</div><div className="value">{meta.total}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><i className="ph ph-currency-circle-dollar"></i></div>
          <div className="stat-info"><div className="label">Montant total</div><div className="value">{fmt(meta.somme)}</div></div>
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Référence</th><th>Élève</th><th>Classe</th><th>Type</th><th>Montant</th><th>Mode</th><th>Date</th><th>Comptable</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={9}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={9}><div className="empty-state"><i className="ph ph-credit-card"></i><h3>Aucun paiement trouvé</h3></div></td></tr>}
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.reference}</code></td>
                  <td>{p.prenom} {p.nom} <span className="text-muted">({p.matricule})</span></td>
                  <td>{p.classe}</td>
                  <td><span className="badge badge-info">{p.type_paiement}</span></td>
                  <td><strong>{fmt(p.montant, p.devise)}</strong></td>
                  <td>{p.mode_paiement}</td>
                  <td className="text-muted">{new Date(p.date_paiement).toLocaleString('fr-FR')}</td>
                  <td className="text-muted">{p.cpt_prenom} {p.cpt_nom}</td>
                  <td><button className="btn btn-outline btn-sm" onClick={() => window.open(`/recu/${p.id}`, '_blank')}><i className="ph ph-printer"></i></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {meta.totalPages > 1 && (
          <div className="pagination">
            <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Précédent</button>
            <span className="text-muted" style={{ padding: '6px 10px' }}>Page {page} / {meta.totalPages}</span>
            <button className="btn btn-outline btn-sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Suivant</button>
          </div>
        )}
      </div>
    </div>
  );
}
