import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useAnnee } from '../context/AnneeContext.jsx';
import { useDevise } from '../context/DeviseContext.jsx';
import { API_URL } from '../api/client.js';
import GlobalSearch from './GlobalSearch.jsx';

const NAV_GROUPS = [
  { section: 'Général', railIcon: 'ph-bold ph-house', items: [
    { to: '/', icon: 'ph-bold ph-squares-four', label: 'Tableau de bord', perm: null },
    { to: '/caisse', icon: 'ph-bold ph-cash-register', label: 'Caisse rapide', perm: 'paiements' },
  ]},
  { section: 'Gestion', railIcon: 'ph-bold ph-briefcase', items: [
    { to: '/eleves', icon: 'ph-bold ph-graduation-cap', label: 'Élèves', perm: 'eleves' },
    { to: '/classes', icon: 'ph-bold ph-buildings', label: 'Classes', perm: 'classes' },
    { to: '/paiements', icon: 'ph-bold ph-credit-card', label: 'Paiements', perm: null },
    { to: '/remboursements', icon: 'ph-bold ph-arrow-counter-clockwise', label: 'Remboursements', perm: 'remboursements' },
    { to: '/promotion', icon: 'ph-bold ph-arrow-circle-up', label: 'Promotion annuelle', perm: 'promotion' },
  ]},
  { section: 'Analyse', railIcon: 'ph-bold ph-chart-line', items: [
    { to: '/rapports', icon: 'ph-bold ph-chart-bar', label: 'Rapports', perm: 'rapports' },
    { to: '/historique', icon: 'ph-bold ph-clock-counter-clockwise', label: 'Historique des années', perm: 'historique' },
  ]},
  { section: 'Administration', railIcon: 'ph-bold ph-shield-check', items: [
    { to: '/utilisateurs', icon: 'ph-bold ph-users-three', label: 'Utilisateurs', admin: true },
    { to: '/parametres', icon: 'ph-bold ph-gear-six', label: 'Paramètres', perm: 'parametres' },
    { to: '/corbeille', icon: 'ph-bold ph-trash', label: 'Corbeille', admin: true },
    { to: '/logs', icon: 'ph-bold ph-clipboard-text', label: "Journal d'activité", admin: true },
  ]},
  { section: 'Mon compte', railIcon: 'ph-bold ph-user-circle', items: [
    { to: '/profil', icon: 'ph-bold ph-user', label: 'Mon profil', perm: null },
  ]},
];

const PAGE_TITLES = {
  '/': ['Tableau de bord', "Vue d'ensemble de l'année scolaire"],
  '/caisse': ['Caisse rapide', 'Enregistrer un paiement'],
  '/eleves': ['Gestion des élèves', 'Inscriptions et suivi des paiements'],
  '/classes': ['Gestion des classes', 'Frais et hiérarchie des classes'],
  '/paiements': ['Historique des paiements', 'Toutes les transactions'],
  '/remboursements': ['Remboursements', 'Demandes et approbations'],
  '/promotion': ['Promotion annuelle', "Passage à l'année suivante"],
  '/rapports': ['Rapports & statistiques', 'Analyse financière détaillée'],
  '/historique': ['Historique des années', "Tout ce qui s'est passé, année par année"],
  '/utilisateurs': ['Gestion des utilisateurs', 'Rôles et permissions'],
  '/parametres': ['Paramètres', "Configuration de l'école"],
  '/corbeille': ['Corbeille', 'Données récupérables (30 jours)'],
  '/logs': ["Journal d'activité", 'Historique des actions'],
  '/profil': ['Mon profil', 'Informations personnelles'],
  '/eleves/': ['Fiche élève', 'Détails et paiements'],
  '/classes/': ['Détails de la classe', 'Élèves et recouvrement'],
};

function findTitle(pathname) {
  if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
  const prefixMatch = Object.keys(PAGE_TITLES).find((k) => k.length > 1 && k.endsWith('/') && pathname.startsWith(k));
  return prefixMatch ? PAGE_TITLES[prefixMatch] : ['EcolePay', ''];
}

function findGroupIndex(groups, pathname) {
  for (let i = 0; i < groups.length; i++) {
    for (const item of groups[i].items) {
      if (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)) return i;
    }
  }
  return 0;
}

export default function Layout({ children }) {
  const { user, logout, hasPermission, ecole } = useAuth();
  const { viewingAnnee, setViewingAnnee } = useAnnee();
  const { devise, deviseLocale, toggleDevise } = useDevise();
  const location = useLocation();
  const [title, subtitle] = findTitle(location.pathname);

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((item) => (item.admin ? user?.role === 'admin' : item.perm ? hasPermission(item.perm) : true)) }))
    .filter((g) => g.items.length);

  const [expanded, setExpanded] = useState(() => {
    const idx = findGroupIndex(visibleGroups, location.pathname);
    return new Set([visibleGroups[idx]?.section].filter(Boolean));
  });

  // Deplie automatiquement la section de la page active, sans jamais replier les autres.
  useEffect(() => {
    const idx = findGroupIndex(NAV_GROUPS, location.pathname);
    const section = NAV_GROUPS[idx]?.section;
    if (section) setExpanded((prev) => (prev.has(section) ? prev : new Set(prev).add(section)));
  }, [location.pathname]);

  function toggleSection(section) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section); else next.add(section);
      return next;
    });
  }

  const initials = user ? `${(user.prenom || '')[0] || ''}${(user.nom || '')[0] || ''}`.toUpperCase() : '';

  return (
    <div className="app-shell">
      <aside className="nav-sidebar">
        <NavLink to="/" className="nav-sidebar-brand">
          <div className="brand-icon-wrap">
            {ecole?.logo ? (
              <img src={`${API_URL.replace(/\/api$/, '')}/uploads/logos/${ecole.logo}`} alt="logo" className="nav-logo-img" />
            ) : (
              <i className="ph-fill ph-graduation-cap"></i>
            )}
          </div>
          <div className="name">{ecole?.nom || 'EcolePay'}</div>
        </NavLink>

        <nav className="nav-tree">
          {visibleGroups.map((g) => {
            const isExpanded = expanded.has(g.section);
            return (
              <div key={g.section} className="nav-tree-group">
                <button
                  type="button"
                  className={isExpanded ? 'nav-tree-header expanded' : 'nav-tree-header'}
                  onClick={() => toggleSection(g.section)}
                  aria-expanded={isExpanded}
                >
                  <i className={g.railIcon}></i>
                  <span>{g.section}</span>
                  <i className="ph-bold ph-caret-right nav-tree-chevron"></i>
                </button>
                {isExpanded && (
                  <div className="nav-tree-children">
                    {g.items.map((item) => (
                      <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                        <i className={item.icon}></i> {item.label}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        <div className="nav-sidebar-footer">Développé par FoxGroupe</div>
      </aside>

      <div className="main-area">
        <div className="topbar-wrap">
          <header className="topbar">
            <div>
              <h1>{title}</h1>
              <div className="subtitle">{subtitle}</div>
            </div>
            <GlobalSearch />
            <button
              type="button"
              className="devise-toggle"
              onClick={toggleDevise}
              title={`Afficher les montants en ${devise === 'USD' ? deviseLocale : 'USD'}`}
            >
              <span className={devise === 'USD' ? 'active' : ''}>USD</span>
              <span className={devise !== 'USD' ? 'active' : ''}>{deviseLocale === 'CDF' ? 'FC' : deviseLocale}</span>
            </button>
            <div className="topbar-user">
              <div className="info">
                <div><strong>{user?.prenom} {user?.nom}</strong></div>
                <div className="role">{user?.role}</div>
              </div>
              <div className="avatar">{initials}</div>
              <button className="logout-btn" onClick={logout} title="Déconnexion">
                <i className="ph-bold ph-sign-out"></i>
              </button>
            </div>
          </header>
          {viewingAnnee && (
            <div className="historical-banner">
              <span><i className="ph-bold ph-clock-counter-clockwise"></i>Vous consultez l'année <strong>{viewingAnnee}</strong> — lecture seule</span>
              <button className="btn btn-sm btn-outline" onClick={() => setViewingAnnee(null)}>Retour à l'année en cours</button>
            </div>
          )}
        </div>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
