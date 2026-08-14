import React, { useEffect, useState } from 'react';
import { AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import client, { API_URL } from '../api/client.js';
import { useAnnee } from '../context/AnneeContext.jsx';
import { useDevise } from '../context/DeviseContext.jsx';
import RowMenu from '../components/RowMenu.jsx';
import GenererRapportButton from '../components/GenererRapportButton.jsx';

const COLORS = ['#059669', '#f59e0b', '#16a34a', '#7c3aed', '#dc2626', '#0891b2', '#c026d3', '#ea580c', '#4f46e5', '#65a30d', '#db2777', '#78716c'];
const MODE_LABELS = { especes: 'Espèces', mobile_money: 'Mobile Money', virement: 'Virement', cheque: 'Chèque' };
const DEPENSE_FORM_INIT = { categorie: 'autre', montant: '', devise: 'USD', mode_paiement: 'especes', beneficiaire: '', description: '' };

export default function Comptabilite() {
  const { viewingAnnee } = useAnnee();
  const { format, devise, convert } = useDevise();
  const [resume, setResume] = useState(null);
  const [depenses, setDepenses] = useState([]);
  const [meta, setMeta] = useState({ total: 0, somme: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [categorieFiltre, setCategorieFiltre] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(DEPENSE_FORM_INIT);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function loadResume() {
    const params = viewingAnnee ? { annee: viewingAnnee } : {};
    const res = await client.get('/comptabilite/resume', { params });
    setResume(res.data);
  }
  async function loadDepenses() {
    setLoading(true);
    const params = { page, categorie: categorieFiltre, q };
    if (viewingAnnee) params.annee = viewingAnnee;
    const res = await client.get('/comptabilite/depenses', { params });
    setDepenses(res.data.depenses);
    setMeta(res.data);
    setLoading(false);
  }

  useEffect(() => { loadResume(); /* eslint-disable-next-line */ }, [viewingAnnee]);
  useEffect(() => { setPage(1); }, [categorieFiltre, q, viewingAnnee]);
  useEffect(() => { const t = setTimeout(loadDepenses, 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [page, categorieFiltre, q, viewingAnnee]);

  function openNew() {
    setEditing(null);
    setForm(DEPENSE_FORM_INIT);
    setError('');
    setShowModal(true);
  }
  function openEdit(d) {
    setEditing(d);
    setForm({ categorie: d.categorie, montant: d.montant, devise: d.devise, mode_paiement: d.mode_paiement, beneficiaire: d.beneficiaire || '', description: d.description || '' });
    setError('');
    setShowModal(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (editing) await client.put(`/comptabilite/depenses/${editing.id}`, form);
      else await client.post('/comptabilite/depenses', form);
      setShowModal(false);
      loadDepenses();
      loadResume();
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function supprimer(d) {
    if (!window.confirm(`Supprimer la dépense "${d.reference}" ? Elle sera déplacée vers la corbeille et pourra être restaurée pendant 30 jours.`)) return;
    await client.delete(`/comptabilite/depenses/${d.id}`);
    loadDepenses();
    loadResume();
  }

  function exportDepenses() {
    const token = localStorage.getItem('ecolepay_token');
    const params = new URLSearchParams({ categorie: categorieFiltre, q, devise, ...(viewingAnnee ? { annee: viewingAnnee } : {}) }).toString();
    fetch(`${API_URL}/comptabilite/depenses/export.xlsx?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.blob())
      .then((blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `depenses_${Date.now()}.xlsx`; a.click();
        window.URL.revokeObjectURL(url);
      });
  }

  if (!resume) return <div className="loading-screen"><div className="spinner spinner-lg"></div><p>Chargement de la comptabilité...</p></div>;

  const pieData = resume.depensesParCategorie.map((c) => ({ name: c.categorie, value: c.total }));

  return (
    <div>
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div className="text-muted">Année {resume.annee}{resume.modeHistorique ? ' — lecture seule' : ''}</div>
        <div className="flex gap-8">
          <GenererRapportButton endpoint="/comptabilite/rapport.xlsx" filePrefix="comptabilite" />
          {!viewingAnnee && <button className="btn btn-accent" onClick={openNew}><i className="ph ph-plus"></i> Nouvelle sortie</button>}
        </div>
      </div>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-icon green"><i className="ph ph-arrow-circle-down"></i></div>
          <div className="stat-info"><div className="label">Total recettes</div><div className="value">{format(resume.totalRecettes)}</div><div className="sub">{resume.nbRecettes} paiement(s)</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon red"><i className="ph ph-arrow-circle-up"></i></div>
          <div className="stat-info"><div className="label">Total dépenses</div><div className="value">{format(resume.totalDepenses)}</div><div className="sub">{resume.nbDepenses} sortie(s)</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-icon blue"><i className="ph ph-scales"></i></div>
          <div className="stat-info"><div className="label">Solde net</div><div className="value" style={{ color: resume.solde >= 0 ? 'var(--success)' : 'var(--danger)' }}>{format(resume.solde)}</div></div>
        </div>
      </div>

      <div className="grid-2 mb-16">
        <div className="card">
          <div className="card-header"><i className="ph ph-chart-line"></i><h3>Recettes vs Dépenses</h3></div>
          <div className="card-body">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={resume.evolution}>
                <defs>
                  <linearGradient id="colorRecettes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.35} /><stop offset="95%" stopColor="#059669" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorDepenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#dc2626" stopOpacity={0.35} /><stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e6efec" />
                <XAxis dataKey="lbl" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => convert(v).toLocaleString('fr-FR')} />
                <Tooltip formatter={(v) => format(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="recettes" name="Recettes" stroke="#059669" fill="url(#colorRecettes)" strokeWidth={2} />
                <Area type="monotone" dataKey="depenses" name="Dépenses" stroke="#dc2626" fill="url(#colorDepenses)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><i className="ph ph-chart-donut"></i><h3>Dépenses par catégorie</h3></div>
          <div className="card-body">
            {pieData.length === 0 ? (
              <div className="empty-state"><i className="ph ph-chart-donut"></i><h3>Aucune dépense</h3></div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3}>
                    {pieData.map((entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => format(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <i className="ph ph-list-checks"></i><h3>Dépenses ({meta.total})</h3>
          <div className="card-actions">
            <button className="btn btn-outline btn-sm" onClick={exportDepenses}><i className="ph ph-file-xls"></i> Exporter (Excel)</button>
          </div>
        </div>
        <div className="filters-bar" style={{ padding: '0 18px', marginTop: 12 }}>
          <div className="search-input-wrap" style={{ flex: 1, minWidth: 200 }}>
            <i className="ph ph-magnifying-glass"></i>
            <input placeholder="Référence, bénéficiaire, description..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="form-group">
            <select value={categorieFiltre} onChange={(e) => setCategorieFiltre(e.target.value)}>
              <option value="">Toutes les catégories</option>
              {Object.entries(resume.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div className="table-container">
          <table>
            <thead><tr><th>Référence</th><th>Catégorie</th><th>Bénéficiaire</th><th>Montant</th><th>Mode</th><th>Date</th><th>Enregistré par</th><th></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan={8}><div className="loading-inline"><div className="spinner"></div> Chargement...</div></td></tr>}
              {!loading && depenses.length === 0 && <tr><td colSpan={8}><div className="empty-state"><i className="ph ph-receipt"></i><h3>Aucune dépense trouvée</h3></div></td></tr>}
              {depenses.map((d) => (
                <tr key={d.id}>
                  <td><code>{d.reference}</code></td>
                  <td><span className="badge badge-info">{resume.categories[d.categorie] || d.categorie}</span></td>
                  <td>{d.beneficiaire || '—'}</td>
                  <td><strong style={{ color: 'var(--danger)' }}>{format(d.montant_usd)}</strong></td>
                  <td>{MODE_LABELS[d.mode_paiement] || d.mode_paiement}</td>
                  <td className="text-muted">{new Date(d.date_depense).toLocaleString('fr-FR')}</td>
                  <td className="text-muted">{d.cpt_prenom ? `${d.cpt_prenom} ${d.cpt_nom}` : '—'}</td>
                  <td>
                    {!viewingAnnee && (
                      <RowMenu>
                        {(close) => (
                          <>
                            <button onClick={() => { openEdit(d); close(); }}><i className="ph ph-pencil-simple"></i> Modifier</button>
                            <button className="danger" onClick={() => { supprimer(d); close(); }}><i className="ph ph-trash"></i> Supprimer</button>
                          </>
                        )}
                      </RowMenu>
                    )}
                  </td>
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

      <div className={`modal-backdrop ${showModal ? 'show' : ''}`} onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
        <div className="modal">
          <div className="modal-header">
            <i className={editing ? 'ph ph-pencil-simple' : 'ph ph-money'}></i><h3>{editing ? 'Modifier la dépense' : 'Nouvelle sortie'}</h3>
            <button className="modal-close" onClick={() => setShowModal(false)}><i className="ph ph-x"></i></button>
          </div>
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              {error && <div className="alert alert-danger">{error}</div>}
              <div className="form-grid">
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Catégorie</label>
                    <select value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })}>
                      {Object.entries(resume.categories).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Mode de paiement</label>
                    <select value={form.mode_paiement} onChange={(e) => setForm({ ...form, mode_paiement: e.target.value })}>
                      <option value="especes">Espèces</option>
                      <option value="mobile_money">Mobile Money</option>
                      <option value="virement">Virement</option>
                      <option value="cheque">Chèque</option>
                    </select>
                  </div>
                </div>
                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label>Montant</label>
                    <input type="number" step="0.01" min="0" value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Devise</label>
                    <select value={form.devise} onChange={(e) => setForm({ ...form, devise: e.target.value })}>
                      <option value="USD">USD</option>
                      <option value="CDF">CDF</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Bénéficiaire (optionnel)</label>
                  <input placeholder="Ex: Nom du fournisseur, employé..." value={form.beneficiaire} onChange={(e) => setForm({ ...form, beneficiaire: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Description (optionnel)</label>
                  <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Annuler</button>
              <button type="submit" className="btn btn-accent" disabled={saving}>{saving ? 'Enregistrement...' : editing ? 'Enregistrer' : 'Valider la sortie'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
