import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import client from '../api/client.js';
import { useAuth } from './AuthContext.jsx';

const DeviseContext = createContext(null);

// Tous les montants stockes en base (montant_usd, frais_scolarite_total, total_paye, etc.)
// sont exprimes dans la devise principale de l'ecole ("USD"). Ce contexte permet de basculer
// l'affichage de CES MEMES montants, partout dans le logiciel, vers la devise locale
// (ecole.devise_locale, "CDF" par defaut) selon le taux de change configure dans les
// parametres systeme -- et l'operation inverse (retour a USD) reste possible a tout moment.
export function DeviseProvider({ children }) {
  const { user } = useAuth();
  const [devise, setDevise] = useState(() => localStorage.getItem('ecolepay_devise') || 'USD');
  const [deviseLocale, setDeviseLocale] = useState('CDF');
  const [tauxChange, setTauxChange] = useState(1);

  const refreshDevise = useCallback(() => {
    client.get('/parametres').then((res) => {
      const { ecole, params } = res.data;
      setDeviseLocale(ecole?.devise_locale || 'CDF');
      setTauxChange(parseFloat(params?.taux_usd_cdf) || 1);
    }).catch(() => {});
  }, []);

  // Ne charger le taux qu'une fois authentifie : /api/parametres exige un token, et
  // sans ce garde-fou le premier appel (sur l'ecran de login) echoue en 401 et n'est
  // jamais reessaye, laissant le taux bloque a sa valeur de repli (1) toute la session.
  useEffect(() => { if (user) refreshDevise(); }, [user, refreshDevise]);
  useEffect(() => { localStorage.setItem('ecolepay_devise', devise); }, [devise]);

  function toggleDevise() {
    setDevise((d) => (d === 'USD' ? deviseLocale : 'USD'));
  }

  // `montant` est toujours suppose exprime dans la devise principale (USD, telle que stockee en base).
  function convert(montant) {
    const m = parseFloat(montant) || 0;
    return devise === 'USD' ? m : m * tauxChange;
  }

  function format(montant, decimales) {
    const val = convert(montant);
    const d = decimales !== undefined ? decimales : (devise === 'USD' ? 2 : 0);
    return `${val.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })} ${devise === 'CDF' ? 'FC' : devise}`;
  }

  return (
    <DeviseContext.Provider value={{ devise, deviseLocale, tauxChange, toggleDevise, convert, format, refreshDevise }}>
      {children}
    </DeviseContext.Provider>
  );
}

export function useDevise() {
  return useContext(DeviseContext);
}
