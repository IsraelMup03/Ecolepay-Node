import React, { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import client, { API_URL } from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import { useDevise } from '../context/DeviseContext.jsx';
import GenererRapportButton from '../components/GenererRapportButton.jsx';

const COLORS = ['#059669', '#f59e0b', '#16a34a', '#7c3aed', '#dc2626'];
const MODE_LABELS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque' };

function downloadFile(path, params, filename) {
  const token = localStorage.getItem('ecolepay_token');
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v))).toString();
  fetch(`${API_URL}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => res.blob())
    .then((blob) => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      window.URL.revokeObjectURL(url);
    });
}

export default function Rapports() {
  const { viewingAnnee } = useAnnee();
  const { format, devise, convert } = useDevise();
  const [classes, setClasses] = useState([]);
  const [classeId, setClasseId] = useState('');
  const [debut, setDebut] = useState('');
  const [fin, setFin] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('soldes');

  async function load() {
    setLoading(true);
    const params = { classe_id: classeId };
    if (viewingAnnee) params.annee = viewingAnnee;
    else { params.debut = debut; params.fin = fin; }
    const res = await client.get('/rapports', { params });
    setData(res.data);
    setClasses(res.data.classes);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [classeId, debut, fin, viewingAnnee]);

  if (loading && !data) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement des rapports...</p></div>;
  if (!data) return null;

  const modeData = data.parMode.map((m) => ({ name: MODE_LABELS[m.mode_paiement] || m.mode_paiement, value: parseFloat(m.total) }));

  const TABS = {
    soldes: { label: 'Soldés', rows: data.elevesSoldes, status: 'solde' },
    partiels: { label: 'Partiels', rows: data.elevesPartiels, status: 'partiel' },
    non_payes: { label: 'Non payés', rows: data.elevesNonPayes, status: 'non_paye' },
  };
  const activeTab = TABS[tab];

  return (
    <div>
      <div className="filters-bar">
        {!viewingAnnee && (
          <>
            <div className="form-group"><input type="date" value={debut} onChange={(e) => setDebut(e.target.value)} /></div>
            <div className="form-group"><input type="date" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
          </>
        )}
        <div className="form-group">
          <select value={classeId} onChange={(e) => setClasseId(e.target.value)}>
            <option value="">Toutes les classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        </div>
        {!viewingAnnee && <div style={{ marginLeft: 'auto' }}><GenererRapportButton /></div>}
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-icon blue"><i className="ph ph-currency-circle-dollar"></i></div>
          <div className="stat-info"><div className="label">Total encaissé {viewingAnnee ? `(${viewingAnnee})` : '(période)'}</div><div className="value">{format(data.resume.total_usd)}</div></div>
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
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => convert(v).toLocaleString('fr-FR')} />
                <Tooltip formatter={(v) => format(v)} />
                <Line type="monotone" dataKey="total" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <i className="ph ph-chart-donut"></i><h3>Répartition par mode de paiement</h3>
            <div className="card-actions">
              <button className="btn btn-outline btn-sm" onClick={() => downloadFile('/rapports/download/par-mode.xlsx', { debut, fin, classe_id: classeId, annee: viewingAnnee, devise }, 'repartition_par_mode.xlsx')}>
                <i className="ph ph-file-xls"></i> Télécharger (Excel)
              </button>
            </div>
          </div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={modeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {modeData.map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => format(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="card-header">
          <i className="ph ph-chart-bar"></i><h3>Recouvrement par classe</h3>
          <div className="card-actions">
            <button className="btn btn-outline btn-sm" onClick={() => downloadFile('/rapports/download/par-classe.xlsx', { classe_id: classeId, annee: viewingAnnee, devise }, 'recouvrement_par_classe.xlsx')}>
              <i className="ph ph-file-xls"></i> Télécharger (Excel)
            </button>
          </div>
        </div>
        <div className="card-body">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.parClasse}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e6efec" />
              <XAxis dataKey="classe" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => convert(v).toLocaleString('fr-FR')} />
              <Tooltip formatter={(v) => format(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="total_paye" fill="#16a34a" name="Payé" radius={[4, 4, 0, 0]} />
              <Bar dataKey="total_attendu" fill="#d7e3de" name="Attendu" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {!viewingAnnee && (
      <div className="card mb-16">
        <div className="card-header"><i className="ph ph-sparkle"></i><h3>Prévisions financières (6 prochains mois)</h3></div>
        <div className="card-body">
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="stat-card"><div className="stat-icon red"><i className="ph ph-arrow-down"></i></div><div className="stat-info"><div className="label">Conservateur</div><div className="value">{format(data.previsions.conservateur)}</div></div></div>
            <div className="stat-card"><div className="stat-icon blue"><i className="ph ph-sliders"></i></div><div className="stat-info"><div className="label">Réaliste</div><div className="value">{format(data.previsions.realiste)}</div></div></div>
            <div className="stat-card"><div className="stat-icon green"><i className="ph ph-arrow-up"></i></div><div className="stat-info"><div className="label">Optimiste</div><div className="value">{format(data.previsions.optimiste)}</div></div></div>
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>Estimation basée sur la moyenne mensuelle observée sur la période sélectionnée.</p>
        </div>
      </div>
      )}

      <div className="card">
        <div className="flex-between" style={{ padding: '14px 18px 0' }}>
          <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
            {Object.entries(TABS).map(([key, t]) => (
              <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{t.label} ({t.rows.length})</button>
            ))}
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => downloadFile('/rapports/download/eleves.xlsx', { classe_id: classeId, status: activeTab.status, annee: viewingAnnee, devise }, `eleves_${activeTab.status}.xlsx`)}>
            <i className="ph ph-file-xls"></i> Télécharger cette liste (Excel)
          </button>
        </div>
        <div className="table-container">
          <table>
            <thead><tr><th>Matricule</th><th>Élève</th><th>Classe</th><th>Payé</th><th>Reste</th></tr></thead>
            <tbody>
              {activeTab.rows.map((e) => (
                <tr key={e.id}>
                  <td><code>{e.matricule}</code></td><td>{e.prenom} {e.nom}</td><td>{e.classe}</td>
                  <td>{format(e.total_paye)}</td>
                  <td><strong style={{ color: tab === 'soldes' ? 'var(--success)' : 'var(--danger)' }}>{format(Math.max(0, e.frais_scolarite_total - e.total_paye))}</strong></td>
                </tr>
              ))}
              {activeTab.rows.length === 0 && <tr><td colSpan={5} className="text-center text-muted">Aucun élève.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
