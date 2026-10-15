import type { SqlConnection } from './connection.ts';
import type { InsightsRepository, NotificationMapping } from '../../services/finance/insights-contracts.ts';
import type { ManualFinancialEvent } from '../../financial-engine/financial-calendar.ts';
const fields = "id,profile_id AS profileId,title,event_date AS date,kind,currency,amount_minor AS amountMinor,description,CASE WHEN kind='income' THEN CASE WHEN income_transaction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM transactions reversed WHERE reversed.profile_id=financial_events.profile_id AND reversed.reversal_of=financial_events.income_transaction_id AND reversed.status='POSTED') THEN 1 ELSE 0 END ELSE completed END AS completed,income_transaction_id AS incomeTransactionId,created_at AS createdAt,updated_at AS updatedAt";
function event(row: ManualFinancialEvent): ManualFinancialEvent { return { ...row, completed: Boolean(row.completed) }; }
export function sqliteInsightsRepository(db: SqlConnection): InsightsRepository {
    return {
        events: async (profileId) => (await db.all<ManualFinancialEvent>(`SELECT ${fields} FROM financial_events WHERE profile_id=? ORDER BY event_date,id`, [profileId])).map(event),
        event: async (profileId, id) => { const rows = await db.all<ManualFinancialEvent>(`SELECT ${fields} FROM financial_events WHERE profile_id=? AND id=?`, [profileId, id]); return rows[0] ? event(rows[0]) : undefined; },
        saveEvent: async (row) => { await db.run(`INSERT INTO financial_events(id,profile_id,title,event_date,kind,currency,amount_minor,description,completed,created_at,updated_at,income_transaction_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,id) DO UPDATE SET title=excluded.title,event_date=excluded.event_date,kind=excluded.kind,currency=excluded.currency,amount_minor=excluded.amount_minor,description=excluded.description,completed=excluded.completed,updated_at=excluded.updated_at,income_transaction_id=excluded.income_transaction_id`, [row.id, row.profileId, row.title, row.date, row.kind, row.currency, row.amountMinor, row.description, row.completed ? 1 : 0, row.createdAt, row.updatedAt, row.incomeTransactionId ?? null]); },
        linkIncome: async (profileId, eventId, transactionId) => { await db.run(`UPDATE financial_events SET income_transaction_id=?,completed=1,updated_at=(SELECT created_at FROM transactions WHERE profile_id=? AND id=?) WHERE profile_id=? AND id=? AND kind='income'`, [transactionId, profileId, transactionId, profileId, eventId]); },
        reminders: async (profileId) => (await db.all<{
            eventKey: string;
            enabled: number;
            offsets: string;
        }>('SELECT event_key AS eventKey,enabled,offsets_json AS offsets FROM financial_reminders WHERE profile_id=?', [profileId])).map(row => ({ eventKey: row.eventKey, enabled: Boolean(row.enabled), offsets: JSON.parse(row.offsets) as number[] })),
        saveReminder: async (profileId, row) => { await db.run('INSERT INTO financial_reminders(profile_id,event_key,enabled,offsets_json) VALUES(?,?,?,?) ON CONFLICT(profile_id,event_key) DO UPDATE SET enabled=excluded.enabled,offsets_json=excluded.offsets_json', [profileId, row.eventKey, row.enabled ? 1 : 0, JSON.stringify(row.offsets)]); },
        settings: profileId => db.all('SELECT currency,small_threshold_minor AS smallThresholdMinor FROM insights_settings WHERE profile_id=?', [profileId]),
        saveSettings: async (profileId, row) => { await db.run('INSERT INTO insights_settings(profile_id,currency,small_threshold_minor) VALUES(?,?,?) ON CONFLICT(profile_id,currency) DO UPDATE SET small_threshold_minor=excluded.small_threshold_minor', [profileId, row.currency, row.smallThresholdMinor]); },
        mappings: profileId => db.all<NotificationMapping>('SELECT event_key AS eventKey,offset_days AS offsetDays,notification_id AS notificationId,scheduled_date AS date,signature FROM local_notification_mappings WHERE profile_id=?', [profileId]),
        replaceMappings: async (profileId, rows) => { await db.run('DELETE FROM local_notification_mappings WHERE profile_id=?', [profileId]); for (const row of rows)
            await db.run('INSERT INTO local_notification_mappings(profile_id,event_key,offset_days,notification_id,scheduled_date,signature) VALUES(?,?,?,?,?,?)', [profileId, row.eventKey, row.offsetDays, row.notificationId, row.date, row.signature]); },
    };
}
