import { Platform } from 'react-native';
import { reminderDiff, reminderPlan } from './plan';
import type { NotificationMapping } from '../finance/insights-contracts';
export interface ReminderSyncResult {scheduled:number;supported:boolean;permission:'granted'|'denied'|'undetermined';message?:string}
let tail:Promise<unknown>=Promise.resolve();let pending:ReturnType<typeof setTimeout>|undefined;let lastError='';
export function reminderStatus(){return lastError;}
export function syncLocalReminders(profileId:string,options:{requestPermission?:boolean}={}):Promise<ReminderSyncResult>{
 const next=tail.then(()=>sync(profileId,options));tail=next.catch(()=>undefined);return next;
}
async function sync(profileId:string,options:{requestPermission?:boolean}):Promise<ReminderSyncResult>{
 if(Platform.OS==='web')return {scheduled:0,supported:false,permission:'undetermined',message:'Los recordatorios se guardaron. Las notificaciones locales funcionan en Android/iOS; web muestra el calendario.'};
 try{
  const Notifications=await import('expo-notifications');
  Notifications.setNotificationHandler({handleNotification:async()=>({shouldPlaySound:true,shouldSetBadge:false,shouldShowBanner:true,shouldShowList:true})});
  if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('financial-reminders',{name:'Recordatorios financieros',importance:Notifications.AndroidImportance.DEFAULT});
  let permission=await Notifications.getPermissionsAsync();if(!permission.granted&&options.requestPermission)permission=await Notifications.requestPermissionsAsync();
  if(!permission.granted)return {scheduled:0,supported:true,permission:permission.status==='denied'?'denied':'undetermined',message:'Recordatorios guardados. Activa el permiso de notificaciones para recibirlos.'};
  const {insights}=await import('../finance/runtime');
  const [jobs,mappings,native]=await Promise.all([insights.reminderJobs(profileId),insights.mappings(profileId),Notifications.getAllScheduledNotificationsAsync()]);
  const planned=reminderPlan(profileId,jobs,new Date());const nativeIds=new Set(native.map(row=>row.identifier));
  const diff=reminderDiff(planned,mappings,new Set([...nativeIds].filter(id=>id.startsWith(`finance:${profileId}:`))));
  for(const identifier of diff.cancel)await Notifications.cancelScheduledNotificationAsync(identifier);
  for(const item of diff.schedule)await Notifications.scheduleNotificationAsync({identifier:item.identifier,content:{title:item.job.title,body:item.job.body,data:{url:item.job.route,finance:true},sound:true},trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:item.at,channelId:'financial-reminders'}});
  const updated:NotificationMapping[]=planned.map(item=>({eventKey:item.job.eventKey,offsetDays:item.job.offsetDays,notificationId:item.identifier,date:item.at.toISOString(),signature:item.signature}));
  const order=(rows:NotificationMapping[])=>JSON.stringify([...rows].sort((a,b)=>a.notificationId.localeCompare(b.notificationId)));
  if(order(updated)!==order(mappings))await insights.replaceMappings(profileId,updated);
  lastError='';return {scheduled:updated.length,supported:true,permission:'granted',message:`Recordatorios activos: ${updated.length}. Se programan a las 9:00 y funcionan sin internet.`};
 }catch(error){lastError=error instanceof Error?error.message:'No se pudieron programar los recordatorios';return {scheduled:0,supported:true,permission:'undetermined',message:`No se pudo sincronizar: ${lastError}`};}
}
/** Debounced after committed writes; never asks permission in the background. */
export function queueReminderRefresh(){if(Platform.OS==='web')return;if(pending)clearTimeout(pending);pending=setTimeout(()=>{pending=undefined;void import('../finance/runtime').then(async({finance})=>{const profile=await finance.initialProfile();await syncLocalReminders(profile.id);}).catch(error=>{lastError=error instanceof Error?error.message:'No se pudo sincronizar';});},350);}
