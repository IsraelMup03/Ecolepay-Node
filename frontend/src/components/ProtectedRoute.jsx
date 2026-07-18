import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Chargement...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.premier_connexion) return <Navigate to="/changer-mot-de-passe" replace />;
  return children;
}

export function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export function PermissionRoute({ perm, children }) {
  const { hasPermission } = useAuth();
  if (!hasPermission(perm)) return <Navigate to="/" replace />;
  return children;
}
