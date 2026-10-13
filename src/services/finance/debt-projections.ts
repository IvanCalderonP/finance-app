import { assert, integer, total } from '../../financial-engine/model.ts';
import type { Entry } from '../../financial-engine/model.ts';
import { calculateDebtPending, debtStatus } from '../../financial-engine/debts.ts';
import type { DebtSummary } from '../../financial-engine/debts.ts';
import type { Repositories } from './contracts.ts';
export async function debtProjections(repositories:Repositories,profileId:string,entries:Entry[],asOf:string):Promise<DebtSummary[]> {
 const [debts,people]=await Promise.all([repositories.debts.list(profileId),repositories.debts.listPeople(profileId)]);
 return Promise.all(debts.map(async debt=>{
  const person=people.find(row=>row.id===debt.personId);assert(person!==undefined,'Persona inexistente');
  const pendingMinor=calculateDebtPending(debt,entries);assert(pendingMinor>=0 && pendingMinor<=debt.initialMinor,'La deuda no concilia');
  const history=await repositories.debts.events(profileId,debt.id);
  assert(total(history.map(row=>row.amountMinor))===pendingMinor,'Historial de deuda inconsistente');
  const payments=history.filter(row=>row.kind==='PAYMENT');
  const paymentIds=new Set(payments.map(row=>row.transactionId));
  const settledMinor=integer(0-total(history.filter(row=>row.kind==='PAYMENT'||row.kind==='REVERSAL'&&row.reversalOf!==null&&paymentIds.has(row.reversalOf)).map(row=>row.amountMinor)));
  assert(settledMinor>=0 && settledMinor<=debt.initialMinor,'Pagos de deuda inconsistentes');
  const annulled=history.some(row=>row.kind==='REVERSAL'&&row.reversalOf===debt.originTransactionId);
  return {debt,person,pendingMinor,settledMinor,status:annulled?'anulada':debtStatus(pendingMinor,debt.dueOn,asOf),history};
 }));
}
