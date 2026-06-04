/**
 * Chat screen — shared by civil, security, and admin.
 *
 * FIX ISSUE #3:
 *   1. On open, the LAST message is auto-loaded AND the FlatList is scrolled
 *      to the end.  The previous behaviour fetched messages but didn't
 *      scroll, so the user landed on a blank screen with messages below
 *      the fold.
 *   2. After sending a new message, the new bubble is appended AND the
 *      FlatList is auto-scrolled to the end so the user sees their own
 *      message without manual scrolling.
 *   3. Polls every 4 seconds while the screen is mounted so live messages
 *      from the other side appear without a manual refresh.
 *   4. Marks the conversation as read on open and on any new message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView, Platform,
  Pressable, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import * as SecureStore from "expo-secure-store";

type Message = {
  id:        string;
  sender_id: string;
  message:   string;
  sent_at:   string;
};

const API = () => process.env.EXPO_PUBLIC_API_URL || "";
const POLL_MS = 4000;

export default function ChatScreen() {
  const { conversationId, otherId, otherName } = useLocalSearchParams<{
    conversationId: string;
    otherId?:       string;
    otherName?:     string;
  }>();

  const [me,         setMe]         = useState<string>("");
  const [messages,   setMessages]   = useState<Message[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [draft,      setDraft]      = useState("");
  const [sending,    setSending]    = useState(false);

  const listRef = useRef<FlatList<Message>>(null);

  const authHeader = useCallback(async (): Promise<Record<string, string>> => {
    const t = await SecureStore.getItemAsync("auth_token");
    return t
      ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }, []);

  // Load conversation partner and resolve my user id from the token.
  useEffect(() => {
    (async () => {
      const t = await SecureStore.getItemAsync("auth_token");
      if (!t) return;
      try {
        const meResp = await fetch(`${API()}/api/user/profile`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        if (meResp.ok) {
          const data = await meResp.json();
          setMe(String(data.user_id || ""));
        }
      } catch { /* tolerate */ }
    })();
  }, []);

  // FIX ISSUE #3a: load messages AND scroll to the end on first paint.
  const loadMessages = useCallback(async (scrollToEnd: boolean) => {
    try {
      const resp = await fetch(`${API()}/api/chat/${conversationId}/messages`, {
        headers: await authHeader(),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const list: Message[] = (data.messages || []).map((m: any) => ({
        id:        String(m.id ?? m._id ?? Math.random()),
        sender_id: String(m.sender_id ?? m.from_user_id ?? ""),
        message:   String(m.message ?? m.content ?? ""),
        sent_at:   String(m.sent_at ?? m.timestamp ?? new Date().toISOString()),
      }));
      setMessages(list);
      if (scrollToEnd) {
        // Wait one frame for layout, then jump to bottom.
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: false });
        });
      }
      // Mark as read.
      try {
        await fetch(`${API()}/api/chat/mark-read`, {
          method:  "POST",
          headers: await authHeader(),
          body:    JSON.stringify({ conversation_id: conversationId }),
        });
      } catch { /* non-fatal */ }
    } finally {
      setLoading(false);
    }
  }, [conversationId, authHeader]);

  useEffect(() => {
    if (!conversationId) return;
    loadMessages(true);
  }, [conversationId, loadMessages]);

  // Poll for new messages while the screen is mounted.
  useEffect(() => {
    if (!conversationId) return;
    const id = setInterval(() => loadMessages(false), POLL_MS);
    return () => clearInterval(id);
  }, [conversationId, loadMessages]);

  // FIX ISSUE #3b: send message, append optimistically, then scroll to end.
  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    // Optimistic append
    const optimistic: Message = {
      id:        `tmp-${Date.now()}`,
      sender_id: me,
      message:   text,
      sent_at:   new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

    try {
      const resp = await fetch(`${API()}/api/chat/send`, {
        method: "POST",
        headers: await authHeader(),
        body: JSON.stringify({
          conversation_id: conversationId,
          to_user_id:      otherId,        // backend tolerates either
          content:         text,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      // Reload to pick up the server-assigned id/timestamp + any peer reply
      // that may have arrived in the same tick.
      await loadMessages(true);
    } catch (e) {
      // Roll back optimistic append on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);   // restore the draft
    } finally {
      setSending(false);
    }
  }, [draft, sending, me, conversationId, otherId, authHeader, loadMessages]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{otherName || "Chat"}</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#2563eb" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const mine = item.sender_id === me;
            return (
              <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>
                    {item.message}
                  </Text>
                </View>
              </View>
            );
          }}
          // Keep the list pinned to the bottom on content-size changes.
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        />
      )}

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message…"
          placeholderTextColor="#94a3b8"
          value={draft}
          onChangeText={setDraft}
          multiline
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sending}
          style={({ pressed }) => [
            styles.sendBtn,
            (!draft.trim() || sending) && { opacity: 0.5 },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={styles.sendText}>{sending ? "…" : "Send"}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root:        { flex: 1, backgroundColor: "#0b1220" },
  header:      { padding: 16, paddingTop: 56, backgroundColor: "#0f172a",
                 borderBottomWidth: 1, borderBottomColor: "#1e293b" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  center:      { flex: 1, alignItems: "center", justifyContent: "center" },

  list:        { padding: 12, gap: 6, flexGrow: 1, justifyContent: "flex-end" },
  bubbleRow:   { flexDirection: "row" },
  rowMine:     { justifyContent: "flex-end" },
  rowTheirs:   { justifyContent: "flex-start" },
  bubble:      { maxWidth: "80%", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16 },
  bubbleMine:  { backgroundColor: "#2563eb", borderBottomRightRadius: 4 },
  bubbleTheirs:{ backgroundColor: "#1e293b", borderBottomLeftRadius: 4 },
  bubbleTextMine:   { color: "#fff",    fontSize: 15 },
  bubbleTextTheirs: { color: "#e2e8f0", fontSize: 15 },

  composer:    { flexDirection: "row", alignItems: "flex-end", gap: 8,
                 padding: 8, paddingBottom: 24, backgroundColor: "#0f172a",
                 borderTopWidth: 1, borderTopColor: "#1e293b" },
  input:       { flex: 1, color: "#fff", backgroundColor: "#1e293b",
                 borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10,
                 maxHeight: 120, fontSize: 15 },
  sendBtn:     { backgroundColor: "#2563eb", paddingHorizontal: 18, paddingVertical: 12,
                 borderRadius: 18, alignItems: "center", justifyContent: "center" },
  sendText:    { color: "#fff", fontWeight: "700", fontSize: 15 },
});
