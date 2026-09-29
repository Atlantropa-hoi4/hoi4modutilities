export interface StyleTableOptions {
    /**
     * Names one-time styles after their content, so identical rules share one class within a
     * table and across tables that render incremental patches for the same page.
     */
    contentAddressedOneTimeStyles?: boolean;
}

export class StyleTable {
    private readonly records: Record<string, string> = {};
    private readonly rawRecords: Record<string, string> = {};
    private id: number = 0;

    constructor(private readonly options: StyleTableOptions = {}) {
    }

    public style(name: string, callback: () => string, fakeClass?: string): string
    public style(name: string, callback: () => Promise<string>, fakeClass?: string): Promise<string>
    public style(name: string, callback: (() => string) | (() => Promise<string>), pseudoClass: string = ''): string | Promise<string> {
        name = this.name(name);
        const key = name + pseudoClass;
        const result = this.records[key];
        if (result !== undefined) {
            return name;
        }
    
        const callbackResult = callback();
        if (typeof callbackResult === 'string') {
            this.records[key] = callbackResult;
            return name;
        } else {
            return callbackResult.then<string>(v => {
                this.records[key] = v;
                return name;
            });
        }
    }

    public oneTimeStyle(name: string, callback: () => string, fakeClass?: string): string
    public oneTimeStyle(name: string, callback: () => Promise<string>, fakeClass?: string): Promise<string>
    public oneTimeStyle(name: string, callback: (() => string) | (() => Promise<string>), fakeClass: string = ''): string | Promise<string> {
        if (!this.options.contentAddressedOneTimeStyles) {
            const sid = this.id++;
            return this.style(name + '-' + sid, callback as any, fakeClass);
        }

        const callbackResult = callback();
        return typeof callbackResult === 'string'
            ? this.contentAddressedStyle(name, callbackResult, fakeClass)
            : callbackResult.then(content => this.contentAddressedStyle(name, content, fakeClass));
    }

    /** Class rules keyed by class name plus pseudo-class, in insertion order. */
    public rules(): Array<[key: string, content: string]> {
        return Object.entries(this.records);
    }

    /** Omits class rules whose key already maps to identical content in `existingRules`. */
    public toStyleContent(existingRules?: ReadonlyMap<string, string>): string {
        const records = existingRules
            ? Object.entries(this.records).filter(([key, content]) => existingRules.get(key) !== content)
            : Object.entries(this.records);
        return `
            ${records.map(([k, v]) => `.${k} { ${v.replace(/^\s+/gm, '')} }\n`).join('')}
            ${Object.entries(this.rawRecords).map(([k, v]) => `${k} { ${v.replace(/^\s+/gm, '')} }\n`).join('')}
        `;
    }

    private contentAddressedStyle(name: string, content: string, pseudoClass: string): string {
        const hash = hashStyleContent(pseudoClass + '\u0000' + content);
        for (let suffix = 0; ; suffix++) {
            const className = this.name(`${name}-h${hash}${suffix === 0 ? '' : `-${suffix}`}`);
            const key = className + pseudoClass;
            const existing = this.records[key];
            if (existing === undefined) {
                this.records[key] = content;
                return className;
            }
            if (existing === content) {
                return className;
            }
        }
    }

    public toRawCss(): string {
        return this.toStyleContent();
    }

    public toStyleElement(nonce: string): string {
        return `<style nonce="${nonce}">
            ${this.toStyleContent()}
            </style>`;
    }

    public name(name: string) {
        return 'st-' + name;
    }

    public raw(selector: string, content: string) {
        this.rawRecords[selector] = content;
    }
}

/**
 * 53-bit string hash (cyrb53) in base 36. Style tables resolve collisions within one table with
 * a numeric suffix.
 */
export function hashStyleContent(value: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function normalizeForStyle(name: string): string {
    return name.replace(/[^\w_]/g, r => '_' + r.charCodeAt(0));
}
