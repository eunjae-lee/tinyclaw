/**
 * Parse a time string like "14:30" into a Date object for today.
 */
export function parseTime(timeStr: string): Date {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
}

/**
 * Format an ISO datetime string to a short time like "14:35".
 */
export function formatTime(isoStr: string): string {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Return relative time like "in 3 min" or "2 min ago".
 */
export function relativeTime(isoStr: string): string {
    const diffMs = new Date(isoStr).getTime() - Date.now();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin === 0) return 'now';
    if (diffMin > 0) return `in ${diffMin} min`;
    return `${Math.abs(diffMin)} min ago`;
}

/**
 * Format a duration in seconds to a human-readable string.
 */
export function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}min`;
    return `${m} min`;
}

/**
 * Format ISO datetime to YYYYMMDDTHHMMSS for API requests.
 */
export function toApiDatetime(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
