import { formatAmountMinor } from '../financial-engine/money';
export function displayMoney(value:number,currency:string){
 const raw=formatAmountMinor(value,currency).slice(4);
 const [whole,fraction]=raw.split('.');
 const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,',');
 return `${currency==='USD'?'$':currency==='EUR'?'€':currency+' '}${grouped}.${fraction}`;
}
export function displayDate(value:string){const d=new Date(`${value}T12:00:00`);return Number.isNaN(d.getTime())?value:d.toLocaleDateString('es-SV',{day:'numeric',month:'short',year:'numeric'});}
export function localToday(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
