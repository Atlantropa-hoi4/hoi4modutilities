import type { Technology, TechnologyTree } from './schema';
import type { Node } from '../../hoiformat/hoiparser';
import { getFilePathFromMod, listFilesFromModOrHOI4, parseAndResolveHoi4FileCached } from '../../util/fileloader';
import { getIndexedGfxNames } from '../../util/gfxindex';
import { mapWithConcurrency } from '../../util/common';

export function technologyIconNames(id: string, country?: string): string[] {
    return [...(country ? [`GFX_${country}_${id}_medium`, `GFX_${country}_${id}`] : []),
        `GFX_${id}_medium`, `GFX_${id}`];
}

export function allTechnologies(trees: TechnologyTree[]): Technology[] {
    const result = new Set<Technology>();
    const visit = (tech: Technology) => {
        if (result.has(tech)) { return; }
        result.add(tech);
        tech.subTechnologies.forEach(visit);
    };
    trees.forEach(tree => tree.technologies.forEach(visit));
    return [...result];
}

function children(node: Node): Node[] { return Array.isArray(node.value) ? node.value : []; }
function value(node: Node | undefined): string | undefined {
    return typeof node?.value === 'string' ? node.value
        : node?.value && !Array.isArray(node.value) && typeof node.value === 'object' ? node.value.name : undefined;
}

export async function loadTechnologyPresentation(trees: TechnologyTree[]): Promise<string[]> {
    const files: string[] = [];
    const list = async (folder: string) => {
        try {
            return (await listFilesFromModOrHOI4(folder, { recursively: true }))
                .filter(file => file.toLowerCase().endsWith('.txt')).sort().map(file => `${folder}/${file}`);
        } catch { return []; }
    };
    const technologies = allTechnologies(trees);
    const [tagFiles, equipmentFiles, sprites] = await Promise.all([
        list('common/country_tags'),
        technologies.some(tech => tech.equipmentIds?.length) ? list('common/units/equipment') : Promise.resolve([]),
        getIndexedGfxNames(),
    ]);
    const tags = new Set<string>();
    const equipment = new Map<string, { short?: string; parent?: string }>();
    const loaded = await mapWithConcurrency([...tagFiles, ...equipmentFiles], 8, async file => {
        files.push(file);
        try {
            return { file, node: await parseAndResolveHoi4FileCached(file), mod: !!await getFilePathFromMod(file) };
        } catch { return undefined; }
    });
    // Read concurrently, then merge in a stable order with mod definitions taking precedence.
    const definitions = loaded.filter((row): row is NonNullable<typeof row> => !!row)
        .sort((a, b) => Number(a.mod) - Number(b.mod) || a.file.localeCompare(b.file));
    for (const { file, node } of definitions) {
        if (tagFiles.includes(file)) {
            children(node).forEach(child => {
                if (child.name && child.name !== 'dynamic_tags' && value(child)) { tags.add(child.name); }
            });
        } else {
            children(node).filter(child => child.name === 'equipments').flatMap(children).forEach(child => {
                if (child.name) { equipment.set(child.name, {
                    short: value(children(child).find(field => field.name === 'short_name')),
                    parent: value(children(child).find(field => field.name === 'archetype')),
                }); }
            });
        }
    }
    const spriteSet = new Set(sprites);
    for (const tech of technologies) {
        tech.countryTags = [...tags].filter(tag => technologyIconNames(tech.id, tag).slice(0, 2)
            .some(name => spriteSet.has(name))).sort();
        tech.nameKeys = { short: [], long: [...(tech.equipmentIds ?? [])] };
        for (const id of tech.equipmentIds ?? []) {
            const definition = equipment.get(id);
            const parent = definition?.parent ? equipment.get(definition.parent) : undefined;
            tech.nameKeys.short.push(definition?.short ?? parent?.short ?? `${id}_short`);
        }
    }
    return files;
}
