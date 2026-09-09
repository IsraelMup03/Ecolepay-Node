import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import client from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const AlertesContext = createContext(null);

// Compteurs du bandeau de rappel (eleves en attente de transfert inter-classe, remboursements
// en attente). Se rafraichissent a chaque navigation -- mais une action qui les fait varier
// (approuver un remboursement, transferer un eleve...) sans changer de page ne declenchait
// rien avant : le bandeau restait affiche avec l'ancien chiffre jusqu'a la prochaine
// navigation. `refreshAlertes()` permet a ces pages de forcer une mise a jour immediate.
export function AlertesProvider({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  const [alertes, setAlertes] = useState({ elevesEnAttenteOrientation: 0, remboursementsEnAttente: 0 });

  const refreshAlertes = useCallback(() => {
    if (!user) return;
    client.get('/dashboard/alertes').then((res) => setAlertes(res.data)).catch(() => {});
  }, [user]);

  useEffect(() => { refreshAlertes(); }, [refreshAlertes, location.pathname]);

  return (
    <AlertesContext.Provider value={{ alertes, refreshAlertes }}>
      {children}
    </AlertesContext.Provider>
  );
}

export function useAlertes() {
  return useContext(AlertesContext);
}
