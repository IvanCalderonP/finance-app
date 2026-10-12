import type { CreditCard, CardCycle, CardData, PaymentApplication } from '../../financial-engine/cards.ts';
export interface CreditCardRepository {
  list(profileId: string): Promise<CreditCard[]>;
  find(profileId: string, id: string): Promise<CreditCard | undefined>;
  byCreationKey(profileId: string, key: string): Promise<{ card: CreditCard; fingerprint: string } | undefined>;
  insert(card: CreditCard, key: string, fingerprint: string): Promise<void>;
  ensureCycle(profileId: string, card: CreditCard, period: Omit<CardCycle, 'id' | 'cardId'>): Promise<CardCycle>;
  attachCharge(profileId: string, card: CreditCard, transactionId: string, cycleId: string): Promise<void>;
  addPayment(profileId: string, card: CreditCard, transactionId: string, accountId: string): Promise<void>;
  data(profileId: string, cardId: string): Promise<CardData>;
  replaceApplications(profileId: string, cardId: string, applications: PaymentApplication[]): Promise<void>;
  related(profileId: string, transactionId: string): Promise<CreditCard | undefined>;
  reassign(profileId: string, cardId: string, transactionId: string, targetCycleId: string, reason: string): Promise<void>;
}
