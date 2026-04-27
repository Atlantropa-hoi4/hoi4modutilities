export function htmlTextEscape(unsafe: string): string {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;");
}

export function htmlAttributeEscape(unsafe: string): string {
    return htmlTextEscape(unsafe)
         .replace(/"/g, "&quot;");
}
