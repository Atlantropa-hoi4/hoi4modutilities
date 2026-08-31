import { readFileFromModOrHOI4 } from '../../../util/fileloader';
import { LoaderSession } from '../../../util/loader/loader';
import { FileLoader, FolderLoader, LoadResult, LoadResultOD } from './common';

export interface Defines {
    minimumProvinceSize?: { file: string; value: number };
}

interface DefinesFile extends Defines {
    file: string;
}

export class DefinesLoader extends FolderLoader<Defines, DefinesFile> {
    constructor() {
        super('common/defines', DefinesFileLoader);
    }

    protected mergeFiles(fileResults: LoadResult<DefinesFile>[], _session: LoaderSession): Promise<LoadResult<Defines>> {
        const result: Defines = {};
        const files = fileResults.map(fileResult => fileResult.result).sort((left, right) => left.file.localeCompare(right.file));
        for (const file of files) {
            if (file.minimumProvinceSize) {
                result.minimumProvinceSize = file.minimumProvinceSize;
            }
        }
        return Promise.resolve({ result, warnings: [], dependencies: [this.folder + '/*'] });
    }
}

class DefinesFileLoader extends FileLoader<DefinesFile> {
    protected async loadFromFile(): Promise<LoadResultOD<DefinesFile>> {
        const [buffer] = await readFileFromModOrHOI4(this.file);
        const value = parseMinimumProvinceSize(buffer.toString());
        return {
            result: {
                file: this.file,
                minimumProvinceSize: value === undefined ? undefined : { file: this.file, value },
            },
            warnings: [],
        };
    }
}

export function parseMinimumProvinceSize(content: string): number | undefined {
    const withoutComments = content.replace(/--\[\[[\s\S]*?\]\]/g, '').replace(/--[^\r\n]*/g, '');
    const regex = /\bMINIMUM_PROVINCE_SIZE_IN_PIXELS\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(?=\s*(?:[,;]|$))/gim;
    let result: number | undefined;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(withoutComments)) !== null) {
        result = Number(match[1]);
    }
    return result;
}
