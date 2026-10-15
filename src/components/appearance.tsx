import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable as NativePressable, ScrollView as NativeScrollView, Text as NativeText, TextInput as NativeTextInput, View as NativeView, StyleSheet, useColorScheme } from 'react-native';
import type { PressableProps, PressableStateCallbackType, ScrollViewProps, TextProps, TextInputProps, ViewProps } from 'react-native';
import type { AppPreferences } from '../financial-engine/model';
const light={bg:'#F4F6F3',ink:'#142D2C',muted:'#62736A',primary:'#177D63',border:'#E2E8E2',white:'#FFFFFF',soft:'#E8F2EC',danger:'#B5473C',amber:'#A56E20'};
const dark={bg:'#101C19',ink:'#E0EDE5',muted:'#A4B6AB',primary:'#63CFAB',border:'#33483E',white:'#1B2B24',soft:'#243E31',danger:'#FF9A85',amber:'#E6BD78'};
interface Appearance {preferences:AppPreferences;dark:boolean;colors:typeof light;update:(value:AppPreferences)=>Promise<void>}
const Context=createContext<Appearance>({preferences:{theme:'system',hideAmounts:false},dark:false,colors:light,update:async()=>{}});
export function AppearanceProvider({children}:{children:ReactNode}){
 const device=useColorScheme();const [preferences,setPreferences]=useState<AppPreferences>({theme:'system',hideAmounts:false});const [profileId,setProfileId]=useState('');const [ready,setReady]=useState(false);
 useEffect(()=>{let live=true;void import('../services/finance/runtime').then(async({finance})=>{const profile=await finance.initialProfile();const prefs=await finance.preferences(profile.id);if(live){setProfileId(profile.id);setPreferences(prefs);setReady(true);}}).catch(()=>{if(live)setReady(true);});return()=>{live=false;};},[]);
 const isDark=preferences.theme==='dark'||preferences.theme==='system'&&device==='dark';
 async function update(value:AppPreferences){const {finance}=await import('../services/finance/runtime');const id=profileId||(await finance.initialProfile()).id;await finance.setPreferences(id,value);setPreferences(value);}
 return <Context.Provider value={{preferences,dark:isDark,colors:isDark?dark:light,update}}>{ready?children:<NativeView style={{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:isDark?dark.bg:light.bg}}><NativeText style={{color:isDark?dark.ink:light.ink}}>Abriendo Finance App…</NativeText></NativeView>}</Context.Provider>;
}
export function useAppearance(){return useContext(Context);}
export function maskMoney(value:string,hidden:boolean){return hidden?value.replace(/(?:[$€]\s*-?\d[\d,.]*|\b[A-Z]{3}\s+-?\d[\d,.]*)/g,'••••'):value;}
function themed(style:unknown,isDark:boolean,text=false){if(!isDark)return style;const value=StyleSheet.flatten(style as never) as Record<string,unknown>|undefined;if(!value)return text?{color:dark.ink}:style;const result={...value};const map:Record<string,string>={};for(const key of Object.keys(light) as (keyof typeof light)[])map[light[key]]=dark[key];Object.assign(map,{'#F8FAF7':dark.bg,'#EEF1ED':dark.soft,'#ECF3ED':dark.soft,'#F0F3EE':dark.border,'#FFF0D7':'#473B20','#FCEBE6':'#492E26','#FCEDE7':'#492E26'});
 for(const key of ['color','backgroundColor','borderColor','borderBottomColor','borderTopColor','borderLeftColor','borderRightColor']){const current=result[key];if(typeof current!=='string')continue;if(key==='color'&&current.toUpperCase()==='#FFFFFF')continue;if(key==='backgroundColor'&&current===light.ink)continue;if(map[current])result[key]=map[current];}
 if(text&&!result.color)result.color=dark.ink;return result;
}
function hideChildren(children:ReactNode,hidden:boolean):ReactNode {if(typeof children==='string')return maskMoney(children,hidden);if(Array.isArray(children))return children.map((child,i)=><NativeText key={i}>{hideChildren(child,hidden)}</NativeText>);return children;}
export function ThemeText(props:TextProps){const appearance=useAppearance();return <NativeText {...props} style={themed(props.style,appearance.dark,true) as TextProps['style']}>{hideChildren(props.children,appearance.preferences.hideAmounts)}</NativeText>;}
export function ThemeView(props:ViewProps){const {dark}=useAppearance();return <NativeView {...props} style={themed(props.style,dark) as ViewProps['style']}/>;}
export function ThemePressable(props:PressableProps){const {dark}=useAppearance();return <NativePressable {...props} style={typeof props.style==='function'?state=>themed((props.style as (state:PressableStateCallbackType)=>unknown)(state),dark) as ViewProps['style']:themed(props.style,dark) as ViewProps['style']}/>;}
export function ThemeScrollView(props:ScrollViewProps){const {dark}=useAppearance();return <NativeScrollView {...props} style={themed(props.style,dark) as ScrollViewProps['style']} contentContainerStyle={themed(props.contentContainerStyle,dark) as ScrollViewProps['contentContainerStyle']}/>;}
export function ThemeTextInput(props:TextInputProps){const {dark}=useAppearance();return <NativeTextInput {...props} style={themed(props.style,dark,true) as TextInputProps['style']}/>;}
