import { ExtensionServices } from './serviceRegistry';
import { PreviewManager } from '../previewdef/previewmanager';
import { getPreviewDescriptors, registerFeatureArea } from '../features/catalog';

export function registerPreviewServices(services: ExtensionServices): void {
    const previewManager = new PreviewManager({
        previewProviders: getPreviewDescriptors(),
    });

    services.push(
        previewManager.register(),
        ...registerFeatureArea('preview'),
    );
}
