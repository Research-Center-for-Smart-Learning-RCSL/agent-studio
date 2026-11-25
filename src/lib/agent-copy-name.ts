export function agentCopyName(sourceName: string, existingNames: Iterable<string>): string {
  const names = new Set(existingNames);
  if (!names.has(sourceName)) return sourceName;

  const base = sourceName.replace(/^\((?:[2-9]|[1-9]\d+)\)\s+/, "");
  let number = 2;
  while (names.has(`(${number}) ${base}`)) number++;
  return `(${number}) ${base}`;
}
