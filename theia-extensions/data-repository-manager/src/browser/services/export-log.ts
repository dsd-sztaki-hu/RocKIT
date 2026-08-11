export type ExportLogAction = 'create' | 'update' | 'sync';
export type ExportLogStatus = 'success' | 'failed' | 'cancelled';

interface ExportLogEvent {
    action: ExportLogAction;
    timestamp: string;
    crosswalkFile?: string;
    status: ExportLogStatus;
}

export interface ExportLogEntry {
    target: string;
    repository: string;
    mappingFile: string;
    crosswalkFile?: string;
    datasetName?: string;
    collectionId?: string;
    status?: ExportLogStatus;
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
        const candidateLatest = events[events.length - 1];
        const latest = !previous || candidateLatest.timestamp >= previous.syncedAt
            ? candidateLatest
            : {
                action: previous.syncType,
                timestamp: previous.syncedAt,
                crosswalkFile: previous.crosswalkFile,
                status: previous.status ?? 'success'
            };
        const useCandidateDetails = latest === candidateLatest;
        grouped.set(key, {
            ...(useCandidateDetails ? previous : record),
            ...(useCandidateDetails ? record : previous),
            target: useCandidateDetails ? target : previous!.target,
            repository: useCandidateDetails ? repository : previous!.repository,
            mappingFile,
            crosswalkFile: latest.crosswalkFile
                ?? optionalString(record.crosswalkFile)
                ?? previous?.crosswalkFile,
            datasetName: useCandidateDetails
                ? optionalString(record.datasetName) ?? previous?.datasetName
                : previous?.datasetName,
            status: latest.status,
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
        const { syncType, syncedAt, log: _log, ...record } = entry as ExportLogEntry & { log?: unknown };
        return {
            ...record,
            syncType,
            syncedAt
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
            if ((action === 'create' || action === 'update' || action === 'sync') && timestamp) {
                const crosswalkFile = optionalString(event.crosswalkFile) ?? optionalString(record.crosswalkFile);
                events.push({
                    action,
                    timestamp,
                    status: readStatus(event.status) ?? readStatus(record.status) ?? 'success',
                    ...(crosswalkFile ? { crosswalkFile } : {})
                });
            }
        }
    }
    const legacyAction = record.syncType;
    const legacyTimestamp = stringValue(record.syncedAt);
    if ((legacyAction === 'create' || legacyAction === 'update' || legacyAction === 'sync') && legacyTimestamp) {
        const crosswalkFile = optionalString(record.crosswalkFile);
        events.push({
            action: legacyAction,
            timestamp: legacyTimestamp,
            status: readStatus(record.status) ?? 'success',
            ...(crosswalkFile ? { crosswalkFile } : {})
        });
    }
    return uniqueEvents(events);
}

function uniqueEvents(events: ExportLogEvent[]): ExportLogEvent[] {
    return Array.from(
        new Map(events.map(event => [`${event.timestamp}\n${event.action}\n${event.crosswalkFile ?? ''}\n${event.status}`, event])).values()
    ).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
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

function readStatus(value: unknown): ExportLogStatus | undefined {
    return value === 'success' || value === 'failed' || value === 'cancelled'
        ? value
        : undefined;
}
