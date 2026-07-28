export type ExportLogAction = 'create' | 'update';

export interface ExportLogEvent {
    action: ExportLogAction;
    timestamp: string;
}

export interface ExportLogEntry {
    target: string;
    repository: string;
    mappingFile: string;
    datasetName?: string;
    collectionId?: string;
    log?: ExportLogEvent[];
    /** Derived compatibility fields used by the existing export services. */
    syncType: ExportLogAction;
    syncedAt: string;
    [key: string]: unknown;
}

export function normalizeExportLogEntries(value: unknown): ExportLogEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const grouped = new Map<string, ExportLogEntry>();
    for (const candidate of value) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            continue;
        }
        const record = candidate as Record<string, unknown>;
        const target = stringValue(record.target);
        const repository = stringValue(record.repository);
        const mappingFile = stringValue(record.mappingFile);
        if (!target || !repository || !mappingFile) {
            continue;
        }
        const events = readEvents(record);
        if (!events.length) {
            continue;
        }
        const key = `${normalizeUrl(repository)}\n${mappingFile}`;
        const previous = grouped.get(key);
        const combinedEvents = uniqueEvents([...(previous?.log ?? []), ...events]);
        const latest = combinedEvents[combinedEvents.length - 1];
        const candidateLatest = events[events.length - 1];
        const useCandidateDetails = !previous || candidateLatest.timestamp >= previous.syncedAt;
        grouped.set(key, {
            ...(useCandidateDetails ? previous : record),
            ...(useCandidateDetails ? record : previous),
            target: useCandidateDetails ? target : previous!.target,
            repository: useCandidateDetails ? repository : previous!.repository,
            mappingFile,
            datasetName: useCandidateDetails
                ? optionalString(record.datasetName) ?? previous?.datasetName
                : previous?.datasetName,
            log: combinedEvents,
            syncType: latest.action,
            syncedAt: latest.timestamp
        } as ExportLogEntry);
    }
    return Array.from(grouped.values());
}

export function appendExportLogEvent(
    entries: ExportLogEntry[],
    entry: ExportLogEntry
): ExportLogEntry[] {
    return normalizeExportLogEntries([...entries, entry]);
}

export function serializeExportLogEntries(entries: ExportLogEntry[]): object[] {
    return normalizeExportLogEntries(entries).map(entry => {
        const { syncType: _syncType, syncedAt: _syncedAt, log, ...record } = entry;
        const latest = latestEvent(log);
        return {
            ...record,
            syncType: latest.action,
            syncedAt: latest.timestamp
        };
    });
}

function readEvents(record: Record<string, unknown>): ExportLogEvent[] {
    const events: ExportLogEvent[] = [];
    if (Array.isArray(record.log)) {
        for (const item of record.log) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                continue;
            }
            const event = item as Record<string, unknown>;
            const action = event.action;
            const timestamp = stringValue(event.timestamp);
            if ((action === 'create' || action === 'update') && timestamp) {
                events.push({ action, timestamp });
            }
        }
    }
    const legacyAction = record.syncType;
    const legacyTimestamp = stringValue(record.syncedAt);
    if ((legacyAction === 'create' || legacyAction === 'update') && legacyTimestamp) {
        events.push({ action: legacyAction, timestamp: legacyTimestamp });
    }
    return uniqueEvents(events);
}

function uniqueEvents(events: ExportLogEvent[]): ExportLogEvent[] {
    return Array.from(
        new Map(events.map(event => [`${event.timestamp}\n${event.action}`, event])).values()
    ).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function latestEvent(events: ExportLogEvent[] | undefined): ExportLogEvent {
    const latest = events?.[events.length - 1];
    if (!latest) {
        throw new Error('An export log entry must contain at least one synchronization event.');
    }
    return latest;
}

function normalizeUrl(value: string): string {
    return value.trim().replace(/\/+$/, '').toLowerCase();
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function optionalString(value: unknown): string | undefined {
    const result = stringValue(value);
    return result || undefined;
}
