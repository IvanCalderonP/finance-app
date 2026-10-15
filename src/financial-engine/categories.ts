import type { Category } from './model.ts';
export function categoryContains(categories:Category[],parentId:string,childId:string):boolean {
 const visited=new Set<string>();let cursor:string|null|undefined=childId;
 while(cursor&&!visited.has(cursor)){if(cursor===parentId)return true;visited.add(cursor);cursor=categories.find(row=>row.id===cursor)?.parentId;}
 return false;
}
export function categoryPath(categories:Category[],id:string):string {
 const names:string[]=[];const visited=new Set<string>();let cursor:string|null|undefined=id;
 while(cursor&&!visited.has(cursor)){visited.add(cursor);const category=categories.find(row=>row.id===cursor);if(!category)break;names.unshift(category.name);cursor=category.parentId;}
 return names.join(' › ');
}
