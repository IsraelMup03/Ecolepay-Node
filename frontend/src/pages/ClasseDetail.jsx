import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import client from '../api/client.js';
import { useDevise } from '../context/DeviseContext.jsx';

export default function ClasseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { format, devise } = useDevise();
  const [classe, setClasse] = useState(null);
  const [stats, setStats] = useState(null);
  const [eleves, setEleves] = useState([]);
  const [eleveSearch, setEleveSearch] = useState('');
  const [eleveSort, setEleveSort] = useState({ field: 'nom', order: 'asc' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { loadClasse(); }, [id]);

  async function loadClasse() {
    setLoading(true);
    setError('');
    try {
      const [classeRes, elevesRes] = await Promise.all([
        client.get(`/classes/${id}/stats`),
        client.get(`/eleves/by-classe/${id}`),
      ]);
      setClasse(classeRes.data.classe);
      setStats(classeRes.data.stats);
      setEleves(elevesRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du chargement de la classe.');
      setClasse(null);
      setEleves([]);
    } finally {
      setLoading(false);
    }
  }

  function sortEleves(field) {
    setEleveSort((current) => {
      const order = current.field === field && current.order === 'asc' ? 'desc' : 'asc';
      return { field, order };
    });
  }

  async function downloadEleves(status) {
    try {
      const res = await client.get('/rapports/download/eleves.xlsx', {
        params: { classe_id: id, status, devise },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `classe_${id}_${status}_${Date.now()}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors du téléchargement du rapport.');
    }
  }

  const filteredEleves = eleves
    .filter((e) => {
      const search = eleveSearch.trim().toLowerCase();
      if (!search) return true;
      return [e.matricule, e.nom, e.prenom, e.perce_par].some((value) => (value || '').toLowerCase().includes(search));
    })
    .sort((a, b) => {
      const field = eleveSort.field;
      const order = eleveSort.order === 'asc' ? 1 : -1;
      if (field === 'total_paye' || field === 'reste') {
        return (parseFloat(a[field] || 0) - parseFloat(b[field] || 0)) * order;
      }
      const va = (a[field] || '').toString().toLowerCase();
      const vb = (b[field] || '').toString().toLowerCase();
      return va.localeCompare(vb) * order;
    });

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner spinner-lg"></div>
        <p>Chargement...</p>
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-danger">{error}</div>;
  }

  return (
    <div>
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: '12px' }}>
        <button className="btn btn-outline" onClick={() => navigate('/classes')}><i className="ph ph-arrow-left"></i> Retour aux classes</button>
        <div>
          <h2 style={{ margin: 0 }}>{classe?.nom || 'Classe'}</h2>
          <div className="text-muted">{eleves.length} élève(s) actif(s)</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button className="btn btn-outline btn-sm" onClick={() => downloadEleves('solde')}>Télécharger élèves soldés</button>
          <button className="btn btn-outline btn-sm" onClick={() => downloadEleves('non_solde')}>Télécharger élèves non soldés</button>
        </div>
      </div>

      <div className="grid-3 mb-16" style={{ gap: '16px' }}>
        <div className="card">
          <div className="card-header"><h3>Informations</h3></div>
          <div className="card-body">
            <table>
              <tbody>
                <tr><td className="text-muted">Nom</td><td>{classe?.nom || '—'}</td></tr>
                <tr><td className="text-muted">Statut</td><td>{classe?.actif ? 'Active' : 'Archivée'}</td></tr>
                <tr><td className="text-muted">Ordre</td><td>{classe?.ordre || '—'}</td></tr>
                <tr><td className="text-muted">Effectif max</td><td>{classe?.effectif_max || '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>Résultats</h3></div>
          <div className="card-body">
            <div className="stat-card"><div className="stat-info"><div className="label">Total attendu</div><div className="value">{format(stats?.total_attendu)}</div></div></div>
            <div className="stat-card"><div className="stat-info"><div className="label">Total payé</div><div className="value">{format(stats?.total_paye)}</div></div></div>
            <div className="stat-card"><div className="stat-info"><div className="label">Reste</div><div className="value">{format((stats?.total_attendu || 0) - (stats?.total_paye || 0))}</div></div></div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Liste des élèves</h3></div>
        <div className="card-body">
          <div className="flex-between mb-8" style={{ flexWrap: 'wrap', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <label style={{ margin: 0 }}>Recherche</label>
              <input type="search" value={eleveSearch} onChange={(e) => setEleveSearch(e.target.value)} placeholder="Matricule, Nom, Prénom, Perçu par..." style={{ minWidth: 240 }} />
            </div>
            <div className="text-muted">{filteredEleves.length} résultat(s)</div>
          </div>
          <div className="table-container" style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th onClick={() => sortEleves('matricule')} style={{ cursor: 'pointer' }}>Matricule</th>
                  <th onClick={() => sortEleves('nom')} style={{ cursor: 'pointer' }}>Nom</th>
                  <th onClick={() => sortEleves('prenom')} style={{ cursor: 'pointer' }}>Prénom</th>
                  <th onClick={() => sortEleves('total_paye')} style={{ cursor: 'pointer' }}>Total payé</th>
                  <th onClick={() => sortEleves('reste')} style={{ cursor: 'pointer' }}>Reste</th>
                  <th onClick={() => sortEleves('dernier_paiement_date')} style={{ cursor: 'pointer' }}>Date paiement</th>
                  <th>Perçu par</th>
                </tr>
              </thead>
              <tbody>
                {filteredEleves.length === 0 && (
                  <tr><td colSpan={7} className="text-center text-muted">Aucun élève actif trouvé pour cette classe.</td></tr>
                )}
                {filteredEleves.map((e) => (
                  <tr key={e.id}>
                    <td>{e.matricule}</td>
                    <td>{e.nom} {!!e.redoublant && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Redoublant</span>}</td>
                    <td>{e.prenom}</td>
                    <td>{format(e.total_paye)}</td>
                    <td>{format(Math.max(0, (e.frais_scolarite_total || 0) - (e.total_paye || 0)))}</td>
                    <td>{e.dernier_paiement_date || '—'}</td>
                    <td>{e.perce_par || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
