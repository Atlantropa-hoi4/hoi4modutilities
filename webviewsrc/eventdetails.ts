import type { EventGraphEventNode, EventGraphOptionNode } from '../src/previewdef/event/payload';
import { feLocalize } from './util/i18n';
import { conditionPanel } from './util/conditiontree';

type DetailsNode = EventGraphEventNode | EventGraphOptionNode;
interface DetailsEntry { node: DetailsNode; localised: boolean; button: HTMLButtonElement; }

export class EventDetailsController {
    private dialog: HTMLDialogElement | undefined;
    private readonly entries = new Map<string, DetailsEntry>();
    private restoreFocus = false;

    constructor(private readonly readState: () => Record<string, unknown>,
        private readonly writeState: (state: Record<string, unknown>) => void) { }

    public beginRender(): void {
        this.restoreFocus = this.dialog?.contains(document.activeElement) ?? false;
        this.removeDialog();
        this.entries.clear();
    }

    public append(card: HTMLElement, node: DetailsNode, localised: boolean, key: string): void {
        const button = document.createElement('button');
        button.className = 'event-details-button';
        button.textContent = feLocalize('event.details', 'Details');
        button.setAttribute('aria-haspopup', 'dialog');
        this.entries.set(key, { node, localised, button });
        button.addEventListener('click', event => {
            event.stopPropagation();
            this.show(key);
        });
        card.append(button);
    }

    public restore(): void {
        const state = this.readState();
        if (state.eventDetailsOpen !== true) {
            return;
        }
        const key = state.eventDetailsSelection;
        if (typeof key === 'string' && this.entries.has(key)) {
            this.show(key);
        } else {
            this.writeState({ eventDetailsOpen: false, eventDetailsSelection: undefined });
            if (this.restoreFocus) {
                document.getElementById('ev-searchbox')?.focus();
            }
        }
    }

    private removeDialog(): void {
        const dialog = this.dialog;
        this.dialog = undefined;
        dialog?.remove();
    }

    private show(key: string): void {
        const entry = this.entries.get(key);
        if (!entry) { return; }
        this.removeDialog();
        const { node, localised, button } = entry;
        const dialog = document.createElement('dialog');
        this.dialog = dialog;
        dialog.className = 'event-details-dialog';
        const title = document.createElement('h2');
        title.id = 'event-details-title';
        title.textContent = node.kind === 'event' ? node.eventId : node.name.key;
        dialog.setAttribute('aria-labelledby', title.id);
        const close = document.createElement('button');
        close.textContent = feLocalize('event.closeDetails', 'Close details');
        close.addEventListener('click', () => { dialog.close(); });
        dialog.addEventListener('close', () => {
            if (this.dialog !== dialog) { return; }
            this.removeDialog();
            this.writeState({ eventDetailsOpen: false });
            if (button.isConnected) { button.focus(); }
            else { document.getElementById('ev-searchbox')?.focus(); }
        });
        dialog.append(title, close);
        if (node.trigger !== true) {
            dialog.append(conditionPanel(node.trigger, feLocalize('eventtree.eventtrigger', 'Event trigger')));
        }
        if (node.kind === 'event') {
            for (const description of node.descriptions ?? []) {
                const text = document.createElement('p');
                text.textContent = localised ? description.text.text : description.text.key;
                dialog.append(text);
                if (description.trigger) {
                    const script = document.createElement('pre');
                    script.textContent = description.trigger;
                    dialog.append(script);
                }
            }
        } else {
            const recipient = document.createElement('p');
            recipient.textContent = feLocalize('event.originalRecipient', 'Original recipient only: {0}', node.originalRecipientOnly ? 'yes' : 'no');
            const script = document.createElement('pre');
            script.textContent = node.aiChanceScript ?? feLocalize('event.noAiChance', 'No explicit AI choice weight.');
            dialog.append(recipient, script);
        }
        document.body.append(dialog);
        dialog.showModal();
        this.writeState({ eventDetailsOpen: true, eventDetailsSelection: key });
    }
}
