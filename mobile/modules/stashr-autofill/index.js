import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

const native = Platform.OS === "android" ? requireOptionalNativeModule("StashrAutofill") : null;

export const autofillSupported = Boolean(native);
export const isServiceEnabled = () => (native ? native.isServiceEnabled() : false);
export const openAccessibilitySettings = () => native?.openAccessibilitySettings();
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
