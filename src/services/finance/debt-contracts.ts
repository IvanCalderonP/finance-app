import type { Debt, DebtEvent, Person } from '../../financial-engine/debts.ts';
export interface DebtRepository {
 listPeople(profileId:string):Promise<Person[]>;
 person(profileId:string,id:string):Promise<Person|undefined>;
 personByKey(profileId:string,key:string):Promise<{person:Person;fingerprint:string}|undefined>;
 insertPerson(person:Person,key:string,fingerprint:string):Promise<void>;
 list(profileId:string):Promise<Debt[]>;
 find(profileId:string,id:string):Promise<Debt|undefined>;
 byKey(profileId:string,key:string):Promise<{debt:Debt;fingerprint:string}|undefined>;
 insert(debt:Debt,key:string,fingerprint:string):Promise<void>;
 addPayment(profileId:string,debt:Debt,transactionId:string,accountId:string):Promise<void>;
 addEvent(profileId:string,debtId:string,transactionId:string,kind:DebtEvent['kind']):Promise<void>;
 events(profileId:string,debtId:string):Promise<DebtEvent[]>;
 related(profileId:string,transactionId:string):Promise<Debt|undefined>;
}
