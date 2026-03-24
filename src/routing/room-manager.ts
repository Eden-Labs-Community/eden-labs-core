export interface RoomRouter {
  send(targetPeerId: string, payload: Buffer): void;
  broadcast(payload: Buffer): void;
}

export interface RoomManagerOptions {
  peerId: string;
  router: RoomRouter;
  maxPeersPerRoom?: number;
  broadcastThreshold?: number;
}

const DEFAULT_MAX_PEERS_PER_ROOM = 100;
const DEFAULT_BROADCAST_THRESHOLD = 50;

export class RoomManager {
  private readonly peerId: string;
  private readonly router: RoomRouter;
  private readonly maxPeersPerRoom: number;
  private readonly broadcastThreshold: number;
  private readonly rooms = new Map<string, Set<string>>();
  private readonly myRooms = new Set<string>();

  constructor(options: RoomManagerOptions) {
    this.peerId = options.peerId;
    this.router = options.router;
    this.maxPeersPerRoom = options.maxPeersPerRoom ?? DEFAULT_MAX_PEERS_PER_ROOM;
    this.broadcastThreshold = options.broadcastThreshold ?? DEFAULT_BROADCAST_THRESHOLD;
  }

  join(roomId: string): void {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    const members = this.rooms.get(roomId)!;

    // Announce to existing members before adding self
    const announcement = Buffer.from(JSON.stringify({
      type: "__room_join__",
      roomId,
      peerId: this.peerId,
    }));
    for (const member of members) {
      if (member !== this.peerId) {
        this.router.send(member, announcement);
      }
    }

    members.add(this.peerId);
    this.myRooms.add(roomId);
  }

  leave(roomId: string): void {
    const members = this.rooms.get(roomId);
    if (!members) return;

    members.delete(this.peerId);
    this.myRooms.delete(roomId);

    // Announce to remaining members
    const announcement = Buffer.from(JSON.stringify({
      type: "__room_leave__",
      roomId,
      peerId: this.peerId,
    }));
    for (const member of members) {
      this.router.send(member, announcement);
    }

    if (members.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  addMember(roomId: string, peerId: string): void {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, new Set());
    }
    const members = this.rooms.get(roomId)!;
    if (members.size >= this.maxPeersPerRoom) {
      throw new Error(`maxPeersPerRoom limit reached (${this.maxPeersPerRoom})`);
    }
    members.add(peerId);
  }

  removeMember(roomId: string, peerId: string): void {
    const members = this.rooms.get(roomId);
    if (!members) return;
    members.delete(peerId);
    if (members.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  sendToRoom(roomId: string, payload: Buffer): void {
    const members = this.rooms.get(roomId);
    if (!members) return;

    const otherMembers = [...members].filter((m) => m !== this.peerId);

    if (otherMembers.length >= this.broadcastThreshold) {
      this.router.broadcast(payload);
      return;
    }

    for (const member of otherMembers) {
      this.router.send(member, payload);
    }
  }

  getMembers(roomId: string): string[] {
    const members = this.rooms.get(roomId);
    return members ? [...members] : [];
  }

  getRooms(): string[] {
    return [...this.myRooms];
  }
}
