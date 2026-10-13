import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSqliteUnitOfWork } from '../src/database/finance/repositories.ts';
import { createFinanceApplication } from '../src/services/finance/application.ts';
import { migrateFinance } from '../src/database/finance/migrations.ts';
const runtime={id:randomUUID,now:()=> '2026-10-12T12:00:00.000Z'};
const day='2026-10-12';
function adapter(path,fail) {
 const db=new DatabaseSync(path);
 return {exec:async sql=>db.exec(sql),run:async(sql,params=[])=>{if(fail)fail(sql,params);db.prepare(sql).run(...params);},all:async(sql,params=[])=>db.prepare(sql).all(...params),close:async()=>db.close()};
}
async function fixture(work) {
 const directory=mkdtempSync(join(tmpdir(),'finance-core-'));const path=join(directory,'finance.db');let failure;
 const unit=createSqliteUnitOfWork(async()=>adapter(path,(sql,params)=>{if(failure)failure(sql,params);}),runtime);
 const app=createFinanceApplication(unit,runtime);
 try {
 const profile=await app.initialProfile();
 const create=(name,initialBalanceMinor=0,type='bank',availabilityPolicy='free',currency='USD')=>app.createAccount({profileId:profile.id,name,type,currency,availabilityPolicy,initialBalanceMinor,effectiveDate:day,idempotencyKey:randomUUID()});
 const input=(kind,accountId,amountMinor,extra={})=>({profileId:profile.id,kind,accountId,amountMinor,description:'Synthetic',effectiveDate:day,idempotencyKey:randomUUID(),...extra});
 await work({app,unit,path,profile,create,input,fail:fn=>{failure=fn;}});
 } finally {failure=undefined;await app.close();rmSync(directory,{recursive:true,force:true});}
}
function usd(snapshot){return snapshot.totals.find(row=>row.currency==='USD');}
test('initial local profile repeats without seeding accounts, including no cash',()=>fixture(async({app,profile})=>{
 assert.equal((await app.initialProfile()).id,profile.id);assert.deepEqual((await app.snapshot(profile.id)).accounts,[]);
 assert.equal((await app.snapshot(profile.id)).categories.length,8);
}));
test('development data 1200+200 protected+100, idempotent and no cash',()=>fixture(async({app,profile})=>{
 const data=await app.seedDevelopment(profile.id);assert.equal(usd(data).physicalMinor,150000);assert.equal(usd(data).availableMinor,130000);
 assert.ok(data.accounts.every(row=>row.account.type!=='cash'));
 assert.equal((await app.seedDevelopment(profile.id)).transactions.length,3);
}));
test('daily withdrawal end to end and later splits do not add money movements',()=>fixture(async({app,profile,create,input})=>{
 const bank=await create('Bank',120000);const tx=await app.post(input('DAILY',bank.id,5000));
 let data=await app.snapshot(profile.id);assert.equal(usd(data).physicalMinor,115000);assert.equal(usd(data).availableMinor,115000);assert.equal(usd(data).expenseMinor,5000);
 const categories=data.categories;const splits=['Transporte','Comida','Otros'].map((name,index)=>({categoryId:categories.find(row=>row.name===name).id,amountMinor:index===2?1000:2000}));
 const entries=structuredClone(tx.entries);await app.splitExpense(profile.id,tx.id,splits);
 data=await app.snapshot(profile.id);assert.equal(data.transactions.length,2);assert.equal(usd(data).expenseMinor,5000);assert.deepEqual(data.transactions.find(row=>row.id===tx.id).entries,entries);
 assert.ok(data.accounts.every(row=>row.account.type!=='cash'));
}));
test('income, expense and transfer affect ledger exactly once',()=>fixture(async({app,profile,create,input})=>{
 const bank=await create('Bank',120000);const to=await create('Other');let data=await app.snapshot(profile.id);
 await app.post(input('INCOME',bank.id,100000,{categoryId:data.categories.find(row=>row.kind==='INCOME').id}));
 await app.post(input('EXPENSE',bank.id,2000,{categoryId:data.categories.find(row=>row.name==='Comida').id}));
 await app.post(input('TRANSFER',bank.id,5000,{toAccountId:to.id}));
 data=await app.snapshot(profile.id);assert.equal(usd(data).physicalMinor,218000);assert.equal(usd(data).availableMinor,218000);assert.equal(usd(data).netWorthMinor,218000);
 assert.equal(usd(data).incomeMinor,100000);assert.equal(usd(data).expenseMinor,2000);assert.equal(data.accounts.find(row=>row.account.id===to.id).balanceMinor,5000);
}));
test('J: concurrent duplicate requests create one transaction; conflicting key rejects',()=>fixture(async({app,profile,create,input})=>{
 const bank=await create('Bank',120000);const request=input('DAILY',bank.id,5000);
 const [a,b]=await Promise.all([app.post(request),app.post(request)]);assert.equal(a.id,b.id);
 await assert.rejects(app.post({...request,amountMinor:6000}));
 assert.equal((await app.snapshot(profile.id)).transactions.length,2);
}));
test('H/I: reversals conserve originals and cannot be duplicated',()=>fixture(async({app,profile,create,input})=>{
 const bank=await create('Bank',120000);const data=await app.snapshot(profile.id);
 for(const kind of ['EXPENSE','DAILY']) {
  const tx=await app.post(input(kind,bank.id,5000,{categoryId:data.categories.find(row=>row.name==='Comida').id}));
  const request={profileId:profile.id,originalId:tx.id,effectiveDate:day,description:'Correction',idempotencyKey:randomUUID()};
  const reversed=await app.reverse(request);assert.equal((await app.reverse(request)).id,reversed.id);
  await assert.rejects(app.reverse({...request,idempotencyKey:randomUUID()}));
 }
 const final=await app.snapshot(profile.id);assert.equal(usd(final).physicalMinor,120000);assert.equal(usd(final).expenseMinor,0);assert.equal(final.transactions.length,5);
}));
test('K: failed second entry rolls back transaction, first entry and new counterparty',()=>fixture(async({app,profile,create,input,fail})=>{
 const bank=await create('Bank',120000);const before=await app.snapshot(profile.id);let writes=0;
 fail(sql=>{if(sql.startsWith('INSERT INTO transaction_entries')&&++writes===2)throw new Error('INJECTED_FAILURE');});
 const request=input('DAILY',bank.id,5000);await assert.rejects(app.post(request),/INJECTED_FAILURE/);fail(undefined);
 assert.deepEqual(await app.snapshot(profile.id),before);await app.post(request);assert.equal(usd(await app.snapshot(profile.id)).physicalMinor,115000);
}));
test('L: balances survive reopening and a separate Node process without seed',()=>fixture(async({app,profile,create,input,path})=>{
 const bank=await create('Bank',120000);await app.post(input('DAILY',bank.id,5000));const before=await app.snapshot(profile.id);await app.close();
 assert.deepEqual(await app.snapshot(profile.id),before);
 const child=spawnSync(process.execPath,['--input-type=module','-e',"import{DatabaseSync}from'node:sqlite';const d=new DatabaseSync(process.argv[1]);const value=d.prepare('SELECT SUM(debit_minor-credit_minor) AS value FROM transaction_entries WHERE ledger_node_id=?').get(process.argv[2]).value;await import('node:fs').then(fs=>fs.writeFileSync(process.argv[3],String(value)));d.close();",path,bank.nodeId,path+'.probe'],{encoding:'utf8',env:{...process.env,NODE_TEST_CONTEXT:undefined}});
 assert.equal(child.status,0,child.stderr);assert.equal(readFileSync(path+'.probe','utf8'),'115000');
}));
test('profile isolation rejects foreign accounts, categories and SQL cross-profile FK',()=>fixture(async({app,profile,create,input,path})=>{
 const bank=await create('Bank',120000);const second=randomUUID();const db=adapter(path);await migrateFinance(db,runtime.now());
 const cat=randomUUID();await db.run('INSERT INTO profiles VALUES(?,?,?,?,?)',[second,'another','Another','USD',runtime.now()]);
 await db.run('INSERT INTO categories VALUES(?,?,?,?,?,?)',[cat,second,'Private','EXPENSE','private',runtime.now()]);
 const foreign=await app.createAccount({profileId:second,name:'Foreign',type:'bank',currency:'USD',availabilityPolicy:'free',initialBalanceMinor:50000,effectiveDate:day,idempotencyKey:randomUUID()});
 await assert.rejects(app.post(input('TRANSFER',bank.id,100,{toAccountId:foreign.id})));
 await assert.rejects(app.post(input('EXPENSE',bank.id,100,{categoryId:cat})));
 await assert.rejects(app.post(input('DAILY',foreign.id,100)));
 assert.equal((await app.snapshot(profile.id)).accounts.length,1);assert.equal((await app.snapshot(second)).accounts.length,1);
 await assert.rejects(db.run('INSERT INTO accounts VALUES(?,?,?,?,?,?,?,?,?,?,?)',[randomUUID(),profile.id,'X','bank','USD','free',1,foreign.nodeId,randomUUID(),'x',runtime.now()]));
 await db.close();
}));
test('posted entries are immutable and posting unbalanced ledger is blocked by SQLite',()=>fixture(async({app,profile,create,path})=>{
 const bank=await create('Bank',120000);const data=await app.snapshot(profile.id);const db=adapter(path);await migrateFinance(db,runtime.now());
 await assert.rejects(db.run('UPDATE transaction_entries SET debit_minor=1 WHERE transaction_id=?',[data.transactions[0].id]),/Immutable/);
 const id=randomUUID();await db.run('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[id,profile.id,'USD','OPENING','regular','DRAFT',day,runtime.now(),'test',randomUUID(),'test',null]);
 await db.run('INSERT INTO transaction_entries VALUES(?,?,?,?,?,?,?)',[randomUUID(),profile.id,id,'USD',bank.nodeId,100,0]);
 await assert.rejects(db.run("UPDATE transactions SET status='POSTED' WHERE id=?",[id]),/Unbalanced/);
 await db.run('DELETE FROM transaction_entries WHERE transaction_id=?',[id]);await db.run('DELETE FROM transactions WHERE id=?',[id]);await db.close();
}));
test('migration is reproducible; no editable balance column exists',()=>fixture(async({app,path,create})=>{
 await create('Bank',100);await app.close();const db=adapter(path);await migrateFinance(db,runtime.now());await migrateFinance(db,runtime.now());
 assert.equal((await db.all('SELECT COUNT(*) AS n FROM schema_migrations'))[0].n,3);
 assert.ok((await db.all('PRAGMA table_info(accounts)')).every(row=>!row.name.includes('balance')));await db.close();
}));
test('protected and inactive accounts retain wealth; cross-currency transfer fails',()=>fixture(async({app,profile,create,input})=>{
 const bank=await create('Bank',120000);const saving=await create('Saving',20000,'savings','protected');const euro=await create('EUR',1000,'bank','free','EUR');
 await app.configureAccount(profile.id,saving.id,false,'protected');
 assert.equal(usd(await app.snapshot(profile.id)).physicalMinor,140000);assert.equal(usd(await app.snapshot(profile.id)).availableMinor,120000);
 await assert.rejects(app.post(input('TRANSFER',bank.id,100,{toAccountId:euro.id})));
 await assert.rejects(app.post(input('DAILY',saving.id,100,{allowProtected:true})));
}));
test('reverse spent income or transfer cannot worsen insufficient funds',()=>fixture(async({app,profile,create,input})=>{
 const bank=await create('Bank',0);const data=await app.snapshot(profile.id);
 const tx=await app.post(input('INCOME',bank.id,1000,{categoryId:data.categories.find(row=>row.kind==='INCOME').id}));await app.post(input('DAILY',bank.id,1000));
 await assert.rejects(app.reverse({profileId:profile.id,originalId:tx.id,effectiveDate:day,description:'Correction',idempotencyKey:randomUUID()}));
 assert.equal(usd(await app.snapshot(profile.id)).physicalMinor,0);
}));
test('account creation keys are stable and cannot be reused with different opening balance',()=>fixture(async({app,profile})=>{
 const request={profileId:profile.id,name:'Bank',type:'bank',currency:'USD',availabilityPolicy:'free',initialBalanceMinor:120000,effectiveDate:day,idempotencyKey:randomUUID()};
 const a=await app.createAccount(request);const b=await app.createAccount({...request});assert.equal(a.id,b.id);
 await assert.rejects(app.createAccount({...request,initialBalanceMinor:100000}));
 const data=await app.snapshot(profile.id);assert.equal(data.accounts.length,1);assert.equal(data.transactions.length,1);
}));
test('reversal after optional expense breakdown keeps total and entries correct',()=>fixture(async({app,profile,create,input})=>{
 const bank=await create('Bank',120000);const tx=await app.post(input('DAILY',bank.id,5000));const data=await app.snapshot(profile.id);
 await app.splitExpense(profile.id,tx.id,['Transporte','Comida','Otros'].map((name,index)=>({categoryId:data.categories.find(row=>row.name===name).id,amountMinor:index===2?1000:2000})));
 await app.reverse({profileId:profile.id,originalId:tx.id,effectiveDate:day,description:'Correct aggregate',idempotencyKey:randomUUID()});
 const final=await app.snapshot(profile.id);assert.equal(usd(final).expenseMinor,0);assert.equal(usd(final).physicalMinor,120000);assert.equal(final.transactions.length,3);
 await assert.rejects(app.splitExpense(profile.id,tx.id,[{categoryId:data.categories[0].id,amountMinor:5000}]));
}));
test('Phase A: complete core validation sequence, restart, transfer, reversal and duplicates',()=>fixture(async({app,profile,create,input})=>{
 assert.equal((await app.initialProfile()).id,profile.id);
 const bank=await create('Banco validación',120000);
 let data=await app.snapshot(profile.id);
 const income=input('INCOME',bank.id,100000,{categoryId:data.categories.find(row=>row.kind==='INCOME').id});
 const expense=input('EXPENSE',bank.id,2000,{categoryId:data.categories.find(row=>row.name==='Comida').id});
 const daily=input('DAILY',bank.id,5000);
 await app.post(income);const original=await app.post(expense);await app.post(daily);
 data=await app.snapshot(profile.id);
 assert.equal(data.accounts.find(row=>row.account.id===bank.id).balanceMinor,213000);
 assert.equal(usd(data).physicalMinor,213000);assert.equal(usd(data).availableMinor,213000);
 const persisted=data;await app.close();
 assert.deepEqual(await app.snapshot(profile.id),persisted);
 const secondary=await create('Secundaria validación',0);
 const transfer=input('TRANSFER',bank.id,5000,{toAccountId:secondary.id});await app.post(transfer);
 data=await app.snapshot(profile.id);
 assert.equal(data.accounts.find(row=>row.account.id===bank.id).balanceMinor,208000);
 assert.equal(data.accounts.find(row=>row.account.id===secondary.id).balanceMinor,5000);
 const reverse={profileId:profile.id,originalId:original.id,effectiveDate:day,description:'Validación de reverso',idempotencyKey:randomUUID()};
 await app.reverse(reverse);
 await app.post(income);await app.post(expense);await app.post(daily);await app.post(transfer);await app.reverse(reverse);
 data=await app.snapshot(profile.id);
 assert.equal(data.accounts.find(row=>row.account.id===bank.id).balanceMinor,210000);
 assert.equal(data.accounts.find(row=>row.account.id===secondary.id).balanceMinor,5000);
 assert.equal(usd(data).physicalMinor,215000);assert.equal(usd(data).availableMinor,215000);
 assert.equal(usd(data).incomeMinor,100000);assert.equal(usd(data).expenseMinor,5000);
 assert.equal(data.transactions.length,6);assert.ok(data.accounts.every(row=>row.account.type!=='cash'));
}));
