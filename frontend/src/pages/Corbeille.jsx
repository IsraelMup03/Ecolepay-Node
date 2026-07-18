import React, { useEffect, useState } from 'react';
import client from '../api/client.js';

const TABLE_LABELS = { eleves: 'Élève', classes: 'Classe', utilisateurs: 'Utilisateur' };

export default function Corbeille() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await client.get('/corbeille');
    setRows(res.data);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function restaurer(id) {
    if (!window.confirm('Restaurer cet élément ?')) return;
    const res = await client.post(`/corbeille/${id}/restaurer`);
    alert(res.data.message || 'Restauré.');
    load();
  }
  async function supprimer(id) {
    if (!window.confirm('Supprimer définitivement cet élément ? Cette action est irréversible.')) return;
    await client.delete(`/corbeille/${id}`);
    load();
  }

  function apercu(item) {
    try {
      const d = JSON.parse(item.donnees);
      if (item.table_source === 'eleves') return `${d.prenom} ${d.nom} (${d.matricule})`;
      if (item.table_source === 'classes') return d.nom;
      if (item.table_source === 'utilisateurs') return `${d.prenom} ${d.nom} — ${d.email}`;
      return '—';
    } catch (e) { return '—'; }
  }

  return (
    <div>
      <div className="alert alert-info"><i className="ri-information-line"></i> Les éléments sont conservés 30 jours avant suppression définitive automatique.</div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead><tr><th>Type</th><th>Aperçu</th><th>Supprimé par</th><th>Date de suppression</th><th>Expire le</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="text-center text-muted">Chargement...</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={6}><div className="empty-state"><i className="ri-delete-bin-line"></i><h3>Corbeille vide</h3></div></td></tr>}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="badge badge-default">{TABLE_LABELS[r.table_source] || r.table_source}</span></td>
                  <td>{apercu(r)}</td>
                  <td className="text-muted">{r.supp_prenom} {r.supp_nom}</td>
                  <td className="text-muted">{new Date(r.date_suppression).toLocaleDateString('fr-FR')}</td>
                  <td className="text-muted">{new Date(r.date_expiration).toLocaleDateString('fr-FR')}</td>
                  <td className="flex gap-8">
                    <button className="btn btn-success btn-sm" onClick={() => restaurer(r.id)}><i className="ri-arrow-go-back-line"></i> Restaurer</button>
                    <button className="btn btn-danger btn-sm" onClick={() => supprimer(r.id)}><i className="ri-delete-bin-line"></i></button>
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
