import { Tabs } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette } from '@/components/ui';
const icons:Record<string,string>={index:'◉',accounts:'▤',transactions:'↔',cards:'▰',debts:'⇄'};
function FinanceTabs(){const insets=useSafeAreaInsets();return <><StatusBar style="dark"/><Tabs screenOptions={({route})=>({headerShown:false,tabBarActiveTintColor:palette.primary,tabBarInactiveTintColor:palette.muted,tabBarStyle:{backgroundColor:palette.white,borderTopColor:palette.border,height:64+insets.bottom,paddingTop:8,paddingBottom:8+insets.bottom},tabBarLabelStyle:{fontSize:10,fontWeight:'700',marginBottom:5},tabBarIcon:({color})=><Text style={{fontSize:22,color}}>{icons[route.name]??'○'}</Text>})}>
<Tabs.Screen name="index" options={{title:'Inicio'}}/><Tabs.Screen name="accounts" options={{title:'Cuentas'}}/><Tabs.Screen name="transactions" options={{title:'Movimientos'}}/><Tabs.Screen name="cards" options={{title:'Tarjetas'}}/><Tabs.Screen name="debts" options={{title:'Deudas'}}/><Tabs.Screen name="storage-lab" options={{href:null}}/>
</Tabs></>;}
export default function RootLayout(){return <SafeAreaProvider><FinanceTabs/></SafeAreaProvider>;}
