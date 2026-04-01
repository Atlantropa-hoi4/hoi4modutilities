export type Dependency = { type: string, path: string };

export function getDependenciesFromText(text: string): Dependency[] {
    const dependencies: Dependency[] = [];
    const regex = /^\s*#!(?<type>.*?):(?<path>.*\.(?<ext>.*?))$/gm;
    let match = regex.exec(text);
    while (match) {
        const type = match.groups?.type;
        const ext = match.groups?.ext!;
        if (type && (type === ext || ext === 'txt' || ext === 'yml')) {
            const path = match.groups?.path!;
            const pathValue = path.trim().replace(/\/\/+|\\+/g, '/');

            dependencies.push({ type, path: pathValue });
        }

        match = regex.exec(text);
    }

    return dependencies;
}
