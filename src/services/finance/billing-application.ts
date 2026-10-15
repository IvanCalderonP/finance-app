import { assert,currency,date,integer,total } from '../../financial-engine/model.ts';
import type { Transaction } from '../../financial-engine/model.ts';
import { calculateAccountBalance,calculateAvailableBalance } from '../../financial-engine/calculations.ts';
import { calculateCreditCardDebt } from '../../financial-engine/cards.ts';
import { calculateDebtPending } from '../../financial-engine/debts.ts';
import { addDays,recurrenceDate,recurrenceThrough } from '../../financial-engine/recurrence.ts';
import type { Recurrence } from '../../financial-engine/recurrence.ts';
import { editAllocation,previewAllocation,validateAllocationRules } from '../../financial-engine/allocation.ts';
import type { AllocationPreview,AllocationRule } from '../../financial-engine/allocation.ts';
import type { BillOccurrence,BillSeries,BillSummary,BillingSnapshot,DistributionTemplate,IncomeDistribution } from './billing-contracts.ts';
import { runtimeDay, scopedUnitOfWork } from './contracts.ts';
import type { Repositories,Runtime,UnitOfWork } from './contracts.ts';
import { createFinanceApplication } from './application.ts';
import { createCreditCardApplication } from './card-application.ts';
import { createPlanningApplication,createBucketIn,fundBucketIn,reconcileBillFunding,validateFunding,restoreConsumption } from './planning-application.ts';
interface Base {profileId:string;idempotencyKey:string;effectiveDate:string;description?:string}
export interface CreateBillInput extends Base {name:string;currency:string;expectedMinor:number;dueOn:string;frequency:Recurrence['frequency'];intervalDays?:number|null;categoryId:string;preferredMethod:'bank'|'card';accountId?:string|null;cardId?:string|null}
export interface EditBillInput {profileId:string;billId:string;name:string;expectedMinor:number;actualMinor:number|null;dueOn:string;categoryId:string;preferredMethod:'bank'|'card';accountId:string|null;cardId:string|null}
export interface DistributionInput extends Base {templateId:string;accountId:string;incomeTransactionId?:string|null;amountMinor?:number;categoryId?:string;changes?:{id:string;amountMinor:number}[]}
export interface DistributionPreview extends AllocationPreview {templateId:string;accountId:string;incomeTransactionId:string|null;effectiveDate:string;newIncome:boolean}
function fingerprint(operation:string,input:unknown){return JSON.stringify({operation,input});}
function baseValid(input:Base){assert(input.idempotencyKey.trim().length>0&&input.idempotencyKey.length<=140,'Clave de operación inválida');date(input.effectiveDate);assert((input.description??'').trim().length<=500,'Descripción demasiado larga');}
function amountOf(transaction:Transaction){return total(transaction.splits.map(row=>row.amountMinor));}
async function requireBill(repositories:Repositories,profileId:string,billId:string){const bill=(await repositories.billing.occurrences(profileId)).find(row=>row.id===billId);assert(bill!==undefined,'Recibo inexistente en este perfil');return bill;}
async function validateBillMetadata(repositories:Repositories,input:{profileId:string;name:string;currency:string;expectedMinor:number;categoryId:string;preferredMethod:'bank'|'card';accountId:string|null;cardId:string|null}){
 assert(input.name.trim().length>0&&input.name.trim().length<=100,'Nombre de recibo inválido');currency(input.currency);assert(integer(input.expectedMinor)>0,'Monto esperado inválido');assert((await repositories.categories.list(input.profileId)).some(row=>row.id===input.categoryId&&row.kind==='EXPENSE'),'Categoría de gasto inválida');assert(['bank','card'].includes(input.preferredMethod),'Forma de pago inválida');
 if(input.accountId){const account=await repositories.accounts.find(input.profileId,input.accountId);assert(account?.currency===input.currency,'Cuenta incompatible con el recibo');}
 if(input.cardId){const card=await repositories.cards.find(input.profileId,input.cardId);assert(card?.currency===input.currency,'Tarjeta incompatible con el recibo');}
}
async function renew(repositories:Repositories,runtime:Runtime,profileId:string,through:string){
 const existing=await repositories.billing.occurrences(profileId);
 for(const series of await repositories.billing.series(profileId)){
  if(!series.active)continue;
  for(const period of recurrenceThrough(series,through))if(!existing.some(row=>row.seriesId===series.id&&row.periodIndex===period.index)){
   const bill:BillOccurrence={id:runtime.id(),profileId,seriesId:series.id,periodIndex:period.index,name:series.name,currency:series.currency,expectedMinor:series.expectedMinor,actualMinor:null,dueOn:period.dueOn,categoryId:series.categoryId,preferredMethod:series.preferredMethod,accountId:series.accountId,cardId:series.cardId,reservationBucketId:null,createdAt:runtime.now()};await repositories.billing.insertOccurrence(bill);existing.push(bill);
  }
 }
}
async function billSummary(repositories:Repositories,runtime:Runtime,bill:BillOccurrence,asOf:string):Promise<BillSummary>{
 const transactions=await repositories.transactions.list(bill.profileId);const payments=await repositories.billing.payments(bill.profileId,bill.id);
 const paidMinor=total(payments.map(payment=>{const original=transactions.find(row=>row.id===payment.transactionId);assert(original!==undefined,'Pago sin movimiento');const reversal=transactions.find(row=>row.reversalOf===original.id);return amountOf(original)+(reversal?amountOf(reversal):0);}));
 const remainingMinor=integer((bill.actualMinor??bill.expectedMinor)-paidMinor);assert(paidMinor>=0&&remainingMinor>=0,'El recibo no concilia con sus pagos');
 const planning=await createPlanningApplication(scopedUnitOfWork(repositories),runtime).snapshot(bill.profileId,asOf);const reservedMinor=planning.buckets.find(row=>row.bucket.id===bill.reservationBucketId)?.fundedMinor??0;
 return{bill,paidMinor,remainingMinor,reservedMinor,status:remainingMinor===0?'paid':bill.dueOn<asOf?'overdue':reservedMinor>0?'reserved':'pending',payments};
}
async function buildPreview(repositories:Repositories,runtime:Runtime,input:DistributionInput):Promise<DistributionPreview>{
 baseValid(input);const template=(await repositories.billing.templates(input.profileId)).find(row=>row.id===input.templateId);assert(template!==undefined,'Regla de distribución inexistente');const account=await repositories.accounts.find(input.profileId,input.accountId);assert(account!==undefined&&account.active&&account.currency===template.currency,'Cuenta incompatible con la regla');
 let incomeMinor:number;const incomeTransactionId=input.incomeTransactionId??null;
 if(incomeTransactionId){const transaction=await repositories.transactions.find(input.profileId,incomeTransactionId);assert(transaction?.type==='INCOME'&&transaction.currency===template.currency,'Selecciona un ingreso válido');assert(!(await repositories.transactions.reversedBy(input.profileId,transaction.id)),'El ingreso está revertido');assert(transaction.entries.some(row=>row.nodeId===account.nodeId&&row.debitMinor>0),'El ingreso no pertenece a esa cuenta');assert(!(await repositories.billing.distributions(input.profileId)).some(row=>row.incomeTransactionId===incomeTransactionId),'Este ingreso ya fue distribuido');incomeMinor=amountOf(transaction);}else{assert(input.amountMinor!==undefined&&integer(input.amountMinor)>0,'Indica el ingreso');incomeMinor=input.amountMinor;assert((await repositories.categories.list(input.profileId)).some(row=>row.id===input.categoryId&&row.kind==='INCOME'),'Selecciona la categoría de ingreso');}
 const planning=await createPlanningApplication(scopedUnitOfWork(repositories),runtime).snapshot(input.profileId,input.effectiveDate);
 const funding=total(planning.buckets.flatMap(row=>row.funding.filter(value=>value.accountId===account.id).map(value=>value.amountMinor)));
 const historicalTransactions=(await repositories.transactions.list(input.profileId)).filter(row=>row.effectiveDate<=input.effectiveDate);const historicalEntries=historicalTransactions.flatMap(row=>row.entries);
 const balance=calculateAccountBalance(account,historicalEntries);const resourceMinor=Math.max(0,integer(balance+(incomeTransactionId?0:incomeMinor)-funding));
 let preview=previewAllocation(incomeMinor,resourceMinor,template.rules);if(input.changes)preview=editAllocation(preview,input.changes);
 const finances=await createFinanceApplication(scopedUnitOfWork(repositories),runtime).snapshot(input.profileId);
 const balances=(await repositories.accounts.list(input.profileId)).map(value=>({account:value,balanceMinor:calculateAccountBalance(value,historicalEntries)}));
 const liabilities=[...finances.cards.map(row=>({id:`card:${row.card.id}`,currency:row.card.currency,amountMinor:Math.max(0,calculateCreditCardDebt(row.card,historicalEntries)),alreadyExcludedMinor:planning.liabilityExcluded.find(value=>value.kind==='card'&&value.id===row.card.id)?.amountMinor??0})),...finances.debts.filter(row=>row.debt.direction==='payable').map(row=>({id:`debt:${row.debt.id}`,currency:row.debt.currency,amountMinor:Math.max(0,calculateDebtPending(row.debt,historicalEntries)),alreadyExcludedMinor:planning.liabilityExcluded.find(value=>value.kind==='debt'&&value.id===row.debt.id)?.amountMinor??0}))];
 let availability=Math.max(0,integer(calculateAvailableBalance(balances,template.currency,[...liabilities,...planning.commitments])+(!incomeTransactionId&&account.availabilityPolicy==='free'?incomeMinor:0)));
 let resourceLeft=preview.resourceMinor;
 const backingUsed=new Map<string,number>();
 const lines=[];for(const line of preview.lines){
  const requestedMinor=!input.changes&&line.mode==='remainder'?resourceLeft:line.requestedMinor;const wanted=Math.min(resourceLeft,input.changes?line.amountMinor:requestedMinor);
  if(line.target==='free'){resourceLeft-=wanted;lines.push({...line,requestedMinor,amountMinor:wanted,shortfallMinor:Math.max(0,requestedMinor-wanted)});continue;}const bucket=planning.buckets.find(row=>row.bucket.id===line.bucketId);assert(bucket!==undefined&&bucket.bucket.currency===template.currency,'Apartado incompatible con el ingreso');
  const owner=bucket.bucket.targetId;let backing=0;
  if(bucket.bucket.kind==='card'&&owner){const card=finances.cards.find(row=>row.card.id===owner)?.card;backing=card?calculateCreditCardDebt(card,historicalEntries):0;}
  if(bucket.bucket.kind==='debt'&&owner){const debt=finances.debts.find(row=>row.debt.id===owner&&row.debt.direction==='payable')?.debt;backing=debt?calculateDebtPending(debt,historicalEntries):0;}
  const ownerKey=`${bucket.bucket.kind}:${owner}`;const fundedOwner=total(planning.buckets.filter(row=>row.bucket.kind===bucket.bucket.kind&&row.bucket.targetId===owner).map(row=>row.fundedMinor));
  const overlap=Math.max(0,integer(backing-fundedOwner-(backingUsed.get(ownerKey)??0)));
  let capacity=account.availabilityPolicy==='protected'?wanted:integer(availability+overlap);
  if(bucket.bucket.kind==='card'||bucket.bucket.kind==='debt')capacity=Math.min(capacity,overlap);
  if(bucket.bucket.kind==='bill'){const bill=await requireBill(repositories,input.profileId,owner??'');const summary=await billSummary(repositories,runtime,bill,input.effectiveDate);capacity=Math.min(capacity,Math.max(0,summary.remainingMinor-fundedOwner-(backingUsed.get(ownerKey)??0)));}
  const amountMinor=Math.min(wanted,capacity);resourceLeft-=amountMinor;
  if(input.changes)assert(amountMinor===line.amountMinor,'El reparto manual excede el Disponible real');
  const overlapped=Math.min(amountMinor,overlap);backingUsed.set(ownerKey,integer((backingUsed.get(ownerKey)??0)+(bucket.bucket.kind==='bill'?amountMinor:overlapped)));if(account.availabilityPolicy==='free')availability-=amountMinor-overlapped;
  lines.push({...line,requestedMinor,amountMinor,shortfallMinor:Math.max(0,requestedMinor-amountMinor)});
 }
 const allocatedMinor=total(lines.filter(row=>row.target==='bucket').map(row=>row.amountMinor));return{...preview,lines,allocatedMinor,freeMinor:incomeMinor-allocatedMinor,templateId:template.id,accountId:account.id,incomeTransactionId,effectiveDate:input.effectiveDate,newIncome:!incomeTransactionId};
}
export function createBillingApplication(unit:UnitOfWork,runtime:Runtime){return{
 snapshot:(profileId:string,asOf=runtimeDay(runtime))=>unit.execute(async repositories=>{date(asOf);await renew(repositories,runtime,profileId,addDays(asOf,32));return{series:await repositories.billing.series(profileId),bills:await Promise.all((await repositories.billing.occurrences(profileId)).map(row=>billSummary(repositories,runtime,row,asOf))),templates:await repositories.billing.templates(profileId),distributions:await repositories.billing.distributions(profileId)} satisfies BillingSnapshot;}),
 createBill:(input:CreateBillInput)=>unit.execute(async repositories=>{
  baseValid(input);date(input.dueOn);const normalized={...input,name:input.name.trim(),accountId:input.accountId??null,cardId:input.cardId??null,intervalDays:input.frequency==='custom'?input.intervalDays??null:null};const hash=fingerprint('create-bill',normalized);const previous=await repositories.billing.seriesByKey(input.profileId,input.idempotencyKey);if(previous){assert(previous.fingerprint===hash,'Clave de recibo reutilizada');return previous.series;}
  await validateBillMetadata(repositories,normalized);recurrenceDate({frequency:input.frequency,intervalDays:normalized.intervalDays,anchorDate:input.dueOn},0);if(input.frequency==='custom')recurrenceDate({frequency:input.frequency,intervalDays:normalized.intervalDays,anchorDate:input.dueOn},1);
  const series:BillSeries={id:runtime.id(),profileId:input.profileId,name:normalized.name,currency:input.currency,expectedMinor:input.expectedMinor,anchorDate:input.dueOn,frequency:input.frequency,intervalDays:normalized.intervalDays,categoryId:input.categoryId,preferredMethod:input.preferredMethod,accountId:normalized.accountId,cardId:normalized.cardId,active:true,createdAt:runtime.now()};await repositories.billing.insertSeries(series,input.idempotencyKey,hash);await renew(repositories,runtime,input.profileId,input.dueOn);return series;
 }),
 updateBill:(input:EditBillInput)=>unit.execute(async repositories=>{const bill=await requireBill(repositories,input.profileId,input.billId);date(input.dueOn);await validateBillMetadata(repositories,{...input,currency:bill.currency});if(input.actualMinor!==null)assert(integer(input.actualMinor)>=0,'Monto real inválido');const summary=await billSummary(repositories,runtime,bill,runtimeDay(runtime));assert((input.actualMinor??input.expectedMinor)>=summary.paidMinor,'El total no puede ser menor que los pagos realizados');const updated={...bill,name:input.name.trim(),expectedMinor:input.expectedMinor,actualMinor:input.actualMinor,dueOn:input.dueOn,categoryId:input.categoryId,preferredMethod:input.preferredMethod,accountId:input.accountId,cardId:input.cardId};await repositories.billing.updateOccurrence(updated);await reconcileBillFunding(repositories,runtime,input.profileId,runtimeDay(runtime));await validateFunding(repositories,input.profileId);return updated;}),
 configureSeries:(profileId:string,seriesId:string,active:boolean)=>unit.execute(async repositories=>{assert((await repositories.billing.series(profileId)).some(row=>row.id===seriesId),'Serie inexistente');await repositories.billing.configureSeries(profileId,seriesId,active);}),
 reserve:(input:Base&{billId:string;accountId:string;amountMinor:number})=>unit.execute(async repositories=>{
  baseValid(input);const bill=await requireBill(repositories,input.profileId,input.billId);const summary=await billSummary(repositories,runtime,bill,input.effectiveDate);assert(integer(input.amountMinor)>0,'Indica un monto positivo');
  let bucketId=bill.reservationBucketId;if(!bucketId){const bucket=await createBucketIn(repositories,runtime,{profileId:input.profileId,idempotencyKey:`bill-bucket:${bill.id}`,effectiveDate:input.effectiveDate,name:bill.name,currency:bill.currency,kind:'bill',targetId:bill.id,categoryId:bill.categoryId});bucketId=bucket.id;await repositories.billing.updateOccurrence({...bill,reservationBucketId:bucketId});}
  // The funding command handles retries; the cap is checked against net funding before a first call.
  const retry=await repositories.planning.operation(input.profileId,input.idempotencyKey);if(!retry)assert(integer(summary.reservedMinor+input.amountMinor)<=summary.remainingMinor,'La reserva excede lo pendiente del recibo');
  return createPlanningApplication(scopedUnitOfWork(repositories),runtime).fund({...input,bucketId});
 }),
 payBill:(input:Base&{billId:string;method:'bank'|'card';sourceId:string;amountMinor:number;allowProtected?:boolean})=>unit.execute(async repositories=>{
  baseValid(input);const normalized={...input,description:(input.description??'').trim(),allowProtected:input.allowProtected??false};const hash=fingerprint('pay-bill',normalized);const previous=await repositories.billing.paymentByKey(input.profileId,input.idempotencyKey);if(previous){assert(previous.fingerprint===hash,'Clave de pago reutilizada');const transaction=await repositories.transactions.find(input.profileId,previous.payment.transactionId);assert(transaction!==undefined,'Pago incompleto');return transaction;}
  const bill=await requireBill(repositories,input.profileId,input.billId);const summary=await billSummary(repositories,runtime,bill,input.effectiveDate);assert(integer(input.amountMinor)>0&&input.amountMinor<=summary.remainingMinor,'El pago excede lo pendiente del recibo');
  const base={profileId:input.profileId,idempotencyKey:`${input.idempotencyKey}:movement`,effectiveDate:input.effectiveDate,description:input.description?.trim()||bill.name};let transaction:Transaction;
  if(input.method==='bank'){const account=await repositories.accounts.find(input.profileId,input.sourceId);assert(account?.currency===bill.currency,'Cuenta incompatible con el recibo');transaction=await createFinanceApplication(scopedUnitOfWork(repositories),runtime).post({...base,kind:'EXPENSE',accountId:input.sourceId,categoryId:bill.categoryId,amountMinor:input.amountMinor,allowProtected:input.allowProtected,fundingOwner:{kind:'bill',targetId:bill.id}});}
  else{assert(input.method==='card','Forma de pago inválida');const card=await repositories.cards.find(input.profileId,input.sourceId);assert(card?.currency===bill.currency,'Tarjeta incompatible con el recibo');transaction=await createCreditCardApplication(scopedUnitOfWork(repositories),runtime).purchase({...base,cardId:input.sourceId,categoryId:bill.categoryId,amountMinor:input.amountMinor,fundingOwner:{kind:'bill',targetId:bill.id}});}

  await repositories.billing.insertPayment({id:runtime.id(),profileId:input.profileId,billId:bill.id,transactionId:transaction.id,method:input.method,sourceId:input.sourceId,createdAt:runtime.now()},input.idempotencyKey,hash);await reconcileBillFunding(repositories,runtime,input.profileId,input.effectiveDate,transaction.id);await validateFunding(repositories,input.profileId);
  const series=(await repositories.billing.series(input.profileId)).find(row=>row.id===bill.seriesId);if(series?.active&&series.frequency!=='once')await renew(repositories,runtime,input.profileId,recurrenceDate(series,bill.periodIndex+1));return transaction;
 }),
 reverseBillPayment:(input:Base&{billId:string;originalId:string})=>unit.execute(async repositories=>{
  baseValid(input);const payment=(await repositories.billing.payments(input.profileId,input.billId)).find(row=>row.transactionId===input.originalId);assert(payment!==undefined,'Pago inexistente en este recibo');const base={...input,description:input.description?.trim()||'Reverso de pago de recibo'};const reversal=payment.method==='card'?await createCreditCardApplication(scopedUnitOfWork(repositories),runtime).reversePurchase({...base,cardId:payment.sourceId}):await createFinanceApplication(scopedUnitOfWork(repositories),runtime).reverse(base);await restoreConsumption(repositories,runtime,input.profileId,input.originalId,reversal.id);return reversal;
 }),
 saveTemplate:(input:{profileId:string;id?:string;name:string;currency:string;rules:AllocationRule[]})=>unit.execute(async repositories=>{
  assert(input.name.trim().length>0&&input.name.trim().length<=100,'Nombre de regla inválido');currency(input.currency);validateAllocationRules(input.rules);const planning=await createPlanningApplication(scopedUnitOfWork(repositories),runtime).snapshot(input.profileId);for(const rule of input.rules)if(rule.target==='bucket')assert(planning.buckets.some(row=>row.bucket.id===rule.bucketId&&row.bucket.currency===input.currency),'Apartado incompatible');const old=input.id?(await repositories.billing.templates(input.profileId)).find(row=>row.id===input.id):undefined;assert(!input.id||old!==undefined,'Regla inexistente');assert(!old||old.currency===input.currency,'No cambies la moneda de una regla existente');const template:DistributionTemplate={id:old?.id??runtime.id(),profileId:input.profileId,name:input.name.trim(),currency:input.currency,rules:input.rules.map(row=>({...row,label:row.label.trim()})),createdAt:old?.createdAt??runtime.now()};await repositories.billing.saveTemplate(template);return template;
 }),
 previewDistribution:(input:DistributionInput)=>unit.execute(repositories=>buildPreview(repositories,runtime,input)),
 confirmDistribution:(input:DistributionInput)=>unit.execute(async repositories=>{
  baseValid(input);const hash=fingerprint('confirm-distribution',{...input,description:(input.description??'').trim(),incomeTransactionId:input.incomeTransactionId??null});const previous=await repositories.billing.distributionByKey(input.profileId,input.idempotencyKey);if(previous){assert(previous.fingerprint===hash,'Clave de distribución reutilizada');return previous.distribution;}
  const plan=await buildPreview(repositories,runtime,input);let incomeTransactionId=plan.incomeTransactionId;
  if(!incomeTransactionId){const transaction=await createFinanceApplication(scopedUnitOfWork(repositories),runtime).post({profileId:input.profileId,idempotencyKey:`${input.idempotencyKey}:income`,effectiveDate:input.effectiveDate,description:input.description?.trim()||'Ingreso distribuido',kind:'INCOME',accountId:input.accountId,amountMinor:plan.incomeMinor,categoryId:input.categoryId});incomeTransactionId=transaction.id;}
  for(const line of plan.lines)if(line.target==='bucket'&&line.amountMinor>0){assert(line.bucketId!==null,'Selecciona un apartado');await fundBucketIn(repositories,runtime,{profileId:input.profileId,idempotencyKey:`${input.idempotencyKey}:${line.id}`,effectiveDate:input.effectiveDate,bucketId:line.bucketId,accountId:input.accountId,amountMinor:line.amountMinor});}
  const distribution:IncomeDistribution={id:runtime.id(),profileId:input.profileId,incomeTransactionId,templateId:input.templateId,accountId:input.accountId,plan,createdAt:runtime.now()};await repositories.billing.insertDistribution(distribution,input.idempotencyKey,hash);return distribution;
 }),
};}
export type BillingApplication=ReturnType<typeof createBillingApplication>;
