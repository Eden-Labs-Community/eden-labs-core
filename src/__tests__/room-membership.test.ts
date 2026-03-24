import { RoomManager } from "../routing/room-manager.js";

function makeMockRouter() {
  const sent: Array<{ target: string; payload: Buffer }> = [];
  const broadcasts: Buffer[] = [];
  return {
    send: (target: string, payload: Buffer) => { sent.push({ target, payload }); },
    broadcast: (payload: Buffer) => { broadcasts.push(payload); },
    sent,
    broadcasts,
  };
}

describe("RoomManager", () => {
  it("join adds peer to room membership", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router });

    rm.join("room-1");
    expect(rm.getMembers("room-1")).toContain("me");
  });

  it("leave removes peer from room", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router });

    rm.join("room-1");
    rm.leave("room-1");
    expect(rm.getMembers("room-1")).not.toContain("me");
  });

  it("addMember tracks remote peer in room", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router });

    rm.join("room-1");
    rm.addMember("room-1", "peer-bob");
    expect(rm.getMembers("room-1")).toContain("peer-bob");
  });

  it("removeMember removes remote peer from room", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router });

    rm.join("room-1");
    rm.addMember("room-1", "peer-bob");
    rm.removeMember("room-1", "peer-bob");
    expect(rm.getMembers("room-1")).not.toContain("peer-bob");
  });

  it("join announces to existing members via router.send", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router });

    rm.addMember("room-1", "peer-bob");
    rm.addMember("room-1", "peer-alice");
    rm.join("room-1");

    // Should send join announcement to each member
    const joinMsgs = router.sent.filter((s) => {
      const msg = JSON.parse(s.payload.toString());
      return msg.type === "__room_join__";
    });
    expect(joinMsgs).toHaveLength(2);
    expect(joinMsgs.map((m) => m.target).sort()).toEqual(["peer-alice", "peer-bob"]);
  });

  it("leave announces to members via router.send", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router });

    rm.join("room-1");
    rm.addMember("room-1", "peer-bob");
    rm.leave("room-1");

    const leaveMsgs = router.sent.filter((s) => {
      const msg = JSON.parse(s.payload.toString());
      return msg.type === "__room_leave__";
    });
    expect(leaveMsgs).toHaveLength(1);
    expect(leaveMsgs[0]!.target).toBe("peer-bob");
  });

  it("sendToRoom sends to each member via router.send for small rooms", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router });

    rm.join("room-1");
    rm.addMember("room-1", "peer-bob");
    rm.addMember("room-1", "peer-alice");

    rm.sendToRoom("room-1", Buffer.from("hello room"));

    // Should send to bob and alice (not to self)
    expect(router.sent.length).toBeGreaterThanOrEqual(2);
    const targets = router.sent
      .filter((s) => s.payload.toString() === "hello room")
      .map((s) => s.target);
    expect(targets).toContain("peer-bob");
    expect(targets).toContain("peer-alice");
    expect(targets).not.toContain("me");
  });

  it("sendToRoom uses broadcast for large rooms", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router, broadcastThreshold: 3 });

    rm.join("room-1");
    for (let i = 0; i < 5; i++) {
      rm.addMember("room-1", `peer-${i}`);
    }

    rm.sendToRoom("room-1", Buffer.from("big room msg"));

    // Should broadcast instead of N sends
    expect(router.broadcasts).toHaveLength(1);
  });

  it("maxPeersPerRoom limits room size", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router, maxPeersPerRoom: 2 });

    rm.join("room-1");
    rm.addMember("room-1", "peer-bob");

    // Room has 2 members (me + bob), adding another should be rejected
    expect(() => rm.addMember("room-1", "peer-alice")).toThrow("maxPeersPerRoom");
  });

  it("getRooms returns rooms the peer has joined", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router });

    rm.join("room-a");
    rm.join("room-b");

    expect(rm.getRooms().sort()).toEqual(["room-a", "room-b"]);
  });

  it("getMembers returns empty array for unknown room", () => {
    const router = makeMockRouter();
    const rm = new RoomManager({ peerId: "me", router });

    expect(rm.getMembers("nonexistent")).toEqual([]);
  });
});
