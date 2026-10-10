import type { AllowedFolder } from "../../shared/rpc";
import type { AllowedFolderSetting } from "../../shared/settings";

// explorer.folders.list reports folders by their expanded root, but settings store what the user
// typed ("~/notes"). The client cannot expand ~, so pair them up: exact absolute matches first,
// then ~/ paths by suffix among the remaining roots, then a bare ~ if one root is left over.
// A setting the daemon deduped into another one gets no status.

export function matchFolderStatuses(
  settings: readonly AllowedFolderSetting[],
  folders: readonly AllowedFolder[],
): (AllowedFolder | null)[] {
  const unclaimed = new Set(folders);
  const matches: (AllowedFolder | null)[] = settings.map(() => null);

  function claim(index: number, predicate: (root: string) => boolean) {
    for (const folder of unclaimed) {
      if (predicate(normalize(folder.root))) {
        matches[index] = folder;
        unclaimed.delete(folder);
        return;
      }
    }
  }

  settings.forEach((setting, index) => {
    const path = setting.path.trim();
    if (path === "~" || path.startsWith("~/")) return;
    const target = normalize(path);
    claim(index, (root) => root === target);
  });
  settings.forEach((setting, index) => {
    const path = setting.path.trim();
    if (!path.startsWith("~/") || matches[index]) return;
    const suffix = normalize(path.slice(1));
    // "~/" alone is the home directory, handled with bare ~ below.
    if (suffix === "/" || suffix === "") return;
    claim(index, (root) => root.endsWith(suffix));
  });
  settings.forEach((setting, index) => {
    const path = normalize(setting.path.trim());
    if (path !== "~" || matches[index] || unclaimed.size !== 1) return;
    claim(index, () => true);
  });
  return matches;
}

// Windows roots come back with backslashes and the drive letter as typed; compare on slashes
// with an uppercase drive.
function normalize(path: string): string {
  let slashed = path.replace(/\\/g, "/");
  if (/^[a-z]:\//.test(slashed)) slashed = `${slashed[0].toUpperCase()}${slashed.slice(1)}`;
  if (slashed === "/" || /^[A-Z]:\/$/.test(slashed)) return slashed;
  return slashed.replace(/\/+$/, "");
}
