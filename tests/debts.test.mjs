import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteUnitOfWork } from '../src/database/finance/repositories.ts';
import { createFinanceApplication } from '../src/services/finance/application.ts';
import { createDebtApplication } from '../src/services/finance/debt-application.ts';
import { createCreditCardApplication } from '../src/services/finance/card-application.ts';
import { calculateDebtPending } from '../src/financial-engine/debts.ts';
const runtime={id:randomUUID,now:()=> '2026-10-20T12:00:00.000Z'};
async function fixture(work){
 const dir=mkdtempSync(join(tmpdir(),'debt-tests-'));let fail;
 const unit=createSqliteUnitOfWork(async()=>{const raw=new DatabaseSync(join(dir,'finance.db'));return {exec:async s=>raw.exec(s),run:async(s,p=[])=>{fail?.(s);raw.prepare(s).run(...p);},all:async(s,p=[])=>raw.prepare(s).all(...p),close:async()=>raw.close()};},runtime);
 const finance=createFinanceApplication(unit,runtime),debts=createDebtApplication(unit,runtime),cards=createCreditCardApplication(unit,runtime);
 try{
  const profile=await finance.initialProfile();
  const base=(extra={})=>({profileId:profile.id,idempotencyKey:randomUUID(),effectiveDate:'2026-10-10',description:'Synthetic',...extra});
  const bank=await finance.createAccount({...base(),name:'Bank',type:'bank',currency:'USD',availabilityPolicy:'free',initialBalanceMinor:120000});
  const person=await debts.createPerson({profileId:profile.id,idempotencyKey:randomUUID(),name:'Carlos',note:'Synthetic'});
  const categoryId=(await finance.snapshot(profile.id)).categories.find(c=>c.name==='Comida').id;
  const create=(originKind,initialMinor=10000,extra={})=>debts.create({...base(),personId:person.id,originKind,currency:'USD',initialMinor,concept:'Test debt',dueOn:null,notes:'',accountId:bank.id,categoryId,...extra});
  const settle=(debt,amountMinor=3000,extra={})=>debts.settle({...base({effectiveDate:'2026-10-15'}),debtId:debt.id,accountId:bank.id,amountMinor,full:false,...extra});
  const snapshot=()=>finance.snapshot(profile.id);const summary=async d=>(await debts.snapshot(profile.id)).find(row=>row.debt.id===d.id);
  await work({finance,debts,cards,unit,profile,bank,person,categoryId,base,create,settle,snapshot,summary,fail:fn=>fail=fn});
 }finally{fail=undefined;await unit.close();rmSync(dir,{recursive:true,force:true});}
}
const usd=data=>data.totals.find(row=>row.currency==='USD');
test('A loan given reduces bank/available and preserves total wealth',()=>fixture(async f=>{const d=await f.create('loan_given');const s=usd(await f.snapshot());assert.equal(s.physicalMinor,110000);assert.equal(s.availableMinor,110000);assert.equal(s.receivableMinor,10000);assert.equal(s.netWorthMinor,120000);assert.equal(s.netWorthLiquidMinor,110000);assert.equal(s.expenseMinor,0);assert.equal((await f.summary(d)).pendingMinor,10000);}));
test('B partial collection restores bank, is not income',()=>fixture(async f=>{const d=await f.create('loan_given');await f.settle(d,3000);const s=usd(await f.snapshot());assert.equal(s.physicalMinor,113000);assert.equal(s.availableMinor,113000);assert.equal(s.receivableMinor,7000);assert.equal(s.incomeMinor,0);assert.equal((await f.summary(d)).settledMinor,3000);}));
test('C existing payable is an opening, not monthly expense',()=>fixture(async f=>{const d=await f.create('existing_payable');const s=usd(await f.snapshot());assert.equal(s.physicalMinor,120000);assert.equal(s.availableMinor,110000);assert.equal(s.payableMinor,10000);assert.equal(s.expenseMinor,0);assert.equal((await f.summary(d)).status,'pendiente');}));
test('D borrowed money increases bank and liability equally',()=>fixture(async f=>{await f.create('loan_received');const s=usd(await f.snapshot());assert.equal(s.physicalMinor,130000);assert.equal(s.availableMinor,120000);assert.equal(s.netWorthMinor,120000);assert.equal(s.incomeMinor,0);}));
test('E principal repayment frees liability without new expense',()=>fixture(async f=>{const d=await f.create('existing_payable');await f.settle(d,3000);const s=usd(await f.snapshot());assert.equal(s.physicalMinor,117000);assert.equal(s.payableMinor,7000);assert.equal(s.availableMinor,110000);assert.equal(s.expenseMinor,0);}));
test('F financed purchase is one expense and repayment is no new expense',()=>fixture(async f=>{const d=await f.create('financed_expense',5000);let s=usd(await f.snapshot());assert.equal(s.physicalMinor,120000);assert.equal(s.payableMinor,5000);assert.equal(s.availableMinor,115000);assert.equal(s.expenseMinor,5000);await f.settle(d,5000);s=usd(await f.snapshot());assert.equal(s.physicalMinor,115000);assert.equal(s.availableMinor,115000);assert.equal(s.expenseMinor,5000);}));
test('G receivable never enters available cash',()=>fixture(async f=>{await f.create('loan_given',5000);const s=usd(await f.snapshot());assert.equal(s.receivableMinor,5000);assert.equal(s.availableMinor,s.physicalMinor);}));
test('H card and personal debt combine without duplicate commitment',()=>fixture(async f=>{const card=await f.cards.create({...f.base(),name:'Card',currency:'USD',limitMinor:20000,initialDebtMinor:10000,closingDay:15,dueDay:12,defaultAccountId:f.bank.id});assert.ok(card.id);await f.create('existing_payable',3000);const s=usd(await f.snapshot());assert.equal(s.physicalMinor,120000);assert.equal(s.cardDebtMinor,10000);assert.equal(s.payableMinor,3000);assert.equal(s.availableMinor,107000);}));
test('I/J partial and full settlement derive paid status',()=>fixture(async f=>{const d=await f.create('loan_given');await f.settle(d,3000);await f.settle(d,undefined,{full:true});const row=await f.summary(d);assert.equal(row.pendingMinor,0);assert.equal(row.status,'pagada');assert.equal(row.settledMinor,10000);await assert.rejects(f.settle(d,100),/principal/);}));
test('K overdue is derived from due date, paid overrides overdue',()=>fixture(async f=>{const d=await f.create('existing_payable',1000,{dueOn:'2026-10-11'});assert.equal((await f.summary(d)).status,'vencida');await f.settle(d,1000);assert.equal((await f.summary(d)).status,'pagada');}));
test('L reverses loan, collection, borrowed money, repayment, financed expense',()=>fixture(async f=>{for(const kind of ['loan_given','loan_received','existing_payable','financed_expense']){const d=await f.create(kind,1000);const payment=await f.settle(d,300);const reversed=await f.debts.reverse({...f.base({effectiveDate:'2026-10-16',description:'Correction'}),debtId:d.id,originalId:payment.id});assert.equal(reversed.reversalOf,payment.id);assert.equal((await f.summary(d)).pendingMinor,1000);const opening=(await f.summary(d)).history.find(row=>row.kind==='ORIGIN');await f.debts.reverse({...f.base({effectiveDate:'2026-10-17',description:'Cancel'}),debtId:d.id,originalId:opening.transactionId});assert.equal((await f.summary(d)).pendingMinor,0);assert.equal((await f.summary(d)).settledMinor,0);assert.equal((await f.summary(d)).status,'anulada');}const s=usd(await f.snapshot());assert.equal(s.physicalMinor,120000);assert.equal(s.expenseMinor,0);}));
test('reverse origin after collection rejects and preserves history',()=>fixture(async f=>{const d=await f.create('loan_given');await f.settle(d,3000);const before=await f.snapshot();await assert.rejects(f.debts.reverse({...f.base({effectiveDate:'2026-10-16',description:'Cancel'}),debtId:d.id,originalId:d.originTransactionId}),/inconsistente/);assert.deepEqual(await f.snapshot(),before);}));
test('M person, origin and payment idempotency',()=>fixture(async f=>{const personInput={profileId:f.profile.id,idempotencyKey:randomUUID(),name:'Juan',note:''};assert.equal((await f.debts.createPerson(personInput)).id,(await f.debts.createPerson(personInput)).id);const input=f.base();const d=await f.create('existing_payable',1000,input);assert.equal((await f.create('existing_payable',1000,input)).id,d.id);const paymentInput=f.base();const a=await f.settle(d,300,paymentInput),b=await f.settle(d,300,paymentInput);assert.equal(a.id,b.id);assert.equal((await f.summary(d)).pendingMinor,700);await assert.rejects(f.settle(d,301,paymentInput),/Clave/);}));
for(const operation of ['create','settle'])test(`N rollback after ${operation} ledger posting failure`,()=>fixture(async f=>{const before=await f.snapshot();f.fail(sql=>{if(sql.includes('INSERT INTO debt_events'))throw Error('Injected');});if(operation==='create')await assert.rejects(f.create('existing_payable'),/Injected/);else{f.fail(undefined);const d=await f.create('existing_payable');const middle=await f.snapshot();f.fail(sql=>{if(sql.includes('INSERT INTO debt_events'))throw Error('Injected');});await assert.rejects(f.settle(d,300),/Injected/);f.fail(undefined);assert.deepEqual(await f.snapshot(),middle);return;}f.fail(undefined);assert.deepEqual(await f.snapshot(),before);}));
test('O cross-profile person, debt and settlement are isolated',()=>fixture(async f=>{await assert.rejects(f.create('loan_given',1000,{personId:randomUUID()}),/Persona/);const d=await f.create('loan_given');await assert.rejects(f.debts.settle({...f.base({profileId:randomUUID()}),debtId:d.id,accountId:f.bank.id,amountMinor:100,full:false}),/perfil/);assert.equal((await f.summary(d)).pendingMinor,10000);}));
test('P pending is rebuilt from ledger across close/reopen',()=>fixture(async f=>{const d=await f.create('loan_given');await f.settle(d,3000);const before=await f.summary(d);await f.unit.close();const after=await f.summary(d);assert.deepEqual(after,before);const pending=await f.unit.execute(async r=>calculateDebtPending(d,await r.ledger.entries(f.profile.id)));assert.equal(pending,7000);}));
test('payments reject overpayment, insufficient funds and backdated settlement',()=>fixture(async f=>{const d=await f.create('existing_payable');await assert.rejects(f.settle(d,10001));await assert.rejects(f.settle(d,100,{effectiveDate:'2026-10-01'}),/inconsistente/);assert.equal((await f.summary(d)).pendingMinor,10000);}));
test('generic reversal cannot bypass debt history',()=>fixture(async f=>{const d=await f.create('financed_expense');await assert.rejects(f.finance.reverse({...f.base({description:'Correction'}),originalId:d.originTransactionId}),/Deudas/);}));
test('migration 003 preserves V2 rows and reenables FKs after a failed upgrade',async()=>{
 const { MIGRATION_001,migrateFinance }=await import('../src/database/finance/migrations.ts');
 const { MIGRATION_002 }=await import('../src/database/finance/migration002.ts');
 const raw=new DatabaseSync(':memory:');
 const db={exec:async sql=>raw.exec(sql),run:async(sql,p=[])=>raw.prepare(sql).run(...p),all:async(sql,p=[])=>raw.prepare(sql).all(...p)};
 try{
  raw.exec(MIGRATION_001);raw.exec('PRAGMA user_version=1');await migrateFinance(db,runtime.now());
  // Recreate a V2 database by rolling back only the new empty schema in a test-owned connection.
  raw.exec('PRAGMA foreign_keys=OFF');raw.exec('BEGIN');
  for(const name of ['debt_node_kind','debt_event_node'])raw.exec(`DROP TRIGGER ${name}`);
  for(const name of ['debt_events','debt_payments','debts','people'])raw.exec(`DROP TABLE ${name}`);
  raw.exec('DELETE FROM schema_migrations WHERE version=3');raw.exec('PRAGMA user_version=2');raw.exec('COMMIT');raw.exec('PRAGMA foreign_keys=ON');
  const existing=(await db.all('SELECT COUNT(*) AS n FROM credit_cards'))[0].n;
  const failing={...db,exec:async sql=>{raw.exec(sql);if(sql.includes('CREATE TABLE people'))throw Error('Injected migration 003');}};
  await assert.rejects(migrateFinance(failing,runtime.now()),/Injected/);
  assert.equal((await db.all('PRAGMA user_version'))[0].user_version,2);
  assert.equal((await db.all('PRAGMA foreign_keys'))[0].foreign_keys,1);
  assert.equal((await db.all("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='people'"))[0].n,0);
  assert.equal((await db.all('SELECT COUNT(*) AS n FROM credit_cards'))[0].n,existing);
  await migrateFinance(db,runtime.now());await migrateFinance(db,runtime.now());
  assert.equal((await db.all('PRAGMA user_version'))[0].user_version,3);
  assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);
 }finally{raw.close();}
});
test('interest remains a separate categorized expense, without changing principal',()=>fixture(async f=>{
 const debt=await f.create('existing_payable',5000);
 await f.finance.post({...f.base(),kind:'EXPENSE',accountId:f.bank.id,amountMinor:300,categoryId:f.categoryId});
 const s=usd(await f.snapshot());assert.equal(s.expenseMinor,300);assert.equal(s.payableMinor,5000);assert.equal((await f.summary(debt)).pendingMinor,5000);
}));
test('payable settlement cannot exceed bank balance, including protected confirmation',()=>fixture(async f=>{
 const d=await f.create('existing_payable',200000);const before=await f.snapshot();
 await assert.rejects(f.settle(d,120001),/Saldo insuficiente/);assert.deepEqual(await f.snapshot(),before);
 const protectedAccount=await f.finance.createAccount({...f.base(),name:'Protected',type:'savings',currency:'USD',availabilityPolicy:'protected',initialBalanceMinor:10000});
 await assert.rejects(f.settle(d,1000,{accountId:protectedAccount.id}),/protegidos/);
 await f.settle(d,1000,{accountId:protectedAccount.id,allowProtected:true});
 assert.equal((await f.summary(d)).pendingMinor,199000);
}));
