import { assert, currency, date, integer, total } from '../../financial-engine/model.ts';
import type { Context, Transaction } from '../../financial-engine/model.ts';
import { calculateAccountBalance } from '../../financial-engine/calculations.ts';
import { reverseTransaction } from '../../financial-engine/commands.ts';
import { calculateCreditCardDebt, cycleForDate, rebuildPaymentApplications, registerCreditCardOpening, registerCreditCardPurchase, payCreditCard } from '../../financial-engine/cards.ts';
import type { CreditCard } from '../../financial-engine/cards.ts';
import type { Repositories, Runtime, UnitOfWork } from './contracts.ts';
import { cardProjections } from './card-projections.ts';
interface Base { profileId: string; idempotencyKey: string; effectiveDate: string; description: string }
export interface CreateCardInput extends Base {
  name: string; currency: string; limitMinor: number; initialDebtMinor: number; closingDay: number; dueDay: number; defaultAccountId: string | null;
}
export interface PurchaseCardInput extends Base { cardId: string; amountMinor: number; categoryId: string }
export interface PayCardInput extends Base { cardId: string; accountId: string; full: boolean; amountMinor?: number; allowProtected?: boolean }
function fingerprint(operation: string, input: object) {
  const normalized = { ...input, operation }; return JSON.stringify(normalized, Object.keys(normalized).sort());
}
async function requireCard(repositories: Repositories, profileId: string, cardId: string) {
  const card = await repositories.cards.find(profileId, cardId); assert(card !== undefined, 'Tarjeta inexistente en este perfil'); return card;
}
async function reconcile(repositories: Repositories, card: CreditCard) {
  const data = await repositories.cards.data(card.profileId, card.id);
  const applications = rebuildPaymentApplications(data);
  await repositories.cards.replaceApplications(card.profileId, card.id, applications);
  const transactions = await repositories.transactions.list(card.profileId);
  // A backdated payment/reversal must not produce a historical credit balance.
  let balance = 0;
  for (const effectiveDate of [...new Set(transactions.map(row => row.effectiveDate))].sort()) {
    const entries = transactions.filter(row => row.effectiveDate === effectiveDate).flatMap(row => row.entries);
    balance = integer(balance + calculateCreditCardDebt(card, entries));
    assert(balance >= 0, 'La fecha indicada dejaría saldo acreedor en el historial de la tarjeta');
  }
  const debt = calculateCreditCardDebt(card, await repositories.ledger.entries(card.profileId));
  assert(integer(total(data.charges.map(row => row.amountMinor)) - total(data.payments.map(row => row.amountMinor))) === debt, 'La tarjeta no concilia con sus asientos');
}
export function createCreditCardApplication(unit: UnitOfWork, runtime: Runtime) {
  function ctx(input: Base): Context {
    assert(input.idempotencyKey.trim().length > 0 && input.idempotencyKey.length <= 180, 'Clave de operación inválida');
    date(input.effectiveDate); return { ...input, id: runtime.id(), createdAt: runtime.now(), description: input.description.trim() };
  }
  async function duplicate(repositories: Repositories, input: Base, hash: string) {
    const previous = await repositories.transactions.byKey(input.profileId, input.idempotencyKey);
    if (previous) { assert(previous.fingerprint === hash, 'La clave ya corresponde a otra operación'); return previous.transaction; }
  }
  async function attach(repositories: Repositories, card: CreditCard, transaction: Transaction, cycleId?: string) {
    const cycle = cycleId ? undefined : await repositories.cards.ensureCycle(card.profileId, card, cycleForDate(transaction.effectiveDate, card.closingDay, card.dueDay));
    const target = cycleId ?? cycle?.id; assert(target !== undefined, 'Ciclo no disponible');
    await repositories.cards.attachCharge(card.profileId, card, transaction.id, target);
    await reconcile(repositories, card);
  }
  return {
    snapshot: (profileId: string, asOf = runtime.now().slice(0, 10)) => unit.execute(async repositories => {
      date(asOf); return cardProjections(repositories, profileId, await repositories.ledger.entries(profileId), await repositories.transactions.list(profileId), asOf);
    }),
    create: (input: CreateCardInput) => unit.execute(async repositories => {
      const normalized = { ...input, name: input.name.trim(), description: input.description.trim() };
      const hash = fingerprint('create-card', normalized); const context = ctx(input);
      currency(input.currency); assert(normalized.name.length > 0 && normalized.name.length <= 100, 'Nombre inválido');
      assert(integer(input.limitMinor) > 0 && integer(input.initialDebtMinor) >= 0, 'Límite o deuda inicial inválidos');
      const period = cycleForDate(input.effectiveDate, input.closingDay, input.dueDay);
      const previous = await repositories.cards.byCreationKey(input.profileId, input.idempotencyKey);
      if (previous) { assert(previous.fingerprint === hash, 'Clave de tarjeta reutilizada'); return previous.card; }
      if (input.defaultAccountId) {
        const account = await repositories.accounts.find(input.profileId, input.defaultAccountId);
        assert(account !== undefined && account.currency === input.currency, 'Cuenta de pago predeterminada incompatible');
      }
      const card: CreditCard = { id: runtime.id(), profileId: input.profileId, name: normalized.name, currency: input.currency, nodeId: runtime.id(),
        limitMinor: input.limitMinor, closingDay: input.closingDay, dueDay: input.dueDay, defaultAccountId: input.defaultAccountId, status: 'active', createdAt: runtime.now() };
      await repositories.ledger.insertNode({ id: card.nodeId, profileId: card.profileId, currency: card.currency, kind: 'LIABILITY' });
      await repositories.cards.insert(card, input.idempotencyKey, hash);
      const cycle = await repositories.cards.ensureCycle(input.profileId, card, period);
      if (input.initialDebtMinor > 0) {
        const opening = registerCreditCardOpening({ ...context, idempotencyKey: `${context.idempotencyKey}:opening` }, card, input.initialDebtMinor,
          await repositories.ledger.systemNode(input.profileId, input.currency, 'EQUITY'));
        await repositories.transactions.insert(opening, hash); await attach(repositories, card, opening, cycle.id);
      }
      return card;
    }),
    purchase: (input: PurchaseCardInput) => unit.execute(async repositories => {
      const hash = fingerprint('card-purchase', { ...input, description: input.description.trim() }); const previous = await duplicate(repositories, input, hash); if (previous) return previous;
      const card = await requireCard(repositories, input.profileId, input.cardId);
      const categories = await repositories.categories.list(input.profileId);
      assert(categories.some(row => row.id === input.categoryId && row.kind === 'EXPENSE'), 'Categoría de gasto inválida');
      const debt = calculateCreditCardDebt(card, await repositories.ledger.entries(input.profileId));
      const transaction = registerCreditCardPurchase(ctx(input), card, input.amountMinor, debt, await repositories.ledger.systemNode(input.profileId, card.currency, 'EXPENSE'), input.categoryId);
      await repositories.transactions.insert(transaction, hash); await attach(repositories, card, transaction); return transaction;
    }),
    pay: (input: PayCardInput) => unit.execute(async repositories => {
      const normalized = { ...input, amountMinor: input.full ? undefined : input.amountMinor, description: input.description.trim(), allowProtected: input.allowProtected ?? false };
      const hash = fingerprint('card-payment', normalized); const previous = await duplicate(repositories, input, hash); if (previous) return previous;
      const card = await requireCard(repositories, input.profileId, input.cardId);
      const account = await repositories.accounts.find(input.profileId, input.accountId); assert(account !== undefined, 'Cuenta de pago inexistente');
      const entries = await repositories.ledger.entries(input.profileId);
      const debt = calculateCreditCardDebt(card, entries); const amount = input.full ? debt : input.amountMinor; assert(amount !== undefined, 'Indica el monto');
      const transaction = payCreditCard(ctx(input), card, account, amount, debt, calculateAccountBalance(account, entries), input.allowProtected);
      await repositories.transactions.insert(transaction, hash); await repositories.cards.addPayment(input.profileId, card, transaction.id, account.id);
      await reconcile(repositories, card); return transaction;
    }),
    reversePurchase: (input: Base & { cardId: string; originalId: string }) => unit.execute(async repositories => {
      const hash = fingerprint('reverse-card-purchase', { ...input, description: input.description.trim() }); const previous = await duplicate(repositories, input, hash); if (previous) return previous;
      const card = await requireCard(repositories, input.profileId, input.cardId);
      const original = await repositories.transactions.find(input.profileId, input.originalId);
      assert(original !== undefined && original.type === 'EXPENSE', 'Selecciona una compra original');
      assert(!(await repositories.transactions.reversedBy(input.profileId, input.originalId)), 'La compra ya está revertida');
      const data = await repositories.cards.data(input.profileId, card.id); const charge = data.charges.find(row => row.transactionId === original.id);
      assert(charge !== undefined && charge.amountMinor > 0, 'La compra no pertenece a esta tarjeta');
      assert(calculateCreditCardDebt(card, await repositories.ledger.entries(input.profileId)) >= charge.amountMinor, 'El reverso produciría saldo acreedor; ese flujo queda fuera de V1');
      const reversal = reverseTransaction(ctx(input), original); await repositories.transactions.insert(reversal, hash); await attach(repositories, card, reversal, charge.cycleId); return reversal;
    }),
    reassignCycle: (input: { profileId: string; cardId: string; originalId: string; cycleDate: string; reason: string }) => unit.execute(async repositories => {
      const card = await requireCard(repositories, input.profileId, input.cardId);
      const original = await repositories.transactions.find(input.profileId, input.originalId);
      assert(original !== undefined && original.type === 'EXPENSE', 'Solo se reasignan compras originales');
      assert(!(await repositories.transactions.reversedBy(input.profileId, original.id)), 'No reasignes una compra revertida');
      assert(input.reason.trim().length > 0 && input.reason.length <= 500, 'La corrección necesita un motivo');
      const cycle = await repositories.cards.ensureCycle(input.profileId, card, cycleForDate(input.cycleDate, card.closingDay, card.dueDay));
      await repositories.cards.reassign(input.profileId, card.id, original.id, cycle.id, input.reason.trim());
      await reconcile(repositories, card);
    }),
  };
}
export type CreditCardApplication = ReturnType<typeof createCreditCardApplication>;
