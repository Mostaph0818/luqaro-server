import { Room, Player, RoomSettings, Role, EliminatedPlayer } from "./types";

const rooms = new Map<string, Room>();

function generateCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export function createRoom(hostPlayer: Omit<Player, "role" | "isAlive">, settings: RoomSettings, isPrivate: boolean): Room {
  const code = generateCode();
  const room: Room = {
    id: generateId(),
    code,
    hostId: hostPlayer.id,
    players: [{ ...hostPlayer, role: "villager", isAlive: true }],
    settings,
    phase: "lobby",
    round: 0,
    nightKillTarget: null,
    witchSaved: null,
    witchKilled: null,
    votes: {},
    eliminated: [],
    phaseEndTime: null,
    isPrivate,
    witchUsedSave: false,
    witchUsedKill: false,
  };
  rooms.set(room.id, room);
  return room;
}

export function joinRoom(roomId: string, player: Omit<Player, "role" | "isAlive">): Room | null {
  const room = rooms.get(roomId);
  if (!room || room.phase !== "lobby") return null;
  if (room.players.length >= room.settings.maxPlayers) return null;
  if (room.players.find(p => p.id === player.id)) return null;
  room.players.push({ ...player, role: "villager", isAlive: true });
  return room;
}

export function joinRandomRoom(player: Omit<Player, "role" | "isAlive">): Room | null {
  for (const room of rooms.values()) {
    if (!room.isPrivate && room.phase === "lobby" && room.players.length < room.settings.maxPlayers) {
      return joinRoom(room.id, player);
    }
  }
  return null;
}

export function findRoomByCode(code: string): Room | null {
  for (const room of rooms.values()) {
    if (room.code === code) return room;
  }
  return null;
}

export function getRoom(roomId: string): Room | null {
  return rooms.get(roomId) ?? null;
}

export function assignRoles(room: Room): void {
  const players = [...room.players];
  // Shuffle
  for (let i = players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [players[i], players[j]] = [players[j], players[i]];
  }

  const roles: Role[] = [];
  for (let i = 0; i < room.settings.numWolves; i++) roles.push("wolf");
  if (room.settings.hasWitch && players.length > room.settings.numWolves) roles.push("witch");
  while (roles.length < players.length) roles.push("villager");

  players.forEach((p, i) => {
    const player = room.players.find(rp => rp.id === p.id);
    if (player) player.role = roles[i];
  });
}

export function eliminatePlayer(room: Room, playerId: string, cause: EliminatedPlayer["cause"]): Player | null {
  const player = room.players.find(p => p.id === playerId);
  if (!player || !player.isAlive) return null;
  player.isAlive = false;
  room.eliminated.push({ player: { ...player }, round: room.round, phase: room.phase, cause });
  return player;
}

export function checkWinCondition(room: Room): "wolves" | "villagers" | null {
  const alivePlayers = room.players.filter(p => p.isAlive);
  const aliveWolves = alivePlayers.filter(p => p.role === "wolf");
  const aliveVillagers = alivePlayers.filter(p => p.role !== "wolf");

  if (aliveWolves.length === 0) return "villagers";
  if (aliveWolves.length >= aliveVillagers.length) return "wolves";
  return null;
}

export function leaveRoom(roomId: string, playerId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  room.players = room.players.filter(p => p.id !== playerId);
  if (room.players.length === 0) {
    rooms.delete(roomId);
  } else if (room.hostId === playerId) {
    room.hostId = room.players[0].id;
  }
}

export function removeRoom(roomId: string): void {
  rooms.delete(roomId);
}
