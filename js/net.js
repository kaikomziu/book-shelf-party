import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 部屋を取得、無ければ指定の冊数で新規作成する(先着優先。既にあればその冊数が使われる)
export async function getOrCreateRoom(roomCode, requestedTotalBooks) {
  const { data, error } = await supabase.rpc("bookshelf_get_or_create_room", {
    p_room: roomCode,
    p_total: requestedTotalBooks,
  });
  if (error) {
    console.warn("[bookshelf] getOrCreateRoom error:", error.message);
    return { error };
  }
  return { totalBooks: data };
}

// 部屋の中で「触られたことのある本」(held/placed)だけを取得する
export async function fetchRoomBookStates(roomCode) {
  const { data, error } = await supabase
    .from("bookshelf_book_state")
    .select("book_id, state, holder_id")
    .eq("room_code", roomCode);
  if (error) {
    console.warn("[bookshelf] fetchRoomBookStates error:", error.message);
    return [];
  }
  return data || [];
}

export async function pickupBook(roomCode, bookId, holderId) {
  const { data, error } = await supabase.rpc("bookshelf_pickup", {
    p_room: roomCode,
    p_book_id: bookId,
    p_holder: holderId,
  });
  if (error) {
    console.warn("[bookshelf] pickupBook error:", error.message);
    return false;
  }
  return !!data;
}

export async function placeBook(roomCode, bookId, holderId) {
  const { data, error } = await supabase.rpc("bookshelf_place", {
    p_room: roomCode,
    p_book_id: bookId,
    p_holder: holderId,
  });
  if (error) {
    console.warn("[bookshelf] placeBook error:", error.message);
    return false;
  }
  return !!data;
}

export async function releaseAllHeldBy(roomCode, holderId) {
  const { error } = await supabase.rpc("bookshelf_release_all", {
    p_room: roomCode,
    p_holder: holderId,
  });
  if (error) console.warn("[bookshelf] releaseAllHeldBy error:", error.message);
}

// 本の状態変化(拾う/置く/手放す)をリアルタイム購読する
export function subscribeBookChanges(roomCode, onChange) {
  const ch = supabase
    .channel("bookshelf_state_" + roomCode)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "bookshelf_book_state", filter: `room_code=eq.${roomCode}` },
      (payload) => onChange(payload)
    )
    .subscribe();
  return ch;
}

// プレイヤーの移動・入退室はDBを使わずbroadcast/presenceでリアルタイム共有する
export function joinRoomLive(roomCode, myId, initialMeta, handlers) {
  const ch = supabase.channel("bookshelf_live_" + roomCode, {
    config: { broadcast: { self: false }, presence: { key: myId } },
  });

  if (handlers.onMove) {
    ch.on("broadcast", { event: "move" }, ({ payload }) => handlers.onMove(payload));
  }
  ch.on("presence", { event: "sync" }, () => {
    handlers.onPresenceSync && handlers.onPresenceSync(ch.presenceState());
  });
  ch.on("presence", { event: "leave" }, ({ key, leftPresences }) => {
    handlers.onPresenceLeave && handlers.onPresenceLeave(key, leftPresences);
  });

  ch.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      await ch.track(initialMeta);
    }
  });

  return {
    sendMove(pos, rotationY) {
      ch.send({ type: "broadcast", event: "move", payload: { id: myId, x: pos.x, z: pos.z, rotationY } });
    },
    updatePresence(meta) {
      ch.track(meta);
    },
    leave() {
      supabase.removeChannel(ch);
    },
  };
}
