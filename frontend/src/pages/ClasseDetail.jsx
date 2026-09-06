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
  const [sections, setSections] = useState([]);
  const [elevesSansSection, setElevesSansSection] = useState(0);
  const [nouvelleSection, setNouvelleSection] = useState('');
  const [sectionError, setSectionError] = useState('');
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
      setSections(classeRes.data.sections || []);
      setElevesSansSection(classeRes.data.elevesSansSection || 0);
      setEleves(elevesRes.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors du chargement de la classe.');
      setClasse(null);
      setEleves([]);
    } finally {
      setLoading(false);
    }
  }

  async function ajouterSection(e) {
    e.preventDefault();
    setSectionError('');
    if (!nouvelleSection.trim()) return;
    try {
      await client.post(`/classes/${id}/sections`, { nom: nouvelleSection.trim() });
      setNouvelleSection('');
      loadClasse();
    } catch (err) {
      setSectionError(err.response?.data?.error || 'Erreur.');
    }
  }

  async function supprimerSection(section) {
    if (!window.confirm(`Supprimer la section "${classe?.nom} ${section.nom}" ?`)) return;
    try {
      await client.delete(`/classes/sections/${section.id}`);
      loadClasse();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
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

  // Classe pivot : les eleves fraichement promus depuis la classe inferieure (normaux, pas
  // encore concernes par un transfert) ne doivent jamais etre meles a ceux qui etaient deja
  // presents avant la derniere promotion et sont maintenant en retard de transfert manuel.
  const estPivot = !!classe?.est_pivot;
  const elevesEnAttente = estPivot ? filteredEleves.filter((e) => !!e.en_attente_orientation) : [];
  const elevesDeCetteAnnee = estPivot ? filteredEleves.filter((e) => !e.en_attente_orientation) : filteredEleves;

  function tableEleves(liste, emptyLabel) {
    return (
      <div className="table-container" style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th onClick={() => sortEleves('matricule')} style={{ cursor: 'pointer' }}>Matricule</th>
              <th onClick={() => sortEleves('nom')} style={{ cursor: 'pointer' }}>Nom</th>
              <th onClick={() => sortEleves('prenom')} style={{ cursor: 'pointer' }}>Prénom</th>
              <th>Section</th>
              <th onClick={() => sortEleves('total_paye')} style={{ cursor: 'pointer' }}>Total payé</th>
              <th onClick={() => sortEleves('reste')} style={{ cursor: 'pointer' }}>Reste</th>
              <th onClick={() => sortEleves('dernier_paiement_date')} style={{ cursor: 'pointer' }}>Date paiement</th>
              <th>Perçu par</th>
              {estPivot && <th></th>}
            </tr>
          </thead>
          <tbody>
            {liste.length === 0 && (
              <tr><td colSpan={estPivot ? 9 : 8} className="text-center text-muted">{emptyLabel}</td></tr>
            )}
            {liste.map((e) => (
              <tr key={e.id}>
                <td>{e.matricule}</td>
                <td>{e.nom} {!!e.redoublant && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Redoublant</span>}</td>
                <td>{e.prenom}</td>
                <td>{e.section_nom || '—'}</td>
                <td>{format(e.total_paye)}</td>
                <td>{format(Math.max(0, (e.frais_scolarite_total || 0) - (e.total_paye || 0)))}</td>
                <td>{e.dernier_paiement_date || '—'}</td>
                <td>{e.perce_par || '—'}</td>
                {estPivot && (
                  <td><button className="btn btn-link btn-sm" onClick={() => navigate(`/eleves/${e.id}`)}>Ouvrir la fiche →</button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

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
        <div className="card">
          <div className="card-header"><h3>Sections</h3></div>
          <div className="card-body">
            {sectionError && <div className="alert alert-danger">{sectionError}</div>}
            {sections.length === 0 && <div className="text-muted mb-8">Aucune section — tous les élèves sont directement dans "{classe?.nom}".</div>}
            {sections.length > 0 && (
              <table className="mb-8">
                <tbody>
                  {sections.map((s) => (
                    <tr key={s.id}>
                      <td>{classe?.nom} {s.nom}</td>
                      <td className="text-muted">{s.nb_eleves} élève(s)</td>
                      <td><button className="btn btn-link btn-sm danger" onClick={() => supprimerSection(s)}><i className="ph ph-trash"></i></button></td>
                    </tr>
                  ))}
                  {elevesSansSection > 0 && (
                    <tr><td colSpan={2} className="text-muted">Sans section assignée</td><td>{elevesSansSection}</td></tr>
                  )}
                </tbody>
              </table>
            )}
            <form className="flex gap-8" onSubmit={ajouterSection}>
              <input placeholder="Ex: A, B, C..." value={nouvelleSection} onChange={(e) => setNouvelleSection(e.target.value)} style={{ flex: 1 }} />
              <button type="submit" className="btn btn-outline btn-sm">Ajouter</button>
            </form>
          </div>
        </div>
      </div>

      {estPivot ? (
        <>
          <div className="card mb-16">
            <div className="card-header">
              <h3><i className="ph ph-git-fork"></i> En attente de transfert <span className="badge badge-warning" style={{ marginLeft: 8 }}>{elevesEnAttente.length}</span></h3>
            </div>
            <div className="card-body">
              <div className="alert alert-warning mb-8">
                Ces élèves étaient déjà dans "{classe?.nom}" avant la dernière promotion : ils doivent être transférés individuellement vers la classe qu'ils ont choisie (ouvrir leur fiche → bouton "Transférer").
              </div>
              {tableEleves(elevesEnAttente, 'Aucun élève en attente de transfert.')}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><h3>Élèves de cette année</h3></div>
            <div className="card-body">
              <div className="flex-between mb-8" style={{ flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <label style={{ margin: 0 }}>Recherche</label>
                  <input type="search" value={eleveSearch} onChange={(e) => setEleveSearch(e.target.value)} placeholder="Matricule, Nom, Prénom, Perçu par..." style={{ minWidth: 240 }} />
                </div>
                <div className="text-muted">{elevesDeCetteAnnee.length} résultat(s)</div>
              </div>
              {tableEleves(elevesDeCetteAnnee, 'Aucun élève actif trouvé pour cette classe.')}
            </div>
          </div>
        </>
      ) : (
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
            {tableEleves(filteredEleves, 'Aucun élève actif trouvé pour cette classe.')}
          </div>
        </div>
      )}
    </div>
  );
}
