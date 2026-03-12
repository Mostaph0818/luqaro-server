import { Server, Socket } from "socket.io";
import * as rm from "./roomManager";
import { Room, Player } from "./types";

const PHASE_DURATIONS = {
  night_wolves: 15000,
  night_witch: 15000,
  day: 20000,
};

const phaseTimers = new Map<string, ReturnType<typeof setTimeout>>();

function broadcastRoom(io: Server, room: Room) {
  io.to(room.id).emit("room_update", sanitizeRoom(room));
}

function sanitizeRoom(room: Room) {
  return {
    ...room,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      isAlive: p.isAlive,
      socketId: p.socketId,
    })),
  };
}

function sendRoleToPlayer(io: Server, room: Room, player: Player) {
  io.to(player.socketId).emit("your_role", {
    role: player.role,
    description: getRoleDescription(player.role),
    wolfTeam: player.role === "wolf"
      ? room.players.filter(p => p.role === "wolf").map(p => ({ id: p.id, name: p.name, avatar: p.avatar }))
      : null,
  });
}

function getRoleDescription(role: string): string {
  switch (role) {
    case "wolf": return "أنت ذئب! تعاون مع ذئابك ليلاً لاغتيال القرويين.";
    case "witch": return "أنت الساحرة! لديك دواء للإنقاذ وسُم للقتل - استخدميهما بحكمة.";
    default: return "أنت قروي! كشف الذئاب بالتصويت نهاراً هو طريقك للفوز.";
  }
}

function startPhase(io: Server, roomId: string, phase: Room["phase"]) {
  const room = rm.getRoom(roomId);
  if (!room) return;

  clearPhaseTimer(roomId);
  room.phase = phase;
  room.votes = {};

  if (phase === "night_wolves") {
    room.round++;
    room.nightKillTarget = null;
    room.witchSaved = null;
    room.witchKilled = null;
    const duration = room.settings.nightDuration * 1000 || PHASE_DURATIONS.night_wolves;
    room.phaseEndTime = Date.now() + duration;
    broadcastRoom(io, room);
    io.to(roomId).emit("phase_change", { phase, duration, round: room.round });

    // Notify wolves specifically
    room.players.filter(p => p.role === "wolf" && p.isAlive).forEach(wolf => {
      io.to(wolf.socketId).emit("wolves_chat_open", true);
    });

    const timer = setTimeout(() => endWolvesPhase(io, roomId), duration);
    phaseTimers.set(roomId, timer);
  } else if (phase === "night_witch") {
    const duration = room.settings.witchDuration * 1000 || PHASE_DURATIONS.night_witch;
    room.phaseEndTime = Date.now() + duration;
    broadcastRoom(io, room);
    io.to(roomId).emit("phase_change", { phase, duration, killTarget: room.nightKillTarget, round: room.round });

    // Open witch screen
    const witch = room.players.find(p => p.role === "witch" && p.isAlive);
    if (witch) {
      io.to(witch.socketId).emit("witch_turn", {
        killTarget: room.nightKillTarget,
        canSave: !room.witchUsedSave,
        canKill: !room.witchUsedKill,
        alivePlayers: room.players.filter(p => p.isAlive).map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
      });
    }

    const timer = setTimeout(() => endWitchPhase(io, roomId), duration);
    phaseTimers.set(roomId, timer);
  } else if (phase === "day") {
    applyNightResults(io, room);
    const duration = room.settings.dayDuration * 1000 || PHASE_DURATIONS.day;
    room.phaseEndTime = Date.now() + duration;

    const winner = rm.checkWinCondition(room);
    if (winner) {
      endGame(io, room, winner);
      return;
    }

    broadcastRoom(io, room);
    io.to(roomId).emit("phase_change", {
      phase,
      duration,
      round: room.round,
      nightResults: buildNightResults(room),
    });

    const timer = setTimeout(() => endDayPhase(io, roomId), duration);
    phaseTimers.set(roomId, timer);
  }
}

function buildNightResults(room: Room) {
  const eliminated = room.eliminated.filter(e => e.round === room.round);
  return eliminated.map(e => ({
    player: { id: e.player.id, name: e.player.name, avatar: e.player.avatar },
    cause: e.cause,
    role: e.player.role,
  }));
}

function applyNightResults(io: Server, room: Room) {
  // Apply wolf kill
  if (room.nightKillTarget) {
    const saved = room.witchSaved === room.nightKillTarget;
    if (!saved) {
      rm.eliminatePlayer(room, room.nightKillTarget, "wolves");
    }
  }
  // Apply witch kill
  if (room.witchKilled) {
    rm.eliminatePlayer(room, room.witchKilled, "witch_kill");
  }
}

function endWolvesPhase(io: Server, roomId: string) {
  const room = rm.getRoom(roomId);
  if (!room) return;
  // Close wolves chat and clear it
  room.players.filter(p => p.role === "wolf").forEach(wolf => {
    io.to(wolf.socketId).emit("wolves_chat_open", false);
  });
  const witchAlive = room.players.find(p => p.role === "witch" && p.isAlive);
  if (witchAlive && (room.witchUsedSave === false || room.witchUsedKill === false)) {
    startPhase(io, roomId, "night_witch");
  } else {
    startPhase(io, roomId, "day");
  }
}

function endWitchPhase(io: Server, roomId: string) {
  startPhase(io, roomId, "day");
}

function endDayPhase(io: Server, roomId: string) {
  const room = rm.getRoom(roomId);
  if (!room) return;

  // Count votes
  const voteCounts: Record<string, number> = {};
  Object.values(room.votes).forEach(targetId => {
    voteCounts[targetId] = (voteCounts[targetId] || 0) + 1;
  });

  let maxVotes = 0;
  let eliminated: string | null = null;
  for (const [playerId, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminated = playerId;
    }
  }

  let eliminatedPlayer = null;
  if (eliminated) {
    eliminatedPlayer = rm.eliminatePlayer(room, eliminated, "vote");
  }

  io.to(roomId).emit("day_result", {
    eliminated: eliminatedPlayer ? {
      id: eliminatedPlayer.id,
      name: eliminatedPlayer.name,
      avatar: eliminatedPlayer.avatar,
      role: eliminatedPlayer.role,
    } : null,
    votes: voteCounts,
  });

  const winner = rm.checkWinCondition(room);
  if (winner) {
    setTimeout(() => endGame(io, room, winner), 3000);
    return;
  }

  setTimeout(() => startPhase(io, roomId, "night_wolves"), 5000);
}

function endGame(io: Server, room: Room, winner: "wolves" | "villagers") {
  room.phase = "ended";
  clearPhaseTimer(room.id);
  broadcastRoom(io, room);
  io.to(room.id).emit("game_ended", {
    winner,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      role: p.role,
      isAlive: p.isAlive,
    })),
  });
}

function clearPhaseTimer(roomId: string) {
  const timer = phaseTimers.get(roomId);
  if (timer) {
    clearTimeout(timer);
    phaseTimers.delete(roomId);
  }
}

export function setupGameSocket(io: Server) {
  io.on("connection", (socket: Socket) => {
    let currentRoomId: string | null = null;
    let currentPlayerId: string | null = null;

    socket.on("create_room", ({ player, settings, isPrivate }) => {
      const room = rm.createRoom({ ...player, socketId: socket.id }, settings, isPrivate ?? false);
      currentRoomId = room.id;
      currentPlayerId = player.id;
      socket.join(room.id);
      socket.emit("room_created", { roomId: room.id, code: room.code });
      broadcastRoom(io, room);
    });

    socket.on("join_room", ({ player, roomId }) => {
      const room = rm.joinRoom(roomId, { ...player, socketId: socket.id });
      if (!room) {
        socket.emit("error", { message: "الغرفة ممتلئة أو غير موجودة" });
        return;
      }
      currentRoomId = room.id;
      currentPlayerId = player.id;
      socket.join(room.id);
      socket.emit("room_joined", { roomId: room.id, code: room.code });
      broadcastRoom(io, room);
    });

    socket.on("join_by_code", ({ player, code }) => {
      const room = rm.findRoomByCode(code.toUpperCase());
      if (!room) {
        socket.emit("error", { message: "كود الغرفة غير صحيح" });
        return;
      }
      const joined = rm.joinRoom(room.id, { ...player, socketId: socket.id });
      if (!joined) {
        socket.emit("error", { message: "الغرفة ممتلئة أو اللعبة بدأت" });
        return;
      }
      currentRoomId = room.id;
      currentPlayerId = player.id;
      socket.join(room.id);
      socket.emit("room_joined", { roomId: room.id, code: room.code });
      broadcastRoom(io, joined);
    });

    socket.on("join_random", ({ player }) => {
      let room = rm.joinRandomRoom({ ...player, socketId: socket.id });
      if (!room) {
        // Create a public room
        room = rm.createRoom({ ...player, socketId: socket.id }, {
          maxPlayers: 8,
          numWolves: 2,
          hasWitch: true,
          nightDuration: 15,
          witchDuration: 15,
          dayDuration: 20,
        }, false);
      }
      currentRoomId = room.id;
      currentPlayerId = player.id;
      socket.join(room.id);
      socket.emit("room_joined", { roomId: room.id, code: room.code });
      broadcastRoom(io, room);
    });

    socket.on("start_game", ({ roomId }) => {
      const room = rm.getRoom(roomId);
      if (!room || room.hostId !== currentPlayerId) return;
      if (room.players.length < 4) {
        socket.emit("error", { message: "يجب أن يكون عدد اللاعبين 4 على الأقل" });
        return;
      }
      rm.assignRoles(room);
      room.players.forEach(player => sendRoleToPlayer(io, room, player));
      io.to(roomId).emit("game_started");
      setTimeout(() => startPhase(io, roomId, "night_wolves"), 3000);
    });

    socket.on("wolf_vote", ({ roomId, targetId }) => {
      const room = rm.getRoom(roomId);
      if (!room || room.phase !== "night_wolves") return;
      const player = room.players.find(p => p.id === currentPlayerId);
      if (!player || player.role !== "wolf" || !player.isAlive) return;
      // Wolves vote on kill target
      room.votes[currentPlayerId!] = targetId;
      // Most voted becomes target
      const voteCounts: Record<string, number> = {};
      Object.values(room.votes).forEach(id => { voteCounts[id] = (voteCounts[id] || 0) + 1; });
      let max = 0, target = null;
      for (const [id, count] of Object.entries(voteCounts)) {
        if (count > max) { max = count; target = id; }
      }
      room.nightKillTarget = target;
      // Notify wolves of current target
      room.players.filter(p => p.role === "wolf" && p.isAlive).forEach(wolf => {
        io.to(wolf.socketId).emit("wolf_target_update", { targetId: target });
      });
    });

    socket.on("witch_action", ({ roomId, action, targetId }) => {
      const room = rm.getRoom(roomId);
      if (!room || room.phase !== "night_witch") return;
      const player = room.players.find(p => p.id === currentPlayerId);
      if (!player || player.role !== "witch" || !player.isAlive) return;

      if (action === "save" && !room.witchUsedSave) {
        room.witchSaved = room.nightKillTarget;
        room.witchUsedSave = true;
      } else if (action === "kill" && !room.witchUsedKill && targetId) {
        room.witchKilled = targetId;
        room.witchUsedKill = true;
      } else if (action === "skip") {
        // do nothing
      }
      clearPhaseTimer(roomId);
      endWitchPhase(io, roomId);
    });

    socket.on("day_vote", ({ roomId, targetId }) => {
      const room = rm.getRoom(roomId);
      if (!room || room.phase !== "day") return;
      const player = room.players.find(p => p.id === currentPlayerId);
      if (!player || !player.isAlive) return;
      room.votes[currentPlayerId!] = targetId;
      io.to(roomId).emit("vote_update", { votes: room.votes });
    });

    socket.on("wolf_chat", ({ roomId, message }) => {
      const room = rm.getRoom(roomId);
      if (!room || room.phase !== "night_wolves") return;
      const player = room.players.find(p => p.id === currentPlayerId);
      if (!player || player.role !== "wolf" || !player.isAlive) return;
      room.players.filter(p => p.role === "wolf" && p.isAlive).forEach(wolf => {
        io.to(wolf.socketId).emit("wolf_message", {
          from: { id: player.id, name: player.name, avatar: player.avatar },
          message,
          timestamp: Date.now(),
        });
      });
    });

    socket.on("disconnect", () => {
      if (currentRoomId && currentPlayerId) {
        rm.leaveRoom(currentRoomId, currentPlayerId);
        const room = rm.getRoom(currentRoomId);
        if (room) broadcastRoom(io, room);
      }
    });
  });
}
