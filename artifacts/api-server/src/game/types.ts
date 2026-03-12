export type Role = "villager" | "wolf" | "witch";
export type GamePhase = "lobby" | "night_wolves" | "night_witch" | "day" | "ended";

export interface Player {
  id: string;
  name: string;
  avatar: string;
  role: Role;
  isAlive: boolean;
  socketId: string;
}

export interface Room {
  id: string;
  code: string;
  hostId: string;
  players: Player[];
  settings: RoomSettings;
  phase: GamePhase;
  round: number;
  nightKillTarget: string | null;
  witchSaved: string | null;
  witchKilled: string | null;
  votes: Record<string, string>;
  eliminated: EliminatedPlayer[];
  phaseEndTime: number | null;
  isPrivate: boolean;
  witchUsedSave: boolean;
  witchUsedKill: boolean;
}

export interface EliminatedPlayer {
  player: Player;
  round: number;
  phase: GamePhase;
  cause: "wolves" | "witch_kill" | "vote";
}

export interface RoomSettings {
  maxPlayers: number;
  numWolves: number;
  hasWitch: boolean;
  nightDuration: number;
  witchDuration: number;
  dayDuration: number;
}
