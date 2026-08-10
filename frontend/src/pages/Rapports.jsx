import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import client from '../api/client.js';

function fmt(n) { return (parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const COLORS = ['#059669', '#f59e0b', '#16a34a', '#7c3aed', '#dc2626'];
const MODE_LABELS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque' };

export default function Rapports() {
  const [classes, setClasses] = useState([]);
  const [classeId, setClasseId] = useState('');
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('soldes');

  async function load() {
    setLoading(true);
    const res = await client.get('/rapports', { params: { classe_id: classeId, debut, fin } });
    setData(res.data);
    setClasses(res.data.classes);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [classeId, debut, fin]);

  if (loading && !data) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement des rapports...</p></div>;
  if (!data) return null;

  const modeData = data.parMode.map((m) => ({ name: MODE_LABELS[m.mode_paiement] || m.mode_paiement, value: parseFloat(m.total) }));

  return (
    <div>
      <div className="filters-bar">
        <div className="form-group"><input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></div>
        <div className="form-group"><input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
        <div className="form-group">
          <select value={classeId} onChange={(e) => setClasseId(e.target.value)}>
            <option value="">Toutes les classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-icon blue"><i className="ph ph-currency-circle-dollar"></i></div>
          <div className="stat-info"><div className="label">Total encaissé (période)</div><div className="value">{fmt(data.resume.total_usd)}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><i className="ph ph-list-checks"></i></div>
          <div className="stat-info"><div className="label">Paiements</div><div className="value">{data.resume.nb_paiements}</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon orange"><i className="ph ph-user"></i></div>
          <div className="stat-info"><div className="label">Élèves actifs</div><div className="value">{data.totalElevesActifs}</div></div>
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><i className="ph ph-chart-line"></i><h3>Évolution mensuelle</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data.mensuel}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6efec" />
                <XAxis dataKey="mois_lbl" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Line type="monotone" dataKey="total" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><i className="ph ph-chart-donut"></i><h3>Répartition par mode de paiement</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={modeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {modeData.map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><i className="ph ph-chart-bar"></i><h3>Recouvrement par classe</h3></div>
        <div className="card-body">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.parClasse}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6efec" />
              <XAxis dataKey="classe" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="total_paye" fill="#16a34a" name="Payé" radius={[4, 4, 0, 0]} />
              <Bar dataKey="total_attendu" fill="#d7e3de" name="Attendu" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header"><i className="ph ph-sparkle"></i><h3>Prévisions financières (6 prochains mois)</h3></div>
        <div className="card-body">
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card"><div className="stat-icon red"><i className="ph ph-arrow-down"></i></div><div className="stat-info"><div className="label">Conservateur</div><div className="value">{fmt(data.previsions.conservateur)}</div></div></div>
            <div className="stat-card"><div className="stat-icon blue"><i className="ph ph-sliders"></i></div><div className="stat-info"><div className="label">Réaliste</div><div className="value">{fmt(data.previsions.realiste)}</div></div></div>
            <div className="stat-card"><div className="stat-icon green"><i className="ph ph-arrow-up"></i></div><div className="stat-info"><div className="label">Optimiste</div><div className="value">{fmt(data.previsions.optimiste)}</div></div></div>
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Estimation basée sur la moyenne mensuelle observée sur la période sélectionnée.</p>
        </div>
      </div>

      <div className="card">
        <div className="tabs" style={{ padding: '0 18px', paddingTop: 14 }}>
          <button className={tab === 'soldes' ? 'active' : ''} onClick={() => setTab('soldes')}>Élèves soldés ({data.elevesSoldes.length})</button>
          <button className={tab === 'non_soldes' ? 'active' : ''} onClick={() => setTab('non_soldes')}>Élèves non soldés ({data.elevesNonSoldes.length})</button>
        </div>
        <div className="table-container">
          {tab === 'soldes' ? (
            <table>
              <thead><tr><th>Matricule</th><th>Élève</th><th>Classe</th></tr></thead>
              <tbody>
                {data.elevesSoldes.map((e) => <tr key={e.id}><td><code>{e.matricule}</code></td><td>{e.prenom} {e.nom}</td><td>{e.classe}</td></tr>)}
                {data.elevesSoldes.length === 0 && <tr><td colSpan={3} className="text-center text-muted">Aucun élève.</td></tr>}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Matricule</th><th>Élève</th><th>Classe</th><th>Payé</th><th>Reste</th></tr></thead>
              <tbody>
                {data.elevesNonSoldes.map((e) => (
                  <tr key={e.id}>
                    <td><code>{e.matricule}</code></td><td>{e.prenom} {e.nom}</td><td>{e.classe}</td>
                    <td>{fmt(e.total_paye)}</td>
                    <td><strong style={{ color: 'var(--danger)' }}>{fmt(e.frais_scolarite_total - e.total_paye)}</strong></td>
                  </tr>
                ))}
                {data.elevesNonSoldes.length === 0 && <tr><td colSpan={5} className="text-center text-muted">Aucun élève.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
