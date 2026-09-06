const { setupTestDb, teardownTestDb } = require('./_helpers/testDb');
const dbFile = setupTestDb();

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./_helpers/app');
const { creerClasse, creerEleve, tokenAdmin } = require('./_helpers/fixtures');

let ctx;
before(async () => { ctx = await startTestServer(tokenAdmin()); });
after(async () => { await ctx.close(); await teardownTestDb(dbFile); });

test('un remboursement total exclut le paiement de tous les totaux (statut=rembourse)', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const eleve = await creerEleve(classe.id);
  const { body: paiement } = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 300, devise: 'USD', type_paiement: 'scolarite' });

  const { body: demande } = await ctx.api('POST', '/api/remboursements', { paiement_id: paiement.id, motif: 'Erreur de caisse' });
  const approbation = await ctx.api('POST', `/api/remboursements/${demande.id}/approuver`, {});
  assert.equal(approbation.status, 200);

  const { body: fiche } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  assert.equal(Number(fiche.totaux.totalPayeScolarite), 0, 'un paiement totalement rembourse ne doit plus compter dans le total paye');

  // Redevient donc payable a nouveau (plus rien de valide n'est enregistre pour cet eleve).
  const nouveau = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 500, devise: 'USD', type_paiement: 'scolarite' });
  assert.equal(nouveau.status, 201);
});

test('un remboursement partiel reduit le montant du paiement mais le laisse valide et compte', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const eleve = await creerEleve(classe.id);
  const { body: paiement } = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 250, devise: 'USD', type_paiement: 'scolarite' });

  const { body: demande } = await ctx.api('POST', '/api/remboursements', { paiement_id: paiement.id, motif: 'Trop percu', montant: 50 });
  const approbation = await ctx.api('POST', `/api/remboursements/${demande.id}/approuver`, {});
  assert.equal(approbation.status, 200);

  const { body: fiche } = await ctx.api('GET', `/api/eleves/${eleve.id}`);
  assert.equal(Number(fiche.totaux.totalPayeScolarite), 200, '250 - 50 rembourses = 200 doit rester compte (paiement toujours valide)');
});

test('impossible de rembourser plus que ce qui reste sur le paiement', async () => {
  const classe = await creerClasse({ frais_scolarite: 500 });
  const eleve = await creerEleve(classe.id);
  const { body: paiement } = await ctx.api('POST', '/api/paiements', { eleve_id: eleve.id, montant: 100, devise: 'USD', type_paiement: 'scolarite' });

  const demande = await ctx.api('POST', '/api/remboursements', { paiement_id: paiement.id, motif: 'Test', montant: 150 });
  assert.equal(demande.status, 400, 'une demande superieure au montant du paiement doit etre refusee');
});
