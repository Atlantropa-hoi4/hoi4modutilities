import type { EventGraphEventNode, EventGraphOptionNode } from '../src/previewdef/event/payload';
import { feLocalize } from './util/i18n';
import { conditionPanel } from './util/conditiontree';

export function appendEventDetails(card: HTMLElement, node: EventGraphEventNode | EventGraphOptionNode, localised: boolean): void {
    const button = document.createElement('button');
    button.className = 'event-details-button';
    button.textContent = feLocalize('event.details', 'Details');
    button.addEventListener('click', event => {
        event.stopPropagation();
        document.querySelector('.event-details-dialog')?.remove();
        const dialog = document.createElement('dialog');
        dialog.className = 'event-details-dialog';
        const title = document.createElement('h2');
        title.textContent = node.kind === 'event' ? node.eventId : node.name.key;
        const close = document.createElement('button');
        close.textContent = feLocalize('event.closeDetails', 'Close details');
        close.addEventListener('click', () => { dialog.close(); });
        dialog.addEventListener('close', () => { dialog.remove(); button.focus(); });
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
    });
    card.append(button);
}
