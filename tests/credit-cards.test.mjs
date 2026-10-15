import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqliteUnitOfWork } from '../src/database/finance/repositories.ts';
import { createFinanceApplication } from '../src/services/finance/application.ts';
import { createCreditCardApplication } from '../src/services/finance/card-application.ts';
import { cycleForDate,calculateCreditCardDebt } from '../src/financial-engine/cards.ts';
const runtime={id:randomUUID,now:()=> '2026-10-20T12:00:00.000Z'};
async function fixture(work,initial=10000) {
 const dir=mkdtempSync(join(tmpdir(),'cards-'));let fail;
 const unit=createSqliteUnitOfWork(async()=>{const db=new DatabaseSync(join(dir,'db'));return {exec:async s=>db.exec(s),run:async(s,p=[])=>{fail?.(s);db.prepare(s).run(...p);},all:async(s,p=[])=>db.prepare(s).all(...p),close:async()=>db.close()};},runtime);
 const finance=createFinanceApplication(unit,runtime),cards=createCreditCardApplication(unit,runtime);
 try {
 const profile=await finance.initialProfile();const base=(extra={})=>({profileId:profile.id,idempotencyKey:randomUUID(),effectiveDate:'2026-09-10',description:'Synthetic',...extra});
 const bank=await finance.createAccount({...base(),name:'Bank',type:'bank',currency:'USD',availabilityPolicy:'free',initialBalanceMinor:120000});
 const card=await cards.create({...base(),name:'Card',currency:'USD',limitMinor:20000,initialDebtMinor:initial,closingDay:15,dueDay:12,defaultAccountId:bank.id});
 const categoryId=(await finance.snapshot(profile.id)).categories.find(c=>c.name==='Comida').id;
 const purchase=(amountMinor=2000,extra={})=>cards.purchase({...base(),cardId:card.id,amountMinor,categoryId,...extra});
 const pay=(amountMinor=2000,extra={})=>cards.pay({...base({effectiveDate:'2026-10-20'}),cardId:card.id,accountId:bank.id,full:false,amountMinor,...extra});
 const snapshot=()=>finance.snapshot(profile.id);const summary=async()=>(await cards.snapshot(profile.id))[0];
 await work({finance,cards,unit,profile,bank,card,base,purchase,pay,snapshot,summary,categoryId,fail:fn=>fail=fn});
 } finally {fail=undefined;await unit.close();rmSync(dir,{recursive:true,force:true});}
}
const usd=s=>s.totals.find(t=>t.currency==='USD');
test('A/G opening debt commits cash without an expense',()=>fixture(async({snapshot,summary})=>{const s=usd(await snapshot());assert.equal(s.physicalMinor,120000);assert.equal(s.availableMinor,110000);assert.equal(s.expenseMinor,0);assert.equal((await summary()).availableCreditMinor,10000);}));
test('B purchase spends category and wealth without withdrawing bank cash',()=>fixture(async({purchase,snapshot})=>{await purchase();const s=usd(await snapshot());assert.equal(s.physicalMinor,120000);assert.equal(s.cardDebtMinor,12000);assert.equal(s.availableMinor,108000);assert.equal(s.expenseMinor,2000);assert.equal(s.netWorthMinor,108000);}));
test('C payment reduces cash and liability without new expense',()=>fixture(async({purchase,pay,snapshot})=>{await purchase();await pay();const s=usd(await snapshot());assert.equal(s.physicalMinor,118000);assert.equal(s.cardDebtMinor,10000);assert.equal(s.availableMinor,108000);assert.equal(s.expenseMinor,2000);}));
test('D partial payment restores credit',()=>fixture(async({pay,summary})=>{await pay(5000);assert.equal((await summary()).debtMinor,5000);assert.equal((await summary()).availableCreditMinor,15000);}));
test('E total payment uses exact pending amount and is idempotent',()=>fixture(async({pay,base,summary,snapshot})=>{const input={...base(),full:true};const a=await pay(undefined,input);const b=await pay(undefined,input);assert.equal(a.id,b.id);assert.equal((await summary()).debtMinor,0);assert.equal(usd(await snapshot()).physicalMinor,110000);}));
test('F above limit rejects the whole transaction',()=>fixture(async({purchase,snapshot})=>{const before=await snapshot();await assert.rejects(purchase(10001),/límite/);assert.deepEqual(await snapshot(),before);}));
test('H inclusive cutoff',()=>assert.equal(cycleForDate('2026-10-15',15,12).closesOn,'2026-10-15'));
test('I day after cutoff',()=>assert.equal(cycleForDate('2026-10-16',15,12).closesOn,'2026-11-15'));
test('J invalid month day clamps and respects leap years',()=>{assert.equal(cycleForDate('2026-02-28',31,31).closesOn,'2026-02-28');assert.equal(cycleForDate('2024-02-29',31,12).closesOn,'2024-02-29');assert.equal(cycleForDate('2026-10-15',15,12).dueOn,'2026-11-12');});
test('K FIFO payment spans multiple cycles with stored applications',()=>fixture(async({purchase,pay,summary})=>{await purchase(8000,{effectiveDate:'2026-10-10'});await pay(10000);const s=await summary();assert.deepEqual(s.cycles.map(c=>c.pendingMinor),[0,4000]);assert.equal(s.data.applications.length,2);assert.equal(s.debtMinor,4000);},6000));
test('L full purchase reversal preserves trace and restores all projections',()=>fixture(async({purchase,cards,base,card,snapshot,summary})=>{const tx=await purchase();await cards.reversePurchase({...base(),cardId:card.id,originalId:tx.id});assert.equal(usd(await snapshot()).expenseMinor,0);assert.equal((await summary()).debtMinor,10000);assert.equal(usd(await snapshot()).availableMinor,110000);assert.ok((await snapshot()).transactions.some(t=>t.reversalOf===tx.id));}));
test('M duplicate purchase has one expense and cycle entry',()=>fixture(async({purchase,base,summary})=>{const input=base();assert.equal((await purchase(2000,input)).id,(await purchase(2000,input)).id);assert.equal((await summary()).data.charges.length,2);await assert.rejects(purchase(2001,input),/clave/);}));
test('N duplicate payment has one set of applications',()=>fixture(async({pay,base,summary})=>{const input=base();assert.equal((await pay(2000,input)).id,(await pay(2000,input)).id);const s=await summary();assert.equal(s.data.payments.length,1);assert.equal(s.data.applications.length,1);}));
for(const operation of ['purchase','pay']) test(`O ${operation} injected late failure rolls back ledger and metadata`,()=>fixture(async f=>{const before=await f.snapshot();f.fail(sql=>{if(sql.includes('INSERT INTO credit_card_')&&sql.includes(operation==='purchase'?'cycle_entries':'payment_applications'))throw Error('Injected');});await assert.rejects(f[operation](),/Injected/);f.fail(undefined);assert.deepEqual(await f.snapshot(),before);}));
test('P debt reconstructs from ledger and survives closing/reopening',()=>fixture(async({purchase,pay,unit,summary,profile,card})=>{await purchase();await pay();const before=await summary();await unit.close();assert.deepEqual(await summary(),before);assert.equal(await unit.execute(async r=>calculateCreditCardDebt(card,await r.ledger.entries(profile.id))),before.debtMinor);}));
test('manual cycle correction changes no financial transaction',()=>fixture(async({purchase,cards,card,base,profile,snapshot,summary})=>{const tx=await purchase(2000,{effectiveDate:'2026-10-16'});const before=await snapshot();await cards.reassignCycle({profileId:profile.id,cardId:card.id,originalId:tx.id,cycleDate:'2026-10-15',reason:'Bank correction'});const after=await snapshot();assert.deepEqual(after.transactions,before.transactions);assert.deepEqual(after.totals,before.totals);assert.equal((await summary()).data.charges.find(c=>c.transactionId===tx.id).cycleId,(await summary()).cycles.find(c=>c.closesOn==='2026-10-15').id);}));
test('last-cut balance differs from current debt and later purchases',()=>fixture(async({purchase,pay,summary})=>{await purchase(2000,{effectiveDate:'2026-10-16'});await pay(3000);const s=await summary();assert.equal(s.lastClosingBalanceMinor,10000);assert.equal(s.debtMinor,9000);assert.equal(s.purchasesAfterClosingMinor,2000);assert.equal(s.paymentsMinor,3000);}));
test('overpayment and insufficient cash reject fully',()=>fixture(async({pay,snapshot})=>{const before=await snapshot();await assert.rejects(pay(10001));assert.deepEqual(await snapshot(),before);}));
test('generic reversals cannot bypass card applications',()=>fixture(async({purchase,finance,base})=>{const tx=await purchase();await assert.rejects(finance.reverse({...base(),originalId:tx.id}),/Tarjetas/);}));
test('reversal after partial payment reallocates FIFO and reconciles',()=>fixture(async({purchase,pay,cards,base,card,summary})=>{const tx=await purchase(2000,{effectiveDate:'2026-10-10'});await pay(3000);await cards.reversePurchase({...base({effectiveDate:'2026-10-20'}),cardId:card.id,originalId:tx.id});assert.equal((await summary()).debtMinor,7000);}));

test('migration upgrades populated V1, preserves ledger and enforces FKs',async()=>{
 const { MIGRATION_001,migrateFinance }=await import('../src/database/finance/migrations.ts');
 const raw=new DatabaseSync(':memory:');const db={exec:async s=>raw.exec(s),run:async(s,p=[])=>raw.prepare(s).run(...p),all:async(s,p=[])=>raw.prepare(s).all(...p)};
 try {
 raw.exec('PRAGMA foreign_keys=ON');raw.exec(MIGRATION_001);raw.exec('PRAGMA user_version=1');raw.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(runtime.now());
 const r=await import('../src/database/finance/repositories.ts');const repos=r.sqliteRepositories(db,runtime);const profile=await repos.profiles.initial();
 const node={id:randomUUID(),profileId:profile.id,currency:'USD',kind:'ASSET'};await repos.ledger.insertNode(node);
 const {registerOpeningBalance}=await import('../src/financial-engine/commands.ts');const opening=registerOpeningBalance({id:randomUUID(),profileId:profile.id,idempotencyKey:randomUUID(),effectiveDate:'2026-09-10',createdAt:runtime.now(),description:'Synthetic'}, {...node,nodeId:node.id,active:true,availabilityPolicy:'free',type:'bank',name:'Synthetic'},12345,await repos.ledger.systemNode(profile.id,'USD','EQUITY'));
 await repos.transactions.insert(opening,'synthetic');const before=await repos.ledger.entries(profile.id);
 await migrateFinance(db,runtime.now());await migrateFinance(db,runtime.now());
 assert.deepEqual(await repos.ledger.entries(profile.id),before);assert.equal((await db.all('PRAGMA user_version'))[0].user_version,7);assert.equal((await db.all('PRAGMA foreign_keys'))[0].foreign_keys,1);assert.deepEqual(await db.all('PRAGMA foreign_key_check'),[]);
 await assert.rejects(db.run('INSERT INTO ledger_nodes VALUES(?,?,?,?,?,?)',[randomUUID(),randomUUID(),'USD','LIABILITY',null,runtime.now()]),/FOREIGN KEY/);
 } finally {raw.close();}
});
test('failed V2 migration rolls back schema, version and reenables FKs',async()=>{
 const { MIGRATION_001,migrateFinance }=await import('../src/database/finance/migrations.ts');const raw=new DatabaseSync(':memory:');raw.exec(MIGRATION_001);raw.exec('PRAGMA user_version=1');
 const db={exec:async s=>{raw.exec(s);if(s.includes('CREATE TABLE credit_cards'))throw Error('Injected migration');},run:async(s,p=[])=>raw.prepare(s).run(...p),all:async(s,p=[])=>raw.prepare(s).all(...p)};
 try {await assert.rejects(migrateFinance(db,runtime.now()),/Injected/);assert.equal((await db.all('PRAGMA user_version'))[0].user_version,1);assert.equal((await db.all('PRAGMA foreign_keys'))[0].foreign_keys,1);assert.equal((await db.all("SELECT count(*) AS n FROM sqlite_master WHERE name='credit_cards'"))[0].n,0);assert.ok((await db.all("SELECT sql FROM sqlite_master WHERE name='ledger_nodes'"))[0].sql.includes("'EXPENSE'"));}finally{raw.close();}
});
test('protected payment needs confirmation and currency mismatch fails',()=>fixture(async({finance,cards,base,card,profile,snapshot})=>{
 const protectedAccount=await finance.createAccount({...base(),name:'Protected',type:'savings',currency:'USD',availabilityPolicy:'protected',initialBalanceMinor:10000});
 const input={...base({effectiveDate:'2026-10-20'}),cardId:card.id,accountId:protectedAccount.id,full:false,amountMinor:2000};
 await assert.rejects(cards.pay(input),/protegidos/);await cards.pay({...input,allowProtected:true});
 const euro=await finance.createAccount({...base(),name:'Euro',type:'bank',currency:'EUR',availabilityPolicy:'free',initialBalanceMinor:10000});
 await assert.rejects(cards.pay({...input,idempotencyKey:randomUUID(),accountId:euro.id}),/moneda/);
 const totals=(await snapshot()).totals;assert.equal(totals.find(t=>t.currency==='EUR').cardDebtMinor,0);
}));
test('paid purchase refund cannot silently create unsupported creditor balance',()=>fixture(async({purchase,pay,cards,card,base,snapshot})=>{
 const tx=await purchase();await pay(undefined,{full:true});const before=await snapshot();await assert.rejects(cards.reversePurchase({...base({effectiveDate:'2026-10-20'}),cardId:card.id,originalId:tx.id}),/acreedor/);assert.deepEqual(await snapshot(),before);
}));
test('payment before debt date rolls back completely',()=>fixture(async({pay,snapshot})=>{const before=await snapshot();await assert.rejects(pay(100,{effectiveDate:'2026-09-01'}),/historial/);assert.deepEqual(await snapshot(),before);}));
test('multiple cards contribute independently and cross-profile mutations fail',()=>fixture(async({cards,base,profile,card,snapshot,purchase})=>{
 await cards.create({...base(),name:'Second',currency:'USD',limitMinor:30000,initialDebtMinor:5000,closingDay:31,dueDay:12,defaultAccountId:null});
 assert.equal(usd(await snapshot()).cardDebtMinor,15000);await assert.rejects(purchase(100,{profileId:randomUUID()}),/perfil/);assert.equal((await cards.snapshot(profile.id)).find(c=>c.card.id===card.id).debtMinor,10000);
}));
