/** Selection follows stable IDs and falls back after deleting or moving the selected shot. */
export function selectedSceneShot(shots: readonly { id: string; sceneId: string }[], sceneId: string, selectedId?: string): string | null {
  const sceneShots = shots.filter(shot => shot.sceneId === sceneId);
  return sceneShots.some(shot => shot.id === selectedId) ? selectedId! : sceneShots[0]?.id ?? null;
}

export async function readPlanDocument(file: File) {
  if (!/\.(txt|md)$/i.test(file.name) || file.size > 64 * 1024) throw new Error('Choose a UTF-8 .txt or .md file, up to 64 KB. Paste text from a PDF or Word document for now.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  if (!text.trim() || text.length > 12000 || text.includes('\0')) throw new Error('Use non-empty text, up to 12,000 characters.');
  return { name: file.name.slice(0, 160), text };
}
