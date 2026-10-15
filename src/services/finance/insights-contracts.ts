import type { ManualFinancialEvent, ReminderPreference } from '../../financial-engine/financial-calendar.ts';
export interface InsightsSettings {
    currency: string;
    smallThresholdMinor: number;
}
export interface NotificationMapping {
    eventKey: string;
    offsetDays: number;
    notificationId: string;
    date: string;
    signature: string;
}
export interface InsightsRepository {
    events(profileId: string): Promise<ManualFinancialEvent[]>;
    event(profileId: string, id: string): Promise<ManualFinancialEvent | undefined>;
    saveEvent(event: ManualFinancialEvent): Promise<void>;
    linkIncome(profileId: string, eventId: string, transactionId: string): Promise<void>;
    reminders(profileId: string): Promise<ReminderPreference[]>;
    saveReminder(profileId: string, preference: ReminderPreference): Promise<void>;
    settings(profileId: string): Promise<InsightsSettings[]>;
    saveSettings(profileId: string, settings: InsightsSettings): Promise<void>;
    mappings(profileId: string): Promise<NotificationMapping[]>;
    replaceMappings(profileId: string, mappings: NotificationMapping[]): Promise<void>;
}
