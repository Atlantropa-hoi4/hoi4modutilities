import * as vscode from 'vscode';
import {
    createCountryColorLabel,
    findCountryColorMatches,
    formatCountryColorBlock,
    isCountryColorFile,
} from './countryColorProviderShared';

export { createCountryColorLabel, formatCountryColorBlock, isCountryColorFile };

export interface Hoi4CountryColorMatch {
    key: 'color' | 'color_ui';
    start: number;
    end: number;
    valueText: string;
    red: number;
    green: number;
    blue: number;
}

export interface CountryColorRange {
    key: 'color' | 'color_ui';
    start: number;
    end: number;
    rgb: {
        red: number;
        green: number;
        blue: number;
    };
}

export function registerCountryColorProvider(): vscode.Disposable {
    return vscode.languages.registerColorProvider(
        [
            { pattern: '**/common/countries/color.txt' },
            { pattern: '**/common/countries/colors.txt' },
            { pattern: '**/common/countries/cosmetic.txt' },
            { pattern: '**/common/ideologies/*.txt' },
            { pattern: '**/countries/color.txt' },
            { pattern: '**/countries/colors.txt' },
            { pattern: '**/countries/cosmetic.txt' },
            { pattern: '**/ideologies/*.txt' },
        ],
        new CountryColorProvider(),
    );
}

export function isCountryColorDocumentPath(path: string): boolean {
    return isCountryColorFile(path);
}

export function findCountryColorRanges(text: string): CountryColorRange[] {
    return findCountryColorMatches(text).map(match => ({
        key: match.key,
        start: match.start,
        end: match.end,
        rgb: {
            red: match.red,
            green: match.green,
            blue: match.blue,
        },
    }));
}

export function findHoi4CountryColorMatches(text: string): Hoi4CountryColorMatch[] {
    return findCountryColorMatches(text).map(match => ({
        key: match.key,
        start: match.start,
        end: match.end,
        valueText: match.valueText,
        red: match.red,
        green: match.green,
        blue: match.blue,
    }));
}

export function formatHoi4CountryColorValue(referenceText: string | undefined, red: number, green: number, blue: number): string {
    return formatCountryColorBlock(referenceText, { red, green, blue });
}

class CountryColorProvider implements vscode.DocumentColorProvider {
    public provideDocumentColors(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.ColorInformation[]> {
        if (!isCountryColorFile(document.uri.fsPath || document.uri.path)) {
            return [];
        }

        return findCountryColorMatches(document.getText()).map(match => new vscode.ColorInformation(
            new vscode.Range(document.positionAt(match.start), document.positionAt(match.end)),
            new vscode.Color(match.red / 255, match.green / 255, match.blue / 255, 1),
        ));
    }

    public provideColorPresentations(
        color: vscode.Color,
        context: { document: vscode.TextDocument; range: vscode.Range; },
        _token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.ColorPresentation[]> {
        if (!isCountryColorFile(context.document.uri.fsPath || context.document.uri.path)) {
            return [];
        }

        const currentText = context.document.getText(context.range);
        const presentation = new vscode.ColorPresentation(createCountryColorLabel(currentText, {
            red: color.red * 255,
            green: color.green * 255,
            blue: color.blue * 255,
        }));
        presentation.textEdit = new vscode.TextEdit(context.range, formatCountryColorBlock(currentText, {
            red: color.red * 255,
            green: color.green * 255,
            blue: color.blue * 255,
        }));

        return [presentation];
    }
}
