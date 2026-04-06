let table: Record<string, string> = {};

try {
    table = (window as any)['__i18ntable'];
    if (!table) {
        console.error('Table not filled.');
        table = {};
    }
} catch(e) {
    console.error(e);
}

export function feLocalize(_key: string, message: string, ...args: unknown[]): string {
    const translatedMessage = table[message] ?? message;
    const regex = new RegExp('\\{(' + args.map((_, i) => i.toString()).join('|') + ')\\}', 'g');
    return translatedMessage.replace(regex, (_, group1) => args[parseInt(group1, 10)]?.toString() ?? '');
}
