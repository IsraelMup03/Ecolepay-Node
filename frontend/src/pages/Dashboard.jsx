import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import client from '../api/client.js';

function fmt(n, devise = 'USD') {
  return `${(parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get('/dashboard').then((res) => setData(res.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center text-muted" style={{ padding: 60 }}>Chargement du tableau de bord...</div>;
  if (!data) return <div className="alert alert-danger">Impossible de charger les données.</div>;

  const { stats, mensuel, parClasse, derniers, devise, annee } = data;

  return (
    <div>
      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-icon blue"><i className="ri-graduation-cap-line"></i></div>
          <div className="stat-info">
            <div className="label">Élèves actifs</div>
            <div className="value">{stats.totalEleves}</div>
            <div className="sub">{stats.totalGarcons} garçons · {stats.totalFilles} filles</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon purple"><i className="ri-building-4-line"></i></div>
          <div className="stat-info">
            <div className="label">Classes actives</div>
            <div className="value">{stats.totalClasses}</div>
            <div className="sub">Année {annee}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><i className="ri-money-dollar-circle-line"></i></div>
          <div className="stat-info">
            <div className="label">Total encaissé</div>
            <div className="value">{fmt(stats.totalAnnee, devise)}</div>
            <div className="sub">Sur l'année {annee}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><i className="ri-calendar-check-line"></i></div>
          <div className="stat-info">
            <div className="label">Aujourd'hui</div>
            <div className="value">{fmt(stats.paiementsAujourdhui, devise)}</div>
            <div className="sub">Ce mois : {fmt(stats.paiementsMois, devise)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><i className="ri-percent-line"></i></div>
          <div className="stat-info">
            <div className="label">Taux de recouvrement</div>
            <div className="value">{stats.taux}%</div>
            <div className="sub">Attendu : {fmt(stats.totalAttendu, devise)}</div>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red"><i className="ri-alert-line"></i></div>
          <div className="stat-info">
            <div className="label">Élèves non soldés</div>
            <div className="value">{stats.elevesNonSoldes}</div>
            <div className="sub">{stats.elevesSoldes} soldés</div>
          </div>
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><i className="ri-line-chart-line"></i><h3>Évolution des encaissements (12 derniers mois)</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={mensuel}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2557a7" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#2557a7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" />
                <XAxis dataKey="lbl" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => fmt(v, devise)} />
                <Area type="monotone" dataKey="total" stroke="#2557a7" fill="url(#colorTotal)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><i className="ri-bar-chart-grouped-line"></i><h3>Recouvrement par classe</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={parClasse}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5" />
                <XAxis dataKey="classe" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => fmt(v, devise)} />
                <Bar dataKey="total_paye" fill="#e8a020" radius={[4, 4, 0, 0]} name="Payé" />
                <Bar dataKey="total_attendu" fill="#d1dce8" radius={[4, 4, 0, 0]} name="Attendu" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <i className="ri-history-line"></i><h3>Derniers paiements</h3>
          <div className="card-actions"><Link to="/paiements" className="btn btn-outline btn-sm">Voir tout</Link></div>
        </div>
        <div className="table-container">
          <table>
            <thead><tr><th>Référence</th><th>Élève</th><th>Classe</th><th>Type</th><th>Montant</th><th>Date</th></tr></thead>
            <tbody>
              {derniers.length === 0 && <tr><td colSpan={6} className="text-center text-muted">Aucun paiement récent.</td></tr>}
              {derniers.map((p) => (
                <tr key={p.id}>
                  <td><code>{p.reference}</code></td>
                  <td>{p.prenom} {p.nom}</td>
                  <td>{p.classe}</td>
                  <td><span className="badge badge-info">{p.type_paiement}</span></td>
                  <td><strong>{fmt(p.montant, p.devise)}</strong></td>
                  <td className="text-muted">{new Date(p.date_paiement).toLocaleString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
