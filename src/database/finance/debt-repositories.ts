import type { Debt, DebtEvent, Person } from '../../financial-engine/debts.ts';
import type { DebtRepository } from '../../services/finance/debt-contracts.ts';
import type { Runtime } from '../../services/finance/contracts.ts';
import type { SqlConnection } from './connection.ts';
const personColumns='id,profile_id AS profileId,name,note,created_at AS createdAt';
const debtColumns=`id,profile_id AS profileId,person_id AS personId,direction,currency,initial_minor AS initialMinor,
 concept,opened_on AS openedOn,due_on AS dueOn,notes,ledger_node_id AS nodeId,origin_kind AS originKind,
 origin_transaction_id AS originTransactionId,created_at AS createdAt`;
export function sqliteDebtRepository(db:SqlConnection,runtime:Runtime):DebtRepository {
 return {
  listPeople:profileId=>db.all<Person>(`SELECT ${personColumns} FROM people WHERE profile_id=? ORDER BY name,id`,[profileId]),
  async person(profileId,id){return (await db.all<Person>(`SELECT ${personColumns} FROM people WHERE profile_id=? AND id=?`,[profileId,id]))[0];},
  async personByKey(profileId,key){const rows=await db.all<Person&{fingerprint:string}>(`SELECT ${personColumns},creation_request AS fingerprint FROM people WHERE profile_id=? AND creation_key=?`,[profileId,key]);if(!rows[0])return undefined;const {fingerprint,...person}=rows[0];return {person,fingerprint};},
  async insertPerson(person,key,fingerprint){await db.run('INSERT INTO people VALUES(?,?,?,?,?,?,?)',[person.id,person.profileId,person.name,person.note,person.createdAt,key,fingerprint]);},
  list:profileId=>db.all<Debt>(`SELECT ${debtColumns} FROM debts WHERE profile_id=? ORDER BY created_at,id`,[profileId]),
  async find(profileId,id){return (await db.all<Debt>(`SELECT ${debtColumns} FROM debts WHERE profile_id=? AND id=?`,[profileId,id]))[0];},
  async byKey(profileId,key){const rows=await db.all<Debt&{fingerprint:string}>(`SELECT ${debtColumns},creation_request AS fingerprint FROM debts WHERE profile_id=? AND creation_key=?`,[profileId,key]);if(!rows[0])return undefined;const {fingerprint,...debt}=rows[0];return {debt,fingerprint};},
  async insert(debt,key,fingerprint){await db.run('INSERT INTO debts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[debt.id,debt.profileId,debt.personId,debt.direction,debt.currency,debt.initialMinor,debt.concept,debt.openedOn,debt.dueOn,debt.notes,debt.nodeId,debt.originKind,debt.originTransactionId,debt.createdAt,key,fingerprint]);},
  async addPayment(profileId,debt,transactionId,accountId){await db.run('INSERT INTO debt_payments VALUES(?,?,?,?,?,?,?)',[runtime.id(),profileId,debt.id,debt.currency,transactionId,accountId,debt.direction==='receivable'?'received':'paid']);},
  async addEvent(profileId,debtId,transactionId,kind){await db.run('INSERT INTO debt_events VALUES(?,?,?,?,?)',[runtime.id(),profileId,debtId,transactionId,kind]);},
  async events(profileId,debtId){return db.all<DebtEvent>(`SELECT e.id,e.debt_id AS debtId,e.transaction_id AS transactionId,e.kind,
 t.effective_date AS effectiveDate,t.created_at AS createdAt,t.description,
 CASE d.direction WHEN 'receivable' THEN a.debit_minor-a.credit_minor ELSE a.credit_minor-a.debit_minor END AS amountMinor,
 t.reversal_of AS reversalOf
 FROM debt_events e JOIN debts d ON d.id=e.debt_id JOIN transactions t ON t.id=e.transaction_id
 JOIN transaction_entries a ON a.transaction_id=t.id AND a.ledger_node_id=d.ledger_node_id
 WHERE e.profile_id=? AND e.debt_id=? AND t.status='POSTED' ORDER BY t.effective_date,t.created_at,t.rowid`,[profileId,debtId]);},
  async related(profileId,transactionId){const rows=await db.all<{debtId:string}>('SELECT debt_id AS debtId FROM debt_events WHERE profile_id=? AND transaction_id=?',[profileId,transactionId]);return rows[0]?this.find(profileId,rows[0].debtId):undefined;},
 };
}
