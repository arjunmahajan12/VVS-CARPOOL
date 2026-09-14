// Generates a VAPID key pair for web push. Run: node scripts/vapid.mjs
import { generateKeyPairSync } from "node:crypto";
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const b64u = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pub = publicKey.export({ format: "jwk" }), prv = privateKey.export({ format: "jwk" });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64"), Buffer.from(pub.y, "base64")]);
console.log("VAPID_PUBLIC_KEY=" + b64u(raw));
console.log("VAPID_PRIVATE_KEY=" + prv.d);
