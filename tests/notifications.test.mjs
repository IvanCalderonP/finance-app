import test from 'node:test';
import assert from 'node:assert/strict';
import { reminderPlan, reminderDiff } from '../src/services/notifications/plan.ts';

const job=(eventKey,date,offsetDays=0,title='Recibo')=>({eventKey,date,offsetDays,title,body:'Pago previsto',route:'/bills'});
const now=()=>new Date('2026-10-13T08:30:00');
const mapping=item=>({eventKey:item.job.eventKey,offsetDays:item.job.offsetDays,notificationId:item.identifier,date:item.at.toISOString(),signature:item.signature});

test('only future local 9:00 reminders are selected, in date order with stable IDs',()=>{
 const plan=reminderPlan('local',[job('late','2026-10-15'),job('today','2026-10-13'),job('past','2026-10-12'),job('today','2026-10-13')],now());
 assert.deepEqual(plan.map(row=>row.job.eventKey),['today','late']);
 assert.equal(plan[0].at.getHours(),9);
 assert.equal(plan[0].identifier,'finance:local:today:0');
 assert.equal(reminderPlan('local',[job('today','2026-10-13')],new Date('2026-10-13T09:00:00')).length,0);
});
test('native pending budget caps earliest reminders without losing ordering',()=>{
 const jobs=Array.from({length:65},(_,i)=>job(`event-${i}`,'2026-10-14',i));
 assert.equal(reminderPlan('local',jobs,now()).length,60);
 assert.deepEqual(reminderPlan('local',jobs,now(),2).map(row=>row.job.eventKey),['event-0','event-1']);
});
test('unchanged native reminders survive a refresh without cancellation',()=>{
 const plan=reminderPlan('local',[job('bill','2026-10-20')],now());
 assert.deepEqual(reminderDiff(plan,plan.map(mapping),new Set([plan[0].identifier])),{schedule:[],cancel:[]});
});
test('date or content changes cancel and reschedule the same stable ID',()=>{
 const old=reminderPlan('local',[job('bill','2026-10-20')],now());
 for(const edited of [job('bill','2026-10-21'),job('bill','2026-10-20',0,'Nuevo nombre')]){
  const next=reminderPlan('local',[edited],now());const diff=reminderDiff(next,old.map(mapping),new Set([old[0].identifier]));
  assert.equal(diff.schedule.length,1);assert.deepEqual(diff.cancel,[old[0].identifier]);
 }
});
test('completed/deleted items cancel; missing native requests recover; foreign IDs stay',()=>{
 const plan=reminderPlan('local',[job('bill','2026-10-20')],now());
 assert.deepEqual(reminderDiff([],plan.map(mapping),new Set([plan[0].identifier])).cancel,[plan[0].identifier]);
 assert.equal(reminderDiff(plan,plan.map(mapping),new Set()).schedule.length,1);
 const stray=reminderDiff([],[],new Set(['finance:local:stray:0','unrelated-app-id']));
 assert.deepEqual(stray.cancel,['finance:local:stray:0']);
});
