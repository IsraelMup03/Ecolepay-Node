import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';

function fmt(n, devise = 'USD') {
  return `${(parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

const STATUT_LABELS = { solde: 'Soldé', partiel: 'Partiel', non_paye: 'Non payé' };
const STATUT_BADGE = { solde: 'badge-success', partiel: 'badge-warning', non_paye: 'badge-danger' };

export default function Historique() {
  const navigate = useNavigate();
  const { viewingAnnee, setViewingAnnee } = useAnnee();
  const [annees, setAnnees] = useState([]);
  const [anneeCourante, setAnneeCourante] = useState(null);
  const [annee, setAnnee] = useState(null);
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('paiements');

  useEffect(() => {
    client.get('/historique/annees').then((res) => {
      setAnnees(res.data.annees);
      setAnneeCourante(res.data.anneeCourante);
      // Si on est deja en mode historique (bandeau actif), on ouvre directement sur cette annee-la.
      setAnnee(viewingAnnee || res.data.annees[0] || res.data.anneeCourante);
    });
    // eslint-disable-next-line
  }, []);

  useEffect(() => {
    if (!annee) return;
    client.get(`/historique/${annee}`, { params: { p: page } }).then((res) => setData(res.data));
  }, [annee, page]);

  function selectAnnee(a) {
    setData(null);
    setAnnee(a);
    setPage(1);
    setTab('paiements');
  }

  if (!annees.length || !annee) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement...</p></div>;

  return (
    <div>
      <div className="filters-bar">
        <div className="form-group" style={{ minWidth: 220, marginBottom: 0 }}>
          <select value={annee} onChange={(e) => selectAnnee(e.target.value)}>
            {annees.map((a) => <option key={a} value={a}>{a}{a === anneeCourante ? ' (en cours)' : ''}</option>)}
          </select>
        </div>
        <button className="btn btn-outline" onClick={() => { setViewingAnnee(annee === anneeCourante ? null : annee); navigate('/'); }}>
          <i className="ph-bold ph-clock-counter-clockwise"></i> Consulter cette année dans tout le logiciel
        </button>
      </div>

      {!data ? (
        <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement de l'année {annee}...</p></div>
      ) : (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card">
              <div className="stat-icon green"><i className="ph-bold ph-currency-circle-dollar"></i></div>
              <div className="stat-info"><div className="label">Total encaissé</div><div className="value">{fmt(data.resume.total_encaisse)}</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon blue"><i className="ph-bold ph-list-checks"></i></div>
              <div className="stat-info"><div className="label">Paiements</div><div className="value">{data.resume.nb_paiements}</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon red"><i className="ph-bold ph-arrow-counter-clockwise"></i></div>
              <div className="stat-info"><div className="label">Remboursements</div><div className="value">{data.resume.nb_remboursements}</div></div>
            </div>
            <div className="stat-card">
              <div className="stat-icon purple"><i className="ph-bold ph-graduation-cap"></i></div>
              <div className="stat-info"><div className="label">Élèves suivis</div><div className="value">{data.resume.nb_eleves}</div></div>
            </div>
          </div>

          <div className="tabs">
            <button className={tab === 'paiements' ? 'active' : ''} onClick={() => setTab('paiements')}>Paiements ({data.total})</button>
            <button className={tab === 'remboursements' ? 'active' : ''} onClick={() => setTab('remboursements')}>Remboursements ({data.remboursements.length})</button>
            <button className={tab === 'situation' ? 'active' : ''} onClick={() => setTab('situation')}>Situation par élève ({data.situation.length})</button>
          </div>

          {tab === 'paiements' && (
            <div className="card">
              <div className="table-container">
                <table>
                  <thead><tr><th>Référence</th><th>Élève</th><th>Classe</th><th>Type</th><th>Montant</th><th>Mode</th><th>Statut</th><th>Date</th><th>Encaissé par</th></tr></thead>
                  <tbody>
                    {data.paiements.length === 0 && <tr><td colSpan={9} className="text-center text-muted">Aucun paiement pour cette année.</td></tr>}
                    {data.paiements.map((p) => (
                      <tr key={p.id}>
                        <td><code>{p.reference}</code></td>
                        <td>{p.prenom} {p.nom} <span className="text-muted">({p.matricule})</span></td>
                        <td>{p.classe || '—'}</td>
                        <td><span className="badge badge-info">{p.type_paiement}</span></td>
                        <td><strong>{fmt(p.montant, p.devise)}</strong></td>
                        <td>{p.mode_paiement}</td>
                        <td><span className={`badge ${p.statut === 'valide' ? 'badge-success' : p.statut === 'rembourse' ? 'badge-danger' : 'badge-default'}`}>{p.statut}</span></td>
                        <td className="text-muted">{new Date(p.date_paiement).toLocaleString('fr-FR')}</td>
                        <td className="text-muted">{p.cpt_prenom ? `${p.cpt_prenom} ${p.cpt_nom}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.totalPages > 1 && (
                <div className="pagination">
                  <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Précédent</button>
                  <span className="text-muted" style={{ padding: '6px 10px' }}>Page {page} / {data.totalPages}</span>
                  <button className="btn btn-outline btn-sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Suivant</button>
                </div>
              )}
            </div>
          )}

          {tab === 'remboursements' && (
            <div className="card">
              <div className="table-container">
                <table>
                  <thead><tr><th>Référence</th><th>Élève</th><th>Paiement</th><th>Montant</th><th>Motif</th><th>Statut</th><th>Date</th><th>Approuvé par</th></tr></thead>
                  <tbody>
                    {data.remboursements.length === 0 && <tr><td colSpan={8} className="text-center text-muted">Aucun remboursement pour cette année.</td></tr>}
                    {data.remboursements.map((r) => (
                      <tr key={r.id}>
                        <td><code>{r.reference_remboursement}</code></td>
                        <td>{r.prenom} {r.nom} <span className="text-muted">({r.matricule})</span></td>
                        <td><code>{r.pay_ref}</code></td>
                        <td><strong>{fmt(r.montant, r.devise)}</strong></td>
                        <td className="text-muted">{r.motif}</td>
                        <td><span className={`badge ${r.statut === 'approuve' ? 'badge-success' : r.statut === 'rejete' ? 'badge-danger' : 'badge-warning'}`}>{r.statut}</span></td>
                        <td className="text-muted">{new Date(r.date_remboursement).toLocaleDateString('fr-FR')}</td>
                        <td className="text-muted">{r.appr_prenom ? `${r.appr_prenom} ${r.appr_nom}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'situation' && (
            <div className="card">
              <div className="table-container">
                <table>
                  <thead><tr><th>Élève</th><th>Matricule</th><th>Classe</th><th>Frais total</th><th>Payé</th><th>Statut</th></tr></thead>
                  <tbody>
                    {data.situation.length === 0 && <tr><td colSpan={6} className="text-center text-muted">Aucune donnée pour cette année.</td></tr>}
                    {data.situation.map((s) => (
                      <tr key={s.eleve_id}>
                        <td>{s.prenom} {s.nom}</td>
                        <td><code>{s.matricule}</code></td>
                        <td>{s.classe_nom || '—'}</td>
                        <td>{fmt(s.frais_scolarite_total)}</td>
                        <td>{fmt(s.total_paye)}</td>
                        <td><span className={`badge ${STATUT_BADGE[s.statut_paiement] || 'badge-default'}`}>{STATUT_LABELS[s.statut_paiement] || s.statut_paiement}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
