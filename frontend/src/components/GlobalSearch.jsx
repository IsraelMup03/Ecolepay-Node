import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '../api/client.js';

function fmt(n, devise = 'USD') {
  return `${(parseFloat(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${devise}`;
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function handleChange(v) {
    setQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (v.trim().length < 2) { setResults(null); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      const res = await client.get('/recherche', { params: { q: v.trim() } });
      setResults(res.data);
      setOpen(true);
    }, 250);
  }

  function goTo(path) {
    setOpen(false);
    setQ('');
    setResults(null);
    navigate(path);
  }

  const hasResults = results && (results.eleves.length || results.paiements.length || results.classes.length);

  return (
    <div className="global-search" ref={wrapRef}>
      <div className="search-input-wrap">
        <i className="ph ph-magnifying-glass"></i>
        <input
          placeholder="Rechercher un élève, un reçu, une classe..."
          value={q}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => { if (results) setOpen(true); }}
        />
      </div>

      {open && (
        <div className="global-search-results">
          {!hasResults && <div className="global-search-empty">Aucun résultat pour « {q} ».</div>}

          {results.eleves.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-label">Élèves</div>
              {results.eleves.map((e) => (
                <div key={`e-${e.id}`} className="global-search-item" onClick={() => goTo(`/eleves/${e.id}`)}>
                  <div className={e.genre === 'F' ? 'genre-f' : 'genre-m'}>{e.genre}</div>
                  <div>
                    <div className="global-search-item-title">{e.prenom} {e.nom}</div>
                    <div className="global-search-item-sub">{e.matricule} · {e.classe_nom || '—'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.paiements.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-label">Reçus de paiement</div>
              {results.paiements.map((p) => (
                <div key={`p-${p.id}`} className="global-search-item" onClick={() => goTo(`/recu/${p.id}`)}>
                  <i className="ph ph-receipt"></i>
                  <div>
                    <div className="global-search-item-title">{p.reference}</div>
                    <div className="global-search-item-sub">{p.prenom} {p.nom} · {fmt(p.montant, p.devise)} · {p.annee_scolaire}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {results.classes.length > 0 && (
            <div className="global-search-group">
              <div className="global-search-group-label">Classes</div>
              {results.classes.map((c) => (
                <div key={`c-${c.id}`} className="global-search-item" onClick={() => goTo(`/classes/${c.id}`)}>
                  <i className="ph ph-buildings"></i>
                  <div>
                    <div className="global-search-item-title">{c.nom}</div>
                    <div className="global-search-item-sub">{fmt(c.frais_scolarite, c.devise)} / an</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
