import React, { useEffect, useState } from 'react';
import client from '../api/client.js';

export default function Logs() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await client.get('/logs', { params: { p: page, q } });
    setRows(res.data.logs);
    setMeta(res.data);
    setLoading(false);
  }
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, page]);

  return (
    <div>
      <div className="filters-bar">
        <div className="search-input-wrap" style={{ flex: 1, minWidth: 220 }}>
          <i className="ri-search-line"></i>
          <input placeholder="Rechercher une action..." value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Détails</th><th>IP</th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={5} className="text-center text-muted">Chargement...</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={5} className="text-center text-muted">Aucune entrée.</td></tr>}
              {rows.map((l) => (
                <tr key={l.id}>
                  <td className="text-muted">{new Date(l.date_action).toLocaleString('fr-FR')}</td>
                  <td>{l.prenom ? `${l.prenom} ${l.nom}` : <span className="text-muted">Système</span>}</td>
                  <td><strong>{l.action}</strong></td>
                  <td className="text-muted">{l.details || '—'}</td>
                  <td className="text-muted">{l.ip || '—'}</td>
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
