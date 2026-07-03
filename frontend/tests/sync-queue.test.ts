import { test, describe, before } from 'node:test';
import assert from 'node:assert';

const sessionStorageMock = (globalThis as any).sessionStorage;
const mockFetchCalls = (globalThis as any).mockFetchCalls;

import { authClient } from '../src/lib/auth-client';


describe('WebMedia Deferred Sync Queue Tests', () => {

  before(() => {
    sessionStorageMock.clear();
    mockFetchCalls.length = 0;
  });

  test('Doit ajouter et accumuler les favoris dans la file sessionStorage', async () => {
    const { queueFavoriteSync } = await import('../src/lib/sync-queue.ts');

    queueFavoriteSync('media-1', 'add');
    queueFavoriteSync('media-2', 'add');
    queueFavoriteSync('media-1', 'remove'); // Annule l'ajout précédent de media-1

    const rawPending = sessionStorageMock.getItem('webmedia_pending_favs');
    assert.ok(rawPending, 'Les favoris en attente doivent exister dans le sessionStorage');

    const pending = JSON.parse(rawPending);
    assert.strictEqual(pending.length, 2, 'Il doit y avoir deux elements dans la file');
    
    // Le premier element (media-1) doit maintenant avoir l'action 'remove' suite à l'annulation
    const media1Op = pending.find(([id]: any) => id === 'media-1');
    assert.strictEqual(media1Op[1].action, 'remove');
  });

  test('Doit initialiser la session et planifier le flush', async () => {
    const { initSyncSession } = await import('../src/lib/sync-queue.ts');

    // Définir la date de début de session comme s'il s'agissait du chargement initial 
    sessionStorageMock.setItem('webmedia_session_start', String(Date.now()));

    // L'exécution directe ne doit pas vider immédiatement si < 15 min
    initSyncSession();
    assert.strictEqual(mockFetchCalls.length, 0, 'Aucun fetch ne doit être execute immédiatement');
  });

  test('Doit exécuter la synchronisation immédiate si la session a dépassé 15 minutes', async () => {
    const { initSyncSession } = await import('../src/lib/sync-queue.ts');

    // Mocker une session vieille de 20 minutes (20 * 60 * 1000)
    const oldTime = Date.now() - (20 * 60 * 1000);
    sessionStorageMock.setItem('webmedia_session_start', String(oldTime));

    // Préparer une file d'attente à synchroniser
    sessionStorageMock.setItem('webmedia_pending_favs', JSON.stringify([
      ['media-xyz', { action: 'add', timestamp: Date.now() }]
    ]));

    // Lancer initSyncSession
    initSyncSession();

    // Attendre un court instant la fin de la promesse asynchrone interne
    await new Promise(resolve => setTimeout(resolve, 50));

    const favCall = mockFetchCalls.find((c: any) => c.url.includes('/user/favorites'));
    assert.ok(favCall, 'Un appel fetch de synchronisation favoris doit être déclenché');
    assert.strictEqual(favCall.options.method, 'POST', 'L action add doit être traduite par un POST');
    assert.deepStrictEqual(JSON.parse(favCall.options.body), { mediaId: 'media-xyz' });
    
    // Vérification du Header d'authentification
    assert.strictEqual(favCall.options.headers['Authorization'], 'Bearer test-bearer-token');

    // Vérifier que la file d'attente a bien été purgée du sessionStorage
    const rawPending = sessionStorageMock.getItem('webmedia_pending_favs');
    assert.strictEqual(rawPending, null, 'La file d attente doit être vide après le flush');
  });
});
