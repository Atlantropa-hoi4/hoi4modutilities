// This file contains constants that may be used in package.json

export const ConfigurationKey = 'hoi4ModUtilities';
export const Hoi4FsSchema = 'server.hoi4installpath';

export namespace ViewType {
    export const DDS = 'server.hoi4modutilities.dds';
    export const TGA = 'server.hoi4modutilities.tga';
}

export namespace ContextName {
    export const ShouldHideHoi4Preview = 'server.shouldHideHoi4Preview';
    export const ShouldShowHoi4Preview = 'server.shouldShowHoi4Preview';
    export const Hoi4PreviewType = 'server.hoi4PreviewType';
    export const Hoi4MUInDev = 'server.hoi4MUInDev';
    export const Hoi4MULoaded = 'server.hoi4MULoaded';
}

export namespace Commands {
    export const Preview = 'server.hoi4modutilities.preview';
    export const PreviewWorld = 'server.hoi4modutilities.previewworld';
    export const ScanReferences = 'server.hoi4modutilities.scanreferences';
    export const SelectModFile = 'server.hoi4modutilities.selectmodfile';
    export const SelectHoiFolder = 'server.hoi4modutilities.selecthoifolder';
    export const Test = 'server.hoi4modutilities.test';
}

export namespace WebviewType {
    export const Preview = 'server.hoi4ftpreview';
    export const PreviewWorldMap = 'server.hoi4worldmappreview';
}
