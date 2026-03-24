import nacl from "tweetnacl";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Identity {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

const DEFAULT_PATH = join(homedir(), ".eden", "identity.json");

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createIdentity(
  options?: { path?: string },
): Promise<Identity> {
  const filePath = options?.path ?? DEFAULT_PATH;
  const dir = dirname(filePath);

  try {
    const raw = JSON.parse(await readFile(filePath, "utf-8")) as {
      publicKey: string;
      secretKey: string;
    };
    return {
      publicKey: hexToBytes(raw.publicKey),
      secretKey: hexToBytes(raw.secretKey),
    };
  } catch {
    // file does not exist — generate new identity
  }

  const keyPair = nacl.box.keyPair();

  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o700);

  const json = JSON.stringify({
    publicKey: bytesToHex(keyPair.publicKey),
    secretKey: bytesToHex(keyPair.secretKey),
  });

  await writeFile(filePath, json, { mode: 0o600 });

  return {
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey,
  };
}

export function derivePeerId(publicKey: Uint8Array): string {
  return createHash("sha256").update(publicKey).digest("hex");
}
