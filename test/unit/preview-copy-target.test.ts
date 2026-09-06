import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { ensureCopyTargetIsInsideWorkspace } from '../../src/util/previewcopytarget';

const uri = (fsPath: string) => ({ scheme: 'file', fsPath } as vscode.Uri);

describe('preview copy target containment', () => {
    let temporary: string;
    let workspace: string;
    let outside: string;

    beforeEach(async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'hoi4-preview-copy-'));
        workspace = path.join(temporary, 'workspace');
        outside = path.join(temporary, 'outside');
        await Promise.all([fs.mkdir(workspace), fs.mkdir(outside)]);
    });

    afterEach(async () => {
        // All fixtures, including the junction targets, live under this test's own directory.
        assert.ok(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep));
        await fs.rm(temporary, { recursive: true, force: true });
    });

    it('allows a new directory tree within the workspace', async () => {
        await ensureCopyTargetIsInsideWorkspace(uri(path.join(workspace, 'interface', 'new', 'test.gfx')), uri(workspace));
    });

    it('rejects a parent traversal outside the workspace', async () => {
        await assert.rejects(
            ensureCopyTargetIsInsideWorkspace(uri(path.join(workspace, '..', 'outside', 'test.txt')), uri(workspace)),
            /outside the workspace/,
        );
    });

    it('rejects a junction that redirects a new file outside the workspace', async () => {
        await fs.symlink(outside, path.join(workspace, 'interface'), 'junction');
        await assert.rejects(
            ensureCopyTargetIsInsideWorkspace(uri(path.join(workspace, 'interface', 'new', 'test.gfx')), uri(workspace)),
            /outside the workspace/,
        );
        assert.deepStrictEqual(await fs.readdir(outside), []);
    });

    it('accepts a workspace opened through a junction', async () => {
        const alias = path.join(temporary, 'alias');
        await fs.symlink(workspace, alias, 'junction');
        await ensureCopyTargetIsInsideWorkspace(uri(path.join(alias, 'interface', 'test.gfx')), uri(alias));
    });

    it('allows an internal junction whose target remains inside the workspace', async () => {
        const internal = path.join(workspace, 'shared');
        await fs.mkdir(internal);
        await fs.symlink(internal, path.join(workspace, 'interface'), 'junction');
        await ensureCopyTargetIsInsideWorkspace(uri(path.join(workspace, 'interface', 'test.gfx')), uri(workspace));
    });
});
