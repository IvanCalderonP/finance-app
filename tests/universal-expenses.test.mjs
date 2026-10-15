import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteUnitOfWork } from '../src/database/finance/repositories.ts';
import { runtimeDay } from '../src/services/finance/contracts.ts';
import { createFinanceApplication } from '../src/services/finance/application.ts';
import { createCreditCardApplication } from '../src/services/finance/card-application.ts';
import { createPlanningApplication } from '../src/services/finance/planning-application.ts';
import { createInsightsApplication } from '../src/services/finance/insights-application.ts';
const runtime={id:randomUUID,now:()=> '2026-10-13T12:00:00.000Z'};
async function fixture(work){
 const directory=mkdtempSync(join(tmpdir(),'universal-splits-'));let fail;
 const unit=createSqliteUnitOfWork(async()=>{const db=new DatabaseSync(join(directory,'finance.db'));return{exec:async sql=>db.exec(sql),run:async(sql,values=[])=>{fail?.(sql,values);db.prepare(sql).run(...values);},all:async(sql,values=[])=>db.prepare(sql).all(...values),close:async()=>db.close()};},runtime);
 const finance=createFinanceApplication(unit,runtime),cards=createCreditCardApplication(unit,runtime),planning=createPlanningApplication(unit,runtime),insights=createInsightsApplication(unit,runtime);
 try{const profile=await finance.initialProfile();const base=(extra={})=>({profileId:profile.id,idempotencyKey:randomUUID(),effectiveDate:'2026-10-08',description:'Sintético',...extra});const bank=await finance.createAccount({...base({effectiveDate:'2026-10-01'}),name:'Banco sintético',type:'bank',currency:'USD',availabilityPolicy:'free',initialBalanceMinor:100000});const card=await cards.create({...base(),name:'Tarjeta sintética',currency:'USD',limitMinor:30000,initialDebtMinor:0,closingDay:15,dueDay:12,defaultAccountId:bank.id});const snapshot=()=>finance.snapshot(profile.id);await work({finance,cards,planning,insights,unit,profile,bank,card,base,snapshot,fail:fn=>fail=fn});}finally{fail=undefined;await unit.close();rmSync(directory,{recursive:true,force:true});}
}
const usd=s=>s.totals.find(row=>row.currency==='USD');
async function categories(f){const food=(await f.snapshot()).categories.find(row=>row.name==='Comida');const market=await f.finance.createCategory({...f.base(),name:'Mercado',kind:'EXPENSE',parentId:food.id});const clean=await f.finance.createCategory({...f.base(),name:'Limpieza',kind:'EXPENSE'});const personal=await f.finance.createCategory({...f.base(),name:'Cuidado personal',kind:'EXPENSE'});return{food,market,clean,personal,splits:[{categoryId:market.id,amountMinor:3000},{categoryId:clean.id,amountMinor:1000},{categoryId:personal.id,amountMinor:1000}]};}
test('bank, daily and card split 50 into 30/10/10 with one debit each and parent reports',()=>fixture(async f=>{
 const cat=await categories(f);const budget=await f.planning.createBudget({...f.base(),name:'Comida',currency:'USD',categoryId:cat.food.id,limitMinor:10000,frequency:'monthly',startsOn:'2026-10-01',endsOn:'2026-10-31',renew:true});
 const bankTx=await f.finance.post({...f.base(),kind:'EXPENSE',accountId:f.bank.id,categoryId:cat.food.id,amountMinor:5000});const dailyTx=await f.finance.post({...f.base({effectiveDate:'2026-10-09'}),kind:'DAILY',accountId:f.bank.id,amountMinor:5000});const cardTx=await f.cards.purchase({...f.base({effectiveDate:'2026-10-10'}),cardId:f.card.id,categoryId:cat.food.id,amountMinor:5000});
 const before=await f.snapshot();for(const tx of [bankTx,dailyTx,cardTx])await f.finance.splitExpense(f.profile.id,tx.id,cat.splits);
 const after=await f.snapshot();assert.deepEqual(after.transactions.map(row=>row.entries),before.transactions.map(row=>row.entries));assert.equal(after.transactions.length,before.transactions.length);assert.equal(usd(after).physicalMinor,90000);assert.equal(usd(after).cardDebtMinor,5000);assert.equal(usd(after).expenseMinor,15000);
 assert.equal((await f.cards.snapshot(f.profile.id))[0].debtMinor,5000);
 const report=await f.insights.snapshot(f.profile.id,{start:'2026-10-08',end:'2026-10-10',currency:'USD'});assert.equal(report.expenseMinor,15000);assert.equal(report.categories.find(row=>row.categoryId===cat.food.id).rolledUpMinor,9000);assert.equal(report.methods.find(row=>row.method.cardId===f.card.id).amountMinor,5000);assert.equal(report.budgets.find(row=>row.budget.id===budget.id).spentMinor,9000);
}));
test('editing card classification keeps debt and expense, then reversal nets signed categories to zero',()=>fixture(async f=>{
 const cat=await categories(f);const purchase=await f.cards.purchase({...f.base(),cardId:f.card.id,categoryId:cat.food.id,amountMinor:5000});await f.finance.splitExpense(f.profile.id,purchase.id,cat.splits);
 const before=await f.snapshot();await assert.rejects(f.finance.splitExpense(f.profile.id,purchase.id,[{categoryId:cat.market.id,amountMinor:4999}]),/total|monto|igual|coincid/i);assert.deepEqual(await f.snapshot(),before);
 await f.finance.splitExpense(f.profile.id,purchase.id,[{categoryId:cat.market.id,amountMinor:4000},{categoryId:cat.clean.id,amountMinor:500},{categoryId:cat.personal.id,amountMinor:500}]);assert.equal((await f.cards.snapshot(f.profile.id))[0].debtMinor,5000);assert.equal(usd(await f.snapshot()).expenseMinor,5000);
 await f.cards.reversePurchase({...f.base({effectiveDate:'2026-10-11'}),cardId:f.card.id,originalId:purchase.id});
 const replacement=[{categoryId:cat.market.id,amountMinor:2000},{categoryId:cat.clean.id,amountMinor:2000},{categoryId:cat.personal.id,amountMinor:1000}];await f.finance.splitExpense(f.profile.id,purchase.id,replacement);
 const final=await f.snapshot();const reversal=final.transactions.find(row=>row.reversalOf===purchase.id);assert.deepEqual(final.transactions.find(row=>row.id===purchase.id).splits,replacement);assert.deepEqual(reversal.splits,replacement.map(row=>({...row,amountMinor:-row.amountMinor})));assert.equal(usd(final).expenseMinor,0);assert.equal(usd(final).cardDebtMinor,0);
 const report=await f.insights.snapshot(f.profile.id,{start:'2026-10-08',end:'2026-10-11',currency:'USD'});assert.equal(report.expenseMinor,0);assert.equal(report.categories.find(row=>row.categoryId===cat.food.id).rolledUpMinor,0);
}));
test('split update rollback, custom category guards and persisted appearance',()=>fixture(async f=>{
 const cat=await categories(f);await assert.rejects(f.finance.createCategory({...f.base(),name:'No válido',kind:'INCOME',parentId:cat.food.id}),/padre|incompatible/i);
 await assert.rejects(f.finance.createCategory({...f.base({profileId:randomUUID()}),name:'Ajena',kind:'EXPENSE',parentId:cat.food.id}),/padre|incompatible/i);
 const transaction=await f.finance.post({...f.base(),kind:'EXPENSE',accountId:f.bank.id,categoryId:cat.food.id,amountMinor:5000});await f.finance.reverse({...f.base({effectiveDate:'2026-10-09'}),originalId:transaction.id});
 const before=await f.snapshot();let audit=0;f.fail(sql=>{if(sql.startsWith('INSERT INTO split_edits')&&++audit===2)throw Error('Injected split failure');});await assert.rejects(f.finance.splitExpense(f.profile.id,transaction.id,cat.splits),/Injected split failure/);f.fail(undefined);assert.deepEqual(await f.snapshot(),before);
 await f.finance.setPreferences(f.profile.id,{theme:'dark',hideAmounts:true});await f.unit.close();assert.deepEqual(await f.finance.preferences(f.profile.id),{theme:'dark',hideAmounts:true});
}));

test('financial day follows the device civil date across a UTC midnight',()=>{const previous=process.env.TZ;try{process.env.TZ='America/El_Salvador';assert.equal(runtimeDay({id:randomUUID,now:()=> '2026-10-14T02:00:00.000Z'}),'2026-10-13');}finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}});
