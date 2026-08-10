import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

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
  '/utilisateurs': ['Gestion des utilisateurs', 'Rôles et permissions'],
  '/parametres': ['Paramètres', "Configuration de l'école"],
  '/corbeille': ['Corbeille', 'Données récupérables (30 jours)'],
  '/logs': ["Journal d'activité", 'Historique des actions'],
  '/profil': ['Mon profil', 'Informations personnelles'],
};

function findGroupIndex(groups, pathname) {
  for (let i = 0; i < groups.length; i++) {
    for (const item of groups[i].items) {
      if (item.to === '/' ? pathname === '/' : pathname.startsWith(item.to)) return i;
    }
  }
  return 0;
}

export default function Layout({ children }) {
  const { user, logout, hasPermission } = useAuth();
  const location = useLocation();
  const [title, subtitle] = PAGE_TITLES[location.pathname] || ['EcolePay', ''];
  const [manualSection, setManualSection] = useState(null);

  useEffect(() => { setManualSection(null); }, [location.pathname]);

  const initials = user ? `${(user.prenom || '')[0] || ''}${(user.nom || '')[0] || ''}`.toUpperCase() : '';

  const visibleGroups = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((item) => (item.admin ? user?.role === 'admin' : item.perm ? hasPermission(item.perm) : true)) }))
    .filter((g) => g.items.length);

  const activeIndex = manualSection !== null ? manualSection : findGroupIndex(visibleGroups, location.pathname);
  const activeGroup = visibleGroups[activeIndex];

  return (
    <div className="app-shell">
      <aside className="nav-rail">
        <NavLink to="/" className="nav-rail-logo"><i className="ph-fill ph-graduation-cap"></i></NavLink>
        <div className="nav-rail-groups">
          {visibleGroups.map((g, i) => (
            <button key={g.section} type="button" title={g.section} className={i === activeIndex ? 'nav-rail-btn active' : 'nav-rail-btn'} onClick={() => setManualSection(i)}>
              <i className={g.railIcon}></i>
            </button>
          ))}
        </div>
      </aside>

      <aside className="nav-panel">
        <div className="nav-panel-brand">
          <div className="name">EcolePay</div>
        </div>
        {activeGroup && (
          <div className="nav-panel-section">
            <div className="nav-panel-label">{activeGroup.section}</div>
            <nav className="nav-panel-nav">
              {activeGroup.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                  <i className={item.icon}></i> {item.label}
                </NavLink>
              ))}
            </nav>
          </div>
        )}
        <div className="nav-panel-footer">EcolePay</div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            <div className="subtitle">{subtitle}</div>
          </div>
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
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
