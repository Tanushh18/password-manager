import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

const native = Platform.OS === "android" ? requireOptionalNativeModule("StashrAutofill") : null;

export const autofillSupported = Boolean(native);
export const isServiceEnabled = () => (native ? native.isServiceEnabled() : false);
export const openAccessibilitySettings = () => native?.openAccessibilitySettings();
export const isAutofillServiceEnabled = () => (native ? native.isAutofillServiceEnabled() : false);
export const openAutofillServiceSettings = () => native?.openAutofillServiceSettings();

/** Logins the user asked Android to save: [{ ref, existingId, name, url, username, password }]. */
export const getPendingSaves = () => {
  try {
    return native ? JSON.parse(native.getPendingSaves()) : [];
  } catch (e) {
    return [];
  }
};
export const ackPendingSaves = (refs) => native?.ackPendingSaves(JSON.stringify(refs));
export const clearLinks = () => native?.clearLinks();

/** Picks the autofill service made since the app last looked: [{ key: "web:example.com" | "app:pkg", id }]. */
export const getPendingLinks = () => {
  try {
    return native ? JSON.parse(native.getPendingLinks()) : [];
  } catch (e) {
    return [];
  }
};
export const ackPendingLinks = (list) => native?.ackPendingLinks(JSON.stringify(list));
export const clearCredentials = () => native?.clearCredentials();
export const setRequireBiometric = (on) => native?.setRequireBiometric(Boolean(on));

/** Sends only what autofill needs; the native side encrypts it with a Keystore key. */
export const saveCredentials = (items) =>
  native?.saveCredentials(
    JSON.stringify(
      items
        .filter((i) => i.password)
        .map((i) => ({ id: i.id, name: i.name, username: i.username, password: i.password, url: i.url }))
    )
  );
