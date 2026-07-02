export function formatCliError(error: unknown): string {
  if (error instanceof Error) {
    return `任务启动失败：${error.message}`;
  }

  return `任务启动失败：${String(error)}`;
}
