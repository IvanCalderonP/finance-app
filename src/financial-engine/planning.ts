import { assert, date, integer, total } from './model.ts';
import type { Category, Transaction } from './model.ts';
export type BucketKind = 'category' | 'goal' | 'reserve' | 'bill' | 'card' | 'debt';
export interface FundingOwner { kind: BucketKind; targetId: string }
export interface FundingBucket { id:string; profileId:string; name:string; currency:string; kind:BucketKind; targetId:string|null; categoryId:string|null; createdOn:string; createdAt:string }
export interface BucketFunding { bucketId:string; accountId:string; amountMinor:number }
export interface FundingEvent { id:string; profileId:string; bucketId:string; accountId:string; amountMinor:number; kind:'fund'|'release'|'move'|'consume'|'restore'; effectiveDate:string; createdAt:string; transactionId:string|null; note:string }
export interface Budget { id:string; profileId:string; name:string; currency:string; categoryId:string; limitMinor:number; frequency:'monthly'|'weekly'|'custom'; startsOn:string; endsOn:string; renew:boolean; createdAt:string }
export interface BudgetPeriod { id:string; profileId:string; budgetId:string; bucketId:string; startsOn:string; endsOn:string; closed:boolean }
export interface SavingsGoal { id:string; profileId:string; bucketId:string; name:string; currency:string; targetMinor:number; targetOn:string|null; primary:boolean; createdOn:string; createdAt:string }
export interface LockedReserve { id:string; profileId:string; bucketId:string; name:string; currency:string; unlockOn:string; released:boolean; createdOn:string; createdAt:string }
export interface BucketSummary { bucket:FundingBucket; fundedMinor:number; funding:BucketFunding[]; history:FundingEvent[] }
export interface BudgetSummary { budget:Budget; period:BudgetPeriod; assignedMinor:number; spentMinor:number; remainingMinor:number; percentUsed:number; exceeded:boolean; reservedMinor:number; bucket:BucketSummary }
export interface GoalSummary { goal:SavingsGoal; savedMinor:number; remainingMinor:number; percent:number; estimatedOn:string|null; history:FundingEvent[]; bucket:BucketSummary }
export interface ReserveSummary { reserve:LockedReserve; amountMinor:number; status:'locked'|'releasable'|'released'; bucket:BucketSummary }
export function addDays(value:string,days:number):string { date(value);assert(Number.isSafeInteger(days),'Duración inválida');const d=new Date(`${value}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10); }
export function daysBetween(first:string,last:string) {date(first);date(last);return Math.round((new Date(`${last}T00:00:00Z`).getTime()-new Date(`${first}T00:00:00Z`).getTime())/86400000);}
function nextMonth(value:string,anchorDay:number) {const d=new Date(`${value}T00:00:00Z`);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);const last=new Date(d.getTime());last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);d.setUTCDate(Math.min(anchorDay,last.getUTCDate()));return d.toISOString().slice(0,10);}
export function budgetPeriodAt(budget:Budget,asOf:string):{startsOn:string;endsOn:string}|null {
 date(asOf);date(budget.startsOn);date(budget.endsOn);assert(budget.endsOn>=budget.startsOn,'Período inválido');if(asOf<budget.startsOn)return null;
 if(!budget.renew)return asOf<=budget.endsOn?{startsOn:budget.startsOn,endsOn:budget.endsOn}:null;
 if(budget.frequency==='monthly') {const anchor=Number(budget.startsOn.slice(8));let start=budget.startsOn;for(let i=0;i<2400;i++){const next=nextMonth(start,anchor);if(asOf<next)return {startsOn:start,endsOn:addDays(next,-1)};start=next;}assert(false,'Período fuera del rango admitido');}
 const duration=budget.frequency==='weekly'?7:daysBetween(budget.startsOn,budget.endsOn)+1;assert(duration>0&&duration<=366,'El período personalizado debe durar hasta 366 días');const offset=Math.floor(daysBetween(budget.startsOn,asOf)/duration)*duration;const start=addDays(budget.startsOn,offset);return {startsOn:start,endsOn:addDays(start,duration-1)};
}
export function categoryDescendants(categoryId:string,categories:Category[]):Set<string> {
 const ids=new Set([categoryId]);let changed=true;while(changed){changed=false;for(const row of categories){const parent=(row as Category&{parentId?:string|null}).parentId;if(parent&&ids.has(parent)&&!ids.has(row.id)){ids.add(row.id);changed=true;}}}return ids;
}
export function budgetSpent(period:Pick<BudgetPeriod,'startsOn'|'endsOn'>,categoryId:string,transactions:Transaction[],categories:Category[],currency:string):number {
 const ids=categoryDescendants(categoryId,categories);return total(transactions.filter(tx=>tx.currency===currency&&tx.effectiveDate>=period.startsOn&&tx.effectiveDate<=period.endsOn&&(tx.type==='EXPENSE'||tx.type==='REVERSAL')).flatMap(tx=>tx.splits.filter(split=>ids.has(split.categoryId)).map(split=>split.amountMinor)));
}
export function fundingAt(events:FundingEvent[],asOf:string):BucketFunding[] { date(asOf);const sums=new Map<string,BucketFunding>();for(const event of events.filter(row=>row.effectiveDate<=asOf)){const key=`${event.bucketId}:${event.accountId}`;const row=sums.get(key)??{bucketId:event.bucketId,accountId:event.accountId,amountMinor:0};row.amountMinor=integer(row.amountMinor+event.amountMinor);sums.set(key,row);}for(const row of sums.values())assert(row.amountMinor>=0,'El historial de apartados tiene un saldo negativo');return [...sums.values()].filter(row=>row.amountMinor>0); }
export function goalEstimate(goal:SavingsGoal,savedMinor:number,events:FundingEvent[],asOf:string):string|null {
 if(savedMinor>=goal.targetMinor)return asOf;const days=daysBetween(goal.createdOn,asOf);if(days<=0||savedMinor<=0)return null;const remaining=goal.targetMinor-savedMinor;const elapsed=Math.ceil(remaining*days/savedMinor);if(!Number.isFinite(elapsed)||elapsed>36525)return null;return addDays(asOf,elapsed);
}
