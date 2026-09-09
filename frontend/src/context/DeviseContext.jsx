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

  // Affiche une TRANSACTION (paiement/depense/recette) dans sa devise reellement saisie.
  // Le montant natif (ce qui a ete tape) est toujours affiche tel quel -- mais l'equivalent
  // entre parentheses n'est ajoute que si cette devise saisie differe de la devise actuellement
  // affichee dans le logiciel (le bascule USD/FC) : quand les deux coincident deja, convertir
  // vers elle-meme n'apporterait rien. `options.toujours` force l'affichage de l'equivalent
  // dans tous les cas (utilise sur le recu imprimable, qui doit toujours montrer les deux
  // devises pour le parent/tuteur, independamment de ce que l'ecole affiche ce jour-la).
  function formatOriginal(row, options = {}) {
    if (!row || !row.devise) return '';
    const estCdf = row.devise === 'CDF';
    const montantNatif = parseFloat(row.montant) || 0;
    const labelNatif = estCdf ? 'FC' : row.devise;
    const decNatif = estCdf ? 0 : 2;
    const txtNatif = montantNatif.toLocaleString('fr-FR', { minimumFractionDigits: decNatif, maximumFractionDigits: decNatif });
    if (row.devise === devise && !options.toujours) return `${txtNatif} ${labelNatif}`;
    const equivalent = parseFloat(estCdf ? row.montant_usd : row.montant_local) || 0;
    const labelEquivalent = estCdf ? 'USD' : (deviseLocale === 'CDF' ? 'FC' : deviseLocale);
    const decEquiv = estCdf ? 2 : 0;
    const txtEquiv = equivalent.toLocaleString('fr-FR', { minimumFractionDigits: decEquiv, maximumFractionDigits: decEquiv });
    return `${txtNatif} ${labelNatif} (≈ ${txtEquiv} ${labelEquivalent})`;
  }

  // Ligne secondaire pour un TOTAL agrege (SUM sur plusieurs lignes) : reprend la composition
  // reelle par devise saisie (`{ usd, cdf, cdfEnUsd }`, cdf = montant natif FC, cdfEnUsd = son
  // equivalent USD), independamment elle aussi du bascule courant -- toujours exprimee en
  // "natif USD + natif FC (equivalent USD)". Renvoie null si le total n'est pas reellement
  // mixte (une seule des deux devises presente), pour ne rien afficher dans le cas courant.
  function formatRepartition(parDevise) {
    if (!parDevise) return null;
    const usd = parseFloat(parDevise.usd) || 0;
    const local = parseFloat(parDevise.cdf) || 0;
    const localEnUsd = parseFloat(parDevise.cdfEnUsd) || 0;
    if (!(usd > 0) || !(local > 0)) return null;
    const labelLocal = deviseLocale === 'CDF' ? 'FC' : deviseLocale;
    const txtUsd = usd.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const txtLocal = local.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    const txtEquiv = localEnUsd.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${txtUsd} USD, ${txtLocal} ${labelLocal} (≈ ${txtEquiv} USD)`;
  }

  return (
    <DeviseContext.Provider value={{ devise, deviseLocale, tauxChange, toggleDevise, convert, format, formatOriginal, formatRepartition, refreshDevise }}>
      {children}
    </DeviseContext.Provider>
  );
}

export function useDevise() {
  return useContext(DeviseContext);
}
