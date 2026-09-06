import type * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export async function ensureCopyTargetIsInsideWorkspace(
	targetPath: vscode.Uri,
	workspaceRoot: vscode.Uri,
): Promise<void> {
	if (targetPath.scheme !== "file" || workspaceRoot.scheme !== "file") {
		return;
	}

	const resolvedRoot = await new Promise<string>((resolve, reject) =>
		fs.realpath(workspaceRoot.fsPath, (error, resolved) => error ? reject(error) : resolve(resolved)),
	);
	let existingPath = targetPath.fsPath;
	while (true) {
		try {
			existingPath = await new Promise<string>((resolve, reject) =>
				fs.realpath(existingPath, (error, resolved) => error ? reject(error) : resolve(resolved)),
			);
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
			const parent = path.dirname(existingPath);
			if (parent === existingPath) {
				break;
			}
			existingPath = parent;
		}
	}

	const relative = path.relative(resolvedRoot, existingPath);
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error("Copy target resolves outside the workspace");
	}
}
