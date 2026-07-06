import { GitDiffService, resolveDefaultWorkspacePath, type DiffService } from "@potato/core";
import { renderChangeSetLines } from "../ui/DiffRenderer.js";

export type DiffCommandOptions = {
  workspacePath?: string;
  patch?: boolean;
  cwd?: string;
  write?: (line: string) => void;
  diffService?: DiffService;
  resolveWorkspacePath?: (cwd: string) => Promise<string>;
};

export async function diffCommand(options: DiffCommandOptions = {}): Promise<void> {
  const workspacePath = options.workspacePath ?? (await (options.resolveWorkspacePath ?? resolveDefaultWorkspacePath)(options.cwd ?? process.cwd()));
  const write = options.write ?? console.log;
  const diffService = options.diffService ?? new GitDiffService();
  const changeSet = await diffService.getChangeSet(workspacePath);

  const rendered = renderChangeSetLines({
    files: (options.patch ?? true) ? changeSet.files : changeSet.files.map((file) => ({ ...file, diff: undefined }))
  });
  for (const line of rendered) {
    write(line);
  }
}
