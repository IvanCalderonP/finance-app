import { assert, integer, total } from './model.ts';
export interface AllocationRule { id: string; label: string; mode: 'fixed' | 'percent' | 'remainder'; value: number; priority: number; target: 'free' | 'bucket'; bucketId: string | null }
export interface AllocationLine extends AllocationRule { requestedMinor: number; amountMinor: number; shortfallMinor: number }
export interface AllocationPreview { incomeMinor: number; resourceMinor: number; allocatedMinor: number; freeMinor: number; lines: AllocationLine[] }
export function validateAllocationRules(rules: AllocationRule[]) {
  assert(rules.length > 0 && rules.length <= 100, 'Agrega entre 1 y 100 destinos'); assert(new Set(rules.map(row => row.id)).size === rules.length, 'Destinos duplicados');
  assert(rules.filter(row => row.mode === 'remainder').length <= 1, 'Solo puede existir un destino para el sobrante');
  for (const rule of rules) { assert(rule.label.trim().length > 0 && rule.label.length <= 100, 'Nombre de destino inválido'); integer(rule.priority); assert(rule.priority >= 0, 'Prioridad inválida'); integer(rule.value); assert(rule.value >= 0, 'Cantidad inválida'); assert(['fixed','percent','remainder'].includes(rule.mode), 'Regla inválida'); if (rule.mode === 'percent') assert(rule.value <= 10000, 'El porcentaje debe estar entre 0 y 100'); assert(rule.target === 'free' || rule.target === 'bucket', 'Destino inválido'); assert(rule.target !== 'bucket' || !!rule.bucketId, 'Selecciona un apartado'); }
}
// Percentages are calculated from original income, rounded DOWN to integer cents.
// Priority order consumes scarce resources; ties keep the saved order, remainder runs last.
export function previewAllocation(incomeMinor: number, resourceMinor: number, rules: AllocationRule[]): AllocationPreview {
  assert(integer(incomeMinor) > 0 && integer(resourceMinor) >= 0, 'Ingreso o recursos inválidos'); validateAllocationRules(rules);
  let remaining = Math.min(incomeMinor, resourceMinor);
  const lines = rules.map((row,index) => ({ ...row,index })).sort((a,b) => Number(a.mode === 'remainder') - Number(b.mode === 'remainder') || a.priority-b.priority || a.index-b.index).map(({ index: _index,...rule }) => {
    const requestedMinor = rule.mode === 'fixed' ? rule.value : rule.mode === 'percent' ? Number(BigInt(incomeMinor)*BigInt(rule.value)/10000n) : remaining;
    const amountMinor = Math.min(remaining, requestedMinor); remaining -= amountMinor; return { ...rule,requestedMinor,amountMinor,shortfallMinor:requestedMinor-amountMinor };
  });
  const allocatedMinor = total(lines.filter(row=>row.target==='bucket').map(row=>row.amountMinor));
  return { incomeMinor,resourceMinor:Math.min(incomeMinor,resourceMinor),allocatedMinor,freeMinor:incomeMinor-allocatedMinor,lines };
}
export function editAllocation(preview: AllocationPreview, changes: { id: string; amountMinor: number }[]): AllocationPreview {
  assert(new Set(changes.map(row=>row.id)).size === changes.length, 'Destinos repetidos'); for(const row of changes){ assert(integer(row.amountMinor)>=0,'Importe inválido');assert(preview.lines.some(line=>line.id===row.id),'Destino inexistente'); }
  const lines=preview.lines.map(line=>{const amountMinor=changes.find(row=>row.id===line.id)?.amountMinor??line.amountMinor;return{...line,amountMinor,shortfallMinor:Math.max(0,line.requestedMinor-amountMinor)};});
  assert(total(lines.map(row=>row.amountMinor))<=preview.resourceMinor,'El reparto excede los recursos disponibles');const allocatedMinor=total(lines.filter(row=>row.target==='bucket').map(row=>row.amountMinor));return{...preview,lines,allocatedMinor,freeMinor:preview.incomeMinor-allocatedMinor};
}
