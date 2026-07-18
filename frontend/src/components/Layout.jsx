import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const NAV_ITEMS = [
  { section: 'Général', items: [
    { to: '/', icon: 'ri-dashboard-line', label: 'Tableau de bord', perm: null },
    { to: '/caisse', icon: 'ri-cash-line', label: 'Caisse rapide', perm: 'paiements' },
  ]},
  { section: 'Gestion', items: [
    { to: '/eleves', icon: 'ri-graduation-cap-line', label: 'Élèves', perm: 'eleves' },
    { to: '/classes', icon: 'ri-building-4-line', label: 'Classes', perm: 'classes' },
    { to: '/paiements', icon: 'ri-bank-card-line', label: 'Paiements', perm: null },
    { to: '/remboursements', icon: 'ri-refund-2-line', label: 'Remboursements', perm: 'remboursements' },
    { to: '/promotion', icon: 'ri-arrow-up-circle-line', label: 'Promotion annuelle', perm: 'promotion' },
  ]},
  { section: 'Analyse', items: [
    { to: '/rapports', icon: 'ri-bar-chart-box-line', label: 'Rapports', perm: 'rapports' },
  ]},
  { section: 'Administration', items: [
    { to: '/utilisateurs', icon: 'ri-team-line', label: 'Utilisateurs', admin: true },
    { to: '/parametres', icon: 'ri-settings-3-line', label: 'Paramètres', perm: 'parametres' },
    { to: '/corbeille', icon: 'ri-delete-bin-line', label: 'Corbeille', admin: true },
    { to: '/logs', icon: 'ri-file-list-3-line', label: "Journal d'activité", admin: true },
  ]},
  { section: 'Mon compte', items: [
    { to: '/profil', icon: 'ri-user-line', label: 'Mon profil', perm: null },
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

export default function Layout({ children }) {
  const { user, logout, hasPermission, ecole } = useAuth();
  const location = useLocation();
  const [title, subtitle] = PAGE_TITLES[location.pathname] || ['EcolePay', ''];

  const initials = user ? `${(user.prenom || '')[0] || ''}${(user.nom || '')[0] || ''}`.toUpperCase() : '';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo-circle">🏫</div>
          <div>
            <div className="name">{ecole?.nom || 'EcolePay'}</div>
            <div className="sub">v2.0 · Node.js/React</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((group) => {
            const visibleItems = group.items.filter((item) => {
              if (item.admin) return user?.role === 'admin';
              if (item.perm) return hasPermission(item.perm);
              return true;
            });
            if (!visibleItems.length) return null;
            return (
              <div key={group.section}>
                <div className="section-label">{group.section}</div>
                {visibleItems.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
                    <i className={item.icon}></i> {item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">EcolePay v2.0 — Node.js/React</div>
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
              <i className="ri-logout-box-r-line"></i>
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
