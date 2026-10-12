import type { Repositories } from './contracts.ts';
import type { Entry, Transaction } from '../../financial-engine/model.ts';
import { summarizeCreditCard } from '../../financial-engine/cards.ts';
export async function cardProjections(repositories: Repositories, profileId: string, entries: Entry[], transactions: Transaction[], asOf: string) {
  const cards = await repositories.cards.list(profileId);
  return Promise.all(cards.map(async card => summarizeCreditCard(card, entries, await repositories.cards.data(profileId, card.id), transactions, asOf)));
}
