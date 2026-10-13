import type { FocusTreeStyleTarget } from '../../src/previewdef/focustree/stylesync';

const baseStyleId = 'focus-tree-dynamic-style';
const deltaStyleId = 'focus-tree-dynamic-patch-style';

/**
 * The webview's dynamic stylesheet: the base style element that whole stylesheets replace, and
 * one delta element right after it for changed and new rules. An appended rule empties the
 * earlier rule of its selector, so a superseded placeholder or image neither keeps applying
 * properties nor holds its body in the CSSOM until the next whole stylesheet compacts both.
 */
export function createFocusTreeStyleSheetTarget(): FocusTreeStyleTarget {
    let ruleBySelector: Map<string, CSSStyleRule> | undefined;
    // Without CSSOM insertion, rules are appended as text and later ones win by order alone.
    let insertRules = true;

    const getBase = () => document.getElementById(baseStyleId) as HTMLStyleElement | null;
    const getDelta = () => document.getElementById(deltaStyleId) as HTMLStyleElement | null;
    const ensureDelta = (): HTMLStyleElement => {
        let delta = getDelta();
        if (!delta) {
            delta = document.createElement('style');
            delta.id = deltaStyleId;
            delta.nonce = window.styleNonce;
            const base = getBase();
            if (base) {
                base.after(delta);
            } else {
                document.head.appendChild(delta);
            }
        }
        return delta;
    };
    const getIndex = (): Map<string, CSSStyleRule> => {
        if (!ruleBySelector) {
            ruleBySelector = new Map();
            for (const sheet of [getBase()?.sheet, getDelta()?.sheet]) {
                for (const rule of Array.from(sheet?.cssRules ?? [])) {
                    if (rule instanceof CSSStyleRule) {
                        ruleBySelector.set(rule.selectorText, rule);
                    }
                }
            }
        }
        return ruleBySelector;
    };

    return {
        replace(css: string): void {
            const base = getBase();
            if (base) {
                base.textContent = css;
            }
            getDelta()?.remove();
            ruleBySelector = undefined;
            insertRules = true;
        },
        append(css: string): void {
            if (!css) {
                return;
            }
            const delta = ensureDelta();
            const sheet = delta.sheet;
            if (insertRules && sheet) {
                try {
                    const parsed = new CSSStyleSheet();
                    parsed.replaceSync(css);
                    const index = getIndex();
                    for (const rule of Array.from(parsed.cssRules)) {
                        const position = sheet.insertRule(rule.cssText, sheet.cssRules.length);
                        const inserted = sheet.cssRules[position];
                        if (inserted instanceof CSSStyleRule) {
                            const superseded = index.get(inserted.selectorText);
                            if (superseded && superseded !== inserted) {
                                superseded.style.cssText = '';
                            }
                            index.set(inserted.selectorText, inserted);
                        }
                    }
                    return;
                } catch {
                    insertRules = false;
                }
            }
            delta.textContent += `\n${css}`;
        },
    };
}
