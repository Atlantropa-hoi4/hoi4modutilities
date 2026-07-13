import { chain, flatMap, min, sumBy } from "lodash";
import { RenderedTechnologyFolder, RenderedTechnologyFolderGridBox, Technology, TechnologyTree } from "../src/previewdef/technology/schema";
import { RenderCommonOptions } from "../src/util/hoi4gui/common";
import { GridBoxConnection, GridBoxItem, renderGridBoxCommon } from "../src/util/hoi4gui/gridboxcommon";
import { setState, getState, scrollToState, tryRun, subscribeRefreshButton, subscribeNavigators, arrayToMap, enableZoom, subscribePreviewLabelToggle, refreshPreviewLabelMode } from "./util/common";
import { StyleTable } from "../src/util/styletable";
import { ConditionItem, conditionItemToStringValue, conditionToString, stringValueToConditionItem } from "../src/hoiformat/condition";
import { DivDropdown } from "./util/dropdown";
import { findTechnologyXorGroups, getAllowedTechnologies, TechnologyXorGroups } from "./technology/conditionfilter";

const renderedTechFolders: Record<string, RenderedTechnologyFolder> = (window as any).renderedTechFolders;
const technologyTrees: TechnologyTree[] = (window as any).technologyTrees;

let selectedExprs: ConditionItem[] = getState().selectedExprs ?? [];
let selectedFolder: string = getState().folder;
let conditions: DivDropdown | undefined = undefined;

async function buildContent() {
    const mainContent = document.getElementById('mainContent') as HTMLDivElement;
    const folder = selectedFolder;
    const renderedFolder = renderedTechFolders[folder];
    if (!renderedFolder) {
        mainContent.replaceChildren();
        return;
    }

    let template = renderedFolder.template ?? '';

    const styleTable = new StyleTable();
    const commonOptions: RenderCommonOptions = {
        styleTable,
    };
    for (const [startTechId, gridbox] of Object.entries(renderedFolder.gridboxes)) {
        const tree = technologyTrees.find(t => t.startTechnology === startTechId && t.folder === folder);
        if (!tree) {
            continue;
        }
        template = template.replace('{{gridbox-' + startTechId + '}}',
            await renderTechnologyTreeGridBox(tree, gridbox, folder, commonOptions, renderedFolder));
    }

    mainContent.innerHTML = template + styleTable.toStyleElement((window as any).styleNonce);
    subscribeNavigators();
    refreshPreviewLabelMode();
}

async function renderTechnologyTreeGridBox(
    tree: TechnologyTree,
    gridbox: RenderedTechnologyFolderGridBox,
    folder: string,
    commonOptions: RenderCommonOptions,
    renderedFolder: RenderedTechnologyFolder,
): Promise<string> {
    const xorJointKey = "#xorJoint#";
    const techMap = arrayToMap(tree.technologies, 'id');
    const technologiesInFolder = tree.technologies.filter(t => folder in t.folders);

    const allowedTechnologies = getAllowedTechnologies(technologiesInFolder, selectedExprs);
    const allowedTechnologyIds = new Set(allowedTechnologies.map(technology => technology.id));

    const technologyXorJoints = allowedTechnologies
        .map(tech => findTechnologyXorGroups(techMap, tech, folder, allowedTechnologyIds))
        .filter((item): item is TechnologyXorGroups => item !== undefined && item.xorGroups.length > 0);
    const technologyXorJointsMap: Record<string, {nonXors: Technology[], xorGroups: Technology[][]}> = {};

    technologyXorJoints.forEach(({ tech, nonXors, xorGroups }) => technologyXorJointsMap[tech.id] = { nonXors, xorGroups });

    const technologyItemsArray = allowedTechnologies.map<GridBoxItem>(t => {
        const jointsItem = technologyXorJointsMap[t.id];
        const connections: GridBoxConnection[] = [];
        let leadsToTechs: Technology[];
        if (jointsItem) {
            const { nonXors, xorGroups } = jointsItem;
            leadsToTechs = nonXors;
            connections.push(...xorGroups.map<GridBoxConnection>((_, i) => ({ target: xorJointKey + t.id + i, style: "1px solid #88aaff", targetType: "child" })));
        } else {
            leadsToTechs = t.leadsToTechs
                .map(technologyId => techMap[technologyId])
                .filter((technology): technology is Technology =>
                    technology !== undefined && allowedTechnologyIds.has(technology.id));
        }

        connections.push(...leadsToTechs.map<GridBoxConnection>(c => {
            if (c.leadsToTechs.includes(t.id)) {
                return { target: c.id, style: "1px dashed #88aaff", targetType: "related" };
            }
            return { target: c.id, style: "1px solid #88aaff", targetType: "child" };
        }));

        return {
            id: t.id,
            gridX: t.folders[folder].x,
            gridY: t.folders[folder].y,
            connections,
        };
    });

    const technologyXorJointsItemsArray = flatMap(technologyXorJoints, ({ tech, xorGroups }) =>
        xorGroups.map<GridBoxItem>((tl, i) => ({
            id: xorJointKey + tech.id + i,
            gridX: Math.round(sumBy(tl, t => t.folders[folder].x) / tl.length),
            gridY: (min(tl.map(t1 => t1.folders[folder].y)) ?? 0) - 1,
            isJoint: true,
            connections: tl.map<GridBoxConnection>(c => {
                return { target: c.id, style: "1px solid red", targetType: "child" };
            }),
        }))
    );

    const hasLineItem = renderedFolder.renderedLines.length === 32;

    return await renderGridBoxCommon(gridbox.gridbox, gridbox.parentInfo, {
        ...commonOptions,
        items: arrayToMap([...technologyItemsArray, ...technologyXorJointsItemsArray], 'id'),
        lineRenderMode: hasLineItem ? 'control' : 'line',
        onRenderItem: async (item, parent) => {
            if (item.id.startsWith(xorJointKey)) {
                const format = gridbox.gridbox.format?._name ?? 'up';
                return format === 'left' || format === 'right' ? renderedFolder.renderedXor.leftRight : renderedFolder.renderedXor.upDown;
            } else {
                return renderedFolder.renderedTechnologies[item.id] ?? '';
            }
        },
        onRenderLineBox: async (item, parent) => {
            if (!hasLineItem) {
                return '';
            }
            const directionalItems = [ item.up, item.down, item.right, item.left ];
            const inSet = chain(directionalItems).compact().flatMap(c => Object.keys(c.in)).uniq().value();
            const outSet = chain(directionalItems).compact().flatMap(c => Object.keys(c.out)).uniq().value();
            let sameInOut = false;

            if (inSet.length === outSet.length) {
                sameInOut = true;
                for (const inItem of inSet) {
                    if (!outSet.includes(inItem)) {
                        sameInOut = false;
                        break;
                    }
                }
            }

            const lineIndex = (item.up ? 1 : 0) | (item.right ? 2 : 0) | (item.down ? 4 : 0) | (item.left ? 8 : 0) | (sameInOut ? 16 : 0);
            return renderedFolder.renderedLines[lineIndex];
        },
    },
    async (_, _1) => gridbox.background);
}

async function folderChange(folder: string, clearCondition: boolean) {
    if (!(folder in renderedTechFolders)) {
        return;
    }

    selectedFolder = folder;
    setState({ folder: folder });

    const conditionExprs = chain(technologyTrees).filter(t => t.folder === folder).flatMap(t => t.conditionExprs).uniqBy(e => e.scopeName + '!' + e.nodeContent).value();
    const conditionOptions = conditionExprs.map(option => ({ value: conditionItemToStringValue(option), text: conditionToString(option) }));
    const conditionOptionValues = new Set(conditionOptions.map(option => option.value));

    const conditionContainerElement = document.getElementById('condition-container') as HTMLDivElement | null;
    if (conditionContainerElement) {
        conditionContainerElement.style.display = conditionExprs.length > 0 ? 'block' : 'none';
    }

    if (conditions) {
        conditions.setupOptions(conditionOptions);
        conditions.selectedValues$.next(clearCondition
            ? []
            : selectedExprs.map(conditionItemToStringValue).filter(value => conditionOptionValues.has(value)));
    }

    await buildContent();
}

window.addEventListener('load', tryRun(async function() {
    const defaultLabelMode = (window as any).technologyDefaultLabelMode === 'id' ? 'id' : 'name';
    subscribePreviewLabelToggle(defaultLabelMode);

    // Tech tree folder selector
    const element = document.getElementById('folderSelector') as HTMLSelectElement;
    const restoredFolder = getState().folder;
    const legacyFolder = typeof restoredFolder === 'string' && restoredFolder.startsWith('techfolder_')
        ? restoredFolder.slice('techfolder_'.length)
        : restoredFolder;
    const folder = typeof legacyFolder === 'string' && legacyFolder in renderedTechFolders
        ? legacyFolder
        : element.value;
    element.value = folder;
    element.addEventListener('change', function() {
        folderChange(this.value, true);
    });

    // Conditions
    const conditionsElement = document.getElementById('conditions') as HTMLDivElement | null;
    if (conditionsElement) {
        conditions = new DivDropdown(conditionsElement, true);

        conditions.selectedValues$.next(selectedExprs.map(conditionItemToStringValue));
        conditions.selectedValues$.subscribe(async (selection) => {
            selectedExprs = selection.map<ConditionItem>(stringValueToConditionItem);
            setState({ selectedExprs });
            await buildContent();
        });
    }

    // Zoom
    const contentElement = document.getElementById('mainContent') as HTMLDivElement;
    enableZoom(contentElement, 0, 40);

    subscribeRefreshButton();
    await folderChange(folder, false);
    scrollToState();
}));
