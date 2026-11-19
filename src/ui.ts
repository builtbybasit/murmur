// Transient UI state and the toast. Nothing here is saved.
import { reactive, watch } from "vue";

export interface ToastAction {
  label: string;
  run: () => void;
}
export interface Toast {
  title: string;
  sub?: string;
  warn?: boolean;
  actions?: ToastAction[];
  id?: number;
}

export const ui = reactive({
  view: "reader" as "reader" | "settings",
  settingsTab: "providers" as "providers" | "voices" | "segments" | "speech" | "storage",
  openProviderId: null as string | null, // provider row expanded in Settings
  fixKey: false, // Settings opened from a 401: mark the key field
  currentId: null as string | null, // chapter shown in the reader (the engine plays this one)
  follow: true, // reader auto-scrolls to the current word
  readingOpen: false, // Aa popover
  shortcutsOpen: false,
  sidebarDrawer: false, // narrow-window overlay drawer
  toast: null as Toast | null,
  flashId: null as string | null, // chapter row to flash
  renamingId: null as string | null, // chapter row in rename mode (Sidebar)
  editingId: null as string | null, // chapter whose text is open in the editor (Reader)
  epubFile: null as File | null, // EPUB being imported (EpubImport dialog)
});

// another chapter: the reader follows the playhead again
watch(
  () => ui.currentId,
  () => (ui.follow = true),
);

/** Open a chapter's text in the editor (Reader pauses playback; saving re-segments in place). */
export function edit(id: string) {
  ui.currentId = id;
  ui.view = "reader";
  ui.editingId = id;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(t: Toast, ms = 6000) {
  ui.toast = { ...t, id: Date.now() };
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (ui.toast = null), ms);
}
