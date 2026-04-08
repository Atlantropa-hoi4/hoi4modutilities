import * as vscode from 'vscode';
import { Commands, ContextName } from '../constants';
import { setVscodeContext } from '../context';
import { ExtensionServices } from './serviceRegistry';

export function registerCommandServices(services: ExtensionServices): void {
    if (process.env.NODE_ENV !== 'production') {
        services.push(vscode.commands.registerCommand(Commands.Test, async () => {
            await vscode.window.showInformationMessage('No developer test command is configured in this fork.');
        }));

        setVscodeContext(ContextName.Hoi4MUInDev, true);
    }
}
