import { matchPathEnd } from '../../util/nodecommon';
import { findRegexPreviewPriority, samplePreviewText } from '../previewdetectshared';

export function getCharacterPreviewPriority(uriString: string, uriPath: string, content: string = ''): number | undefined {
    if (!uriPath.toLowerCase().endsWith('.txt')) {
        return undefined;
    }

    return matchPathEnd(uriString.toLowerCase(), ['common', 'characters', '*'])
        ? 0
        : findRegexPreviewPriority(samplePreviewText(content), /^\s*characters\s*=\s*{/m);
}
