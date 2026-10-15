import type { Budget, BudgetPeriod, BucketFunding, FundingBucket, FundingEvent, LockedReserve, SavingsGoal } from '../../financial-engine/planning.ts';
import type { PlanningRepository } from '../../services/finance/planning-contracts.ts';
import type { SqlConnection } from './connection.ts';
export function sqlitePlanningRepository(db:SqlConnection):PlanningRepository {
 return {
 listBudgets:profileId=>db.all<Budget>('SELECT id,profile_id AS profileId,name,currency,category_id AS categoryId,limit_minor AS limitMinor,frequency,starts_on AS startsOn,ends_on AS endsOn,renew,created_at AS createdAt FROM budgets WHERE profile_id=? ORDER BY created_at,id',[profileId]).then(rows=>rows.map(row=>({...row,renew:!!row.renew}))),
 listPeriods:profileId=>db.all<BudgetPeriod>('SELECT id,profile_id AS profileId,budget_id AS budgetId,bucket_id AS bucketId,starts_on AS startsOn,ends_on AS endsOn,closed FROM budget_periods WHERE profile_id=? ORDER BY starts_on,id',[profileId]).then(rows=>rows.map(row=>({...row,closed:!!row.closed}))),
 listBuckets:profileId=>db.all<FundingBucket>('SELECT id,profile_id AS profileId,name,currency,kind,target_id AS targetId,category_id AS categoryId,created_on AS createdOn,created_at AS createdAt FROM funding_buckets WHERE profile_id=? ORDER BY created_at,id',[profileId]),
 listFunding:profileId=>db.all<BucketFunding>('SELECT bucket_id AS bucketId,account_id AS accountId,SUM(amount_minor) AS amountMinor FROM funding_events WHERE profile_id=? GROUP BY bucket_id,account_id HAVING SUM(amount_minor)!=0',[profileId]),
 listEvents:profileId=>db.all<FundingEvent>('SELECT id,profile_id AS profileId,bucket_id AS bucketId,account_id AS accountId,amount_minor AS amountMinor,kind,effective_date AS effectiveDate,created_at AS createdAt,transaction_id AS transactionId,note FROM funding_events WHERE profile_id=? ORDER BY effective_date,created_at,rowid',[profileId]),
 listGoals:profileId=>db.all<SavingsGoal>('SELECT id,profile_id AS profileId,bucket_id AS bucketId,name,currency,target_minor AS targetMinor,target_on AS targetOn,is_primary AS "primary",created_on AS createdOn,created_at AS createdAt FROM savings_goals WHERE profile_id=? ORDER BY is_primary DESC,created_at,id',[profileId]).then(rows=>rows.map(row=>({...row,primary:!!row.primary}))),
 listReserves:profileId=>db.all<LockedReserve>('SELECT id,profile_id AS profileId,bucket_id AS bucketId,name,currency,unlock_on AS unlockOn,released,created_on AS createdOn,created_at AS createdAt FROM locked_reserves WHERE profile_id=? ORDER BY unlock_on,id',[profileId]).then(rows=>rows.map(row=>({...row,released:!!row.released}))),
 insertBudget:row=>db.run('INSERT INTO budgets VALUES(?,?,?,?,?,?,?,?,?,?,?)',[row.id,row.profileId,row.name,row.currency,row.categoryId,row.limitMinor,row.frequency,row.startsOn,row.endsOn,Number(row.renew),row.createdAt]),
 insertPeriod:row=>db.run('INSERT INTO budget_periods VALUES(?,?,?,?,?,?,?)',[row.id,row.profileId,row.budgetId,row.bucketId,row.startsOn,row.endsOn,Number(row.closed)]),
 insertBucket:row=>db.run('INSERT INTO funding_buckets VALUES(?,?,?,?,?,?,?,?,?)',[row.id,row.profileId,row.name,row.currency,row.kind,row.targetId,row.categoryId,row.createdOn,row.createdAt]),
 insertGoal:row=>db.run('INSERT INTO savings_goals VALUES(?,?,?,?,?,?,?,?,?,?)',[row.id,row.profileId,row.bucketId,row.name,row.currency,row.targetMinor,row.targetOn,Number(row.primary),row.createdOn,row.createdAt]),
 insertReserve:row=>db.run('INSERT INTO locked_reserves VALUES(?,?,?,?,?,?,?,?,?)',[row.id,row.profileId,row.bucketId,row.name,row.currency,row.unlockOn,Number(row.released),row.createdOn,row.createdAt]),
 async addEvent(row){const bucket=(await db.all<{currency:string}>('SELECT currency FROM funding_buckets WHERE profile_id=? AND id=?',[row.profileId,row.bucketId]))[0];if(!bucket)throw new Error('Apartado inexistente');await db.run('INSERT INTO funding_events VALUES(?,?,?,?,?,?,?,?,?,?,?)',[row.id,row.profileId,row.bucketId,row.accountId,bucket.currency,row.amountMinor,row.kind,row.effectiveDate,row.createdAt,row.transactionId,row.note]);},
 closePeriod:(profileId,id)=>db.run('UPDATE budget_periods SET closed=1 WHERE profile_id=? AND id=?',[profileId,id]),
 releaseReserve:(profileId,id)=>db.run('UPDATE locked_reserves SET released=1 WHERE profile_id=? AND id=?',[profileId,id]),
 async setPrimary(profileId,id){await db.run('UPDATE savings_goals SET is_primary=0 WHERE profile_id=?',[profileId]);await db.run('UPDATE savings_goals SET is_primary=1 WHERE profile_id=? AND id=?',[profileId,id]);},
 async operation(profileId,key){return (await db.all<{fingerprint:string;result:string}>('SELECT request_fingerprint AS fingerprint,result_json AS result FROM planning_operations WHERE profile_id=? AND idempotency_key=?',[profileId,key]))[0];},
 remember:(profileId,key,fingerprint,result)=>db.run('INSERT INTO planning_operations VALUES(?,?,?,?)',[profileId,key,fingerprint,result]),
 };
}
