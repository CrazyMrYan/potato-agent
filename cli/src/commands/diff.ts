import { GitDiffService, type DiffService } from "@coding-agent/core";

export type DiffCommandOptions = {
  workspacePath?: string;
  patch?: boolean;
  write?: (line: string) => void;
  diffService?: DiffService;
};

export async function diffCommand(options: DiffCommandOptions = {}): Promise<void> {
  const workspacePath = options.workspacePath ?? process.cwd();
  const write = options.write ?? console.log;
  const diffService = options.diffService ?? new GitDiffService();
  const changeSet = await diffService.getChangeSet(workspacePath);

  if (changeSet.files.length === 0) {
    write("No changes.");
    return;
  }

  for (const file of changeSet.files) {
    write(`${file.status} ${file.path}`);
    if ((options.patch ?? true) && file.diff) {
      write(file.diff);
    }
  }
}
