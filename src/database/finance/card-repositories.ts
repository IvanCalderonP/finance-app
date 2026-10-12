import { assert } from '../../financial-engine/model.ts';
import type { CreditCard, CardCycle, CycleCharge, CardPayment, PaymentApplication } from '../../financial-engine/cards.ts';
import type { CreditCardRepository } from '../../services/finance/card-contracts.ts';
import type { Runtime } from '../../services/finance/contracts.ts';
import type { SqlConnection } from './connection.ts';
const columns = `id,profile_id AS profileId,name,currency,ledger_node_id AS nodeId,limit_minor AS limitMinor,
 closing_day AS closingDay,due_day AS dueDay,default_account_id AS defaultAccountId,status,created_at AS createdAt`;
export function sqliteCardRepository(db: SqlConnection, runtime: Runtime): CreditCardRepository {
  return {
    list: profileId => db.all<CreditCard>(`SELECT ${columns} FROM credit_cards WHERE profile_id=? ORDER BY created_at,rowid`, [profileId]),
    async find(profileId, id) { return (await db.all<CreditCard>(`SELECT ${columns} FROM credit_cards WHERE profile_id=? AND id=?`, [profileId, id]))[0]; },
    async byCreationKey(profileId, key) {
      const rows = await db.all<CreditCard & { fingerprint: string }>(`SELECT ${columns},creation_request AS fingerprint FROM credit_cards WHERE profile_id=? AND creation_key=?`, [profileId, key]);
      if (!rows[0]) return undefined; const { fingerprint, ...card } = rows[0]; return { card, fingerprint };
    },
    async insert(card, key, fingerprint) {
      await db.run('INSERT INTO credit_cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', [card.id, card.profileId, card.name, card.currency, card.limitMinor, card.closingDay, card.dueDay, card.defaultAccountId, card.status, card.nodeId, key, fingerprint, card.createdAt]);
    },
    async ensureCycle(profileId, card, period) {
      const rows = await db.all<CardCycle>('SELECT id,card_id AS cardId,starts_on AS startsOn,closes_on AS closesOn,due_on AS dueOn FROM credit_card_cycles WHERE profile_id=? AND card_id=? AND closes_on=?', [profileId, card.id, period.closesOn]);
      if (rows[0]) return rows[0];
      const cycle = { ...period, id: runtime.id(), cardId: card.id };
      await db.run('INSERT INTO credit_card_cycles VALUES(?,?,?,?,?,?,?)', [cycle.id, profileId, card.id, card.currency, cycle.startsOn, cycle.closesOn, cycle.dueOn]); return cycle;
    },
    async attachCharge(profileId, card, transactionId, cycleId) {
      const rows = await db.all<{ id: string }>('SELECT id FROM transaction_entries WHERE profile_id=? AND transaction_id=? AND ledger_node_id=?', [profileId, transactionId, card.nodeId]);
      assert(rows.length === 1, 'Asiento de tarjeta inexistente o ambiguo');
      await db.run('INSERT INTO credit_card_cycle_entries VALUES(?,?,?,?,?,?)', [runtime.id(), profileId, card.id, card.currency, cycleId, rows[0].id]);
    },
    async addPayment(profileId, card, transactionId, accountId) {
      await db.run('INSERT INTO credit_card_payments VALUES(?,?,?,?,?,?)', [runtime.id(), profileId, card.id, card.currency, transactionId, accountId]);
    },
    async data(profileId, cardId) {
      const cycles = await db.all<CardCycle>('SELECT id,card_id AS cardId,starts_on AS startsOn,closes_on AS closesOn,due_on AS dueOn FROM credit_card_cycles WHERE profile_id=? AND card_id=? ORDER BY closes_on', [profileId, cardId]);
      const charges = await db.all<CycleCharge>(`SELECT e.id AS entryId,t.id AS transactionId,c.cycle_id AS cycleId,e.credit_minor-e.debit_minor AS amountMinor,
       t.effective_date AS effectiveDate,t.type,t.reversal_of AS reversalOf FROM credit_card_cycle_entries c
       JOIN transaction_entries e ON e.id=c.transaction_entry_id JOIN transactions t ON t.id=e.transaction_id
       WHERE c.profile_id=? AND c.card_id=? AND t.status='POSTED' ORDER BY t.effective_date,t.created_at,t.rowid`, [profileId, cardId]);
      const payments = await db.all<CardPayment>(`SELECT p.id,p.transaction_id AS transactionId,p.card_id AS cardId,p.account_id AS accountId,e.debit_minor AS amountMinor,
       t.effective_date AS effectiveDate,t.created_at AS createdAt FROM credit_card_payments p JOIN credit_cards c ON c.id=p.card_id
       JOIN transactions t ON t.id=p.transaction_id JOIN transaction_entries e ON e.transaction_id=t.id AND e.ledger_node_id=c.ledger_node_id
       WHERE p.profile_id=? AND p.card_id=? AND t.status='POSTED' ORDER BY t.effective_date,t.created_at,p.rowid`, [profileId, cardId]);
      const applications = await db.all<PaymentApplication>('SELECT payment_id AS paymentId,cycle_id AS cycleId,amount_minor AS amountMinor FROM credit_card_payment_applications WHERE profile_id=? AND card_id=? ORDER BY rowid', [profileId, cardId]);
      return { cycles, charges, payments, applications };
    },
    async replaceApplications(profileId, cardId, applications) {
      await db.run('DELETE FROM credit_card_payment_applications WHERE profile_id=? AND card_id=?', [profileId, cardId]);
      for (const row of applications) await db.run('INSERT INTO credit_card_payment_applications VALUES(?,?,?,?,?,?)', [runtime.id(), profileId, cardId, row.paymentId, row.cycleId, row.amountMinor]);
    },
    async related(profileId, transactionId) {
      const rows = await db.all<{ cardId: string }>(`SELECT c.card_id AS cardId FROM credit_card_cycle_entries c JOIN transaction_entries e ON e.id=c.transaction_entry_id
        WHERE c.profile_id=? AND e.transaction_id=? UNION SELECT card_id AS cardId FROM credit_card_payments WHERE profile_id=? AND transaction_id=?`, [profileId, transactionId, profileId, transactionId]);
      if (!rows[0]) return undefined;
      return (await db.all<CreditCard>(`SELECT ${columns} FROM credit_cards WHERE profile_id=? AND id=?`, [profileId, rows[0].cardId]))[0];
    },
    async reassign(profileId, cardId, transactionId, targetCycleId, reason) {
      const rows = await db.all<{ entryId: string; cycleId: string }>(`SELECT transaction_entry_id AS entryId,cycle_id AS cycleId FROM credit_card_cycle_entries c
        JOIN transaction_entries e ON e.id=c.transaction_entry_id WHERE c.profile_id=? AND c.card_id=? AND e.transaction_id=?`, [profileId, cardId, transactionId]);
      assert(rows.length === 1, 'Compra no asignada a un ciclo');
      if (rows[0].cycleId === targetCycleId) return;
      await db.run('INSERT INTO credit_card_cycle_corrections VALUES(?,?,?,?,?,?,?,?)', [runtime.id(), profileId, cardId, rows[0].entryId, rows[0].cycleId, targetCycleId, reason, runtime.now()]);
      await db.run('UPDATE credit_card_cycle_entries SET cycle_id=? WHERE profile_id=? AND card_id=? AND transaction_entry_id=?', [targetCycleId, profileId, cardId, rows[0].entryId]);
    },
  };
}
