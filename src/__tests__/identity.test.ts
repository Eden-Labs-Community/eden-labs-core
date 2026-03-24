import { createIdentity, derivePeerId } from "../crypto/identity.js";
import nacl from "tweetnacl";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("createIdentity", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "eden-id-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("generates and saves identity to custom path", async () => {
    const idPath = join(tmpDir, "identity.json");
    const identity = await createIdentity({ path: idPath });
    expect(identity.publicKey).toBeInstanceOf(Uint8Array);
    expect(identity.secretKey).toBeInstanceOf(Uint8Array);
    expect(identity.publicKey.length).toBe(32);
    expect(identity.secretKey.length).toBe(32);
  });

  it("saves keys as hex in JSON", async () => {
    const idPath = join(tmpDir, "identity.json");
    await createIdentity({ path: idPath });
    const raw = JSON.parse(await readFile(idPath, "utf-8"));
    expect(typeof raw.publicKey).toBe("string");
    expect(typeof raw.secretKey).toBe("string");
    expect(raw.publicKey.length).toBe(64);
    expect(raw.secretKey.length).toBe(64);
  });

  it("second call returns the same keys (persistence)", async () => {
    const idPath = join(tmpDir, "identity.json");
    const first = await createIdentity({ path: idPath });
    const second = await createIdentity({ path: idPath });
    expect(Buffer.from(first.publicKey).equals(Buffer.from(second.publicKey))).toBe(true);
    expect(Buffer.from(first.secretKey).equals(Buffer.from(second.secretKey))).toBe(true);
  });

  it("creates parent directory if it does not exist", async () => {
    const nested = join(tmpDir, "sub", "dir", "identity.json");
    const identity = await createIdentity({ path: nested });
    expect(identity.publicKey.length).toBe(32);
  });

  it("sets directory permissions to 0o700", async () => {
    const dir = join(tmpDir, "secure");
    const idPath = join(dir, "identity.json");
    await createIdentity({ path: idPath });
    const dirStat = await stat(dir);
    expect(dirStat.mode & 0o777).toBe(0o700);
  });

  it("sets file permissions to 0o600", async () => {
    const idPath = join(tmpDir, "identity.json");
    await createIdentity({ path: idPath });
    const fileStat = await stat(idPath);
    expect(fileStat.mode & 0o777).toBe(0o600);
  });
});

describe("derivePeerId", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const kp = nacl.box.keyPair();
    const peerId = derivePeerId(kp.publicKey);
    expect(typeof peerId).toBe("string");
    expect(peerId.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(peerId)).toBe(true);
  });

  it("is deterministic", () => {
    const kp = nacl.box.keyPair();
    expect(derivePeerId(kp.publicKey)).toBe(derivePeerId(kp.publicKey));
  });

  it("different keys produce different IDs", () => {
    const a = nacl.box.keyPair();
    const b = nacl.box.keyPair();
    expect(derivePeerId(a.publicKey)).not.toBe(derivePeerId(b.publicKey));
  });
});
