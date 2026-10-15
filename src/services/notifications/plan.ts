import type { ReminderJob } from '../../financial-engine/financial-calendar.ts';
import type { NotificationMapping } from '../finance/insights-contracts.ts';
export interface PlannedReminder {job:ReminderJob;identifier:string;signature:string;at:Date}
export function reminderPlan(profileId:string,jobs:ReminderJob[],now:Date,maxPending=60):PlannedReminder[]{
 const seen=new Set<string>();return jobs.map(job=>({job,at:new Date(`${job.date}T09:00:00`)})).filter(({job,at})=>{const key=`${job.eventKey}:${job.offsetDays}`;if(seen.has(key)||Number.isNaN(at.getTime())||at<=now)return false;seen.add(key);return true;}).sort((a,b)=>a.at.getTime()-b.at.getTime()||a.job.eventKey.localeCompare(b.job.eventKey)).slice(0,maxPending).map(({job,at})=>({job,at,identifier:`finance:${profileId}:${job.eventKey}:${job.offsetDays}`,signature:JSON.stringify([at.toISOString(),job.title,job.body,job.route])}));
}
export function reminderDiff(planned:PlannedReminder[],mappings:NotificationMapping[],nativeIds:Set<string>){
 const schedule=planned.filter(item=>!mappings.some(row=>row.eventKey===item.job.eventKey&&row.offsetDays===item.job.offsetDays&&row.signature===item.signature&&row.notificationId===item.identifier&&nativeIds.has(row.notificationId)));
 const wanted=new Set(planned.map(item=>item.identifier));const cancel=new Set(mappings.filter(row=>!wanted.has(row.notificationId)||schedule.some(item=>item.identifier===row.notificationId)).map(row=>row.notificationId));
 for(const id of nativeIds)if(id.startsWith('finance:')&&!wanted.has(id))cancel.add(id);
 return {schedule,cancel:[...cancel]};
}
