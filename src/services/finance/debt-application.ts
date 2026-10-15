import { runtimeDay } from './contracts.ts';
import { canonicalJson } from '../../utils/canonical.ts';
import { spendability, consumeFunding, restoreConsumption, reconcileLiabilityFunding, validateFunding } from './planning-application.ts';
import { assert, currency, date, integer, total } from '../../financial-engine/model.ts';
import type { Context, Transaction } from '../../financial-engine/model.ts';
import { calculateAccountBalance } from '../../financial-engine/calculations.ts';
import { reverseTransaction } from '../../financial-engine/commands.ts';
import { calculateDebtPending, registerExistingPayable, registerFinancedDebtExpense, registerLoanGiven, registerLoanReceived, settleDebt } from '../../financial-engine/debts.ts';
import type { Debt, DebtOrigin, Person } from '../../financial-engine/debts.ts';
import type { Repositories, Runtime, UnitOfWork } from './contracts.ts';
import { debtProjections } from './debt-projections.ts';
interface Base { profileId:string; idempotencyKey:string; effectiveDate:string; description:string }
export interface CreatePersonInput { profileId:string; idempotencyKey:string; name:string; note:string }
export interface CreateDebtInput extends Base { personId:string; originKind:DebtOrigin; currency:string; initialMinor:number; concept:string; dueOn:string|null; notes:string; accountId?:string; categoryId?:string; allowProtected?:boolean }
export interface SettleDebtInput extends Base { debtId:string; accountId:string; amountMinor?:number; full:boolean; allowProtected?:boolean }
function fingerprint(operation:string,input:object){const normalized={...input,operation};return canonicalJson(normalized);}
function key(value:string){assert(value.trim().length>0 && value.length<=180,'Clave inválida');}
async function requiredDebt(repositories:Repositories,profileId:string,debtId:string){const debt=await repositories.debts.find(profileId,debtId);assert(debt!==undefined,'Deuda inexistente en este perfil');return debt;}
async function validateDebt(repositories:Repositories,debt:Debt){
 const history=await repositories.debts.events(debt.profileId,debt.id);
 let balance=0;
 for(const day of [...new Set(history.map(row=>row.effectiveDate))].sort()){
  balance=integer(balance+total(history.filter(row=>row.effectiveDate===day).map(row=>row.amountMinor)));
  assert(balance>=0 && balance<=debt.initialMinor,'La fecha o reverso dejaría una deuda inconsistente');
 }
 const pending=calculateDebtPending(debt,await repositories.ledger.entries(debt.profileId));
 assert(pending===balance,'La deuda no concilia con el ledger');
 return pending;
}
export function createDebtApplication(unit:UnitOfWork,runtime:Runtime){
 function ctx(input:Base):Context{key(input.idempotencyKey);date(input.effectiveDate);return {id:runtime.id(),profileId:input.profileId,idempotencyKey:input.idempotencyKey,effectiveDate:input.effectiveDate,createdAt:runtime.now(),description:input.description.trim()};}
 async function priorTransaction(repositories:Repositories,input:Base,hash:string){const previous=await repositories.transactions.byKey(input.profileId,input.idempotencyKey);if(previous){assert(previous.fingerprint===hash,'Clave usada para otra operación');return previous.transaction;}}
 return {
  snapshot:(profileId:string,asOf=runtimeDay(runtime))=>unit.execute(async repositories=>{date(asOf);return debtProjections(repositories,profileId,await repositories.ledger.entries(profileId),asOf);}),
  people:(profileId:string)=>unit.execute(repositories=>repositories.debts.listPeople(profileId)),
  createPerson:(input:CreatePersonInput)=>unit.execute(async repositories=>{
   key(input.idempotencyKey);const normalized={...input,name:input.name.trim(),note:input.note.trim()};const hash=fingerprint('person',normalized);
   assert(normalized.name.length>0 && normalized.name.length<=100 && normalized.note.length<=500,'Datos de persona inválidos');
   const previous=await repositories.debts.personByKey(input.profileId,input.idempotencyKey);
   if(previous){assert(previous.fingerprint===hash,'Clave usada para otra persona');return previous.person;}
   const person:Person={id:runtime.id(),profileId:input.profileId,name:normalized.name,note:normalized.note,createdAt:runtime.now()};
   await repositories.debts.insertPerson(person,input.idempotencyKey,hash);return person;
  }),
  create:(input:CreateDebtInput)=>unit.execute(async repositories=>{
   const normalized={...input,concept:input.concept.trim(),notes:input.notes.trim(),description:input.description.trim(),accountId:input.accountId??null,categoryId:input.categoryId??null,allowProtected:input.allowProtected??false};
   const hash=fingerprint('create-debt',normalized);const context=ctx(input);
   currency(input.currency);assert(integer(input.initialMinor)>0,'Principal inválido');
   assert(normalized.concept.length>0 && normalized.concept.length<=200 && normalized.notes.length<=1000,'Concepto o notas inválidos');
   if(input.dueOn)date(input.dueOn);
   assert(['loan_given','existing_payable','loan_received','financed_expense'].includes(input.originKind),'Origen inválido');
   const previous=await repositories.debts.byKey(input.profileId,input.idempotencyKey);
   if(previous){assert(previous.fingerprint===hash,'Clave usada para otra deuda');return previous.debt;}
   assert((await repositories.debts.person(input.profileId,input.personId))!==undefined,'Persona inexistente en este perfil');
   const debt:Debt={id:runtime.id(),profileId:input.profileId,personId:input.personId,direction:input.originKind==='loan_given'?'receivable':'payable',currency:input.currency,
    initialMinor:input.initialMinor,concept:normalized.concept,openedOn:input.effectiveDate,dueOn:input.dueOn,notes:normalized.notes,nodeId:runtime.id(),originKind:input.originKind,originTransactionId:context.id,createdAt:runtime.now()};
   await repositories.ledger.insertNode({id:debt.nodeId,profileId:debt.profileId,currency:debt.currency,kind:debt.direction==='receivable'?'ASSET':'LIABILITY'});
   let transaction:Transaction;
   if(input.originKind==='existing_payable') transaction=registerExistingPayable(context,debt,await repositories.ledger.systemNode(input.profileId,input.currency,'EQUITY'));
   else if(input.originKind==='financed_expense'){
    assert(input.categoryId!==undefined && (await repositories.categories.list(input.profileId)).some(row=>row.id===input.categoryId && row.kind==='EXPENSE'),'Categoría de gasto inválida');
    transaction=registerFinancedDebtExpense(context,debt,await repositories.ledger.systemNode(input.profileId,input.currency,'EXPENSE'),input.categoryId);
   } else {
    assert(input.accountId!==undefined,'Selecciona una cuenta');
    const account=await repositories.accounts.find(input.profileId,input.accountId);assert(account!==undefined,'Cuenta inexistente');
    transaction=input.originKind==='loan_given'?registerLoanGiven(context,debt,account,await spendability(repositories,input.profileId,account.id),input.allowProtected):registerLoanReceived(context,debt,account);
   }
   await repositories.transactions.insert(transaction,hash);
   await repositories.debts.insert(debt,input.idempotencyKey,hash);
   await repositories.debts.addEvent(input.profileId,debt.id,transaction.id,'ORIGIN');
   await validateDebt(repositories,debt);await validateFunding(repositories,input.profileId);return debt;
  }),
  settle:(input:SettleDebtInput)=>unit.execute(async repositories=>{
   const normalized={...input,description:input.description.trim(),amountMinor:input.full?undefined:input.amountMinor,allowProtected:input.allowProtected??false};
   const hash=fingerprint('settle-debt',normalized);const previous=await priorTransaction(repositories,input,hash);if(previous)return previous;
   const debt=await requiredDebt(repositories,input.profileId,input.debtId);
   const account=await repositories.accounts.find(input.profileId,input.accountId);assert(account!==undefined,'Cuenta inexistente');
   const entries=await repositories.ledger.entries(input.profileId);const pending=calculateDebtPending(debt,entries);
   const amount=input.full?pending:input.amountMinor;assert(amount!==undefined,'Indica el principal');
   const transaction=settleDebt(ctx(input),debt,amount,pending,account,debt.direction==='payable'?await spendability(repositories,input.profileId,account.id,{kind:'debt',targetId:debt.id}):calculateAccountBalance(account,entries),input.allowProtected);
   await repositories.transactions.insert(transaction,hash);
   await repositories.debts.addPayment(input.profileId,debt,transaction.id,account.id);
   await repositories.debts.addEvent(input.profileId,debt.id,transaction.id,'PAYMENT');
   if(debt.direction==='payable')await consumeFunding(repositories,runtime,{profileId:input.profileId,accountId:account.id,amountMinor:amount,transactionId:transaction.id,owner:{kind:'debt',targetId:debt.id}});
   await validateDebt(repositories,debt);await reconcileLiabilityFunding(repositories,runtime,input.profileId,input.effectiveDate,transaction.id);await validateFunding(repositories,input.profileId);return transaction;
  }),
  reverse:(input:Base&{debtId:string;originalId:string})=>unit.execute(async repositories=>{
   const hash=fingerprint('reverse-debt',{...input,description:input.description.trim()});const previous=await priorTransaction(repositories,input,hash);if(previous)return previous;
   const debt=await requiredDebt(repositories,input.profileId,input.debtId);
   const related=await repositories.debts.related(input.profileId,input.originalId);assert(related?.id===debt.id,'Movimiento ajeno a esta deuda');
   const original=await repositories.transactions.find(input.profileId,input.originalId);assert(original!==undefined && original.type!=='REVERSAL','Movimiento original inválido');
   assert(!(await repositories.transactions.reversedBy(input.profileId,input.originalId)),'Ya existe un reverso');
   const reversal=reverseTransaction(ctx(input),original);
   const before=await repositories.ledger.entries(input.profileId);
   for(const account of await repositories.accounts.list(input.profileId)){
    const existing=calculateAccountBalance(account,before),delta=calculateAccountBalance(account,reversal.entries);
    assert(integer(existing+delta)>=0 || existing+delta>=existing,'El reverso dejaría saldo insuficiente');
   }
   await repositories.transactions.insert(reversal,hash);
   await repositories.debts.addEvent(input.profileId,debt.id,reversal.id,'REVERSAL');
   await restoreConsumption(repositories,runtime,input.profileId,original.id,reversal.id);
   await validateDebt(repositories,debt);await reconcileLiabilityFunding(repositories,runtime,input.profileId,input.effectiveDate,reversal.id);await validateFunding(repositories,input.profileId);return reversal;
  }),
 };
}
export type DebtApplication=ReturnType<typeof createDebtApplication>;
