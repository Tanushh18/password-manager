// Native crypto (react-native-quick-crypto: OpenSSL via JSI) for Android / iOS.
import QuickCrypto from "react-native-quick-crypto";
import { createCrypto } from "./cryptoCore";

const C = createCrypto(QuickCrypto);
export default C;
