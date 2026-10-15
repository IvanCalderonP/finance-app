import type { AllocationPreview, AllocationRule } from '../../financial-engine/allocation.ts';
import type { Recurrence } from '../../financial-engine/recurrence.ts';
export interface BillSeries extends Recurrence { id:string;profileId:string;name:string;currency:string;expectedMinor:number;categoryId:string;preferredMethod:'bank'|'card';accountId:string|null;cardId:string|null;active:boolean;createdAt:string }
export interface BillOccurrence { id:string;profileId:string;seriesId:string;periodIndex:number;name:string;currency:string;expectedMinor:number;actualMinor:number|null;dueOn:string;categoryId:string;preferredMethod:'bank'|'card';accountId:string|null;cardId:string|null;reservationBucketId:string|null;createdAt:string }
export interface BillPayment { id:string;profileId:string;billId:string;transactionId:string;method:'bank'|'card';sourceId:string;createdAt:string }
export interface BillSummary { bill:BillOccurrence;paidMinor:number;remainingMinor:number;reservedMinor:number;status:'pending'|'reserved'|'paid'|'overdue';payments:BillPayment[] }
export interface DistributionTemplate { id:string;profileId:string;name:string;currency:string;rules:AllocationRule[];createdAt:string }
export interface IncomeDistribution { id:string;profileId:string;incomeTransactionId:string;templateId:string;accountId:string;plan:AllocationPreview;createdAt:string }
export interface BillingSnapshot { series:BillSeries[];bills:BillSummary[];templates:DistributionTemplate[];distributions:IncomeDistribution[] }
export interface BillingRepository {
  series(profileId:string):Promise<BillSeries[]>;
  seriesByKey(profileId:string,key:string):Promise<{series:BillSeries;fingerprint:string}|undefined>;
  insertSeries(series:BillSeries,key:string,fingerprint:string):Promise<void>;
  configureSeries(profileId:string,id:string,active:boolean):Promise<void>;
  occurrences(profileId:string):Promise<BillOccurrence[]>;
  insertOccurrence(value:BillOccurrence):Promise<void>;
  updateOccurrence(value:BillOccurrence):Promise<void>;
  payments(profileId:string,billId?:string):Promise<BillPayment[]>;
  insertPayment(value:BillPayment,key:string,fingerprint:string):Promise<void>;
  paymentByKey(profileId:string,key:string):Promise<{payment:BillPayment;fingerprint:string}|undefined>;
  templates(profileId:string):Promise<DistributionTemplate[]>;
  saveTemplate(value:DistributionTemplate):Promise<void>;
  distributions(profileId:string):Promise<IncomeDistribution[]>;
  distributionByKey(profileId:string,key:string):Promise<{distribution:IncomeDistribution;fingerprint:string}|undefined>;
  insertDistribution(value:IncomeDistribution,key:string,fingerprint:string):Promise<void>;
}
