import type { Budget, BudgetPeriod, BucketFunding, FundingBucket, FundingEvent, LockedReserve, SavingsGoal } from '../../financial-engine/planning.ts';
export interface PlanningRepository {
 listBudgets(profileId:string):Promise<Budget[]>;
 listPeriods(profileId:string):Promise<BudgetPeriod[]>;
 listBuckets(profileId:string):Promise<FundingBucket[]>;
 listFunding(profileId:string):Promise<BucketFunding[]>;
 listEvents(profileId:string):Promise<FundingEvent[]>;
 listGoals(profileId:string):Promise<SavingsGoal[]>;
 listReserves(profileId:string):Promise<LockedReserve[]>;
 insertBudget(row:Budget):Promise<void>;
 insertPeriod(row:BudgetPeriod):Promise<void>;
 insertBucket(row:FundingBucket):Promise<void>;
 insertGoal(row:SavingsGoal):Promise<void>;
 insertReserve(row:LockedReserve):Promise<void>;
 addEvent(row:FundingEvent):Promise<void>;
 closePeriod(profileId:string,id:string):Promise<void>;
 releaseReserve(profileId:string,id:string):Promise<void>;
 setPrimary(profileId:string,id:string):Promise<void>;
 operation(profileId:string,key:string):Promise<{fingerprint:string;result:string}|undefined>;
 remember(profileId:string,key:string,fingerprint:string,result:string):Promise<void>;
}
