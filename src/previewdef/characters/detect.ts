import { matchPathEnd } from '../../util/nodecommon';

export function getCharacterPreviewPriority(uriString: string, uriPath: string): number | undefined {
    if (!uriPath.toLowerCase().endsWith('.txt')) {
        return undefined;
    }

    return matchPathEnd(uriString.toLowerCase(), ['common', 'characters', '*'])
        ? 0
        : undefined;
}
