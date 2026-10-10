import type { PluginSurfaceProps, SettingsState } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  type SettingsInputHandle,
  SettingsInput,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Text } from "react-native";
import type { AllowedFolder } from "../../shared/rpc";
import { type AllowedFolderSetting, explorerSettings } from "../../shared/settings";
import { FOLDER_STATUS_LABELS } from "../tree/folder-picker";
import { explorerBasename } from "../tree/paths";
import { explorerQueryKeys, useAllowedFolders } from "../tree/queries";
import { validateFolderDraft } from "./folder-draft";
import { matchFolderStatuses } from "./folder-status";

export const FOLDERS_SETTINGS_ID = "folders";

type ReadySettings = Extract<
  SettingsState<(typeof explorerSettings)["schema"]>,
  { status: "ready" }
>;

const ACCESS_NOTE =
  "Anyone using a device paired with this host can read every file inside these folders.";

export function FoldersSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(explorerSettings);
  const textStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);

  if (settings.status === "loading") return <Text style={textStyle}>Loading settings...</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Allowed folders">
        <SettingsCard>
          <SettingsAction
            label="Unable to load allowed folders"
            hint={settings.error}
            actionLabel="Reload"
            onPress={() => void settings.reload()}
          />
          {settings.status === "invalid" ? (
            <SettingsAction
              label="Reset allowed folders"
              hint="Replaces the stored list with an empty one"
              actionLabel="Reset"
              onPress={() => void settings.reset()}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    );
  }
  return <FoldersEditor settings={settings} />;
}

function FoldersEditor({ settings }: { settings: ReadySettings }) {
  const queryClient = useQueryClient();
  const folders = useAllowedFolders();
  const statuses = useMemo(
    () => matchFolderStatuses(settings.values.folders, folders.data ?? []),
    [folders.data, settings.values.folders],
  );

  async function saveFolders(next: AllowedFolderSetting[]): Promise<boolean> {
    const saved = await settings.save({ ...settings.values, folders: next }, settings.revision);
    // Statuses, roots and every open tree depend on this list.
    if (saved) await queryClient.invalidateQueries({ queryKey: explorerQueryKeys.all });
    return saved;
  }

  function remove(index: number) {
    void saveFolders(settings.values.folders.filter((_, candidate) => candidate !== index));
  }

  return (
    <>
      <SettingsSection title="Allowed folders" info={ACCESS_NOTE}>
        <SettingsCard>
          {settings.values.folders.length === 0 ? (
            <SettingsRow label="No folders yet" hint="Add a folder below to browse it in Paseo" />
          ) : (
            settings.values.folders.map((folder, index) => (
              <SettingsAction
                key={folder.path}
                label={folder.label ?? (explorerBasename(folder.path) || folder.path)}
                hint={folderHint(folder, statuses[index], folders.isPending)}
                actionLabel="Remove"
                disabled={settings.saving}
                onPress={() => remove(index)}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSection>
      <AddFolder settings={settings} onSave={saveFolders} />
    </>
  );
}

interface AddFolderProps {
  settings: ReadySettings;
  onSave(next: AllowedFolderSetting[]): Promise<boolean>;
}

function AddFolder({ settings, onSave }: AddFolderProps) {
  const pathInput = useRef<SettingsInputHandle>(null);
  const labelInput = useRef<SettingsInputHandle>(null);
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);

  function changePath(text: string) {
    setPath(text);
    setPathError(null);
  }

  async function add() {
    const draft = validateFolderDraft({ path, label, existing: settings.values.folders });
    if (draft.status === "invalid") {
      setPathError(draft.error);
      return;
    }
    if (!(await onSave([...settings.values.folders, draft.folder]))) return;
    pathInput.current?.replaceText("");
    labelInput.current?.replaceText("");
    setPath("");
    setLabel("");
  }

  return (
    <SettingsSection title="Add a folder">
      <SettingsCard>
        <SettingsInput
          ref={pathInput}
          label="Path"
          hint="Absolute, or starting with ~/ for the host user's home"
          placeholder="~/notes"
          error={pathError}
          disabled={settings.saving}
          onChangeText={changePath}
        />
        <SettingsInput
          ref={labelInput}
          label="Label"
          hint="Optional. Defaults to the folder name"
          placeholder="Notes"
          disabled={settings.saving}
          onChangeText={setLabel}
        />
        <SettingsAction
          label="Allow this folder"
          hint={ACCESS_NOTE}
          actionLabel={settings.saving ? "Saving..." : "Add"}
          error={settings.saveError}
          disabled={settings.saving}
          onPress={() => void add()}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function folderHint(
  folder: AllowedFolderSetting,
  status: AllowedFolder | null,
  loading: boolean,
): string {
  if (loading) return folder.path;
  const problem = status ? FOLDER_STATUS_LABELS[status.status] : null;
  return problem ? `${folder.path} - ${problem}` : folder.path;
}
