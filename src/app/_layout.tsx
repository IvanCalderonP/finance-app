import { Tabs, router } from 'expo-router';
import type { Href } from 'expo-router';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { AppState, Platform, Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppearanceProvider, useAppearance } from '@/components/appearance';
import { queueReminderRefresh } from '@/services/notifications';
const icons:Record<string,string>={index:'◉',transactions:'↔',calendar:'▦',goals:'◎',more:'⋯'};
function FinanceTabs(){const insets=useSafeAreaInsets();const {colors,dark}=useAppearance();
 useEffect(()=>{queueReminderRefresh();const listener=AppState.addEventListener('change',state=>{if(state==='active')queueReminderRefresh();});let response:{remove:()=>void}|undefined;let disposed=false;
 if(Platform.OS!=='web')void import('expo-notifications').then(async notifications=>{if(disposed)return;const open=(url:unknown)=>{if(typeof url==='string'&&/^\/(calendar|transactions|cards|debts|goals|bills)(?:\?|$)/.test(url)){router.push(url as Href);return true;}return false;};response=notifications.addNotificationResponseReceivedListener(value=>{if(open(value.notification.request.content.data?.url))notifications.clearLastNotificationResponse();});const last=await notifications.getLastNotificationResponseAsync();if(!disposed&&last&&open(last.notification.request.content.data?.url))notifications.clearLastNotificationResponse();}).catch(()=>{});
 return()=>{disposed=true;listener.remove();response?.remove();};},[]);
 return <><StatusBar style={dark?'light':'dark'}/><Tabs screenOptions={({route})=>({headerShown:false,tabBarActiveTintColor:colors.primary,tabBarInactiveTintColor:colors.muted,tabBarStyle:{backgroundColor:colors.white,borderTopColor:colors.border,height:76+insets.bottom,paddingTop:8,paddingBottom:8+insets.bottom},tabBarLabelStyle:{fontSize:10,lineHeight:15,fontWeight:'700',marginBottom:0},tabBarIcon:({color})=><Text style={{fontSize:22,color}}>{icons[route.name]??'○'}</Text>})}>
 <Tabs.Screen name="index" options={{title:'Inicio'}}/><Tabs.Screen name="transactions" options={{title:'Movimientos'}}/><Tabs.Screen name="calendar" options={{title:'Calendario'}}/><Tabs.Screen name="goals" options={{title:'Metas'}}/><Tabs.Screen name="more" options={{title:'Más'}}/>
 {['accounts','cards','debts','storage-lab','budgets','reserves','bills','distribution','statistics','categories'].map(name=><Tabs.Screen key={name} name={name} options={{href:null}}/>)}</Tabs></>;
}
export default function RootLayout(){return <AppearanceProvider><SafeAreaProvider><FinanceTabs/></SafeAreaProvider></AppearanceProvider>;}
