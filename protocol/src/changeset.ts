export type FileChangeStatus = "added" | "modified" | "deleted" | "renamed";

export type ChangeSet = {
  files: Array<{
    path: string;
    status: FileChangeStatus;
    diff?: string;
  }>;
};
