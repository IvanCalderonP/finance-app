import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { calculateAccountBalance, calculateAvailableBalance, calculatePhysicalBalance, calculateNetWorth } from '../src/financial-engine/calculations.ts';
import { registerOpeningBalance, registerIncome, registerExpense, registerDailyExpenseWithdrawal, transferBetweenAccounts, reverseTransaction, replaceExpenseSplits, registerAdjustment } from '../src/financial-engine/commands.ts';
const profileId = randomUUID();
const account = (policy='free',type='bank') => ({ id: randomUUID(), profileId, name:'Synthetic',currency:'USD',type,availabilityPolicy:policy,active:true,nodeId:randomUUID(),createdAt:'2026-10-12T00:00:00Z' });
const bank = account(), saving=account('protected','savings'), secondary=account(), cash=account('free','cash');
const node = kind => ({ id:randomUUID(),profileId,currency:'USD',kind });
const equity=node('EQUITY'),income=node('INCOME'),expense=node('EXPENSE');
const ctx = () => ({ id:randomUUID(),profileId,idempotencyKey:randomUUID(),effectiveDate:'2026-10-12',createdAt:'2026-10-12T00:00:00Z',description:'Synthetic test' });
const cat=randomUUID();
const initial=registerOpeningBalance(ctx(),bank,120000,equity);
function balances(entries,accounts=[bank]) { return accounts.map(account=>({account,balanceMinor:calculateAccountBalance(account,entries)})); }
function check(entries,expected,accounts=[bank]) {
 const b=balances(entries,accounts);
 assert.equal(calculatePhysicalBalance(b,'USD'),expected.physical);
 assert.equal(calculateAvailableBalance(b,'USD'),expected.available);
 assert.equal(calculateNetWorth(b,'USD'),expected.netWorth);
}
test('A: opening 1200 yields physical, available and net worth 1200',()=>check(initial.entries,{physical:120000,available:120000,netWorth:120000}));
test('B: protected 200 is wealth but not available',()=> {
 const entries=[...initial.entries,...registerOpeningBalance(ctx(),saving,20000,equity).entries];
 check(entries,{physical:140000,available:120000,netWorth:140000},[bank,saving]);
});
test('C: income 1000 increases all balances',()=> {
 const tx=registerIncome(ctx(),bank,100000,income,cat);
 check([...initial.entries,...tx.entries],{physical:220000,available:220000,netWorth:220000});
});
test('D: expense 20 updates category and reduces all balances',()=> {
 const tx=registerExpense(ctx(),bank,2000,expense,cat,120000);
 assert.deepEqual(tx.splits,[{categoryId:cat,amountMinor:2000}]);
 check([...initial.entries,...tx.entries],{physical:118000,available:118000,netWorth:118000});
});
test('E: transfer between free accounts creates no income or expense',()=> {
 const tx=transferBetweenAccounts(ctx(),bank,secondary,5000,120000);
 assert.deepEqual(tx.splits,[]);
 check([...initial.entries,...tx.entries],{physical:120000,available:120000,netWorth:120000},[bank,secondary]);
 assert.equal(calculateAccountBalance(bank,[...initial.entries,...tx.entries]),115000);
 assert.equal(calculateAccountBalance(secondary,tx.entries),5000);
});
test('F: daily withdrawal is expense, without cash credit',()=> {
 const tx=registerDailyExpenseWithdrawal(ctx(),bank,5000,expense,cat,120000);
 assert.equal(tx.type,'EXPENSE');assert.equal(tx.subtype,'daily');assert.equal(tx.splits[0].amountMinor,5000);
 check([...initial.entries,...tx.entries],{physical:115000,available:115000,netWorth:115000});
 assert.equal(calculateAccountBalance(cash,tx.entries),0);
});
test('G: split 20+20+10 replaces classification without changing entries or total',()=> {
 const tx=registerDailyExpenseWithdrawal(ctx(),bank,5000,expense,cat,120000);
 const entries=structuredClone(tx.entries);
 const splits=replaceExpenseSplits(tx,[{categoryId:randomUUID(),amountMinor:2000},{categoryId:randomUUID(),amountMinor:2000},{categoryId:randomUUID(),amountMinor:1000}]);
 assert.equal(splits.reduce((sum,row)=>sum+row.amountMinor,0),5000);assert.deepEqual(tx.entries,entries);
 assert.throws(()=>replaceExpenseSplits(tx,[{categoryId:cat,amountMinor:10000}]));
});
for(const daily of [false,true]) test(daily?'I: reverse daily withdrawal':'H: reverse expense',()=> {
 const tx=(daily?registerDailyExpenseWithdrawal:registerExpense)(ctx(),bank,5000,expense,cat,120000);
 const reversed=reverseTransaction(ctx(),tx);assert.equal(reversed.reversalOf,tx.id);assert.equal(reversed.splits[0].amountMinor,-5000);
 check([...initial.entries,...tx.entries,...reversed.entries],{physical:120000,available:120000,netWorth:120000});
});
test('L: balance reconstruction is based on ledger, including reversals',()=> {
 const tx=registerIncome(ctx(),bank,100000,income,cat);const spend=registerExpense(ctx(),bank,2000,expense,cat,220000);
 check([...initial.entries,...tx.entries,...spend.entries,...reverseTransaction(ctx(),spend).entries],{physical:220000,available:220000,netWorth:220000});
});
test('optional cash transfer follows normal transfer accounting',()=> {
 const tx=transferBetweenAccounts(ctx(),bank,cash,5000,120000);
 assert.equal(calculateAccountBalance(cash,tx.entries),5000);assert.deepEqual(tx.splits,[]);
});
test('free to protected changes availability but conserves physical and wealth',()=> {
 const tx=transferBetweenAccounts(ctx(),bank,saving,5000,120000);
 check([...initial.entries,...tx.entries],{physical:120000,available:115000,netWorth:120000},[bank,saving]);
});
test('invalid amounts, profile, currency, protected funds and insufficient balance reject',()=> {
 for(const value of [0,-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>registerExpense(ctx(),bank,value,expense,cat,120000));
 assert.throws(()=>registerExpense(ctx(),bank,130000,expense,cat,120000));
 assert.throws(()=>registerExpense(ctx(),saving,1,expense,cat,20000));
 assert.throws(()=>transferBetweenAccounts(ctx(),bank,{...secondary,currency:'EUR'},1,120000));
 assert.throws(()=>registerIncome({...ctx(),profileId:randomUUID()},bank,1,income,cat));
 assert.throws(()=>registerIncome({...ctx(),effectiveDate:'2026-02-30'},bank,1,income,cat));
});
test('future commitment projection accepts overlap without double deduction',()=> {
 const b=[{account:bank,balanceMinor:120000},{account:saving,balanceMinor:20000}];
 const id=randomUUID();assert.equal(calculateAvailableBalance(b,'USD',[{id,currency:'USD',amountMinor:20000,alreadyExcludedMinor:20000}]),120000);
 assert.throws(()=>calculateAvailableBalance(b,'USD',[{id,currency:'USD',amountMinor:1,alreadyExcludedMinor:0},{id,currency:'USD',amountMinor:1,alreadyExcludedMinor:0}]));
});
test('negative protected balance is visible as a deficit; currency totals stay separate',()=> {
 assert.equal(calculateAvailableBalance([{account:saving,balanceMinor:-100}],'USD'),-100);
 assert.equal(calculatePhysicalBalance([{account:{...bank,currency:'EUR'},balanceMinor:100}],'USD'),0);
});
test('adjustments require reason and are not income/expense',()=> {
 const tx=registerAdjustment(ctx(),bank,-200,equity);assert.equal(tx.type,'ADJUSTMENT');assert.deepEqual(tx.splits,[]);
 assert.throws(()=>registerAdjustment({...ctx(),description:''},bank,1,equity));
});
test('money parses cents exactly, rejects fractions and overflow, formats integers',async()=>{
 const {parseAmountMinor,formatAmountMinor}=await import('../src/financial-engine/money.ts');
 assert.equal(parseAmountMinor('0.75'),75);assert.equal(parseAmountMinor('50'),5000);assert.equal(parseAmountMinor('20,20'),2020);
 assert.equal(parseAmountMinor('-20.20',true),-2020);assert.equal(formatAmountMinor(75,'USD'),'USD 0.75');
 for(const invalid of ['1.001','1e3','Infinity','-1','1,000.00','900719925474099.99'])assert.throws(()=>parseAmountMinor(invalid));
});
test('balance calculation rejects fractional ledger inputs even when they cancel',()=>{
 assert.throws(()=>calculateAccountBalance(bank,[{nodeId:bank.nodeId,debitMinor:0.1,creditMinor:0.1}]));
});
